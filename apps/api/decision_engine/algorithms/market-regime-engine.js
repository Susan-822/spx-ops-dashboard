/**
 * market-regime-engine.js
 * 0DTE 市场状态机 — 7 种协议，优先级路由
 *
 * 优先级（高 → 低）：
 *   P1  GAMMA_FLIP        Gamma 倒转/崩盘模式（GEX 由正转负 + 跌破 Zero-Gamma）
 *   P1  DEFENSE_COLLAPSE  防线崩溃（IFVG 破位 + 真实净流向深度负 + 跌破做市商核心支撑）
 *   P2  FLOW_CONFLICT     逻辑冲突/神仙打架（真实多头流 + 极端负 Charm 铁顶）
 *   P3  VANNA_SQUEEZE     Vanna 逼空/缩量慢涨（IV 塌陷 + 无量推升）
 *   P4  BULL_TRAP         诱多陷阱（虚假繁荣，机构高位出货）
 *   P4  GRINDER           绞肉机模式（高 GEX 横盘，资金停滞）
 *   P4  INSTITUTIONAL_BUY 机构扫货（真实逼空，主动吃 Ask）
 *   P4  BEAR_FLUSH        恐慌踩踏（防线崩塌，多头逻辑作废）
 *
 * 输入：
 *   microstructureRead  — microstructure-validation-engine 输出
 *   gammaRegimeEngine   — gamma-regime-engine 输出
 *   priceValidation     — price-validation-engine 输出
 *   flowBehavior        — flow-behavior-engine 输出
 *   dealerWallMap       — dealer-wall-map 输出
 *   volDashboard        — vol-dashboard 输出
 *   dealerFactors       — uw_factors.dealer_factors
 *   spotPrice           — 当前现货价格
 */

// ─── 协议常量 ────────────────────────────────────────────────────────────────
export const REGIME = Object.freeze({
  GAMMA_FLIP:        'GAMMA_FLIP',
  DEFENSE_COLLAPSE:  'DEFENSE_COLLAPSE',
  FLOW_CONFLICT:     'FLOW_CONFLICT',
  VANNA_SQUEEZE:     'VANNA_SQUEEZE',
  BULL_TRAP:         'BULL_TRAP',
  GRINDER:           'GRINDER',
  INSTITUTIONAL_BUY: 'INSTITUTIONAL_BUY',
  BEAR_FLUSH:        'BEAR_FLUSH',
  NEUTRAL:           'NEUTRAL',
});

