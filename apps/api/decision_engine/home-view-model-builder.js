/**
 * home-view-model-builder.js
 *
 * SINGLE SOURCE OF TRUTH for renderHome.
 *
 * ─── 架构原则 ──────────────────────────────────────────────────────────────────
 *
 *  UW / FMP / Price Raw Data
 *          ↓
 *  各 engine 计算（dealer-wall / atm-trigger / flow-behavior / ab-order / ...）
 *          ↓
 *  signal_formatter 汇总（primary_card / levels / money_read / ...）
 *          ↓
 *  home_view_model_builder  ← 本文件
 *          ↓
 *  frontend renderHome（只读 signal.home_view_model）
 *
 * ─── 本文件职责（只做这 5 件事）─────────────────────────────────────────────
 *
 *  1. 收口：把所有已计算好的字段收进一个模型
 *  2. 拦截：LOCKED/WAIT 禁止方向；Flow 降级禁止"动能可信"；远端墙禁止进首页
 *  3. 降级：数据缺失 / fallback / PUT_HEAVY_ABSORBED / 正 Gamma ATM 附近 → 降级
 *  4. 生成首页四行：status / action / entry / invalidation / one_sentence
 *  5. 断点输出：ATM 缺失时说明是哪一层断了
 *
 * ─── 本文件禁止做的事 ────────────────────────────────────────────────────────
 *
 *  ✗ 重新计算 GEX / ATM / Flow / IV / Vanna / Charm
 *  ✗ 替代 dealer-wall-engine / atm-trigger-engine / flow-behavior-engine
 *  ✗ 读取 UW / FMP 原始数据
 *  ✗ 生成新的交易信号
 *
 * ─── 输入 ────────────────────────────────────────────────────────────────────
 *
 *  buildHomeViewModel(formattedSignal)
 *
 *  formattedSignal 是 signal_formatter 的输出，包含：
 *    .primary_card   — 主控卡片（方向 / 状态 / 预案）
 *    .levels         — ATM 执行线（已格式化）
 *    .money_read     — 资金人话（已格式化）
 *    .darkpool_read  — 暗盘人话（已格式化）
 *    .vol_dashboard  — 波动率仪表盘
 *    .vix_dashboard  — VIX 仪表盘
 *    .data_health    — 数据健康状态
 *    .sentiment_bar  — 情绪条
 *    .flow_behavior_engine  — Flow 引擎原始输出（只读，不重算）
 *    .ab_order_engine       — 交易状态引擎原始输出（只读，不重算）
 *    .atm_trigger_engine    — ATM 触发引擎原始输出（只读，不重算）
 *    .price_contract        — 价格合约（只读，不重算）
 *    .dealer_wall_map       — GEX 墙位图（只读，不重算）
 */

