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
  return 'Theta unavailable / 不可执行';
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
  const dataSources = signal.data_sources || {};
  const brief = buildSourceBrief(signal);
  const snap = signal.market_snapshot || {};
  const dealer = signal.dealer_conclusion || {};
  const uwGreeks = signal.uw_dealer_greeks || {};
  const reflection = signal.reflection || {};
  const action = signal.projection?.one_line_instruction || '禁做 / 等确认';
  const expectedMove = dealer.expected_move_lower != null && dealer.expected_move_upper != null
    ? `${fmt(dealer.expected_move_lower, 2)} - ${fmt(dealer.expected_move_upper, 2)}`
    : '--';
  const wallNote = (value) => value == null ? '--' : `${fmtInt(value)}（OI fallback / 仅参考）`;
  const reason =
    signal.trade_plan?.plain_chinese
    || signal.command_environment?.reason
    || 'ThetaData 当前不可执行，TV 尚未确认价格结构，不能出 ready。';

  return [
    `【数据状态】${safeText(dataSources.summary?.plain_chinese, '数据健康度不可用')}`,
    `FMP：${sourceBrief(dataSources.fmp || { status: brief.fmp })}`,
    `ThetaData：${sourceBrief(dataSources.theta || { status: brief.theta })}${dataSources.theta?.gamma_status === 'incomplete' ? '，Gamma 不完整' : ''}`,
    `UW：${sourceBrief(dataSources.uw || { status: brief.uw })}`,
    `TV：${sourceBrief(dataSources.tv || { status: brief.tv })}`,
    '',
    '【交互判断】',
    `✓ 可用项：${signal.command_inputs?.external_spot?.status === 'real' ? 'FMP 现价真实' : '暂无核心可用项'}`,
    `✗ 限制项：${[thetaStatus(signal) !== 'live' ? 'ThetaData 不可执行' : null, signal.uw_conclusion?.status !== 'live' ? 'UW 资金行为不可用' : null, signal.tv_sentinel?.matched_allowed_setup !== true ? 'TV 未确认结构' : null].filter(Boolean).join('；') || '--'}`,
    `→ 冲突：${(signal.conflict_resolver?.conflicts || []).join('；') || '无真实价格冲突，但关键源不完整'}`,
    `→ 降级方案：${safeText(signal.degradation?.plain_chinese, '不可降级，全部禁止')}`,
    '',
    '【总判断】',
    `当前：${action}`,
    `原因：${reason}`,
    '',
    '【盘面结构】',
    `现价：${displaySpot(snap)} ${spotSourceText(snap)}`,
    `ES/SPX状态：${safeText(signal.fmp_conclusion?.market_bias, 'unavailable')}`,
    `量比：${safeText(signal.volume_pressure?.plain_chinese, '量比不可用')}`,
    `通道：${safeText(signal.channel_shape?.plain_chinese, '通道形态不可用')}`,
    `波动状态：${safeText(signal.volatility_activation?.plain_chinese, '波动状态不可用')}`,
    '',
    '【Dealer】',
    `ThetaData：${safeText(signal.theta?.status, 'unavailable')}，${safeText(dealer.plain_chinese, 'Dealer 地图不能执行，只能观察。')}`,
    `Expected Move：${expectedMove}`,
    `Call Wall：${wallNote(dealer.call_wall)}`,
    `Put Wall：${wallNote(dealer.put_wall)}`,
    `Max Pain：${wallNote(dealer.max_pain)}`,
    `Zero Gamma：${dealer.zero_gamma == null ? '--' : fmtInt(dealer.zero_gamma)}`,
    `Dealer路径：${safeText(signal.dealer_path?.plain_chinese, 'Dealer path unavailable')}`,
    '',
    '【UW】',
    `Flow：${safeText(signal.uw_conclusion?.flow_bias, 'unavailable')}`,
    `Dark Pool：${safeText(signal.uw_conclusion?.darkpool_bias, 'unavailable')}`,
    `Market Tide：${safeText(signal.uw_conclusion?.market_tide, 'unavailable')}`,
    `Greek Exposure：${safeText(uwGreeks.status, 'unavailable')}`,
    `Vanna：${safeText(uwGreeks.net_vanna_bias, 'unavailable')}`,
    `Charm：${safeText(uwGreeks.net_charm_bias, 'unavailable')}`,
    `Delta：${safeText(uwGreeks.net_delta_bias, 'unavailable')}`,
    `Dealer cross-check：${safeText(uwGreeks.dealer_crosscheck, 'unavailable')}`,
    `UW Dealer Engine：${safeText(signal.dealer_engine?.plain_chinese, 'UW dealer engine unavailable')}`,
    `Dark Pool Summary：${safeText(signal.darkpool_summary?.plain_chinese, 'Dark pool unavailable')}`,
    `Reflection 支持：${safeText(reflection.supporting_evidence, '--')}`,
    `Reflection 冲突：${safeText(reflection.conflicting_evidence, '--')}`,
    `Reflection 缺失：${safeText(reflection.missing_inputs, '--')}`,
    '',
    '【TV哨兵】',
    `状态：${safeText(signal.tv_sentinel?.status, 'waiting')}`,
    `等待：${safeText((signal.trade_plan?.wait_conditions || [])[0]?.text, signal.tv_sentinel?.plain_chinese || '等待 TV 结构信号，不提前交易。')}`,
    `已等待：${signal.tv_waiting?.elapsed_min ?? '--'}分钟 / TTL ${signal.tv_waiting?.ttl_min ?? '--'}分钟`,
    `是否确认：${signal.tv_sentinel?.matched_allowed_setup === true ? 'YES' : 'NO'}`,
    '',
    '【我现在该做什么】',
    `一句话指令：${action}`
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
  if (signal?.recommended_action && ACTION_MAP[signal.recommended_action]) return ACTION_MAP[signal.recommended_action];
  if (signal?.conflict?.conflict_level === 'high' || signal?.stale_flags?.any_stale) return ACTION_MAP.no_trade;
  return ACTION_MAP.wait;
}