// ─── 人话输出模板 ─────────────────────────────────────────────────────────────
const REGIME_TEMPLATES = {
  [REGIME.GAMMA_FLIP]: {
    icon: '💥',
    title: '【Gamma 倒转/崩盘模式】',
    headline: (ctx) => `警告！大盘已击穿 Zero-Gamma 防线（${ctx.zeroGamma ?? '--'}），底层正 Gamma 垫子撤去，转为负 Gamma 裸奔！`,
    action: '震荡逻辑作废！现在是单边趋势行情，做市商正在追空砸盘。顺势做空，绝不抄底！',
    hard_stop_direction: 'BEAR',
    allow_trade: false,
    force_wait: false,
    force_bear: true,
  },
  [REGIME.DEFENSE_COLLAPSE]: {
    icon: '💥',
    title: '【防线崩溃】',
    headline: (ctx) => `做市商托盘底仓被砸穿，多头底层逻辑彻底作废。净流出 ${ctx.trueFlowFmt}，IFVG 已形成。`,
    action: '多单立刻无脑砍仓！绝不可抱有幻想，严禁此时头脑发热反手做空。',
    hard_stop_direction: 'EXIT',
    allow_trade: false,
    force_wait: false,
    force_exit: true,
  },
  [REGIME.FLOW_CONFLICT]: {
    icon: '🚧',
    title: '【逻辑冲突/神仙打架】',
    headline: (ctx) => `真实资金在猛烈做多（净吃单 ${ctx.trueFlowFmt}），但已头撞做市商核心算法抛压墙（强负 Charm 区 ${ctx.charmLevel ?? '--'}）。`,
    action: '多空正在火拼。立刻锁仓！等待 5 分钟 K 线彻底站稳阻力位上方，或资金流枯竭掉头后再做跟随。当前绝对禁做！',
    hard_stop_direction: 'WAIT',
    allow_trade: false,
    force_wait: true,
  },
  [REGIME.VANNA_SQUEEZE]: {
    icon: '🩸',
    title: '【Vanna 逼空/缩量慢涨】',
    headline: (ctx) => `IV 正在快速塌陷（IV30 ${ctx.iv30 ?? '--'}%），做市商因 Put 贬值在被动买入现货。真实资金并未主动做多（净流向 ${ctx.trueFlowFmt}）。`,
    action: '极度抗跌的垃圾时间。严禁左侧猜顶做空（空头会被缓慢钝刀割肉）。无底仓者建议观望，多单逢高逐步止盈。',
    hard_stop_direction: 'NEUTRAL',
    allow_trade: false,
    force_wait: true,
  },
  [REGIME.BULL_TRAP]: {
    icon: '⚡',
    title: '【诱多警报】',
    headline: (ctx) => `大盘虽然在涨，但机构正在高位疯狂卖出 Call 砸盘（净流出 ${ctx.trueFlowFmt}）。上方 ${ctx.callWall ?? '--'} 是机器抛压重灾区。`,
    action: (ctx) => `绝对禁止追高！准备在 ${ctx.callWall ?? '--'} 附近寻找受阻做空机会，或等待回踩 ${ctx.localPutWall ?? '--'}。`,
    hard_stop_direction: 'BEAR',
    allow_trade: false,
    force_wait: true,
  },
  [REGIME.GRINDER]: {
    icon: '🐢',
    title: '【绞肉机模式】',
    headline: (ctx) => `资金流完全停滞（净流向 ${ctx.trueFlowFmt}），做市商正 Gamma 极高（${ctx.netGexFmt}），大跌跌不动，大涨涨不上。`,
    action: (ctx) => `主力在耗时间杀期权权利金（Theta）。管住手，放弃突破幻想，只做 ${ctx.localPutWall ?? '--'}–${ctx.localCallWall ?? '--'} 区间的高抛低吸，或直接空仓看戏。`,
    hard_stop_direction: 'NEUTRAL',
    allow_trade: false,
    force_wait: false,
  },
  [REGIME.INSTITUTIONAL_BUY]: {
    icon: '🚀',
    title: '【机构扫货】',
    headline: (ctx) => `真实资金在主动向上吃单（Hit the Ask），机构正猛烈买入 Call（净流向 ${ctx.trueFlowFmt}），且上方做市商未设阻力盖板。`,
    action: (ctx) => `多头动能确认！回踩 ${ctx.localPutWall ?? '--'} 企稳即是买点，目标看至 ${ctx.localCallWall ?? '--'}。`,
    hard_stop_direction: 'BULL',
    allow_trade: true,
    force_long: true,
  },
  [REGIME.BEAR_FLUSH]: {
    icon: '💥',
    title: '【恐慌踩踏/防线崩塌】',
    headline: (ctx) => `做市商托盘底仓被砸穿（净流出 ${ctx.trueFlowFmt}），现货跌破做市商核心支撑 ${ctx.localPutWall ?? '--'}，多头底层逻辑彻底作废。`,
    action: '多单立刻无脑砍仓！绝不可抱有幻想，严禁此时头脑发热反手做空。',
    hard_stop_direction: 'EXIT',
    allow_trade: false,
    force_exit: true,
  },
  [REGIME.NEUTRAL]: {
    icon: '📊',
    title: '【数据待接入】',
    headline: () => '市场状态数据不足，等待更多信号。',
    action: '保持观望，等待数据完善后再做判断。',
    hard_stop_direction: 'NEUTRAL',
    allow_trade: false,
    force_wait: true,
  },
};

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────
function fmtFlow(val) {
  if (val == null || !Number.isFinite(val)) return '--';
  const sign = val >= 0 ? '+' : '';
  return `${sign}$${Math.abs(val).toFixed(1)}M`;
}