import { buildCapitalFlowReading } from './algorithms/capital-flow-reading-engine.js';
import { buildNarrative }          from './algorithms/narrative-engine.js';

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function _fmt(n, d = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return Number(n).toFixed(d);
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

export function buildHomeViewModel(formattedSignal) {
  // ── Step 1: 收口 — 读取各 engine 已计算好的结果 ───────────────────────────
  // 规则：只读，不重算。所有计算逻辑留在对应 engine。

  const pc  = formattedSignal.primary_card         || {};  // signal_formatter 输出
  const lv  = formattedSignal.levels               || {};  // signal_formatter 输出
  const mr  = formattedSignal.money_read           || {};  // signal_formatter 输出
  const dr  = formattedSignal.darkpool_read        || {};  // signal_formatter 输出
  const sb  = formattedSignal.sentiment_bar        || {};  // signal_formatter 输出
  const vd  = formattedSignal.vol_dashboard        || {};  // signal_formatter 输出
  const vx  = formattedSignal.vix_dashboard        || {};  // signal_formatter 输出
  const dh  = formattedSignal.data_health          || {};  // signal_formatter 输出

  // 以下 engine 原始输出只用于读取已计算好的字段，不重新计算
  const fb  = formattedSignal.flow_behavior_engine || {};  // flow-behavior-engine 原始输出
  const ab  = formattedSignal.ab_order_engine      || {};  // ab-order-engine 原始输出
  const ate = formattedSignal.atm_trigger_engine   || {};  // atm-trigger-engine 原始输出
  const pc2 = formattedSignal.price_contract       || {};  // price-contract 原始输出
  const dw  = formattedSignal.dealer_wall_map      || {};  // dealer-wall-engine 原始输出

  // ── Step 2: 拦截 — 状态门控 ──────────────────────────────────────────────
  // 规则：LOCKED / WAIT / blocked 时强制禁止方向提示

  const rawStatus   = ab.status || 'blocked';
  const isBlocked   = rawStatus === 'blocked' || rawStatus === 'waiting' || pc.locked === true;
  const isWait      = rawStatus === 'waiting' || rawStatus === 'wait';
  const isActive    = rawStatus === 'active' || rawStatus === 'ready';
  const allowTrade  = isActive && !isBlocked;
  const tradeSide   = allowTrade
    ? (pc.direction === 'LONG_CALL' ? 'LONG' : pc.direction === 'SHORT_PUT' ? 'SHORT' : 'NONE')
    : 'NONE';

  // 状态映射（统一为首页显示用）
  let displayStatus = 'LOCKED';
  if (allowTrade && tradeSide === 'LONG')  displayStatus = 'LONG_READY';
  if (allowTrade && tradeSide === 'SHORT') displayStatus = 'SHORT_READY';
  if (isWait && !allowTrade)               displayStatus = 'WAIT';

  const statusLabel = {
    LOCKED:      '锁仓',
    LONG_READY:  '做多',
    SHORT_READY: '做空',
    WAIT:        '等确认',
  }[displayStatus] || '锁仓';

  // ── Step 3: 拦截 — Flow 降级门控 ─────────────────────────────────────────
  // 规则：flow_quality=DEGRADED 或 suspicious_same_window=true 时禁止方向

  const flowQuality          = fb.flow_quality || 'DEGRADED';
  const flowDegraded         = flowQuality === 'DEGRADED';
  const suspiciousSameWindow = fb.suspicious_same_window ?? false;
  const flowAllowDirection   = fb.homepage_allow_direction !== false
    && !flowDegraded
    && !suspiciousSameWindow;

  // PUT_HEAVY_ABSORBED 拦截：Put 重但跌不动，空头动能降级
  const flowState            = fb.flow_state || 'UNKNOWN';
  const isPutHeavyAbsorbed   = flowState === 'PUT_HEAVY_ABSORBED';

  // Flow narrative（已由 flow-behavior-engine 计算，此处只做最终安全覆盖）
  let flowNarrative = fb.flow_narrative || 'Flow 数据待接入。';
  if (flowDegraded || suspiciousSameWindow) {
    flowNarrative = 'Flow 数据降级，方向降级，等确认。';
  } else if (isPutHeavyAbsorbed) {
    flowNarrative = 'Put 偏重，但跌不动，空头动能降级，LOCKED。';
  }

  // 最终 homepage_allow_direction（综合状态门控 + Flow 门控）
  const homepageAllowDirection = allowTrade && flowAllowDirection && !isPutHeavyAbsorbed;

  // ── Step 4: ATM 执行线 — 永远生成，LOCKED 下也显示 ───────────────────────
  // 规则：只读 atm_trigger_engine 和 levels 的已计算字段，不重新计算 ATM

  // 断点诊断：确定是哪一层导致 ATM 缺失
  let unavailableReason = null;
  const _atmVal    = ate.atm ?? lv.atm ?? null;
  const _spotVal   = pc2.spot ?? pc2.live_price ?? null;
  const _atm5      = pc2.atm_5 ?? null;  // price-contract 已计算的 ATM×5 取整值

  if (_atmVal == null) {
    if (_spotVal == null)               unavailableReason = 'SPOT_MISSING';
    else if (_atm5 == null)             unavailableReason = 'ATM_ROUNDING_FAILED';
    else                                unavailableReason = 'ATM_ENGINE_NOT_CALLED';
  } else if (!lv.bull_trigger_fmt && !lv.bear_trigger_fmt) {
    unavailableReason = 'FORMATTER_FIELD_MISSING';
  }

  // 读取 levels（signal_formatter 已格式化），atm_5 作为最终 fallback
  const bull1Fmt   = lv.bull_trigger_fmt       || (_atm5 != null ? _fmt(_atm5 + 5)  : null);
  const bull2Fmt   = lv.bull_trigger_2_fmt     || (_atm5 != null ? _fmt(_atm5 + 10) : null);
  const bear1Fmt   = lv.bear_trigger_fmt       || (_atm5 != null ? _fmt(_atm5 - 5)  : null);
  const bear2Fmt   = lv.bear_trigger_2_fmt     || (_atm5 != null ? _fmt(_atm5 - 10) : null);
  const invBullFmt = (lv.invalidation_bull_fmt && lv.invalidation_bull_fmt !== '--')
    ? lv.invalidation_bull_fmt : (_atm5 != null ? _fmt(_atm5 - 10) : null);
  const invBearFmt = (lv.invalidation_bear_fmt && lv.invalidation_bear_fmt !== '--')
    ? lv.invalidation_bear_fmt : (_atm5 != null ? _fmt(_atm5 + 10) : null);

  const atmAvailable = _atmVal != null || _atm5 != null;

  const atmExecution = {
    atm:                   _atmVal,
    atm_fmt:               lv.atm_fmt || _fmt(_atm5) || '--',
    // lock zone (ATM±5)
    lock_low:              ate.lock_zone?.lower ?? null,
    lock_high:             ate.lock_zone?.upper ?? null,
    lock_low_fmt:          ate.lock_zone?.lower != null ? _fmt(ate.lock_zone.lower) : '--',
    lock_high_fmt:         ate.lock_zone?.upper != null ? _fmt(ate.lock_zone.upper) : '--',
    // trigger lines (ATM+5/+10, ATM-5/-10)
    bull_trigger:          lv.bull_trigger   ?? null,
    bull_trigger_fmt:      bull1Fmt          || '待接入',
    bull_confirm:          lv.bull_trigger_2 ?? null,
    bull_confirm_fmt:      bull2Fmt          || '--',
    bull_target_1_fmt:     lv.bull_target_1_fmt || '--',
    bull_target_2_fmt:     lv.bull_target_2_fmt || '--',
    bear_trigger:          lv.bear_trigger   ?? null,
    bear_trigger_fmt:      bear1Fmt          || '待接入',
    bear_confirm:          lv.bear_trigger_2 ?? null,
    bear_confirm_fmt:      bear2Fmt          || '--',
    bear_target_1_fmt:     lv.bear_target_1_fmt || '--',
    bear_target_2_fmt:     lv.bear_target_2_fmt || '--',
    // invalidation lines
    invalid_long:          lv.invalidation_bull ?? null,
    invalid_long_fmt:      invBullFmt        || '--',
    invalid_short:         lv.invalidation_bear ?? null,
    invalid_short_fmt:     invBearFmt        || '--',
    // state
    spot_in_lock_zone:     lv.spot_in_lock_zone ?? true,
    trigger_status:        lv.trigger_status || ate.trigger_status || 'locked',
    trigger_label:         ate.trigger_label || lv.hint || null,
    hint:                  lv.hint           || null,
    pin_warning:           lv.pin_warning    || null,
    // availability
    available:             atmAvailable,
    unavailable_reason:    unavailableReason,
  };

  // ── Step 5: 拦截 — GEX 远端墙禁止进首页 ─────────────────────────────────
  // 规则：首页只能显示 gex_local（±30pt），far wall 只进 gex_far_background_note

  const gexLocalReference = {
    local_call_wall:     lv.gex_local_call_wall     ?? null,
    local_call_wall_fmt: lv.gex_local_call_wall_fmt ?? null,
    local_put_wall:      lv.gex_local_put_wall      ?? null,
    local_put_wall_fmt:  lv.gex_local_put_wall_fmt  ?? null,
    window_points:       30,  // ±30pt 限制（由 dealer-wall-engine 保证）
    has_local_call_wall: lv.gex_local_call_wall != null,
    has_local_put_wall:  lv.gex_local_put_wall  != null,
    display_note:        lv.gex_local_call_wall != null || lv.gex_local_put_wall != null
      ? `GEX 本地压力 ${lv.gex_local_call_wall_fmt ?? '--'} / 支撑 ${lv.gex_local_put_wall_fmt ?? '--'}（±30pt 内）`
      : 'GEX 本地墙位待接入',
  };

  // Far wall：只作背景注释，禁止进首页主控
  const gexFarBackgroundNote = {
    far_call_wall:     lv.global_call_wall     ?? dw.far_call_wall ?? null,
    far_call_wall_fmt: lv.global_call_wall_fmt ?? '--',
    far_put_wall:      lv.global_put_wall      ?? dw.far_put_wall  ?? null,
    far_put_wall_fmt:  lv.global_put_wall_fmt  ?? '--',
    display_note:      `远端墙：${lv.global_call_wall_fmt ?? '--'} / ${lv.global_put_wall_fmt ?? '--'}（仅 Radar 参考，不作日内触发）`,
    usage:             'radar_only',  // 前端必须检查此字段，禁止在首页主控中使用
  };

  // ── Step 6: Flow 收口 ─────────────────────────────────────────────────────
  // 规则：只读 flow-behavior-engine 已计算好的字段，不重新计算

  const dnpRaw = fb.directional_net_premium;
  const dnpFmt = dnpRaw != null
    ? (dnpRaw >= 0 ? '+' : '') + (dnpRaw / 1e6).toFixed(1) + 'M'
    : '--';

  const flow = {
    pc_volume_ratio:            fb.pc_volume_ratio   ?? null,
    pc_premium_ratio:           fb.pc_premium_ratio  ?? null,
    pc_primary_ratio:           fb.pc_primary_ratio  ?? null,
    directional_net_premium:    dnpRaw               ?? null,
    directional_net_premium_fmt: dnpFmt,
    call_premium_abs:           fb.call_premium_abs  ?? null,
    put_premium_abs:            fb.put_premium_abs   ?? null,
    call_premium_fmt:           mr.call_premium_fmt  || '--',
    put_premium_fmt:            mr.put_premium_fmt   || '--',
    net_premium_fmt:            mr.net_premium_fmt   || '--',
    flow_5m:                    fb.flow_5m_label     || null,
    flow_15m:                   fb.flow_15m_label    || null,
    dual_window_narrative:      fb.dual_window_narrative || null,
    dual_window_aligned:        fb.dual_window_aligned ?? false,
    flow_quality:               flowQuality,
    homepage_allow_direction:   homepageAllowDirection,
    flow_state:                 flowState,
    flow_narrative:             flowNarrative,
    suspicious_same_window:     suspiciousSameWindow,
    fallback_note:              flowDegraded
      ? 'Flow 数据降级（5m/15m 窗口复用或数据缺失），方向判断不可信。'
      : isPutHeavyAbsorbed
        ? 'Put 偏重但价格不跌，空头动能被吸收，方向降级。'
        : null,
  };

  // ── Step 7: 生成首页四行 ──────────────────────────────────────────────────
  // 规则：永远输出完整四行，不允许 unavailable 或空值

  const b1  = atmExecution.bull_trigger_fmt;
  const b2  = atmExecution.bull_confirm_fmt;
  const r1  = atmExecution.bear_trigger_fmt;
  const r2  = atmExecution.bear_confirm_fmt;
  const iL  = atmExecution.invalid_long_fmt;
  const iS  = atmExecution.invalid_short_fmt;
  const atmFmt = atmExecution.atm_fmt;

  // status_line
  const statusLine = `${displayStatus}｜${statusLabel}`;

  // action_line（LOCKED 时禁止方向提示）
  let actionLine = '不做 0DTE，等待条件满足';
  if (homepageAllowDirection && tradeSide === 'LONG') {
    actionLine = `做多：${b1} 站稳，${b2} 确认`;
  } else if (homepageAllowDirection && tradeSide === 'SHORT') {
    actionLine = `做空：${r1} 跌破，${r2} 确认`;
  } else if (isWait) {
    actionLine = '等确认，不追单';
  }

  // entry_line（LOCKED 下也显示观察点位，不显示 unavailable）
  let entryLine;
  if (atmAvailable && (b1 !== '待接入' || r1 !== '待接入')) {
    entryLine = `多：${b1} 站稳，${b2} 确认；空：${r1} 跌破，${r2} 确认`;
  } else if (unavailableReason) {
    entryLine = `ATM 触发线缺失（${unavailableReason}）`;
  } else {
    entryLine = '待接入';
  }

  // invalidation_line
  const invAvailable = (iL && iL !== '--') || (iS && iS !== '--');
  const invalidationLine = invAvailable
    ? `多头失效 ${iL || '--'}；空头失效 ${iS || '--'}`
    : (unavailableReason ? `失效位缺失（${unavailableReason}）` : '--');

  // one_sentence（ATM 附近不做的一句话）
  const oneSentence = atmAvailable
    ? `${atmFmt} ATM 附近不做，等 ${b1} 站稳或 ${r1} 跌破。`
    : (unavailableReason ? `ATM 触发线缺失（${unavailableReason}），等数据恢复。` : '等待 ATM 数据接入。');

  const finalText = {
    status_line:      statusLine,
    action_line:      actionLine,
    entry_line:       entryLine,
    invalidation_line: invalidationLine,
    one_sentence:     oneSentence,
  };

  // ── Step 8: 安全门控记录 ─────────────────────────────────────────────────
  // 供前端 / 调试使用，记录哪些门控被触发

  const guards = {
    locked_gate_applied:          isBlocked,
    wait_gate_applied:            isWait && !allowTrade,
    flow_degraded_gate_applied:   flowDegraded || suspiciousSameWindow,
    put_heavy_absorbed_gate:      isPutHeavyAbsorbed,
    gex_far_blocked_from_home:    true,  // 永远为 true：far wall 永远不进首页
    old_pc_format_blocked:        true,  // 永远为 true：旧 P/C 格式永远不输出
    old_gex_profile_blocked:      true,  // 永远为 true：GEX PROFILE 永远不进首页
    direction_allowed:            homepageAllowDirection,
  };

  // ── Step 9: Meta ─────────────────────────────────────────────────────────

  const spot    = pc2.spot ?? pc2.live_price ?? pc.spot ?? null;
  const spotFmt = spot != null ? Number(spot).toFixed(1) : '--';
  const lastUpd = (() => {
    const lu = formattedSignal.last_updated || {};
    const t  = lu.uw || lu.fmp || null;
    if (!t) return '--';
    try {
      const d = new Date(t);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return '--'; }
  })();

  const meta = {
    symbol:       'SPX',
    spot,
    spot_fmt:     spotFmt,
    updated_at:   lastUpd,
    data_quality: dh.overall_quality || (flowDegraded ? 'DEGRADED' : 'NORMAL'),
    source_status: dh,
  };

  // ── Step 10: Status block ────────────────────────────────────────────────

  const abConf    = ab.execution_confidence ?? pc.execution_confidence ?? 0;
  // LOCKED 状态下禁止输出"小仓等确认"
  const confLabel = isBlocked
    ? (abConf >= 70 ? '高可信，仅观察' : abConf >= 40 ? '中可信，仅观察' : '低可信，只观察')
    : (abConf >= 70 ? '高可信，可执行' : abConf >= 40 ? '中可信，小仓等确认' : '低可信，只观察');
  const confColor = abConf >= 70 ? 'conf-high' : abConf >= 40 ? 'conf-mid' : 'conf-low';

  const status = {
    raw_status:       rawStatus,
    display_status:   displayStatus,
    allow_trade:      allowTrade,
    trade_side:       tradeSide,
    confidence:       abConf,
    confidence_label: confLabel,
    confidence_color: confColor,
    blocked_reason:   ab.blocked_reason === 'cold_start_or_off_hours'
      ? '非交易时段 / 价格历史不足，禁止开仓'
      : ab.blocked_reason === 'spot_missing' ? '现价缺失，禁止开仓'
      : (ab.blocked_reason ?? '等待条件满足'),
    scenario:         ab.scenario || null,
  };

  // ── Step 11: Plans ───────────────────────────────────────────────────────
  // 只透传 primary_card 和 ab_order_engine 已生成的预案，不重新生成

  const plan  = pc.plan  || ab.plan_a || null;
  const planA = ab.plan_a || null;
  const planB = ab.plan_b || null;

  // ── Step 11b: Order Plan — 拆分"显示权"和"执行权" ────────────────────────
  // 原则：A单预案可以显示（displayable），但只有 READY 状态才能执行（executable）
  // 不允许因为 LOCKED/WAIT 直接丢弃 A单预案
  {
    // 判断执行权（五个条件全满足）
    const _isReady2        = rawStatus === 'LONG_READY' || rawStatus === 'SHORT_READY';
    const _flowNormal2     = (flow && flow.flow_quality === 'NORMAL');
    const _allowDir2       = (flow && flow.homepage_allow_direction !== false);
    const _priceOk2        = (pc2 && pc2.spot_gate_open !== false);
    const _notInLockZone2  = !(atmExecution && atmExecution.in_lock_zone);
    const _execAllowed2    = _isReady2 && _flowNormal2 && _allowDir2 && _priceOk2 && _notInLockZone2;
    // capital_flow 预计算（用于 executable 判断和 blocked_reason）
    const _capitalFlowEarly = buildCapitalFlowReading(formattedSignal);
    const _capitalTradeGate = _capitalFlowEarly ? _capitalFlowEarly.trade_gate : 'DEGRADED';
    // 最终执行权：还需要 capital_flow.trade_gate === 'PASS'
    const _execAllowedFinal = _execAllowed2 && _capitalTradeGate === 'PASS';

    function _buildPlanEntry2(rawPlan, isBackup) {
      if (!rawPlan) return null;
      const dir = (rawPlan.direction || 'WAIT').toUpperCase();
      const isWait = dir === 'WAIT';
      
      // ── 三态颜色逻辑 ──────────────────────────────────────────────────────
      // READY（绿）：条件全部满足，可执行
      // PENDING（黄）：有方向但条件未满足（LOCKED/WAIT/DEGRADED）
      // VOID（空白）：无方向，等待下一单条件
      let planState;
      if (isWait) {
        planState = 'VOID';  // 真正无方向 → 空白
      } else if (_execAllowedFinal) {
        planState = 'READY'; // 条件全满（含资金门控）→ 绿色可执行
      } else {
        planState = 'PENDING'; // 有方向但被锁 → 黄色等待
      }
      
      const executable = planState === 'READY';
      const displayable = planState !== 'VOID'; // VOID 时不显示
      
      // ── 被禁原因 ──────────────────────────────────────────────────────────
      let blockedReasons = [];
      if (!_isReady2)        blockedReasons.push(rawStatus === 'blocked' ? 'ATM 锁仓区 / 正 Gamma 磁吸' : '状态未就绪');
      if (!_flowNormal2)     blockedReasons.push('Flow 数据降级');
      if (!_allowDir2)       blockedReasons.push('方向降级');
      if (!_priceOk2)        blockedReasons.push('价格未接入');
      if (!_notInLockZone2)  blockedReasons.push('ATM 锁仓区内');
      // 加入 capital_flow 的资金门控原因
      if (_capitalTradeGate !== 'PASS' && _capitalFlowEarly && _capitalFlowEarly.invalidation_notes) {
        for (const n of _capitalFlowEarly.invalidation_notes) {
          if (!blockedReasons.includes(n)) blockedReasons.push(n);
        }
      }
      const blocked_reason = blockedReasons.length > 0 ? blockedReasons.join(' / ') : null;
      
      const side    = dir === 'BULLISH' ? 'LONG' : dir === 'BEARISH' ? 'SHORT' : 'WAIT';
      const side_cn = dir === 'BULLISH' ? '多头' : dir === 'BEARISH' ? '空头' : '等待';
      const atmE = atmExecution || {};
      
      // 入场/确认/止损
      const entry   = side === 'LONG'  ? (atmE.bull_trigger_fmt  || rawPlan.wait_long   || '--')
                    : side === 'SHORT' ? (atmE.bear_trigger_fmt  || rawPlan.wait_short  || '--') : '--';
      const confirm = side === 'LONG'  ? (atmE.bull_confirm_fmt  || '--')
                    : side === 'SHORT' ? (atmE.bear_confirm_fmt  || '--') : '--';
      const stop    = side === 'LONG'  ? (atmE.invalid_long_fmt  || rawPlan.invalidation || '--')
                    : side === 'SHORT' ? (atmE.invalid_short_fmt || rawPlan.invalidation || '--') : '--';
      const target_1 = rawPlan.tp1 || '--';
      const target_2 = rawPlan.tp2 || '--';
      
      // display_mode 标签
      let display_mode;
      if (planState === 'READY')   display_mode = isBackup ? 'B单可执行' : 'A单可执行';
      else if (planState === 'PENDING') {
        if (rawStatus === 'blocked')       display_mode = isBackup ? 'B单预案｜等触发' : 'A单预案｜等触发';
        else if (rawStatus === 'waiting')  display_mode = isBackup ? 'B单预备｜等确认' : 'A单预备｜等确认';
        else if (!_flowNormal2)            display_mode = isBackup ? 'B单｜数据降级' : 'A单｜数据降级';
        else                               display_mode = isBackup ? 'B单预案' : 'A单预案';
      } else {
        display_mode = '等待方向';
      }
      
      return {
        name: isBackup ? 'B单' : 'A单', side, side_cn,
        grade: rawPlan.direction_cn || side_cn,
        instrument: rawPlan.instrument || '--',
        entry, confirm, stop, target_1, target_2, target_3: '--',
        watch: rawPlan.watch || null,
        wait_long: rawPlan.wait_long || null,
        wait_short: rawPlan.wait_short || null,
        forbidden: rawPlan.forbidden || null,
        reason: rawPlan.rationale || rawPlan.why || '--',
        action_now: rawPlan.action_now || rawPlan.state || '--',
        plan_state: planState,   // READY / PENDING / VOID
        executable, displayable, display_mode, blocked_reason,
        raw: rawPlan,
      };
    }
    const _primaryEntry2 = _buildPlanEntry2(planA, false);
    const _backupEntry2  = _buildPlanEntry2(planB, true);
    // DUAL 模式也显示（双向观察预案）
    const _showPrimary2  = _primaryEntry2 !== null && _primaryEntry2.displayable === true;
    const _showBackup2   = _backupEntry2  !== null && _backupEntry2.displayable  === true;
    let _planMode2;
    if (_execAllowed2 && _showPrimary2)       _planMode2 = 'EXECUTABLE';
    else if (rawStatus === 'blocked')          _planMode2 = 'OBSERVE';
    else if (rawStatus === 'waiting')          _planMode2 = 'STANDBY';
    else if (!_flowNormal2)                    _planMode2 = 'DEGRADED';
    else                                       _planMode2 = 'WAIT';
    let _planNote2 = null;
    if (!_execAllowed2 && _primaryEntry2 && _primaryEntry2.plan_state === 'PENDING') {
      const _p2 = _primaryEntry2;
      _planNote2 = `${_p2.side_cn}预案：${_p2.entry}（${_p2.confirm} 确认）｜失效 ${_p2.stop}｜禁做：${_p2.blocked_reason || '等确认'}`;
    }
    // ── capital_flow_reading：资金实况卡（接入 A单 executable 判断）──────────
    // capital_flow 已在 _capitalFlowEarly 中计算，直接复用
    // ── narrative：叙事层（优先级决策树 + 模板渲染，零 Token 成本）──────────────
    // 注意：narrative 需要 capital_flow 已挂载到 signal.home_view_model.order_plan
    // 为了让 narrative-engine 能读到 capital_flow，临时挂载后再调用
    const _tempSignalForNarrative = {
      ...formattedSignal,
      home_view_model: {
        ...(formattedSignal.home_view_model || {}),
        order_plan: {
          capital_flow: _capitalFlowEarly,
          primary_plan: _primaryEntry2,
        }
      }
    };
    const _narrative2 = buildNarrative(_tempSignalForNarrative);

    var _orderPlan2 = {
      primary_plan:      _primaryEntry2,
      backup_plan:       _backupEntry2,
      show_primary_plan: _showPrimary2,
      show_backup_plan:  _showBackup2,
      plan_mode:         _planMode2,
      plan_note:         _planNote2,
      capital_flow:      _capitalFlowEarly,
      narrative:         _narrative2,  // 叙事层输出
    };
  }


  // ── Step 12: Display helpers ─────────────────────────────────────────────

  const dirColor = pc.direction === 'LONG_CALL' ? 'bullish'
    : pc.direction === 'SHORT_PUT' ? 'bearish' : 'locked';
  const badge    = pc.badge || 'LOCKED';
  const headline = pc.headline    || '--';
  const subHead  = pc.sub_headline || '';
  const uwLive   = pc.uw_live === true;

  // Sentiment
  const sentScore  = sb.score ?? 50;
  const sentLabel  = sb.label || '中性';
  const sentSub    = sb.sub   || '';
  const pcRatioFmt = sb.put_call_ratio != null ? sb.put_call_ratio.toFixed(2) : '--';

  // ── 最终输出 ──────────────────────────────────────────────────────────────

  return {
    meta,
    status,
    atm_execution:          atmExecution,
    gex_local_reference:    gexLocalReference,
    gex_far_background_note: gexFarBackgroundNote,
    flow,
    final_text:             finalText,
    guards,

    // 预案（透传 + order_plan 收口层）
    plan,
    plan_a:                 planA,
    plan_b:                 planB,
    order_plan:             (typeof _orderPlan2 !== "undefined" ? _orderPlan2 : null),

    // 预格式化读物（透传）
    money_read:             mr,
    darkpool_read:          dr,
    vol_dashboard:          vd,
    vix_dashboard:          vx,
    data_health:            dh,
    sentiment_bar:          sb,

    // 显示辅助
    dir_color:              dirColor,
    badge,
    headline,
    sub_head:               subHead,
    uw_live:                uwLive,
    spot,
    spot_fmt:               spotFmt,
    sent_score:             sentScore,
    sent_label:             sentLabel,
    sent_sub:               sentSub,
    pc_ratio_fmt:           pcRatioFmt,
    net_premium_fmt:        mr.net_premium_fmt || '--',
  };
}
