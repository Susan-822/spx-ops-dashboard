/**
 * microstructure-validation-engine.js
 *
 * 0DTE 微观结构交叉验证引擎
 * ─────────────────────────────────────────────────────────────────────────────
 * 核心设计原则（来自 White Glass Lab 架构规范）：
 *
 * 1. 主动剔除 Volume 噪音：所有判定约束在 aggressor_side 上。
 *    无法判断 Hit-the-Bid vs Hit-the-Ask 的订单直接视为白噪音，不计入模型。
 *
 * 2. 一票否决权（Veto Power）：资金流是动力，希腊字母敞口是阻力。
 *    目标突破位存在极端负 Charm（做市商机器抛压盖子）时，
 *    即使底层资金流看多，系统强制输出 flip_conflict_wait，锁死开仓权限。
 *
 * 3. 绝对风控层：IFVG 破位时强制终止所有交易逻辑。
 *
 * 数据来源：
 * - flow_recent_queue: FlowRecentQueue 实例（内存队列，0.7s 逐笔高频数据）
 * - greek_exposure_strike: UW API /api/stock/SPX/greek-exposure/strike（逐行权价）
 * - net_gex: dealer_factors.net_gex（全盘净 Gamma 敞口）
 *
 * 输出状态码（直接映射到前端 status 标签体系）：
 * - SIGNAL_TERMINATE       绝对风控：IFVG 破位，强制平仓
 * - flip_conflict_wait     资金看多但 Charm 铁顶，禁止开仓
 * - uw_call_strong         资金看多且无压制，等待突破回踩
 * - negative_gamma_wait    资金看空但正 Gamma 托底，观察支撑
 * - positive_gamma_income  资金看空且 Gamma 翻转，顺势跟空
 * - theta_stale_no_trade   净吃单停滞，绞肉区禁止操作
 */

'use strict';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function safeFloat(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function roundToNearest5(price) {
  return Math.round(price / 5) * 5;
}

/**
 * 从 flow_recent 的 tags 数组中提取 aggressor_side。
 *
 * UW API 的 flow_recent 端点不直接返回 aggressor_side 字段，
 * 而是将其编码在 tags 数组中：
 *   tags: ['ask_side', 'bearish', 'index']  → aggressor_side = 'ASK'（主动买入）
 *   tags: ['bid_side', 'bullish', 'index']  → aggressor_side = 'BID'（主动卖出）
 *
 * @param {string[]} tags
 * @returns {'ASK' | 'BID' | null}
 */
function extractAggressorSide(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const t = tag.toLowerCase();
    if (t === 'ask_side') return 'ASK';
    if (t === 'bid_side') return 'BID';
  }
  return null;
}

// ─── 核心引擎 ─────────────────────────────────────────────────────────────────

/**
 * 从 flow_recent 队列中重构最近 windowMs 内的真实净流向。
 *
 * 只统计 aggressor_side 明确的订单：
 * - Hit the Ask（ASK）= 主动买入 → 正贡献
 * - Hit the Bid（BID）= 主动卖出 → 负贡献
 * 无 aggressor_side 的订单视为白噪音，不计入。
 *
 * @param {Array} ticks - flow_recent 队列中的逐笔数据
 * @param {number} windowMs - 统计窗口（毫秒），默认 5 分钟
 * @returns {{ net_call_prem: number, net_put_prem: number, true_net_flow: number,
 *             tick_count: number, noise_count: number, coverage_seconds: number }}
 */
