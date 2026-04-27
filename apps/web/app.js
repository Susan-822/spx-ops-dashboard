const SCENARIOS = [
  'negative_gamma_wait_pullback',
  'positive_gamma_income_watch',
  'flip_conflict_wait',
  'theta_stale_no_trade',
  'fmp_event_no_short_vol',
  'uw_call_strong_unconfirmed',
  'breakout_pullback_pending'
];

const ACTION_MAP = {
  long_on_pullback: {
    permission: 'WAIT',
    badge: 'wait',
    title: '等回踩不破再多',
    summary: '方向偏多，但不追。只接受回踩确认后的右侧多。',
    plan: '顺势多',
    triggerLabel: '回踩不破',
    targetLabel: '先看上方墙',
    blockLabel: '跌回关键位下方'
  },
  short_on_retest: {
    permission: 'WAIT',
    badge: 'wait',
    title: '等反抽不过再空',
    summary: '结构偏弱，但不低位追空。只接受反抽压力失败。',
    plan: '顺势空',
    triggerLabel: '反抽不过',
    targetLabel: '先看下方墙',
    blockLabel: '重新站回压力上方'
  },
  income_ok: {
    permission: 'WATCH',
    badge: 'go',
    title: '铁鹰观察，等波动回落',
    summary: '只有价格回到中间区并且波动收敛，才允许考虑收入型结构。',
    plan: '收租观察',
    triggerLabel: '回中轴钉住',
    targetLabel: '收时间价值',
    blockLabel: '离开区间或 IV 再抬'
  },
  no_trade: {
    permission: 'BLOCK',
    badge: 'block',
    title: '禁做，等系统恢复',
    summary: '数据、事件或信号冲突不允许给交易指令。先保护本金。',
    plan: '禁止交易',
    triggerLabel: '无',
    targetLabel: '无',
    blockLabel: '解除风险前不做'
  },
  wait: {
    permission: 'WAIT',
    badge: 'wait',
    title: '等确认，不追',
    summary: '位置不够干净，等价格离开中间区后再判断。',
    plan: '观望',
    triggerLabel: '等确认',
    targetLabel: '等待新结构',
    blockLabel: '冲突未解除不做'
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeText(value, fallback = '--') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    const text = value.map((item) => safeText(item, '')).filter(Boolean).join('；');
    return text || fallback;
  }

  if (typeof value === 'object') {
    return (
      value.plain_chinese ||
      value.summary ||
      value.text ||
      value.note ||
      value.message ||
      value.output ||
      value.state ||
      value.label ||
      value.status ||
      fallback
    );
  }

  return fallback;
}

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function displaySpot(snapshot = {}) {
  return snapshot?.spot_is_real === true && Number.isFinite(Number(snapshot?.spot))
    ? fmt(snapshot.spot, 2)
    : '--';
}

function displaySpotContext(snapshot = {}) {
  if (snapshot?.spot_is_real === true) {
    return `FMP real · ${minutesAgo(snapshot.spot_last_updated)}`;
  }
  if (snapshot?.spot_source === 'fmp') {
    return 'FMP unavailable';
  }
  return spotPositionLabel(snapshot.spot_position);
}

function shortTime(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function minutesAgo(value) {
  if (!value) return '--';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '--';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  return mins <= 0 ? '刚刚' : `${mins}m ago`;
}

function getScenario() {
  const params = new URLSearchParams(window.location.search);
  return params.get('scenario');
}

async function loadSignal() {
  const scenario = getScenario();
  const path = scenario
    ? `/signals/current?scenario=${encodeURIComponent(scenario)}`
    : '/signals/current';
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`/signals/current ${response.status}`);
  return await response.json();
}

function sourceStateLabel(state) {
  return {
    real: 'REAL',
    partial: 'PARTIAL',
    stale: 'STALE',
    unavailable: 'UNAVAILABLE',
    mock: 'MOCK',
    delayed: 'DELAY',
    degraded: 'DEGRADE',
    down: 'DOWN'
  }[state] || String(state || 'UNKNOWN').toUpperCase();
}

function marketStateLabel(value) {
  return {
    positive_gamma_grind: '正Gamma｜磨盘',
    negative_gamma_expand: '负Gamma｜等扩张',
    flip_chop: 'Flip附近｜拉扯',
    event_risk: '事件风险｜先收手',
    unknown: '环境不明｜少做'
  }[value] || value || '环境不明｜少做';
}

function gammaLabel(value) {
  return {
    positive: '正Gamma',
    negative: '负Gamma',
    critical: 'Gamma临界',
    unknown: 'Gamma未知'
  }[value] || value || 'Gamma未知';
}

function spotPositionLabel(value) {
  return {
    below_flip: '现价在 Flip 下方',
    above_flip_below_call_wall: 'Flip 上方，Call Wall 下方',
    above_call_wall: '突破 Call Wall 上方',
    below_put_wall: '跌破 Put Wall 下方',
    between_walls: '墙内震荡区'
  }[value] || value || '位置未知';
}

function flowLabel(value) {
  return {
    call_strong: 'Call 偏强',
    put_strong: 'Put 偏强',
    mixed: '多空混合',
    neutral: '中性',
    unknown: '未知'
  }[value] || value || '未知';
}

function darkPoolLabel(value) {
  return {
    support_below: '下方支撑资金区',
    resistance_above: '上方压力资金区',
    accumulation: '偏吸筹',
    distribution: '偏派发',
    unclear: '不明显'
  }[value] || value || '不明显';
}

function dealerLabel(value) {
  return {
    control_vol: '控波动',
    release_vol: '放波动',
    sweep_up: '往上扫空',
    sweep_down: '往下扫多',
    hedge: '对冲为主',
    unclear: '不清楚'
  }[value] || value || '不清楚';
}

function thetaStatus(signal = {}) {
  return signal?.dealer_conclusion?.status || signal?.theta?.status || 'unavailable';
}

function thetaIsLive(signal = {}) {
  return thetaStatus(signal) === 'live';
}

function thetaLevel(signal, value) {
  return thetaIsLive(signal) ? fmtInt(value) : '--';
}

function thetaLevelNote(signal, fallback) {
  if (thetaIsLive(signal)) return fallback;
  if (thetaStatus(signal) === 'partial') return 'Theta partial / 仅参考 / 不可执行';
  return 'Theta disabled / EM only';
}

function uwSafeValue(signal, field) {
  const status = signal?.uw_conclusion?.status || signal?.uw?.status || 'unavailable';
  if (status === 'live') {
    if (field === 'flow') return flowLabel(signal.uw_conclusion?.flow_bias || signal.uw_context?.flow_bias);
    if (field === 'darkpool') return darkPoolLabel(signal.uw_conclusion?.darkpool_bias || signal.uw_context?.dark_pool_bias);
    if (field === 'dealer') return dealerLabel(signal.uw_conclusion?.dealer_crosscheck || signal.uw_context?.dealer_bias);
  }
  if (status === 'partial') return 'partial / 仅参考，不可执行';
  return 'unavailable';
}