function hasHardBlock(signal) {
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
  if (deriveDataQuality(signal).executable !== true) return '--';
  const snap = signal.market_snapshot || {};
  if (signal.recommended_action === 'long_on_pullback') return `回踩 ${fmtInt(snap.flip_level)} 上方不破`;
  if (signal.recommended_action === 'short_on_retest') return `反抽 ${fmtInt(snap.call_wall || snap.flip_level)} 不过`;
  if (signal.recommended_action === 'income_ok') return `围绕 ${fmtInt(snap.max_pain)} 钉住，IV 回落`;
  if (signal.recommended_action === 'no_trade') return '无触发，先保护本金';
  return `离开 Flip ${fmtInt(snap.flip_level)} 后再看`;
}

function buildTarget(signal) {
  if (deriveDataQuality(signal).executable !== true) return '--';
  const snap = signal.market_snapshot || {};
  if (signal.recommended_action === 'long_on_pullback') return `${fmtInt(snap.call_wall)} / 上方流动性`;
  if (signal.recommended_action === 'short_on_retest') return `${fmtInt(snap.put_wall)} / 下方流动性`;
  if (signal.recommended_action === 'income_ok') return `${fmtInt(snap.put_wall)} - ${fmtInt(snap.call_wall)} 区间内收时间`;
  return '无目标，先等';
}

function buildInvalidation(signal) {
  if (deriveDataQuality(signal).executable !== true) return '--';
  if (signal.plain_language?.invalidation) return signal.plain_language.invalidation;
  const snap = signal.market_snapshot || {};
  if (signal.invalidation_level) return `跌破 / 站回 ${fmtInt(signal.invalidation_level)}`;
  return `Flip ${fmtInt(snap.flip_level)} 失效`;
}