function reconstructTrueNetFlow(ticks, windowMs = 5 * 60 * 1000) {
  if (!Array.isArray(ticks) || ticks.length === 0) {
    return {
      net_call_prem: 0, net_put_prem: 0, true_net_flow: 0,
      tick_count: 0, noise_count: 0, coverage_seconds: 0,
      status: 'no_data'
    };
  }

  const now = Date.now();
  const cutoff = now - windowMs;

  let net_call_prem = 0;
  let net_put_prem  = 0;
  let tick_count    = 0;
  let noise_count   = 0;

  for (const tick of ticks) {
    // 时间过滤
    const ts = new Date(tick.executed_at || tick.created_at || 0).getTime();
    if (ts < cutoff) continue;

    const premium = safeFloat(tick.premium);
    if (premium === null || premium <= 0) { noise_count++; continue; }

    const aggressorSide = extractAggressorSide(tick.tags);
    const optionType    = (tick.option_type || '').toLowerCase();

    // 白噪音过滤：无法判断方向的订单直接丢弃
    if (!aggressorSide) { noise_count++; continue; }
    if (optionType !== 'call' && optionType !== 'put') { noise_count++; continue; }

    tick_count++;

    if (aggressorSide === 'ASK') {
      // 主动向上吃单（Hit the Ask）= 真实买入动能
      if (optionType === 'call') net_call_prem += premium;
      else                       net_put_prem  += premium;
    } else {
      // 主动向下砸盘（Hit the Bid）= 真实卖出抛压
      if (optionType === 'call') net_call_prem -= premium;  // 机构卖 Call 压盘
      else                       net_put_prem  -= premium;  // 机构卖 Put 托底
    }
  }

  const true_net_flow = net_call_prem - net_put_prem;

  // 计算覆盖时长
  const validTimes = ticks
    .map(t => new Date(t.executed_at || t.created_at || 0).getTime())
    .filter(t => t >= cutoff && Number.isFinite(t))
    .sort((a, b) => a - b);
  const coverage_seconds = validTimes.length >= 2
    ? (validTimes[validTimes.length - 1] - validTimes[0]) / 1000
    : 0;

  return {
    net_call_prem,
    net_put_prem,
    true_net_flow,
    tick_count,
    noise_count,
    coverage_seconds,
    status: tick_count >= 3 ? 'ok' : 'sparse'
  };
}

/**
 * 扫描目标行权价的 Charm 敞口，判断做市商是否构筑了机器抛压盖子。
 *
 * 逻辑：
 * - 极端负 Charm（< -500K）叠加全盘正 Gamma（> 100K）= 绞肉机模式
 * - 做市商算法会随时间流逝在该价位自动高频抛售现货
 *
 * @param {Array} greekRows - greek_exposure_strike 的逐行权价数据
 * @param {number} targetStrike - 目标行权价（ATM + 5）
 * @param {number} netGex - 全盘净 Gamma 敞口
 * @returns {{ veto: boolean, upside_charm: number | null, reason: string }}
 */