function thetaDecisionText(signal) {
  if (thetaStatus(signal) === 'partial') {
    return 'partial：期权链/OI/IV 已接入，Gamma 不完整，不可执行';
  }
  if (thetaStatus(signal) === 'live') {
    return signal.signals?.theta_signal || gammaLabel(signal.gamma_regime);
  }
  return 'unavailable';
}

function dealerDecisionText(signal) {
  if (!thetaIsLive(signal)) return thetaStatus(signal);
  return dealerLabel(signal.uw_context?.dealer_bias || signal.signals?.dealer_behavior);
}

function isThetaLive(signal = {}) {
  return thetaIsLive(signal);
}

function isDealerLive(signal = {}) {
  return thetaIsLive(signal) && signal?.dealer_conclusion?.status === 'live';
}

function thetaPartialNote(signal) {
  return thetaLevelNote(signal, 'Theta live');
}

function displayLevels(signal = {}) {
  const dealer = signal.dealer_conclusion || {};
  return {
    flip: '--',
    callWall: thetaLevel(signal, dealer.call_wall),
    putWall: thetaLevel(signal, dealer.put_wall),
    maxPain: thetaLevel(signal, dealer.max_pain),
    zeroGamma: thetaLevel(signal, dealer.zero_gamma)
  };
}

function displayIntel(signal = {}) {
  return {
    theta: thetaDecisionText(signal),
    uwFlow: uwSafeValue(signal, 'flow'),
    darkPool: uwSafeValue(signal, 'darkpool'),
    dealer: dealerDecisionText(signal)
  };
}

function spotSourceText(snapshot = {}) {
  if (snapshot.spot_is_real === true && snapshot.spot_source === 'fmp') {
    return 'FMP real';
  }
  if (snapshot.spot_source === 'fmp') {
    return 'FMP unavailable';
  }
  return 'Spot unavailable';
}

function sourceBrief(source = {}) {
  if (!source || typeof source !== 'object') {
    return 'unavailable';
  }
  const status = safeText(source.status, 'unavailable');
  const age = safeText(source.age_label, '');
  return age ? `${status} · ${age}` : status;
}

function buildSourceBrief(signal = {}) {
  const sources = signal?.data_sources || {};
  const fmp = sources?.fmp?.status || signal?.fmp_conclusion?.status || 'unavailable';
  const theta = sources?.theta?.status || signal?.theta?.status || signal?.dealer_conclusion?.status || 'unavailable';
  const uw = sources?.uw?.status || signal?.uw?.status || signal?.uw_conclusion?.status || 'unavailable';
  const tv = sources?.tv?.status || signal?.tv_sentinel?.status || 'waiting';

  return {
    fmp,
    theta,
    uw,
    tv,
    text: `FMP ${fmp} | Theta ${theta} | UW ${uw} | TV ${tv}`
  };
}

function buildRealtimeAnalysis(signal = {}) {
  const snap = signal.market_snapshot || {};
  const finalDecision = signal.final_decision || {};
  const uw = signal.uw_conclusion || {};
  const theta = signal.theta_conclusion || {};
  const wall = signal.uw_wall_diagnostics || {};

  return [
    `【final_decision】${safeText(finalDecision.label, '等确认')} / ${safeText(finalDecision.state, 'wait')}`,
    `动作：${safeText(finalDecision.instruction, '等确认，不追单')}`,
    `原因：${safeText(finalDecision.reason, '--')}`,
    `等什么：${safeText(finalDecision.waiting_for, '--')}`,
    `禁做：${safeText(finalDecision.do_not_do, '--')}`,
    `仓位：${finalDecision.position_multiplier ?? 0}x`,
    '',
    '【Source State】',
    `FMP：${safeText(signal.fmp_conclusion?.status, 'unavailable')} / spot_real ${signal.fmp_conclusion?.spot_is_real === true}`,
    `UW：${safeText(uw.status, 'unavailable')} / Flow ${safeText(uw.flow_bias, 'unavailable')} / Dealer ${safeText(uw.dealer_confirm, 'partial')}`,
    `ThetaData：${safeText(theta.status, 'disabled')} / ${safeText(theta.role, 'disabled')}`,
    `TV：${safeText(signal.tv_sentinel?.status, 'waiting')} / ${safeText(signal.tv_sentinel?.event_type, '--')}`,
    '',
    '【Dealer / Flow / Technical】',
    `现价：${displaySpot(snap)} ${spotSourceText(snap)}`,
    `Call Wall：${uw.call_wall == null ? '--' : fmtInt(uw.call_wall)}`,
    `Put Wall：${uw.put_wall == null ? '--' : fmtInt(uw.put_wall)}`,
    `Zero Gamma：${uw.zero_gamma == null ? '--' : fmtInt(uw.zero_gamma)}`,
    `Max Pain：${uw.max_pain == null ? '--' : fmtInt(uw.max_pain)}`,
    `Wall Diagnostics：${safeText(wall.plain_chinese, '--')}`,
    `Flow：${safeText(uw.flow_bias, 'unavailable')} / ${safeText(uw.flow_strength, 'unknown')}`,
    `Technical：VWAP ${safeText(uw.vwap, '--')} / EMA50 ${safeText(uw.ema50, '--')} / ATR ${safeText(uw.atr_5min, '--')}`,
    '',
    '【TV哨兵】',
    `状态：${safeText(signal.tv_sentinel?.status, 'waiting')}`,
    `事件：${safeText(signal.tv_sentinel?.event_type, '--')}`,
    `等待：${safeText(finalDecision.waiting_for, signal.tv_sentinel?.plain_chinese || '等待 TV 结构信号。')}`,
    '',
    '【我现在该做什么】',
    `一句话指令：${safeText(finalDecision.instruction, '等确认，不追单')}`
  ].join('\n');
}

function eventRiskLabel(value) {
  return {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
    none: '无重大事件'
  }[value] || value || '未知';
}

function conflictLabel(value) {
  return {
    none: '无明显冲突',
    low: '轻微冲突',
    medium: '中等冲突',
    high: '高冲突'
  }[value] || value || '未知';
}

function deriveDataQuality(signal) {
  const snap = signal?.market_snapshot || {};
  const coherence = signal?.engines?.data_coherence?.data_mode || 'unknown';
  const executable = signal?.engines?.data_coherence?.executable === true;
  return {
    price_source: safeText(snap.spot_source, 'unknown'),
    map_source: signal?.engines?.data_coherence?.map_source || (signal?.fetch_mode === 'mock_scenario' ? 'scenario' : 'real'),
    coherence,
    executable,
    reason: signal?.engines?.data_coherence?.reason || 'Sources are coherent.'
  };
}

