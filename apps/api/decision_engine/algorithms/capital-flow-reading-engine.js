/**
 * capital-flow-reading-engine.js  v2
 *
 * Gemini 级别的资金解读引擎（做市商对冲模型）
 * ─────────────────────────────────────────────────────────────────────────────
 * 核心逻辑：
 *  1. 情绪 vs 真实资金背离（Sentiment vs Premium Divergence）
 *     - 散户看量（P/C Volume），机构看钱（Net Premium）
 *     - P/C Volume 高（散户看空）但 Net Premium 正（大资金买涨）→ 背离，看多
 *     - 永远跟随权利金方向，忽略成交量情绪
 *
 *  2. Gamma 状态机（State Machine）
 *     - 正 Gamma：做市商高抛低吸 → 震荡市，磁吸 ATM
 *     - 负 Gamma：做市商追涨杀跌 → 趋势市，放大波动
 *
 *  3. 多窗口资金流向（5m/15m/日内）
 *     - 5m/15m 一致 → 动能可信
 *     - 5m/15m 冲突 → 动能不稳，降级
 *     - fallback 复用 → 数据不可信
 *
 *  4. 价格 vs 资金配合度
 *     - call_effective / put_effective → 同向，可执行
 *     - put_squeezed / call_capped → 背离，禁追
 *
 *  5. A单 执行门控
 *     - trade_gate: PASS / DEGRADED / BLOCKED
 * ─────────────────────────────────────────────────────────────────────────────
 */

function _fmtM(val, sign = false) {
  if (val == null || !Number.isFinite(Number(val))) return '--';
  const n = Number(val);
  const s = sign && n > 0 ? '+' : '';
  if (Math.abs(n) >= 1_000_000) return s + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000)     return s + (n / 1_000).toFixed(1) + 'K';
  return s + n.toFixed(0);
}

// ── 情绪 vs 资金背离检测 ─────────────────────────────────────────────────────
function detectDivergence({ pcVolume, callPrem, putPrem, netPrem, behavior }) {
  const pcVol = Number(pcVolume) || 0;
  const callP = Number(callPrem) || 0;
  const putP  = Number(putPrem)  || 0;

  const sentimentBear    = pcVol > 1.2;
  const sentimentBull    = pcVol < 0.8;
  const sentimentNeutral = !sentimentBull && !sentimentBear;
  const moneyBull        = callP > putP * 1.1;
  const moneyBear        = putP  > callP * 1.1;

  let type = 'NONE', desc = '', signal = 'NEUTRAL';

  if (sentimentBear && moneyBull) {
    type   = 'BULL_DIVERGENCE';
    desc   = `P/C Volume ${pcVol.toFixed(2)}（散户偏空），但 Call 权利金 ${_fmtM(callP)} > Put 权利金 ${_fmtM(putP)}，大资金在买涨。`;
    signal = 'BULLISH';
  } else if (sentimentBull && moneyBear) {
    type   = 'BEAR_DIVERGENCE';
    desc   = `P/C Volume ${pcVol.toFixed(2)}（散户偏多），但 Put 权利金 ${_fmtM(putP)} > Call 权利金 ${_fmtM(callP)}，大资金在买跌。`;
    signal = 'BEARISH';
  } else if (behavior === 'put_squeezed') {
    type   = 'PUT_ABSORBED';
    desc   = `Put 权利金 ${_fmtM(putP)} 偏重，但价格没有跌破 ATM，做市商正在吸收空头压力。`;
    signal = 'BULLISH';
  } else if (behavior === 'call_capped') {
    type   = 'CALL_CAPPED';
    desc   = `Call 权利金 ${_fmtM(callP)} 偏重，但价格未突破上方阻力，多头资金被压制。`;
    signal = 'BEARISH';
  } else if (sentimentNeutral && moneyBull) {
    type   = 'QUIET_BULL';
    desc   = `成交量均衡，但 Call 权利金 ${_fmtM(callP)} 悄悄高于 Put，大资金低调做多。`;
    signal = 'BULLISH';
  } else if (sentimentNeutral && moneyBear) {
    type   = 'QUIET_BEAR';
    desc   = `成交量均衡，但 Put 权利金 ${_fmtM(putP)} 悄悄高于 Call，大资金低调做空。`;
    signal = 'BEARISH';
  }

  return {
    detected:       type !== 'NONE',
    type,
    description:    desc || '资金与情绪方向一致，无背离。',
    trade_signal:   signal,
    sentiment_side: sentimentBear ? 'BEARISH' : sentimentBull ? 'BULLISH' : 'NEUTRAL',
    money_side:     moneyBear ? 'BEARISH' : moneyBull ? 'BULLISH' : 'NEUTRAL',
  };
}