function fmtGex(val) {
  if (val == null || !Number.isFinite(val)) return '--';
  const abs = Math.abs(val);
  if (abs >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return val.toFixed(0);
}

// ─── 主引擎 ───────────────────────────────────────────────────────────────────
/**
 * @param {object} inputs
 * @returns {{ regime, priority, icon, title, headline, action, hard_stop_direction,
 *             allow_trade, force_wait, force_exit, force_long, force_bear,
 *             ctx, debug }}
 */
export function runMarketRegimeEngine({
  microstructureRead = {},
  gammaRegimeEngine  = {},
  priceValidation    = {},
  flowBehavior       = {},
  dealerWallMap      = {},
  volDashboard       = {},
  dealerFactors      = {},
  spotPrice          = null,
} = {}) {

  // ── 提取关键信号 ──────────────────────────────────────────────────────────
  const _rawTrueFlow  = microstructureRead.true_net_flow_m ?? null;
  const trueNetFlow   = _rawTrueFlow != null ? parseFloat(_rawTrueFlow) : null;  // 真实净吃单（M），parseFloat 处理字符串格式
  const msStatus      = microstructureRead.status ?? 'no_data';
  const mmVeto        = microstructureRead.mm_upside_veto === true;
  const upsideCharm   = microstructureRead.upside_charm_m ?? null;    // 上方 Charm 敞口（M）
  const tickCount     = microstructureRead.tick_count ?? 0;

  const gammaRegime   = gammaRegimeEngine.gamma_regime ?? 'unknown';  // positive/negative/transitional
  const netGex        = dealerFactors.net_gex ?? gammaRegimeEngine.net_gex ?? 0;
  const zeroGamma     = gammaRegimeEngine.zero_gamma_level ?? null;

  const ifvgBreached  = priceValidation.ifvg_breached === true;
  const delta5m       = priceValidation.price_context?.delta_5m ?? priceValidation.delta_5m ?? null;  // 5m 价格变化（price_context 嵌套层优先）
  const spotNow       = spotPrice ?? priceValidation.price_context?.spot_now ?? priceValidation.spot_now ?? null;

  const ivCollapsing  = flowBehavior.iv_collapsing === true;
  const iv30          = volDashboard.iv30 ?? null;
  const ivRank        = volDashboard.iv_rank ?? null;

  const callWall      = dealerWallMap.call_wall ?? null;
  const putWall       = dealerWallMap.put_wall ?? null;
  const localCallWall = dealerWallMap.gex_local_call_wall ?? null;
  const localPutWall  = dealerWallMap.gex_local_put_wall ?? null;

  // ── 构建上下文（用于模板渲染）────────────────────────────────────────────
  const ctx = {
    trueFlowFmt:  fmtFlow(trueNetFlow),
    netGexFmt:    fmtGex(netGex),
    zeroGamma:    zeroGamma != null ? String(zeroGamma) : null,
    callWall:     callWall  != null ? String(callWall)  : null,
    putWall:      putWall   != null ? String(putWall)   : null,
    localCallWall: localCallWall != null ? String(localCallWall) : null,
    localPutWall:  localPutWall  != null ? String(localPutWall)  : null,
    charmLevel:   upsideCharm != null ? String(Math.round(upsideCharm)) : null,
    iv30:         iv30 != null ? iv30.toFixed(1) : null,
    ivRank:       ivRank != null ? ivRank.toFixed(1) : null,
    spotNow:      spotNow != null ? spotNow.toFixed(1) : null,
  };

  // ── 优先级路由 ────────────────────────────────────────────────────────────
  let regime = REGIME.NEUTRAL;
  let priority = 99;
  let debug = [];

  // ── P1A: Gamma 倒转（GEX 由正转负 + 跌破 Zero-Gamma）────────────────────
  const gammaFlipped = gammaRegime === 'negative' && netGex < 0;
  const belowZeroGamma = zeroGamma != null && spotNow != null && spotNow < zeroGamma;
  if (gammaFlipped || belowZeroGamma) {
    regime = REGIME.GAMMA_FLIP;
    priority = 1;
    debug.push(`P1A: gammaFlipped=${gammaFlipped}, belowZeroGamma=${belowZeroGamma}`);
  }

  // ── P1B: 防线崩溃（IFVG + 真实净流向深度负 + 跌破做市商支撑）────────────
  const deepNegFlow = trueNetFlow != null && trueNetFlow < -10;
  const belowLocalSupport = localPutWall != null && spotNow != null && spotNow < localPutWall;
  if (priority > 1 && ifvgBreached && (deepNegFlow || belowLocalSupport)) {
    regime = REGIME.DEFENSE_COLLAPSE;
    priority = 1;
    debug.push(`P1B: ifvgBreached=${ifvgBreached}, deepNegFlow=${deepNegFlow}, belowLocalSupport=${belowLocalSupport}`);
  }

  // ── P2: 逻辑冲突（真实多头流 + 极端负 Charm 铁顶）──────────────────────
  const trulyBullish = trueNetFlow != null && trueNetFlow > 3;
  const extremeCharmVeto = mmVeto === true || (upsideCharm != null && upsideCharm < -500);
  if (priority > 2 && trulyBullish && extremeCharmVeto) {
    regime = REGIME.FLOW_CONFLICT;
    priority = 2;
    debug.push(`P2: trulyBullish=${trulyBullish}, extremeCharmVeto=${extremeCharmVeto}, upsideCharm=${upsideCharm}`);
  }

  // ── P3: Vanna 逼空（IV 塌陷 + 无量推升 + 真实流向平淡）─────────────────
  const priceRising = delta5m != null && delta5m > 0.5;
  const flowFlat    = trueNetFlow != null && trueNetFlow > -2 && trueNetFlow < 3;
  const ivDroppingFast = ivCollapsing || (ivRank != null && ivRank < 20);
  if (priority > 3 && ivDroppingFast && priceRising && flowFlat) {
    regime = REGIME.VANNA_SQUEEZE;
    priority = 3;
    debug.push(`P3: ivDroppingFast=${ivDroppingFast}, priceRising=${priceRising}, flowFlat=${flowFlat}`);
  }

  // ── P4 常规情境（仅在无高优先级触发时判断）──────────────────────────────
  if (priority > 3) {
    const highGex = netGex > 50000;  // 正 Gamma 极高（绞肉机阻尼）
    const trulyBearish = trueNetFlow != null && trueNetFlow < -3;
    const trulyBullishStrong = trueNetFlow != null && trueNetFlow > 5;
    const priceRisingModest = delta5m != null && delta5m > 0.3;
    const priceFalling = delta5m != null && delta5m < -0.5;

    // P4A: 恐慌踩踏（深度负流 + 跌破支撑 + 无 IFVG 但已破位）
    if (trulyBearish && belowLocalSupport) {
      regime = REGIME.BEAR_FLUSH;
      priority = 4;
      debug.push(`P4A: BEAR_FLUSH, trulyBearish=${trulyBearish}, belowLocalSupport=${belowLocalSupport}`);
    }

    // P4B: 诱多陷阱（价格上涨 + 真实净流向负 + 高 GEX 压制）
    else if (priceRisingModest && trulyBearish && highGex) {
      regime = REGIME.BULL_TRAP;
      priority = 4;
      debug.push(`P4B: BULL_TRAP, priceRising=${priceRisingModest}, trulyBearish=${trulyBearish}`);
    }

    // P4C: 机构扫货（真实强多头流 + 无 Charm 否决 + 价格上涨）
    else if (trulyBullishStrong && !extremeCharmVeto && priceRisingModest) {
      regime = REGIME.INSTITUTIONAL_BUY;
      priority = 4;
      debug.push(`P4C: INSTITUTIONAL_BUY, trueNetFlow=${trueNetFlow}`);
    }

    // P4D: 绞肉机（高 GEX + 资金流停滞 + 价格横盘）
    else if (highGex && flowFlat) {
      regime = REGIME.GRINDER;
      priority = 4;
      debug.push(`P4D: GRINDER, highGex=${highGex}, flowFlat=${flowFlat}`);
    }

    // 默认：数据不足或无明确信号
    else {
      regime = REGIME.NEUTRAL;
      priority = 99;
      debug.push(`P4_NEUTRAL: no clear signal, trueNetFlow=${trueNetFlow}, delta5m=${delta5m}`);
    }
  }

  // ── 渲染输出 ──────────────────────────────────────────────────────────────
  const tpl = REGIME_TEMPLATES[regime] || REGIME_TEMPLATES[REGIME.NEUTRAL];
  const headlineStr = typeof tpl.headline === 'function' ? tpl.headline(ctx) : tpl.headline;
  const actionStr   = typeof tpl.action   === 'function' ? tpl.action(ctx)   : tpl.action;

  // 机器盖子/垫子（基于 Charm 和 GEX 本地墙）
  const algoResistance = localCallWall != null
    ? { level: localCallWall, label: `上方算法盖板：${localCallWall}`, strength: mmVeto ? '强压制，勿追' : '注意阻力' }
    : null;
  const algoSupport = localPutWall != null
    ? { level: localPutWall, label: `下方算法承接：${localPutWall}`, strength: netGex > 100000 ? '强托底' : '弱支撑' }
    : null;

  // 绝对风控红线（基于 IFVG + 做市商防线）
  const hardStop = (() => {
    if (regime === REGIME.DEFENSE_COLLAPSE || regime === REGIME.BEAR_FLUSH) {
      return { level: localPutWall, label: `死守底线：${localPutWall ?? '--'}`, note: '若跌破并形成 IFVG，多单强制平仓' };
    }
    if (regime === REGIME.GAMMA_FLIP) {
      return { level: zeroGamma, label: `Zero-Gamma 防线：${zeroGamma ?? '--'}`, note: '已击穿，趋势行情，顺势操作' };
    }
    if (regime === REGIME.INSTITUTIONAL_BUY) {
      return { level: localPutWall, label: `多头止损线：${localPutWall ?? '--'}`, note: '跌破即止损，不争论' };
    }
    return { level: localPutWall, label: `观察底线：${localPutWall ?? '--'}`, note: '跌破后重新评估方向' };
  })();

  return {
    regime,
    priority,
    icon:   tpl.icon,
    title:  tpl.title,
    headline: headlineStr,
    action:   actionStr,
    hard_stop_direction: tpl.hard_stop_direction || 'NEUTRAL',
    allow_trade:  tpl.allow_trade  ?? false,
    force_wait:   tpl.force_wait   ?? false,
    force_exit:   tpl.force_exit   ?? false,
    force_long:   tpl.force_long   ?? false,
    force_bear:   tpl.force_bear   ?? false,
    algo_resistance: algoResistance,
    algo_support:    algoSupport,
    hard_stop:       hardStop,
    true_flow_fmt:   ctx.trueFlowFmt,
    true_net_flow_m: trueNetFlow,
    net_gex_fmt:     ctx.netGexFmt,
    ctx,
    debug,
  };
}