function getAction(signal) {
  if (signal?.command_center?.action) {
    const key = signal.command_center.final_state === 'blocked' ? 'no_trade' : 'wait';
    return {
      ...ACTION_MAP[key],
      title: signal.command_center.action,
      summary: signal.command_center.plain_chinese || ACTION_MAP[key].summary,
      permission: signal.command_center.action,
      plan: signal.command_center.final_state || ACTION_MAP[key].plan
    };
  }
  if (signal?.recommended_action && ACTION_MAP[signal.recommended_action]) return ACTION_MAP[signal.recommended_action];
  if (signal?.conflict?.conflict_level === 'high' || signal?.stale_flags?.any_stale) return ACTION_MAP.no_trade;
  return ACTION_MAP.wait;
}

function hasHardBlock(signal) {
  if (signal?.command_center?.final_state === 'wait') return false;
  const dataQuality = deriveDataQuality(signal);
  return dataQuality.executable !== true
    || signal?.recommended_action === 'no_trade'
    || signal?.conflict?.conflict_level === 'high'
    || signal?.stale_flags?.any_stale
    || signal?.source_status?.some((s) => s.state === 'down');
}

function qualityClass(signal) {
  if (hasHardBlock(signal)) return 'bad';
  if (signal?.conflict?.conflict_level === 'medium' || signal?.event_context?.event_risk === 'high') return 'warn';
  if ((signal?.confidence_score || 0) >= 72) return 'good';
  return 'ok';
}

function statusClassForSource(item) {
  if (item?.stale) return 'stale';
  return item?.state || 'mock';
}

function chipClassByRisk(value) {
  if (['negative', 'high', 'down', 'stale'].includes(value)) return 'red';
  if (['critical', 'medium', 'mixed', 'degraded', 'delayed'].includes(value)) return 'amber';
  if (['positive', 'low', 'none', 'real'].includes(value)) return 'green';
  return 'blue';
}

function getStrategyCard(signal, type) {
  const projectionText = signal.cross_asset_projection?.status === 'partial'
    ? '暂参考 SPX 原始墙位；ES/SPY 等效价暂不可用。'
    : signal.cross_asset_projection?.plain_chinese || '--';
  if (type === '单腿') {
    return {
      strategy_name: '单腿',
      suitable_when: '波动未启动，TV 未确认，不能提前做。',
      entry_condition: '--',
      target_zone: '--',
      invalidation: '--',
      avoid_when: '禁止追单，0仓等待。'
    };
  }
  if (type === '垂直') {
    return {
      strategy_name: '垂直',
      suitable_when: 'UW Flow 偏空，但还需要 TV breakdown_confirmed 或 retest_failed。',
      entry_condition: '等 TV 空头结构确认后再生成。',
      target_zone: projectionText,
      invalidation: 'TV 结构不成立，或 Flow 转向。',
      avoid_when: '没有 TV 确认不进场。'
    };
  }
  if (type === '铁鹰') {
    return {
      strategy_name: '铁鹰',
      suitable_when: '机构流偏空并有轰炸，不是平静磨盘环境。',
      entry_condition: '--',
      target_zone: '--',
      invalidation: '--',
      avoid_when: '不开铁鹰。'
    };
  }
  const cards = Array.isArray(signal.strategy_cards) ? signal.strategy_cards : [];
  const callSpread = cards.find((c) => c.strategy_name === '看涨价差');
  const putSpread = cards.find((c) => c.strategy_name === '看跌价差');
  const single = cards.find((c) => c.strategy_name === '单腿');
  const iron = cards.find((c) => c.strategy_name === '铁鹰');

  if (type === '单腿') return single || {};
  if (type === '铁鹰') return iron || {};
  if (type === '垂直') {
    if (signal.recommended_action === 'short_on_retest') return putSpread || callSpread || {};
    return callSpread || putSpread || {};
  }
  return {};
}

function strategyState(signal, type) {
  const finalCard = (signal.strategy_cards || []).find((card) => card.strategy_name === type);
  if (finalCard?.permission === 'block') {
    return { cls: 'blocked', text: finalCard.status_text || '禁止' };
  }
  if (finalCard?.permission === 'allow') {
    return { cls: 'ready', text: finalCard.status_text || '可执行' };
  }
  if (finalCard) {
    return { cls: 'wait', text: finalCard.status_text || '等待' };
  }
  const dataQuality = deriveDataQuality(signal);
  if (dataQuality.executable !== true) {
    return { text: '禁止', cls: 'block' };
  }
  if (hasHardBlock(signal)) return { text: '不可执行', cls: 'block' };
  if (type === '铁鹰') {
    if (signal.recommended_action === 'income_ok') return { text: '观察可做', cls: 'go' };
    if (signal.gamma_regime === 'negative' || signal.event_context?.event_risk === 'high') return { text: '禁止', cls: 'block' };
    return { text: '等波动回落', cls: 'watch' };
  }
  if (type === '垂直') {
    if (['long_on_pullback', 'short_on_retest'].includes(signal.recommended_action)) return { text: '等触发', cls: 'go' };
    return { text: '等确认', cls: 'watch' };
  }
  if (type === '单腿') {
    if (['long_on_pullback', 'short_on_retest'].includes(signal.recommended_action)) return { text: '轻仓快打', cls: 'watch' };
    return { text: '不优先', cls: 'watch' };
  }
  return { text: '等确认', cls: 'watch' };
}

function buildTrigger(signal) {
  if (signal.trade_plan?.entry_zone?.text) return signal.trade_plan.entry_zone.text;
  if (deriveDataQuality(signal).executable !== true) return '--';
  const snap = signal.market_snapshot || {};
  if (signal.recommended_action === 'long_on_pullback') return `回踩 ${fmtInt(snap.flip_level)} 上方不破`;
  if (signal.recommended_action === 'short_on_retest') return `反抽 ${fmtInt(snap.call_wall || snap.flip_level)} 不过`;
  if (signal.recommended_action === 'income_ok') return `围绕 ${fmtInt(snap.max_pain)} 钉住，IV 回落`;
  if (signal.recommended_action === 'no_trade') return '无触发，先保护本金';
  return `离开 Flip ${fmtInt(snap.flip_level)} 后再看`;
}