// ── Gamma 状态机 ─────────────────────────────────────────────────────────────
function classifyGammaState({ gammaRegime, netGex }) {
  const gex = Number(netGex) || 0;
  const isPos = gammaRegime === 'positive' || gex > 50_000;
  const isNeg = gammaRegime === 'negative' || gex < -50_000;

  if (isPos) return {
    state: 'POSITIVE',
    label: '正 Gamma 震荡',
    color: 'amber',
    mm_behavior: '做市商高抛低吸，价格被磁吸在 ATM 附近，不适合追方向单。',
    trade_implication: '震荡市，逢高卖权占优；方向单需等 Gamma 翻转或资金突破确认。',
  };
  if (isNeg) return {
    state: 'NEGATIVE',
    label: '负 Gamma 趋势',
    color: 'green',
    mm_behavior: '做市商追涨杀跌，价格趋势会被放大，突破后动能强。',
    trade_implication: '趋势市，顺势追单，突破确认后可加速。',
  };
  return {
    state: 'TRANSITIONAL',
    label: 'Gamma 中性',
    color: 'gray',
    mm_behavior: '做市商处于零轴附近，方向不明，随时可能切换。',
    trade_implication: '等待 Gamma 明确偏向后再入场。',
  };
}

// ── 多窗口资金流向 ────────────────────────────────────────────────────────────
function buildFlowWindows({ fb }) {
  const d5m  = fb.flow_5m_delta  ?? null;
  const d15m = fb.flow_15m_delta ?? null;
  const dayNet = fb.net_premium  ?? null;
  const fb5f  = fb.flow_5m_is_fallback  === true;
  const fb15f = fb.flow_15m_is_fallback === true;
  const dir5m  = fb.flow_5m_direction  || 'neutral';
  const dir15m = fb.flow_15m_direction || 'neutral';

  const m5  = { delta_fmt: _fmtM(d5m, true),  direction: dir5m,  is_fallback: fb5f,
    label: fb5f  ? `${_fmtM(d5m, true)}/5m ⚠复用`  : (fb.flow_5m_label  || _fmtM(d5m, true)  + '/5m') };
  const m15 = { delta_fmt: _fmtM(d15m, true), direction: dir15m, is_fallback: fb15f,
    label: fb15f ? `${_fmtM(d15m, true)}/15m ⚠复用` : (fb.flow_15m_label || _fmtM(d15m, true) + '/15m') };
  const day = {
    net_fmt:  _fmtM(dayNet, true),
    call_fmt: _fmtM(fb.call_premium_abs),
    put_fmt:  _fmtM(fb.put_premium_abs),
    direction: dayNet > 0 ? 'bullish' : dayNet < 0 ? 'bearish' : 'neutral',
  };

  const bothFallback = fb5f && fb15f;
  const aligned = fb.dual_window_aligned === true && !fb5f && !fb15f;
  const conflict = fb.dual_window_conflict === true;

  let windowStatus, windowNote;
  if (bothFallback) {
    windowStatus = 'FALLBACK';
    windowNote   = '5m/15m 均为复用数据，窗口不可信，方向降级。';
  } else if (fb5f || fb15f) {
    windowStatus = 'PARTIAL';
    windowNote   = (fb5f ? '5m' : '15m') + ' 为复用数据，部分降级。';
  } else if (conflict) {
    windowStatus = 'CONFLICT';
    windowNote   = '5m 和 15m 方向冲突，动能不稳，等待对齐。';
  } else if (aligned) {
    windowStatus = 'ALIGNED';
    windowNote   = `5m ${m5.label} + 15m ${m15.label} 方向一致，动能可信。`;
  } else {
    windowStatus = 'WEAK';
    windowNote   = '窗口数据存在，但对齐度不足。';
  }

  return { m5, m15, day, window_status: windowStatus, window_note: windowNote };
}