function buildAvoid(signal) {
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
  const heartbeatLabel = scenarioMode
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

function renderMetricCards(signal) {
  const snap = signal.market_snapshot || {};
  const plan = signal.trade_plan || {};
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
        <div class="big-number">${escapeHtml(plan.direction_label || '禁做')}</div>
        <div class="delta-line"><span>${escapeHtml(plan.wait_conditions?.[0]?.text || '等待 TV 结构信号，不提前交易。')}</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">建议仓位</div>
        <div class="big-number">${escapeHtml(plan.position_sizing || '0仓')}</div>
        <div class="delta-line"><span>${escapeHtml(plan.ttl_text || '等待状态无 TTL')}</span></div>
      </div>
    </div>
  `;
}

function renderRiskStack(signal) {
  const cls = qualityClass(signal);
  const conflicts = signal.conflict?.conflict_points || [];
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
          <li>${escapeHtml(buildAvoid(signal))}</li>
          <li>${escapeHtml(buildInvalidation(signal))}</li>
          <li>${escapeHtml(conflicts[0] || signal.event_context?.event_note || '无新增冲突，仍按触发条件执行。')}</li>
        </ul>
      </div>
    </div>
  `;
}

function renderCommandHero(signal) {
  const dataQuality = deriveDataQuality(signal);
  const action = getAction(signal);
  const trigger = buildTrigger(signal);
  const target = buildTarget(signal);
  const invalidation = buildInvalidation(signal);
  const avoid = buildAvoid(signal);
  const summary = dataQuality.executable !== true
    ? safeText(signal.command_center?.plain_chinese, safeText(signal?.engines?.data_coherence?.reason, '数据冲突，禁止执行。'))
    : safeText(signal.plain_language?.user_action, action.summary);
  const title = dataQuality.executable !== true ? '数据守卫阻断｜禁止执行' : action.title;
  const planLabel = dataQuality.executable !== true
    ? safeText(signal?.engines?.data_coherence?.trade_permission, 'no_trade')
    : action.plan;

  return `
    <section class="command-hero">
      ${renderMetricCards(signal)}
      <div class="main-command">
        <div class="command-status-line">
          <div class="section-label">Current Command</div>
          <div class="permission-badge ${action.badge}">${action.permission}</div>
        </div>
        <h1 class="command-title">${escapeHtml(title)}</h1>
        <p class="command-subtitle">${escapeHtml(summary)}</p>
        <div class="tag-row">
          <span class="tag blue">${escapeHtml(planLabel)}</span>
          <span class="tag ${chipClassByRisk(signal.event_context?.event_risk)}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${gammaLabel(signal.gamma_regime)}</span>
          <span class="tag violet">${dealerLabel(signal.uw_context?.dealer_bias || signal.signals?.dealer_behavior)}</span>
        </div>
        <div class="command-grid">
          <div class="command-cell"><span class="card-label">Command Center</span><b>${escapeHtml(signal.command_center?.action || '等确认')}</b></div>
          <div class="command-cell"><span class="card-label">机构</span><b>${escapeHtml(signal.institutional_alert?.plain_chinese || '机构信号不可用。')}</b></div>
          <div class="command-cell"><span class="card-label">波动</span><b>${escapeHtml(signal.volatility_activation?.plain_chinese || '波动状态不可用。')}</b></div>
          <div class="command-cell"><span class="card-label">反射</span><b>${escapeHtml(signal.reflection?.plain_chinese || '等待反射分析。')}</b></div>
        </div>
        <div class="command-grid">
          <div class="command-cell"><span class="card-label">触发</span><b>${escapeHtml(trigger)}</b></div>
          <div class="command-cell"><span class="card-label">第一目标</span><b>${escapeHtml(target)}</b></div>
          <div class="command-cell"><span class="card-label">作废</span><b>${escapeHtml(invalidation)}</b></div>
          <div class="command-cell"><span class="card-label">禁做</span><b>${escapeHtml(avoid)}</b></div>
        </div>
      </div>
      ${renderRiskStack(signal)}
    </section>
  `;
}

function renderStrategyCards(signal) {
  const dataQuality = deriveDataQuality(signal);
  const strategyTypes = ['单腿', '垂直', '铁鹰'];
  return `
    <section class="grid-3">
      ${strategyTypes.map((type) => {
        const card = getStrategyCard(signal, type);
        const state = strategyState(signal, type);
        const target = dataQuality.executable !== true
          ? '--'
          : '--';
        const entry = dataQuality.executable !== true
          ? '--'
          : '--';
        const suitable = dataQuality.executable !== true
          ? safeText(signal?.engines?.data_coherence?.reason, '数据冲突 / 演示场景 / 数据过期 / 缺少关键输入')
          : card.suitable_when || '只在结构、Gamma、事件风险同时支持时考虑。';
        const invalidation = dataQuality.executable !== true
          ? '--'
          : '--';
        const avoid = dataQuality.executable !== true
          ? safeText(signal?.engines?.data_coherence?.reason, '数据冲突 / 演示场景 / 数据过期 / 缺少关键输入')
          : card.avoid_when || buildAvoid(signal);

        return `
          <article class="strategy-card ${state.cls}">
            <div class="strategy-headline">
              <div>
                <div class="section-label">Strategy</div>
                <div class="strategy-name">${type}</div>
              </div>
              <span class="strategy-status ${state.cls}">${state.text}</span>
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
  const keyLevelsLive = isThetaLive(signal) && isDealerLive(signal);
  const levelValue = (value) => keyLevelsLive ? fmtInt(value) : '--';
  const levelNote = (distance, fallback = '数据未 live / 不可交易') => keyLevelsLive && dataQuality.executable === true
    ? `距离 ${fmt(distance, 1)} pt`
    : fallback;
  const items = [
    ['SPX', displaySpot(snap), spotSourceText(snap)],
    ['Flip', levelValue(snap.flip_level), levelNote(snap.distance_to_flip)],
    ['Call Wall', levelValue(snap.call_wall), levelNote(snap.distance_to_call_wall, thetaPartialNote(signal))],
    ['Put Wall', levelValue(snap.put_wall), levelNote(snap.distance_to_put_wall, thetaPartialNote(signal))],
    ['Max Pain', levelValue(snap.max_pain), keyLevelsLive ? '中轴参考' : thetaPartialNote(signal)],
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
    ['Theta', thetaDecisionText(signal), 'Gamma 主环境'],
    ['TradingView', signal.signals?.tv_signal || '等待结构确认', '价格确认'],
    ['UW Flow', uwSafeValue(signal, 'flow'), '主动流向'],
    ['Strategy', Object.entries(signal.strategy_permissions || {}).map(([key, value]) => `${key}:${value?.permission || 'wait'}`).join(' / '), '策略权限'],
    ['Dark Pool', signal.darkpool_summary?.bias || uwSafeValue(signal, 'darkpool'), signal.darkpool_summary?.plain_chinese || '资金区'],
    ['Dealer', signal.dealer_engine?.behavior || dealerDecisionText(signal), signal.dealer_engine?.plain_chinese || '做市商路径'],
    ['UW Greek', signal.uw_dealer_greeks?.status || 'unavailable', signal.uw_dealer_greeks?.plain_chinese || 'Greek Exposure'],
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
      ${renderStrategyCards(signal)}
      <section class="matrix-grid">
        ${renderLevelMatrix(signal)}
        ${renderIntelMatrix(signal)}
      </section>
      ${renderSourceStrip(signal)}
      <div class="footer-note">schema ${escapeHtml(signal.schema_version)} · scenario ${escapeHtml(signal.scenario)} · ${escapeHtml(signal.fetch_mode)}</div>
    </main>
  `;
}

function renderRadarSummary(signal) {
  const dataQuality = deriveDataQuality(signal);
  const snap = signal.market_snapshot || {};
  const conflictPoints = signal.conflict?.conflict_points || [];
  const dealerLive = isDealerLive(signal);
  const levels = displayLevels(signal);
  const intel = displayIntel(signal);
  const projection = signal.projection?.command_summary || {};
  const thetaStatus = signal?.theta?.status || signal?.dealer_conclusion?.status || 'unavailable';
  const dealerStatus = signal?.dealer_conclusion?.status || 'unavailable';
  const executionStatus = signal?.execution_constraints?.theta?.executable === true ? 'ready' : 'blocked / not ready';
  const spotSourceText = snap.spot_is_real === true ? `${safeText(snap.spot_source, 'fmp')} real` : safeText(snap.spot_source, 'unavailable');
  return `
    <section class="radar-layout">
      ${dataQuality.executable !== true ? `
        <article class="radar-card">
          <div class="radar-title">
            <h2>Data Quality Guard</h2>
            <span class="tag amber">${escapeHtml(String(dataQuality.coherence).toUpperCase() || 'NO TRADE')}</span>
          </div>
          <p class="radar-note">${escapeHtml(safeText(signal?.engines?.data_coherence?.reason, '价格地图不一致，禁止执行。'))}</p>
          <ul class="alert-list">
            <li>FMP spot：${escapeHtml(spotSourceText)} ${escapeHtml(displaySpot(snap))}</li>
            <li>ThetaData：${escapeHtml(thetaStatus)}</li>
            <li>UW：${escapeHtml(signal?.uw_conclusion?.status || 'unavailable')}</li>
            <li>Dealer：${escapeHtml(dealerStatus)}</li>
            <li>执行状态：${escapeHtml(executionStatus)}</li>
          </ul>
        </article>
      ` : ''}
      <article class="radar-card">
        <div class="radar-title">
          <h2>Gamma / Dealer Radar</h2>
          <span class="tag ${chipClassByRisk(dealerLive ? signal.gamma_regime : 'partial')}">${dealerLive ? gammaLabel(signal.gamma_regime) : 'Gamma未知 / partial'}</span>
        </div>
        <p class="radar-note">${escapeHtml(dataQuality.executable !== true ? safeText(signal?.dealer_conclusion?.plain_chinese, safeText(signal?.engines?.data_coherence?.reason, '价格地图不一致，禁止执行。')) : safeText(signal.radar_summary?.dealer, safeText(signal.plain_language?.dealer_behavior, '等待 dealer 行为确认。')))}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">现价位置</div><div class="matrix-value">${escapeHtml(dataQuality.executable !== true ? safeText(signal?.engines?.data_coherence?.reason, '价格地图不一致') : displaySpotContext(snap))}</div><div class="matrix-number">${displaySpot(snap)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Flip</div><div class="matrix-value">${dealerLive ? fmt(snap.distance_to_flip, 1) + ' pt' : '--'}</div><div class="matrix-number">${escapeHtml(levels.flip)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Call Wall</div><div class="matrix-value">${dealerLive ? fmt(snap.distance_to_call_wall, 1) + ' pt' : '--'}</div><div class="matrix-number">${escapeHtml(levels.callWall)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Put Wall</div><div class="matrix-value">${dealerLive ? fmt(snap.distance_to_put_wall, 1) + ' pt' : '--'}</div><div class="matrix-number">${escapeHtml(levels.putWall)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Zero Gamma</div><div class="matrix-value">${dealerLive ? 'Gamma map' : '--'}</div><div class="matrix-number">${escapeHtml(levels.zeroGamma)}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Flow / UW Radar</h2>
          <span class="tag violet">${escapeHtml(signal.dealer_engine?.behavior || intel.dealer)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.institutional_alert?.plain_chinese || signal.radar_summary?.order_flow, 'UW 只作为辅助情报，不直接替代价格确认。'))}</p>
        <div class="tag-row">
          <span class="tag blue">Flow ${escapeHtml(intel.uwFlow)}</span>
          <span class="tag green">Dark Pool ${escapeHtml(signal.darkpool_summary?.bias || intel.darkPool)}</span>
          <span class="tag amber">Theta Weight ${fmtInt((signal.weights?.theta || 0) * 100)}%</span>
          <span class="tag violet">UW Weight ${fmtInt((signal.weights?.uw || 0) * 100)}%</span>
        </div>
        <p class="radar-note">${escapeHtml([
          `Factors：${safeText(signal.uw_factors?.flow_factors?.direction, 'none')} / ${safeText(signal.uw_factors?.volatility_factors?.iv_rank, '--')}`,
          `支持：${safeText(signal.reflection?.supporting_evidence, '--')}`,
          `冲突：${safeText(signal.reflection?.conflicting_evidence, '--')}`,
          `缺口：${safeText(signal.reflection?.missing_inputs, '--')}`
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
        <p class="radar-note">${escapeHtml(dataQuality.executable !== true ? safeText(signal?.engines?.data_coherence?.reason, 'FMP 现价真实，但 Gamma 地图仍为 mock，禁止执行。') : safeText(signal.radar_summary?.plan_alignment, safeText(signal.plain_language?.market_status, '暂无冲突说明。')))}</p>
        <ul class="alert-list">
          ${((dataQuality.executable !== true
            ? [
                `Spot 来源：${spotSourceText} ${displaySpot(snap)}`,
                `ThetaData：${thetaStatus}`,
                `Dealer：${dealerStatus}`,
                `执行状态：${executionStatus}`
              ]
            : (conflictPoints.length ? conflictPoints : ['没有强冲突，但仍必须等触发。']))).map((item) => `<li>${escapeHtml(safeText(item))}</li>`).join('')}
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