function buildTarget(signal) {
  if (Array.isArray(signal.trade_plan?.targets) && signal.trade_plan.targets.length > 0) {
    return signal.trade_plan.targets.map((target) => target.text || target.level || target.name).filter(Boolean).join(' / ') || '--';
  }
  if (deriveDataQuality(signal).executable !== true) return '--';
  const snap = signal.market_snapshot || {};
  if (signal.recommended_action === 'long_on_pullback') return `${fmtInt(snap.call_wall)} / 上方流动性`;
  if (signal.recommended_action === 'short_on_retest') return `${fmtInt(snap.put_wall)} / 下方流动性`;
  if (signal.recommended_action === 'income_ok') return `${fmtInt(snap.put_wall)} - ${fmtInt(snap.call_wall)} 区间内收时间`;
  return '无目标，先等';
}

function buildInvalidation(signal) {
  if (signal.trade_plan?.invalidation?.text) return signal.trade_plan.invalidation.text;
  if (deriveDataQuality(signal).executable !== true) return '--';
  if (signal.plain_language?.invalidation) return signal.plain_language.invalidation;
  const snap = signal.market_snapshot || {};
  if (signal.invalidation_level) return `跌破 / 站回 ${fmtInt(signal.invalidation_level)}`;
  return `Flip ${fmtInt(snap.flip_level)} 失效`;
}

function buildAvoid(signal) {
  if (signal.position_sizing_engine?.plain_chinese) return signal.position_sizing_engine.plain_chinese;
  if (deriveDataQuality(signal).executable !== true) {
    return safeText(signal?.engines?.data_coherence?.reason, '数据冲突 / 演示场景 / 数据过期 / 缺少关键输入');
  }
  if (signal.plain_language?.avoid) return signal.plain_language.avoid;
  if (Array.isArray(signal.avoid_actions) && signal.avoid_actions.length) return signal.avoid_actions.join(' / ');
  return '不追单，不提前卖波';
}

function summarizeEngine(name, engine) {
  const directText = safeText(
    engine?.output
    || engine?.state
    || engine?.summary
    || engine?.plain_chinese
    || engine?.note
    || engine?.message,
    ''
  );
  if (directText) {
    return directText;
  }

  switch (name) {
    case 'market_regime':
      return marketStateLabel(engine?.market_state);
    case 'gamma_wall':
      if (engine?.wall_position === 'above_call_wall') return '价格已到 Call Wall 上方，关注上方压力。';
      if (engine?.wall_position === 'below_put_wall') return '价格已到 Put Wall 下方，关注下方支撑。';
      if (engine?.wall_position === 'below_flip') return '现价在 Flip 下方，偏弱。';
      if (engine?.wall_position === 'above_flip') return '现价在 Flip 上方，偏强。';
      return '墙位压力/支撑摘要';
    case 'volatility':
      if (engine?.vol_state === 'expanding') return '波动扩张';
      if (engine?.vol_state === 'contained') return '波动收缩';
      if (engine?.vol_state === 'event_loaded') return '禁止卖波';
      return '波动状态待确认';
    case 'price_structure':
      if (engine?.confirmation_status === 'confirmed' && engine?.price_signal === 'long_pullback_ready') return '突破确认，等回踩。';
      if (engine?.confirmation_status === 'confirmed' && engine?.price_signal === 'short_retest_ready') return '跌破确认，等反抽。';
      if (engine?.price_signal === 'structure_invalidated') return '结构失效';
      return '等回踩确认';
    case 'uw_dealer_flow':
      if (engine?.uw_signal === 'bullish_flow') return 'UW 偏多';
      if (engine?.uw_signal === 'bearish_flow') return 'UW 偏空';
      return 'UW 混合';
    case 'event_risk':
      if (engine?.risk_gate === 'blocked') return '高风险';
      if (engine?.risk_gate === 'caution') return '中风险';
      if (safeText(engine?.event_note, '')?.includes('FMP 异常')) return 'FMP 异常';
      return '低风险';
    case 'conflict':
      return engine?.has_conflict ? '有冲突' : '无明显冲突';
    case 'action':
      if (engine?.recommended_action === 'no_trade') return '禁做';
      if (engine?.recommended_action === 'income_ok') return '可做';
      return '等确认';
    default:
      return '--';
  }
}

function renderTopbar(currentPath, currentScenario, signal) {
  const query = window.location.search || '';
  const dataQuality = deriveDataQuality(signal);
  const scenarioMode = Boolean(currentScenario);
  const heartbeatLabel = signal?.command_center?.final_state === 'wait'
    ? 'WAIT · 等确认'
    : scenarioMode
    ? '演示场景｜不可交易'
    : dataQuality.coherence === 'mixed' || dataQuality.coherence === 'conflict'
      ? `${String(dataQuality.coherence).toUpperCase()} · NO TRADE`
      : signal.is_mock
      ? 'MOCK DATA'
      : 'LIVE';
  return `
    <header class="topbar">
      <div class="brand">
        <div class="logo-mark">SP</div>
        <div>
          <div class="brand-title">SPX Ops Dashboard</div>
          <div class="brand-subtitle">White Glass Lab · 0DTE Command Console</div>
        </div>
      </div>

      <nav class="nav">
        <a class="${currentPath === '/' ? 'active' : ''}" href="/${query}">主操作页</a>
        <a class="${currentPath === '/radar' ? 'active' : ''}" href="/radar${query}">Radar 支撑页</a>
      </nav>

      <div class="system-right">
        <div class="heartbeat"><i class="heartbeat-dot ${qualityClass(signal)}"></i><span>${escapeHtml(heartbeatLabel)}</span><span>${shortTime(signal.received_at)}</span></div>
        ${scenarioMode ? '<div class="tag red">演示场景，不是真实数据</div>' : ''}
        <select class="scenario-select" id="scenario-select" aria-label="mock scenario">
          <option value="">真实 /signals/current</option>
          ${SCENARIOS.map((item) => `<option value="${item}" ${item === currentScenario ? 'selected' : ''}>${item}</option>`).join('')}
        </select>
      </div>
    </header>
  `;
}

function renderSourceStrip(signal) {
  const summary = signal.data_sources?.summary || {};
  const parts = ['fmp', 'theta', 'uw', 'tv']
    .map((key) => {
      const item = signal.data_sources?.[key] || {};
      return `${key.toUpperCase()}(${safeText(item.status, 'unavailable')} · ${safeText(item.age_label, 'unavailable')})`;
    })
    .join(' | ');
  const label = (item = {}) => {
    if (item.source === 'fmp_price') return 'FMP_PRICE';
    if (item.source === 'theta_core') return 'THETA';
    if (item.source === 'uw') return 'UW';
    return String(item.source || '').toUpperCase();
  };
  return `
    <section class="source-row">
      <div class="section-label">Source State</div>
      <div class="footer-note">数据健康度：${escapeHtml(safeText(summary.label, 'BLOCKED'))} ${escapeHtml(parts)}</div>
      <div class="source-list">
        ${(signal.source_status || []).filter((item) => ['tradingview', 'fmp_event', 'fmp_price', 'theta_core', 'theta_full_chain', 'uw', 'telegram', 'dashboard'].includes(item.source)).map((item) => `
          <span class="source-chip ${statusClassForSource(item)}">
            ${escapeHtml(label(item))} · ${sourceStateLabel(item.state)} · ${minutesAgo(item.last_updated)}
          </span>
        `).join('')}
      </div>
    </section>
  `;
}