// ── 主引擎 ────────────────────────────────────────────────────────────────────
export function buildCapitalFlowReading(signal) {
  const fb  = signal.flow_behavior_engine || {};
  // [v3] money_read 已废弃，所有数据从 fb / gexData 直接读取
  const gexData = signal.dealer_wall_map  || {};

  const netPrem    = fb.net_premium      ?? null;
  const callPrem   = fb.call_premium_abs ?? null;
  const putPrem    = fb.put_premium_abs  ?? null;
  const pcVol      = fb.pc_volume_ratio  ?? fb.pc_primary_ratio ?? null;
  // 修复：pc_premium_ratio = Call权利金 / Put权利金（不是 fb.pc_premium_ratio=0 的旧字段）
  const pcPrem     = (callPrem != null && putPrem != null && putPrem > 0)
    ? callPrem / putPrem : null;
  const behavior   = fb.behavior         || 'neutral';
  const gammaRegime = fb.gamma_regime    || gexData.gamma_regime || 'unknown';
  const netGex     = gexData.net_gex     ?? fb.net_gex ?? null;
  const flowQuality = fb.flow_quality    || 'DEGRADED';
  const isDegraded  = flowQuality === 'DEGRADED';

  // ── 子模块 ──────────────────────────────────────────────────────────────
  const gammaState  = classifyGammaState({ gammaRegime, netGex });
  const divergence  = detectDivergence({ pcVolume: pcVol, callPrem, putPrem, netPrem, behavior });
  const flowWindows = buildFlowWindows({ fb });

  // ── 人话生成（Gemini 风格：数据切片 → 交叉验证 → 状态机 → 人话翻译）──────
  let headline = '', detail = '', mmAction = '', tradeImpact = '';

  // 背离优先
  if (divergence.detected) {
    switch (divergence.type) {
      case 'BULL_DIVERGENCE':
        headline = `⚡ 背离信号：散户买 Put，大资金买 Call`;
        detail   = `P/C Volume ${pcVol != null ? Number(pcVol).toFixed(2) : '--'}（散户偏空），但 Call 权利金 ${_fmtM(callPrem)} 远超 Put 权利金 ${_fmtM(putPrem)}。散户情绪和机构筹码背离——永远跟随权利金方向，看多。`;
        break;
      case 'BEAR_DIVERGENCE':
        headline = `⚡ 背离信号：散户买 Call，大资金买 Put`;
        detail   = `P/C Volume ${pcVol != null ? Number(pcVol).toFixed(2) : '--'}（散户偏多），但 Put 权利金 ${_fmtM(putPrem)} 远超 Call 权利金 ${_fmtM(callPrem)}。机构在悄悄布空，跟随权利金方向，看空。`;
        break;
      case 'PUT_ABSORBED':
        headline = `⚡ Put 被吸收：空头压力被做市商对冲，禁追 Put`;
        detail   = `Put 权利金 ${_fmtM(putPrem)} 偏重（P/C ${pcVol != null ? Number(pcVol).toFixed(2) : '--'}），但价格跌不动，说明做市商在底部对冲买入。这不是干净空头，禁止追 Put。`;
        break;
      case 'CALL_CAPPED':
        headline = `⚡ Call 被压制：多头资金被上方阻力吸收，禁追 Call`;
        detail   = `Call 权利金 ${_fmtM(callPrem)} 偏重，但价格涨不动，说明上方有大量做市商卖盘对冲。这不是干净多头，禁止追 Call。`;
        break;
      case 'QUIET_BULL':
        headline = `大资金低调做多`;
        detail   = `成交量均衡，但 Call 权利金 ${_fmtM(callPrem)} 悄悄高于 Put 权利金 ${_fmtM(putPrem)}。机构在低调布多，等价格突破确认。`;
        break;
      case 'QUIET_BEAR':
        headline = `大资金低调做空`;
        detail   = `成交量均衡，但 Put 权利金 ${_fmtM(putPrem)} 悄悄高于 Call 权利金 ${_fmtM(callPrem)}。机构在低调布空，等价格跌破确认。`;
        break;
    }
  } else {
    // 无背离：直接看净权利金
    if (netPrem != null && netPrem > 0) {
      headline = `资金净流入看多：日内净权利金 ${_fmtM(netPrem, true)}`;
      detail   = `Call 权利金 ${_fmtM(callPrem)} / Put 权利金 ${_fmtM(putPrem)}，资金与情绪方向一致，多头主导。`;
    } else if (netPrem != null && netPrem < 0) {
      headline = `资金净流出看空：日内净权利金 ${_fmtM(netPrem, true)}`;
      detail   = `Put 权利金 ${_fmtM(putPrem)} / Call 权利金 ${_fmtM(callPrem)}，资金与情绪方向一致，空头主导。`;
    } else {
      headline = `资金方向待确认`;
      detail   = `Call 权利金 ${_fmtM(callPrem)} / Put 权利金 ${_fmtM(putPrem)}，多空资金相对均衡，等待分化。`;
    }
  }

  // 做市商行动建议（基于 gamma 状态和资金背离）
  mmAction = mr.mm_what_to_do || gammaState.mm_behavior;

  // ── A单 执行门控 ──────────────────────────────────────────────────────────
  let tradeGate = 'DEGRADED';

  if (isDegraded) {
    tradeGate   = 'DEGRADED';
    tradeImpact = `Flow 数据降级（${flowWindows.window_note}），A 单仅显示预案，不可执行。`;
  } else if (flowWindows.window_status === 'FALLBACK' || flowWindows.window_status === 'CONFLICT') {
    tradeGate   = 'DEGRADED';
    tradeImpact = `${flowWindows.window_note}，A 单暂不可执行。`;
  } else if (divergence.type === 'PUT_ABSORBED' || divergence.type === 'CALL_CAPPED') {
    tradeGate   = 'DEGRADED';
    tradeImpact = `资金与价格背离（${divergence.type === 'PUT_ABSORBED' ? 'Put 被吸收' : 'Call 被压制'}），A 单仅显示预案，等价格确认后执行。`;
  } else if (gammaState.state === 'POSITIVE' && behavior !== 'call_effective' && behavior !== 'put_effective') {
    tradeGate   = 'DEGRADED';
    tradeImpact = `正 Gamma 磁吸环境，做市商对冲会压制方向，A 单需等 Gamma 翻转或资金突破确认。`;
  } else if (flowWindows.window_status === 'ALIGNED' && (behavior === 'call_effective' || behavior === 'put_effective')) {
    tradeGate   = 'PASS';
    tradeImpact = `资金和价格同向，5m/15m 趋势一致，A 单条件具备时可执行。`;
  } else {
    tradeGate   = 'DEGRADED';
    tradeImpact = `资金动能不足以直接推升价格，等待进一步确认。`;
  }

  // ── 微调1：P/C 对比（资金比 vs 量比）──────────────────────────────────────
  // 资金比 = Put权利金 / Call权利金（反向，Put越重比值越大）
  const pcPremPutOverCall = (callPrem != null && putPrem != null && callPrem > 0)
    ? putPrem / callPrem : null;
  const pcCompareText = (pcPremPutOverCall != null && pcVol != null)
    ? `量比 ${Number(pcVol).toFixed(2)} vs 资金比 ${Number(pcPremPutOverCall).toFixed(2)}（Put 资金是 Call 的 ${Number(pcPremPutOverCall).toFixed(1)} 倍）`
    : null;

  // ── 微调2：盘面综合状态标签 ──────────────────────────────────────────────────
  // 综合情绪方向 + 资金方向 + 背离类型 → 一个人话标签
  let marketSummaryLabel = 'NEUTRAL';
  let marketSummaryText  = '多空均衡，等待方向确认';
  if (divergence.type === 'PUT_ABSORBED') {
    marketSummaryLabel = 'ABSORPTION';
    marketSummaryText  = '被动承接 / 诱空陷阱 — 做市商正在底部吸收空头压力，禁止追空';
  } else if (divergence.type === 'CALL_CAPPED') {
    marketSummaryLabel = 'DISTRIBUTION';
    marketSummaryText  = '高位派发 / 诱多陷阱 — 做市商正在顶部吸收多头压力，禁止追多';
  } else if (divergence.type === 'BULL_DIVERGENCE') {
    marketSummaryLabel = 'BULL_DIVERGENCE';
    marketSummaryText  = '逼空背离 — 散户看空但大资金买涨，跟随权利金方向看多';
  } else if (divergence.type === 'BEAR_DIVERGENCE') {
    marketSummaryLabel = 'BEAR_DIVERGENCE';
    marketSummaryText  = '诱多背离 — 散户看多但大资金买跌，跟随权利金方向看空';
  } else if (divergence.type === 'QUIET_BULL') {
    marketSummaryLabel = 'QUIET_BULL';
    marketSummaryText  = '低调做多 — 大资金悄悄布多，等价格突破确认';
  } else if (divergence.type === 'QUIET_BEAR') {
    marketSummaryLabel = 'QUIET_BEAR';
    marketSummaryText  = '低调做空 — 大资金悄悄布空，等价格跌破确认';
  } else if (divergence.money_side === 'BULLISH' && divergence.sentiment_side === 'BULLISH') {
    marketSummaryLabel = 'CONSENSUS_BULL';
    marketSummaryText  = '多头共识 — 资金与情绪同向看多';
  } else if (divergence.money_side === 'BEARISH' && divergence.sentiment_side === 'BEARISH') {
    marketSummaryLabel = 'CONSENSUS_BEAR';
    marketSummaryText  = '空头共识 — 资金与情绪同向看空';
  }

  // ── 微调3：价格防线失效条件（替换抽象的 Flow 降级说法）────────────────────
  // 从 signal 中读取 primary_plan.stop 作为失效线
  const _hvm   = signal.home_view_model   || {};
  const _op    = (_hvm.order_plan)        || {};
  const _pp    = (_op.primary_plan)       || {};
  const _stopPrice = _pp.stop             || null;
  const _side      = _pp.side             || null;
  const _dwm   = signal.dealer_wall_map   || {};
  const _putWall   = _dwm.gex_local_put_wall  || _dwm.put_wall  || null;
  const _callWall  = _dwm.gex_local_call_wall || _dwm.call_wall || null;

  let invalidationPriceLine = null;
  if (divergence.type === 'PUT_ABSORBED' && _putWall) {
    // 做市商吸收模型：防线被实质击穿 = 实体K线跌破 Put Wall
    invalidationPriceLine = `实体 K 线跌破并站稳 ${_putWall}（做市商放弃抵抗，吸收转化为真跌）`;
  } else if (divergence.type === 'CALL_CAPPED' && _callWall) {
    invalidationPriceLine = `实体 K 线突破并站稳 ${_callWall}（做市商放弃压制，派发转化为真涨）`;
  } else if (_stopPrice && _side === 'LONG') {
    invalidationPriceLine = `实体 K 线跌破并站稳 ${_stopPrice}（多头失效线，做市商对冲失效）`;
  } else if (_stopPrice && _side === 'SHORT') {
    invalidationPriceLine = `实体 K 线突破并站稳 ${_stopPrice}（空头失效线，做市商对冲失效）`;
  }

  // ── 失效条件摘要 ──────────────────────────────────────────────────────────
  const invalidationNotes = [];
  if (isDegraded)                                          invalidationNotes.push('Flow 数据降级');
  if (flowWindows.window_status === 'CONFLICT')            invalidationNotes.push('5m/15m 冲突');
  if (flowWindows.window_status === 'FALLBACK')            invalidationNotes.push('窗口数据复用');
  if (gammaState.state === 'POSITIVE')                     invalidationNotes.push('正 Gamma 磁吸');
  if (divergence.type === 'PUT_ABSORBED')                  invalidationNotes.push('追 Put 陷阱');
  if (divergence.type === 'CALL_CAPPED')                   invalidationNotes.push('追 Call 陷阱');

  return {
    // Gamma 状态
    gamma_state:       gammaState.state,
    gamma_label:       gammaState.label,
    gamma_color:       gammaState.color,
    gamma_mm_behavior: gammaState.mm_behavior,
    gamma_trade_impl:  gammaState.trade_implication,

    // 情绪 vs 资金背离
    divergence_detected: divergence.detected,
    divergence_type:     divergence.type,
    divergence_desc:     divergence.description,
    divergence_signal:   divergence.trade_signal,
    sentiment_side:      divergence.sentiment_side,
    money_side:          divergence.money_side,

    // 多窗口资金流向
    flow_5m:          flowWindows.m5.label,
    flow_5m_dir:      flowWindows.m5.direction,
    flow_5m_fallback: flowWindows.m5.is_fallback,
    flow_15m:         flowWindows.m15.label,
    flow_15m_dir:     flowWindows.m15.direction,
    flow_15m_fallback:flowWindows.m15.is_fallback,
    day_net:          flowWindows.day.net_fmt,
    day_call:         flowWindows.day.call_fmt,
    day_put:          flowWindows.day.put_fmt,
    day_direction:    flowWindows.day.direction,
    window_status:    flowWindows.window_status,
    window_note:      flowWindows.window_note,

    // P/C 比率（修复 pc_premium_ratio=0 问题）
    pc_volume_ratio:    pcVol  != null ? Number(pcVol).toFixed(2)  : '--',
    pc_premium_ratio:   pcPrem != null ? Number(pcPrem).toFixed(2) : '--',  // Call/Put
    pc_prem_put_over_call: pcPremPutOverCall != null ? Number(pcPremPutOverCall).toFixed(2) : '--',  // Put/Call（资金比）
    pc_compare_text:    pcCompareText,  // 微调1：量比 vs 资金比对比文本
    call_premium_fmt:   _fmtM(callPrem),
    put_premium_fmt:    _fmtM(putPrem),
    net_premium_fmt:    _fmtM(netPrem, true),

    // 微调2：盘面综合状态标签
    market_summary_label: marketSummaryLabel,
    market_summary_text:  marketSummaryText,

    // 微调3：价格防线失效条件
    invalidation_price_line: invalidationPriceLine,

    // 人话解读
    headline,
    detail,
    mm_action:    mmAction,
    trade_impact: tradeImpact,

    // A单 执行门控
    trade_gate:       tradeGate,
    usable_for_trade: tradeGate === 'PASS',

    // 失效条件
    invalidation_notes: invalidationNotes,
    behavior,
    flow_quality: flowQuality,

    // 向后兼容旧字段（防止前端读旧字段报错）
    five_min_money_in:    flowWindows.m5.label,
    fifteen_min_money_in: flowWindows.m15.label,
    day_net_money:        flowWindows.day.net_fmt,
    call_premium_total:   _fmtM(callPrem),
    put_premium_total:    _fmtM(putPrem),
    flow_vs_price_text:   divergence.description,
    trade_impact_text:    tradeImpact,
  };
}