function scanDealerSuppressionVeto(greekRows, targetStrike, netGex) {
  if (!Array.isArray(greekRows) || greekRows.length === 0) {
    return { veto: false, upside_charm: null, reason: '无 Greek 数据，跳过 Charm 扫描' };
  }

  // 找目标行权价的行（±2.5pt 容差）
  const row = greekRows.find(r => {
    const s = safeFloat(r.strike || r.price);
    return s !== null && Math.abs(s - targetStrike) <= 2.5;
  });

  if (!row) {
    return { veto: false, upside_charm: null, reason: `${targetStrike} 无 Charm 数据` };
  }

  const callCharm = safeFloat(row.call_charm);
  const putCharm  = safeFloat(row.put_charm);
  const netCharm  = (callCharm ?? 0) + (putCharm ?? 0);
  const upsideCharm = netCharm;

  // 否决条件：极端负 Charm + 全盘正 Gamma
  const CHARM_VETO_THRESHOLD = -500_000;
  const GEX_POSITIVE_THRESHOLD = 100_000;

  const isExtremeNegCharm = upsideCharm < CHARM_VETO_THRESHOLD;
  const isPositiveGex     = (safeFloat(netGex) ?? 0) > GEX_POSITIVE_THRESHOLD;

  if (isExtremeNegCharm && isPositiveGex) {
    return {
      veto: true,
      upside_charm: upsideCharm,
      call_charm: callCharm,
      put_charm: putCharm,
      net_gex: netGex,
      reason: `${targetStrike} Charm=${(upsideCharm/1e6).toFixed(2)}M（极端负值），全盘 GEX=${(netGex/1e3).toFixed(0)}K（正 Gamma）。做市商算法将在此自动抛售，防范诱多。`
    };
  }

  return {
    veto: false,
    upside_charm: upsideCharm,
    call_charm: callCharm,
    put_charm: putCharm,
    net_gex: netGex,
    reason: `${targetStrike} Charm=${upsideCharm !== null ? (upsideCharm/1e6).toFixed(2)+'M' : 'N/A'}，无极端压制`
  };
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * evaluate0dteMicrostructure
 *
 * 0DTE 微观结构交叉验证主函数。
 * 对应用户提供的 Python 伪代码，完整实现三层判定树。
 *
 * @param {object} params
 * @param {Array}  params.flowRecentTicks   - flow_recent 内存队列中的逐笔数据
 * @param {Array}  params.greekRows         - greek_exposure_strike 逐行权价数据
 * @param {number} params.netGex            - 全盘净 Gamma 敞口（dealer_factors.net_gex）
 * @param {number} params.spotPrice         - 当前现货价格
 * @param {boolean} params.ifvgBreached     - IFVG 是否已破位（多头逻辑失效信号）
 * @param {number}  [params.windowMs=300000] - 净流向统计窗口（默认 5 分钟）
 *
 * @returns {object} 决策结果，包含 status / action / reason / diagnostics
 */
export function evaluate0dteMicrostructure({
  flowRecentTicks = [],
  greekRows       = [],
  netGex          = 0,
  spotPrice,
  ifvgBreached    = false,
  windowMs        = 5 * 60 * 1000,
} = {}) {

  // ══════════════════════════════════════════════════════════════
  // 0. 绝对风控层（Absolute Risk Control）
  // ══════════════════════════════════════════════════════════════
  if (ifvgBreached) {
    return {
      status:  'SIGNAL_TERMINATE',
      action:  'halt_all_trading',
      reason:  'IFVG 破位。底层多头逻辑作废，强制平仓。严禁左侧反手做空。',
      diagnostics: { ifvg_breached: true }
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 1. 真实净流向重构（True Net Flow Reconstruction）
  // ══════════════════════════════════════════════════════════════
  const flowResult = reconstructTrueNetFlow(flowRecentTicks, windowMs);
  const { true_net_flow, net_call_prem, net_put_prem, tick_count, noise_count, coverage_seconds } = flowResult;

  // 方案B阈值：$2M（适应低波动率正 Gamma 压缩环境）
  const FLOW_THRESHOLD = 2_000_000;
  let flowDirection;
  if (true_net_flow > FLOW_THRESHOLD)       flowDirection = 'BULLISH';
  else if (true_net_flow < -FLOW_THRESHOLD) flowDirection = 'BEARISH';
  else                                       flowDirection = 'NEUTRAL';

  // 数据质量检查：tick 太少时降级为 NEUTRAL
  if (tick_count < 3 && flowDirection !== 'NEUTRAL') {
    flowDirection = 'NEUTRAL';
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 做市商防御与压制扫描（Dealer Suppression Scan）
  // ══════════════════════════════════════════════════════════════
  const spot = safeFloat(spotPrice);
  const atmStrike = spot !== null ? roundToNearest5(spot) : null;
  const targetUpsideStrike = atmStrike !== null ? atmStrike + 5 : null;

  let vetoResult = { veto: false, reason: '无现货价格，跳过 Charm 扫描' };
  if (targetUpsideStrike !== null) {
    vetoResult = scanDealerSuppressionVeto(greekRows, targetUpsideStrike, netGex);
  }

  // ══════════════════════════════════════════════════════════════
  // 3. 交叉验证判定树（Cross-Validation Decision Tree）
  // ══════════════════════════════════════════════════════════════
  const diagnostics = {
    flow: {
      true_net_flow,
      net_call_prem,
      net_put_prem,
      flow_direction: flowDirection,
      tick_count,
      noise_count,
      coverage_seconds: Math.round(coverage_seconds),
      threshold: FLOW_THRESHOLD,
      data_quality: flowResult.status,
    },
    dealer: {
      atm_strike:            atmStrike,
      target_upside_strike:  targetUpsideStrike,
      upside_charm:          vetoResult.upside_charm,
      call_charm:            vetoResult.call_charm ?? null,
      put_charm:             vetoResult.put_charm ?? null,
      net_gex:               netGex,
      mm_upside_veto:        vetoResult.veto,
      veto_reason:           vetoResult.reason,
    },
  };

  if (flowDirection === 'BULLISH') {
    if (vetoResult.veto) {
      // 真实资金在买，但面临做市商铁顶 → 诱多绞杀，一票否决
      return {
        status:  'flip_conflict_wait',
        action:  'lock_long_entries',
        reason:  `资金看多（净吃单 +$${(true_net_flow/1e6).toFixed(1)}M）但触发做市商压制。${targetUpsideStrike} 存在极端负 Charm（${(vetoResult.upside_charm/1e6).toFixed(2)}M），防范算法诱多。`,
        diagnostics,
      };
    } else {
      // 资金看多且无抛压盖子 → 确认多头动能
      return {
        status:  'uw_call_strong',
        action:  'prepare_breakout_pullback',
        reason:  `真实多头资金净流入确认（+$${(true_net_flow/1e6).toFixed(1)}M，${tick_count} 笔有效吃单）。上方 ${targetUpsideStrike} 无强 Charm 压制，等待突破回踩进场。`,
        diagnostics,
      };
    }
  } else if (flowDirection === 'BEARISH') {
    const safeNetGex = safeFloat(netGex) ?? 0;
    if (safeNetGex > 150_000) {
      // 资金看空，但全盘巨量正 Gamma 托底 → 跌不深
      return {
        status:  'negative_gamma_wait',
        action:  'monitor_support_bids',
        reason:  `空头资金砸盘（净吃单 -$${Math.abs(true_net_flow/1e6).toFixed(1)}M），但全盘正 Gamma（${(safeNetGex/1e3).toFixed(0)}K）摩擦力极大，观察支撑位底层承接。`,
        diagnostics,
      };
    } else {
      // 资金看空且 Gamma 翻转 → 顺势跟空
      return {
        status:  'positive_gamma_income',
        action:  'execute_short_scalp',
        reason:  `真实空头净流出（-$${Math.abs(true_net_flow/1e6).toFixed(1)}M）且底层 Gamma 托盘撤退（GEX=${(safeNetGex/1e3).toFixed(0)}K），顺势执行。`,
        diagnostics,
      };
    }
  } else {
    // 真实净吃单极其微弱（$2M 阈值内）→ 绞肉区
    return {
      status:  'theta_stale_no_trade',
      action:  'wait',
      reason:  `真实吃单流停滞（净流向 $${(true_net_flow/1e6).toFixed(2)}M，有效 tick ${tick_count} 笔）。陷入 ${atmStrike ?? '--'} 轴心正 Gamma 绞肉区，切勿操作。`,
      diagnostics,
    };
  }
}

/**
 * buildMicrostructureRead
 *
 * 将 evaluate0dteMicrostructure 的输出格式化为前端可用的 read 对象。
 * 直接映射到 home_view_model 的 microstructure_read 字段。
 *
 * @param {object} result - evaluate0dteMicrostructure 的返回值
 * @returns {object}
 */
export function buildMicrostructureRead(result) {
  if (!result) return null;

  const statusLabels = {
    SIGNAL_TERMINATE:       '⛔ 强制终止',
    flip_conflict_wait:     '⚡ 资金/Charm 背离',
    uw_call_strong:         '✅ 多头净流入确认',
    negative_gamma_wait:    '⚠️ 空头+正Gamma托底',
    positive_gamma_income:  '↘ 顺势跟空',
    theta_stale_no_trade:   '⊗ 绞肉区禁止操作',
  };

  const d = result.diagnostics || {};
  const flow = d.flow || {};
  const dealer = d.dealer || {};

  return {
    status:       result.status,
    status_label: statusLabels[result.status] || result.status,
    action:       result.action,
    reason:       result.reason,

    // 净流向数据
    true_net_flow_m:  flow.true_net_flow != null ? (flow.true_net_flow / 1e6).toFixed(2) : null,
    net_call_prem_m:  flow.net_call_prem != null ? (flow.net_call_prem / 1e6).toFixed(2) : null,
    net_put_prem_m:   flow.net_put_prem  != null ? (flow.net_put_prem  / 1e6).toFixed(2) : null,
    flow_direction:   flow.flow_direction,
    tick_count:       flow.tick_count,
    noise_count:      flow.noise_count,
    coverage_seconds: flow.coverage_seconds,
    data_quality:     flow.data_quality,

    // 做市商 Charm 数据
    atm_strike:           dealer.atm_strike,
    target_upside_strike: dealer.target_upside_strike,
    upside_charm_m:       dealer.upside_charm != null ? (dealer.upside_charm / 1e6).toFixed(3) : null,
    mm_upside_veto:       dealer.mm_upside_veto,
    veto_reason:          dealer.veto_reason,
  };
}