function renderIntradayDecisionCard(signal) {
  const finalDecision = signal.final_decision || {};
  const card = signal.intraday_decision_card || {};
  const doNot = Array.isArray(finalDecision.do_not_do) ? finalDecision.do_not_do : Array.isArray(card.do_not_do) ? card.do_not_do : [];
  const currentAction = finalDecision.label || card.current_action || '等确认';
  const position = `${finalDecision.position_multiplier ?? 0}x`;
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">盘中决策卡</div><span class="tag amber">${escapeHtml(currentAction)}</span></div>
      <div class="matrix-list">
        <div class="matrix-item"><div class="matrix-name">当前</div><div class="matrix-value">${escapeHtml(finalDecision.instruction || currentAction)}</div><div class="matrix-number">${escapeHtml(position)}</div></div>
        <div class="matrix-item"><div class="matrix-name">盘面判断</div><div class="matrix-value">${escapeHtml(finalDecision.reason || card.market_read || '--')}</div><div class="matrix-number">final_decision</div></div>
        <div class="matrix-item"><div class="matrix-name">现在含义</div><div class="matrix-value">${escapeHtml(finalDecision.state || '--')}</div><div class="matrix-number">唯一真源</div></div>
        <div class="matrix-item"><div class="matrix-name">等什么</div><div class="matrix-value">${escapeHtml(finalDecision.waiting_for || card.wait_for || '--')}</div><div class="matrix-number">TV</div></div>
        <div class="matrix-item"><div class="matrix-name">禁做</div><div class="matrix-value">${escapeHtml(doNot.join('；') || '--')}</div><div class="matrix-number">0仓</div></div>
        <div class="matrix-item"><div class="matrix-name">关键位</div><div class="matrix-value">${escapeHtml(card.key_levels_summary || '--')}</div><div class="matrix-number">UW墙位</div></div>
      </div>
      <p class="radar-note">${escapeHtml(finalDecision.reason || card.plain_chinese || '')}</p>
    </section>
  `;
}

function renderMetricCards(signal) {
  const snap = signal.market_snapshot || {};
  const finalDecision = signal.final_decision || {};
  return `
    <div class="price-stack">
      <div class="metric-card">
        <div class="metric-label">SPX Spot</div>
        <div class="big-number">${displaySpot(snap)}</div>
        <div class="delta-line"><i class="pulse-bar"></i><span>${escapeHtml(displaySpotContext(snap))}</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Gamma Regime</div>
        <div class="big-number">${gammaLabel(signal.gamma_regime)}</div>
        <div class="tag-row">
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${marketStateLabel(signal.market_state)}</span>
          <span class="tag blue">Flip ${fmtInt(snap.flip_level)}</span>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">当前动作</div>
        <div class="big-number">${escapeHtml(finalDecision.label || '等确认')}</div>
        <div class="delta-line"><span>${escapeHtml(finalDecision.instruction || '等待 TV 结构信号，不提前交易。')}</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">建议仓位</div>
        <div class="big-number">${escapeHtml(`${finalDecision.position_multiplier ?? 0}x`)}</div>
        <div class="delta-line"><span>${escapeHtml(finalDecision.waiting_for || '等待状态无 TTL')}</span></div>
      </div>
    </div>
  `;
}

function renderRiskStack(signal) {
  const cls = qualityClass(signal);
  const finalDecision = signal.final_decision || {};
  const doNot = Array.isArray(finalDecision.do_not_do) ? finalDecision.do_not_do : [];
  return `
    <div class="risk-stack">
      <div class="metric-card ${qualityClass(signal) === 'good' ? 'risk-low' : qualityClass(signal) === 'warn' ? 'risk-mid' : 'risk-high'}">
        <div class="metric-label">Signal Quality</div>
        <div class="big-number">${fmtInt(signal.confidence_score || signal.conflict?.adjusted_confidence || 0)}</div>
        <div class="tag-row">
          <span class="quality-chip ${cls}">${conflictLabel(signal.conflict?.conflict_level)}</span>
          <span class="quality-chip ${signal.event_context?.event_risk === 'high' ? 'bad' : 'ok'}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
        </div>
      </div>
      <div class="alert-panel">
        <div class="section-label">Do Not Violate</div>
        <ul class="alert-list">
          ${(doNot.length ? doNot : ['不追单', '无结构确认不下单', '不自动下单']).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

function strategyCardCopy(signal, type) {
  const finalCard = (signal.strategy_cards || []).find((card) => card.strategy_name === type);
  if (finalCard) {
    return {
      status: finalCard.status_text || '--',
      suitable: finalCard.suitable_when || '--',
      entry: finalCard.entry_condition || '--',
      target: finalCard.target_zone || '--',
      invalidation: finalCard.invalidation || '--',
      avoid: `仓位：${finalCard.position ?? '0'}`
    };
  }
  if (type === '单腿') {
    return {
      status: '等待 / 禁止追单',
      suitable: '波动未启动，TV 未确认，不能提前做。',
      entry: '--',
      target: '--',
      invalidation: '--',
      avoid: '仓位：0'
    };
  }
  if (type === '垂直') {
    return {
      status: '等待候选',
      suitable: 'UW Flow 偏空，但还需要 TV breakdown_confirmed 或 retest_failed。',
      entry: '等 TV 空头结构确认后再生成。',
      target: signal.cross_asset_projection?.plain_chinese || '--',
      invalidation: 'TV 结构不成立，或 Flow 转向。',
      avoid: '仓位：0'
    };
  }
  return {
    status: '禁止',
    suitable: '机构流偏空并有轰炸，不是平静磨盘环境。',
    entry: '--',
    target: '--',
    invalidation: '--',
    avoid: '仓位：0'
  };
}

function renderCommandHero(signal) {
  const finalDecision = signal.final_decision || {};
  const action = getAction(signal);
  const trigger = buildTrigger(signal);
  const invalidation = buildInvalidation(signal);
  const avoid = buildAvoid(signal);
  const card = signal.intraday_decision_card || {};
  const summary = finalDecision.reason || safeText(signal.plain_language?.user_action, action.summary);
  const title = finalDecision.instruction || action.title;
  const planLabel = finalDecision.state || action.plan;

  return `
    <section class="command-hero">
      ${renderMetricCards(signal)}
      <div class="main-command">
        <div class="command-status-line">
          <div class="section-label">盘中决策卡</div>
          <div class="permission-badge ${action.badge}">${action.permission}</div>
        </div>
        <h1 class="command-title">${escapeHtml(finalDecision.label || card.current_action || title)}</h1>
        <p class="command-subtitle">${escapeHtml(card.plain_chinese || summary)}</p>
        <div class="tag-row">
          <span class="tag blue">${escapeHtml(planLabel)}</span>
          <span class="tag ${chipClassByRisk(signal.event_context?.event_risk)}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${gammaLabel(signal.gamma_regime)}</span>
          <span class="tag violet">${escapeHtml(finalDecision.direction || 'unknown')}</span>
        </div>
        <div class="command-grid">
          <div class="command-cell"><span class="card-label">盘面判断</span><b>${escapeHtml(finalDecision.reason || card.market_read || '--')}</b></div>
          <div class="command-cell"><span class="card-label">现在含义</span><b>${escapeHtml(finalDecision.state || card.why_now || '--')}</b></div>
          <div class="command-cell"><span class="card-label">等什么</span><b>${escapeHtml(finalDecision.waiting_for || card.wait_for || trigger)}</b></div>
          <div class="command-cell"><span class="card-label">关键位</span><b>${escapeHtml(card.key_levels_summary || signal.cross_asset_projection?.plain_chinese || '--')}</b></div>
        </div>
        <div class="command-grid">
          <div class="command-cell"><span class="card-label">禁做</span><b>${escapeHtml(safeText(finalDecision.do_not_do, avoid))}</b></div>
          <div class="command-cell"><span class="card-label">仓位</span><b>${escapeHtml(`${finalDecision.position_multiplier ?? 0}x`)}</b></div>
          <div class="command-cell"><span class="card-label">触发</span><b>${escapeHtml(trigger)}</b></div>
          <div class="command-cell"><span class="card-label">作废</span><b>${escapeHtml(invalidation)}</b></div>
        </div>
      </div>
      ${renderRiskStack(signal)}
    </section>
  `;
}

function renderStrategyCards(signal) {
  const strategyTypes = ['单腿', '垂直', '铁鹰'];
  return `
    <section class="grid-3">
      ${strategyTypes.map((type) => {
        const card = strategyCardCopy(signal, type);
        const state = strategyState(signal, type);
        const target = card.target;
        const entry = card.entry;
        const suitable = card.suitable;
        const invalidation = card.invalidation;
        const avoid = card.avoid;

        return `
          <article class="strategy-card ${state.cls}">
            <div class="strategy-headline">
              <div>
                <div class="section-label">Strategy</div>
                <div class="strategy-name">${type}</div>
              </div>
              <span class="strategy-status ${state.cls}">${escapeHtml(card.status || state.text)}</span>
            </div>
            <div class="strategy-kv">
              <div class="kv-row"><span>适合</span><b>${escapeHtml(suitable)}</b></div>
              <div class="kv-row"><span>入场</span><b>${escapeHtml(entry)}</b></div>
              <div class="kv-row"><span>目标</span><b>${escapeHtml(target)}</b></div>
              <div class="kv-row"><span>作废</span><b>${escapeHtml(invalidation)}</b></div>
              <div class="kv-row"><span>禁做</span><b>${escapeHtml(avoid)}</b></div>
            </div>
          </article>
        `;
      }).join('')}
    </section>
  `;
}

function renderLevelMatrix(signal) {
  const dataQuality = deriveDataQuality(signal);
  const snap = signal.market_snapshot || {};
  const keyLevels = signal.key_levels || {};
  const useUwLevels = keyLevels.source === 'uw';
  const keyLevelsLive = useUwLevels || (isThetaLive(signal) && isDealerLive(signal));
  const levelValue = (name, fallback) => {
    if (useUwLevels) return keyLevels?.[name]?.level == null ? '--' : fmtInt(keyLevels[name].level);
    return keyLevelsLive ? fmtInt(fallback) : '--';
  };
  const levelNote = (name, distance, fallback = '数据未 live / 不可交易') => {
    if (useUwLevels) return keyLevels?.[name]?.source || 'uw';
    return keyLevelsLive && dataQuality.executable === true ? `距离 ${fmt(distance, 1)} pt` : fallback;
  };
  const items = [
    ['SPX', displaySpot(snap), spotSourceText(snap)],
    ['Flip', levelValue('zero_gamma', snap.flip_level), levelNote('zero_gamma', snap.distance_to_flip)],
    ['Call Wall', levelValue('call_wall', snap.call_wall), levelNote('call_wall', snap.distance_to_call_wall, thetaPartialNote(signal))],
    ['Put Wall', levelValue('put_wall', snap.put_wall), levelNote('put_wall', snap.distance_to_put_wall, thetaPartialNote(signal))],
    ['Max Pain', levelValue('max_pain', snap.max_pain), useUwLevels ? keyLevels.max_pain?.source || 'uw' : keyLevelsLive ? '中轴参考' : thetaPartialNote(signal)],
    ['Confidence', fmtInt(signal.confidence_score), '指令可信度']
  ];
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">Key Levels</div><span class="tag blue">No Chart · Data Matrix</span></div>
      <div class="matrix-list">
        ${items.map(([name, value, note]) => `
          <div class="matrix-item">
            <div class="matrix-name">${escapeHtml(name)}</div>
            <div class="matrix-value">${escapeHtml(note)}</div>
            <div class="matrix-number">${escapeHtml(value)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderIntelMatrix(signal) {
  const items = [
    ['Theta', signal.theta_conclusion?.status || 'disabled', 'EM 辅助，不做 Dealer 主源'],
    ['TradingView', signal.tv_sentinel?.event_type || signal.signals?.tv_signal || '等待结构确认', '最终确认，不单独定方向'],
    ['UW Flow', uwSafeValue(signal, 'flow'), '主动流向'],
    ['Strategy', Object.entries(signal.strategy_permissions || {}).map(([key, value]) => `${key}:${value?.permission || 'wait'}`).join(' / '), '策略权限'],
    ['等效价', signal.cross_asset_projection?.target_instrument || 'ES', signal.cross_asset_projection?.plain_chinese || '跨资产投射'],
    ['Dark Pool', signal.darkpool_summary?.bias || uwSafeValue(signal, 'darkpool'), signal.darkpool_summary?.plain_chinese || '资金区'],
    ['Dealer', signal.dealer_engine?.behavior || dealerDecisionText(signal), signal.dealer_engine?.plain_chinese || '做市商路径'],
    ['UW Greek', signal.uw_conclusion?.greek_exposure_status || signal.dealer_engine?.status || 'unavailable', signal.dealer_engine?.plain_chinese || 'Greek Exposure'],
    ['量比', signal.volume_pressure?.level || 'unavailable', signal.volume_pressure?.plain_chinese || '推动强度'],
    ['波动启动', signal.volatility_activation?.strength || signal.volatility_activation?.state || 'unavailable', signal.volatility_activation?.plain_chinese || '波动状态'],
    ['反射', signal.reflection?.confidence_score ?? 0, signal.reflection?.plain_chinese || '反射分析不可用'],
    ['FMP', signal.event_context?.event_note || eventRiskLabel(signal.event_context?.event_risk), '事件过滤']
  ];
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">Decision Inputs</div><span class="tag ${chipClassByRisk(signal.conflict?.conflict_level)}">${conflictLabel(signal.conflict?.conflict_level)}</span></div>
      <div class="matrix-list">
        ${items.map(([name, value, note]) => `
          <div class="matrix-item">
            <div class="matrix-name">${escapeHtml(name)}</div>
            <div class="matrix-value">${escapeHtml(value)}</div>
            <div class="matrix-number">${escapeHtml(note)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderHome(signal) {
  return `
    <main class="page">
      ${renderCommandHero(signal)}
      ${renderIntradayDecisionCard(signal)}
      ${renderStrategyCards(signal)}
      <section class="matrix-grid">
        ${renderLevelMatrix(signal)}
        ${renderIntelMatrix(signal)}
      </section>
      <div class="footer-note">schema ${escapeHtml(signal.schema_version)} · scenario ${escapeHtml(signal.scenario)} · ${escapeHtml(signal.fetch_mode)}</div>
    </main>
  `;
}

function buildDataQualityGuardText(signal, spotSourceText) {
  if (signal.data_quality_guard?.plain_chinese) {
    return {
      title: signal.data_quality_guard.title || '数据质量：可观察，等待结构确认。',
      items: signal.data_quality_guard.items || [signal.data_quality_guard.plain_chinese]
    };
  }
  return {
    title: safeText(signal?.engines?.data_coherence?.reason, '价格地图不一致，禁止执行。'),
    items: null
  };
}

function buildUwRadarSummary(signal) {
  if (signal.uw_flow_summary?.plain_chinese) {
    return signal.uw_flow_summary.plain_chinese;
  }
  const human = signal.intraday_decision_card || {};
  if (human.market_read || human.why_now) {
    return [
      '【UW 资金解读】',
      human.market_read || '',
      `结论：${human.why_now || '等待 TV 结构确认。'}`
    ].filter(Boolean).join('\n');
  }
  const flow = signal.uw_conclusion?.flow_bias === 'bearish' ? '偏空' : signal.uw_conclusion?.flow_bias === 'bullish' ? '偏多' : '中性/不明';
  const inst = signal.institutional_alert?.state === 'bombing' ? '连续轰炸' : signal.institutional_alert?.state || '未形成';
  const dark = signal.darkpool_summary?.bias === 'neutral' ? '中性，没有明显支撑/压力' : safeText(signal.darkpool_summary?.bias, '不可用');
  const dealer = signal.dealer_engine?.status === 'partial' ? '部分可读，墙位已接入，但 Vanna/Charm/Delta 不完整' : safeText(signal.dealer_engine?.plain_chinese, '不可用');
  const vol = signal.volatility_activation?.strength === 'off' ? '未启动，单腿不放行' : safeText(signal.volatility_activation?.plain_chinese, '不可用');
  const conclusion = signal.uw_conclusion?.flow_bias === 'bearish'
    ? '空头资金有动作，但不能直接追空。等 TV breakdown_confirmed 或 retest_failed。'
    : '资金有动作，但必须等 TV 结构确认。';
  return [
    '【UW 资金解读】',
    `机构流：${flow}，${inst}`,
    `暗池：${dark}`,
    `Dealer：${dealer}`,
    `波动：${vol}`,
    `结论：${conclusion}`
  ].join('\n');
}

function buildSignalConflictText(signal, spotSourceText) {
  if (signal.signal_conflict?.plain_chinese) {
    return {
      title: signal.signal_conflict.title || '【轻微冲突】',
      items: signal.signal_conflict.items || [signal.signal_conflict.plain_chinese]
    };
  }
  return {
    title: safeText(signal?.engines?.data_coherence?.reason, '等待 final_decision 的下一次确认。'),
    items: [
      `Spot 来源：${spotSourceText} ${displaySpot(signal.market_snapshot || {})}`,
      `执行状态：${signal.final_decision?.state || 'wait'} / ${signal.final_decision?.position_multiplier ?? 0}x`
    ]
  };
}

function renderRadarSummary(signal) {
  const snap = signal.market_snapshot || {};
  const conflictPoints = signal.conflict?.conflict_points || [];
  const finalDecision = signal.final_decision || {};
  const wall = signal.uw_wall_diagnostics || {};
  const levels = {
    flip: signal.uw_conclusion?.zero_gamma == null ? '--' : fmtInt(signal.uw_conclusion.zero_gamma),
    callWall: signal.uw_conclusion?.call_wall == null ? '--' : fmtInt(signal.uw_conclusion.call_wall),
    putWall: signal.uw_conclusion?.put_wall == null ? '--' : fmtInt(signal.uw_conclusion.put_wall),
    zeroGamma: signal.uw_conclusion?.zero_gamma == null ? '--' : fmtInt(signal.uw_conclusion.zero_gamma)
  };
  const intel = displayIntel(signal);
  const thetaStatus = signal?.theta_conclusion?.status || 'disabled';
  const dealerStatus = signal?.uw_conclusion?.dealer_confirm || signal?.dealer_engine?.status || 'partial';
  const executionStatus = `${String(finalDecision.state || 'wait').toUpperCase()} / ${finalDecision.position_multiplier ?? 0}x`;
  const spotSourceText = snap.spot_is_real === true ? `${safeText(snap.spot_source, 'fmp')} real` : safeText(snap.spot_source, 'unavailable');
  const guard = buildDataQualityGuardText(signal, spotSourceText);
  const conflict = buildSignalConflictText(signal, spotSourceText);
  const radarSummary = [
    '【Radar 总结】',
    `当前状态：${String(finalDecision.state || 'wait').toUpperCase()} / ${finalDecision.label || '等确认'}`,
    `主因：${finalDecision.reason || '--'}`,
    `等什么：${finalDecision.waiting_for || '--'}`,
    `禁做：${safeText(finalDecision.do_not_do, '--')}`,
    `仓位：${finalDecision.position_multiplier ?? 0}x`
  ].join('\n');
  return `
    <section class="radar-layout">
      <article class="radar-card">
        <div class="radar-title">
          <h2>Radar 总结</h2>
          <span class="tag amber">${escapeHtml(finalDecision.label || '等确认')}</span>
        </div>
        <p class="radar-note">${escapeHtml(radarSummary)}</p>
      </article>
      <article class="radar-card">
        <div class="radar-title">
          <h2>Source State</h2>
          <span class="tag amber">${escapeHtml(guard.title)}</span>
        </div>
        <p class="radar-note">${escapeHtml(guard.title)}</p>
        <ul class="alert-list">
          ${(guard.items || [
            `FMP spot：${spotSourceText} ${displaySpot(snap)}`,
            `ThetaData：EM auxiliary ${thetaStatus}，不阻断 UW 主线`,
            `UW：${signal?.uw_conclusion?.status || 'unavailable'}`,
            `Dealer：${dealerStatus}`,
            `执行状态：${executionStatus}`
          ]).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </article>
      <article class="radar-card">
        <div class="radar-title">
          <h2>Gamma / Dealer Radar</h2>
          <span class="tag ${chipClassByRisk(signal.uw_conclusion?.gamma_regime)}">${gammaLabel(signal.uw_conclusion?.gamma_regime)}</span>
        </div>
        <p class="radar-note">${escapeHtml(wall.plain_chinese || signal.uw_conclusion?.plain_chinese || 'UW Dealer 等待确认。')}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">现价位置</div><div class="matrix-value">${escapeHtml(displaySpotContext(snap))}</div><div class="matrix-number">${displaySpot(snap)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Flip</div><div class="matrix-value">UW zero_gamma</div><div class="matrix-number">${escapeHtml(levels.flip)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Call Wall</div><div class="matrix-value">${escapeHtml(wall.raw_fields_used?.call_gamma_field || 'call_gamma')}</div><div class="matrix-number">${escapeHtml(levels.callWall)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Put Wall</div><div class="matrix-value">${escapeHtml(wall.raw_fields_used?.put_gamma_field || 'put_gamma')}</div><div class="matrix-number">${escapeHtml(levels.putWall)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Zero Gamma</div><div class="matrix-value">${escapeHtml(wall.zero_gamma_method || 'running_net_gamma')}</div><div class="matrix-number">${escapeHtml(levels.zeroGamma)}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Flow / UW Radar</h2>
          <span class="tag violet">${escapeHtml(signal.dealer_engine?.behavior || intel.dealer)}</span>
        </div>
        <p class="radar-note">${escapeHtml(buildUwRadarSummary(signal))}</p>
        <div class="tag-row">
          <span class="tag blue">Flow ${escapeHtml(intel.uwFlow)}</span>
          <span class="tag green">Dark Pool ${escapeHtml(signal.darkpool_summary?.bias || intel.darkPool)}</span>
          <span class="tag amber">FMP 硬门槛</span>
          <span class="tag violet">UW 主环境</span>
          <span class="tag blue">TV 执行确认</span>
          <span class="tag green">Theta EM auxiliary</span>
        </div>
        <p class="radar-note">${escapeHtml([
          buildUwRadarSummary(signal),
          `Allowed：${safeText(finalDecision.allowed_setups, '--')}`,
          `Trace：${safeText((finalDecision.trace || []).map((item) => item.step || item.reason), '--')}`,
          `Wall diagnostics：${safeText(wall.plain_chinese, '--')}`,
          `Technical：${safeText(signal.technical_engine?.plain_chinese, '--')}`,
          `Projection：${safeText(signal.cross_asset_projection?.plain_chinese, '--')}`,
          `Blocked：${safeText(finalDecision.blocked_setups_reason, '--')}`
        ].join('\n'))}</p>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Event Risk</h2>
          <span class="tag ${chipClassByRisk(signal.event_context?.event_risk)}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.event_context?.event_note, '无重大事件风险。'))}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">卖波许可</div><div class="matrix-value">${signal.event_context?.event_risk === 'high' ? '禁止提前铁鹰 / 裸卖' : '仅在波动回落后评估'}</div><div class="matrix-number">FMP</div></div>
          <div class="matrix-item"><div class="matrix-name">主操作页影响</div><div class="matrix-value">${escapeHtml(getAction(signal).title)}</div><div class="matrix-number">${getAction(signal).permission}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Signal Conflict</h2>
          <span class="quality-chip ${qualityClass(signal)}">${conflictLabel(signal.conflict?.conflict_level)}</span>
        </div>
        <p class="radar-note">${escapeHtml(conflict.title)}</p>
        <ul class="alert-list">
          ${(conflict.items || (conflictPoints.length ? conflictPoints : ['没有强冲突，但仍必须等触发。'])).map((item) => `<li>${escapeHtml(safeText(item))}</li>`).join('')}
        </ul>
      </article>
    </section>
  `;
}

function renderEngineMatrix(signal) {
  return `
    <section class="matrix-grid">
      <div class="matrix-panel">
        <div class="matrix-title"><div class="section-label">综合盘面实时分析</div><span class="tag amber">只看结论</span></div>
        <pre class="radar-note">${escapeHtml(buildRealtimeAnalysis(signal))}</pre>
      </div>
    </section>
  `;
}

function renderRadar(signal) {
  return `
    <main class="page">
      ${renderRadarSummary(signal)}
      ${renderEngineMatrix(signal)}
      ${renderSourceStrip(signal)}
      <div class="footer-note">Radar only supports Page 1 command. It does not create separate trade signals.</div>
    </main>
  `;
}

function bindScenarioSelector() {
  const select = document.getElementById('scenario-select');
  if (!select) return;
  select.addEventListener('change', () => {
    const path = window.location.pathname === '/radar' ? '/radar' : '/';
    window.location.href = select.value ? `${path}?scenario=${encodeURIComponent(select.value)}` : path;
  });
}

function renderLoading() {
  document.getElementById('app').innerHTML = `
    <main class="loading">
      <h1>Loading SPX Ops Dashboard</h1>
      <p>正在读取 /signals/current。</p>
    </main>
  `;
}

function renderError(error) {
  document.getElementById('app').innerHTML = `
    <main class="error-card">
      <h1>Load Error</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>检查 server.js 是否运行，以及 /signals/current 是否返回 JSON。</p>
    </main>
  `;
}

function renderPage(signal) {
  const path = window.location.pathname === '/radar' ? '/radar' : '/';
  document.getElementById('app').innerHTML = `
    ${renderTopbar(path, getScenario(), signal)}
    ${path === '/radar' ? renderRadar(signal) : renderHome(signal)}
  `;
  bindScenarioSelector();
}

document.addEventListener('DOMContentLoaded', async () => {
  renderLoading();
  try {
    const signal = await loadSignal();
    renderPage(signal);
  } catch (error) {
    renderError(error);
  }
});
