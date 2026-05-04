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

function pageSafeText(value, fallback = '--') {
  const text = safeText(value, fallback);
  return ['undefined', 'null', 'NaN'].includes(String(text)) ? fallback : text;
}

function pickHomepageSignal(signal = {}) {
  return {
    analysis_layer: signal.analysis_layer || {},
    operation_layer: signal.operation_layer || {},
    uw_layer_conclusions: {
      master: signal.uw_layer_conclusions?.master || signal.uw_layer_conclusions?.master_synthesis || {},
      dealer: signal.uw_layer_conclusions?.dealer || {},
      flow: signal.uw_layer_conclusions?.flow || {},
      volatility: signal.uw_layer_conclusions?.volatility || {},
      darkpool: signal.uw_layer_conclusions?.darkpool || {},
      sentiment: signal.uw_layer_conclusions?.sentiment || {}
    },
    source_display: signal.source_display || {},
    spot_conclusion: signal.spot_conclusion || {},
    final_decision: signal.final_decision || {},
    tv_sentinel: signal.tv_sentinel || {},
    execution_card: signal.execution_card || {},
    dealer_wall_map: signal.dealer_wall_map || {},
    darkpool_gravity: signal.darkpool_gravity || {},
    flow_conflict: signal.flow_conflict || {},
    volatility_state: signal.volatility_state || signal.uw_normalized?.volatility?.volatility_state || {},
    price_trigger: signal.price_trigger || {},
    news_radar: signal.news_radar || {},
    wall_zone_panel: signal.wall_zone_panel || {},
    control_side: signal.control_side || {},
    price_sources: signal.price_sources || {},
    observation_price: signal.observation_price || {},
    tradeable_price: signal.tradeable_price || {},
    refresh_policy: signal.refresh_policy || {},
    data_clock: signal.data_clock || {},
    refresh_state: signal.refresh_state || {}
  };
}

function homepageState(signal = {}) {
  const home = pickHomepageSignal(signal);
  const operation = home.operation_layer;
  const executionCard = home.execution_card || {};
  const finalDecision = home.final_decision;
  const master = home.uw_layer_conclusions.master;
  const flow = home.uw_layer_conclusions.flow;
  const dataHealth = home.source_display?.uw?.status || master.status || 'partial';
  const ready = operation.status === 'ready';
  const flowDirection = flow.bias === 'bearish_hint' || flow.bias === 'bearish'
      ? '偏空线索'
      : flow.bias === 'bullish_hint' || flow.bias === 'bullish'
        ? '偏多线索'
        : '偏空线索';
  const direction = flowDirection;
  return {
    ...home,
    ready,
    operationStatus: ready ? 'READY / 可执行' : 'WAIT / 等确认',
    direction,
    dataHealth: String(dataHealth || 'partial').toLowerCase() === 'live' ? '数据能参考，但还不能直接出交易计划' : '部分数据能参考，还不能直接出交易计划',
    lockText: ready ? '关闭' : '开启',
    execution_card: executionCard,
    coreReason: '有 Put 看空线索，但 7150 附近有暗池承接区，不能追 Put；Dealer 墙位和波动率 Vscore 还没完成。'
  };
}

function renderHomeRows(rows = []) {
  return `
    <div class="home-field-list">
      ${rows.map(([label, value]) => `
        <div class="home-field-row ${['操作状态', '关键观察位', '入场', '止损', 'TP1', 'TP2', '入场 / 止损 / TP'].includes(label) ? 'emphasis' : ''}"><span>${escapeHtml(label)}</span><b>${escapeHtml(humanHomeText(value, '还没有足够信息，不能用于下单。'))}</b></div>
      `).join('')}
    </div>
  `;
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
  const params = new URLSearchParams();
  if (scenario) params.set('scenario', scenario);
  params.set('ts', String(Date.now()));
  const path = `/signals/current?${params.toString()}`;
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

function homeSafeText(value, fallback = '--') {
  if (value === undefined || value === null || Number.isNaN(value)) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    const text = value.map((item) => homeSafeText(item, '')).filter(Boolean).join('；');
    return text || fallback;
  }
  if (typeof value === 'object') {
    return homeSafeText(
      value.summary_cn
      || value.plain_chinese
      || value.summary
      || value.reason
      || value.instruction
      || value.operation_summary
      || value.market_read
      || value.status,
      fallback
    );
  }
  const text = String(value).trim();
  if (!text || ['undefined', 'null', 'NaN', 'not provided'].includes(text)) return fallback;
  return text
    .replaceAll('endpoint', '接口')
    .replaceAll('Endpoint', '接口')
    .replaceAll('HTTP', '接口')
    .replaceAll('raw', '原始数据')
    .replaceAll('Raw', '原始数据')
    .replaceAll('debug', '诊断')
    .replaceAll('Debug', '诊断')
    .replaceAll('Call Wall 0', 'Call Wall --')
    .replaceAll('Put Wall 0', 'Put Wall --')
    .replaceAll('fallback 进入引擎', '降级等待');
}

function homeSanitize(value, fallback = '--') {
  const text = homeSafeText(value, fallback);
  return text === 'not provided' ? fallback : text;
}

function homeHumanize(value, fallback = '这项信息还不能用于交易计划。') {
  const text = homeSanitize(value, fallback);
  const replacements = [
    [/Gamma Flip 暂不能确认。?/g, '做市商分界线还没算出来，所以暂时不能判断大盘是在震荡区，还是容易单边加速。'],
    [/lower_brake_zone/g, '下方大成交承接区'],
    [/upper_brake_zone/g, '上方大成交压力区'],
    [/Put RepeatedHits/g, '有资金连续买 Put，说明有人押下跌或买保护'],
    [/Data Health Score/g, '数据完整度'],
    [/核心操作字段缺失，不能 ready/g, '还缺做市商墙位、波动率结论、0DTE / 多腿过滤，所以暂时不给入场、止损、TP'],
    [/不能 ready/g, '还不能生成完整交易计划'],
    [/撞墙/g, '追空容易打到下方承接区'],
    [/cluster_wall/g, '聚合大成交区'],
    [/background_only/g, '只能做背景参考'],
    [/bearish_hint/g, '偏空线索'],
    [/partial/g, '部分可参考'],
    [/unavailable/g, '数据源没接好'],
    [/normalized/g, '整理后的数据'],
    [/\braw\b/g, '原始数据'],
    [/endpoint/g, '数据接口'],
    [/parser/g, '数据转换器'],
    [/operation_layer/g, '操作安全层'],
    [/null/g, '还没有结果'],
    [/undefined/g, '还没有结果'],
    [/NaN/g, '还没有结果'],
    [/未确认/g, '还需要确认'],
    [/暂不可用/g, '还不能用于交易计划'],
    [/未知/g, '还没有足够信息']
  ];
  return replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

function formatTradeLevel(value) {
  return value && value !== '--' ? value : '没有给出，不能下单';
}

function homeTradeLanguage(value, fallback = '--') {
  const text = homeSanitize(value, fallback);
  if (text === '--') return fallback;
  return text
    .replaceAll('Gamma Flip 暂不能确认。', '做市商分界线还没算出来，所以暂时不能判断大盘是在震荡区，还是容易单边加速。')
    .replaceAll('lower_brake_zone', '下方大成交承接区')
    .replaceAll('upper_brake_zone', '上方大成交压力区')
    .replaceAll('Put RepeatedHits', '有资金连续买 Put')
    .replaceAll('Data Health Score', '数据能不能出计划')
    .replaceAll('核心操作字段缺失，不能 ready', '还缺做市商墙位、波动率结论、0DTE / 多腿过滤，所以暂时不给入场、止损、TP。')
    .replaceAll('不能 ready', '还不能生成完整交易计划')
    .replaceAll('撞墙', '追空容易打到下方承接区')
    .replaceAll('cluster_wall', '暗池大成交聚集区')
    .replaceAll('major_wall', '大额暗池参考区')
    .replaceAll('background_only', '只能做背景参考')
    .replaceAll('unavailable', '数据还不能用于交易计划')
    .replaceAll('normalized', '已整理数据')
    .replaceAll('parser', '数据转换')
    .replaceAll('operation_layer', '操作层')
    .replaceAll('raw', '原始数据')
    .replaceAll('endpoint', '接口');
}

function readableDataHealth(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'live') return '数据可参考，但还不能生成完整交易计划';
  if (status === 'partial') return '部分数据可参考，还不能直接下单';
  return '数据还在整理，不能生成交易计划';
}

function readableDealerText(wall = {}) {
  if (wall.call_wall == null || wall.put_wall == null || wall.gamma_flip == null) {
    return '做市商墙位还没生成。现在不能用 Gamma 判断上方压力、下方支撑和趋势加速区。';
  }
  return `做市商墙位已生成：上方约 ${wall.call_wall}，下方约 ${wall.put_wall}，分界线约 ${wall.gamma_flip}。`;
}

function readableDarkpoolText(gravity = {}) {
  if (gravity.mapped_spx != null) {
    return `下方 ${Number(gravity.mapped_spx).toFixed(2)} 附近有暗池大成交区。这里可能有资金承接，追 Put 要小心。`;
  }
  return '暗池数据还不能形成交易计划；等出现可映射到 SPX 的大成交区。';
}

function readableFlowText(conflict = {}) {
  if (conflict.flow_state === 'bearish_hits') {
    if (conflict.flow_wall_state === 'stalling') {
      return '有资金连续买 Put，说明有人押下跌或买保护；但下方有承接区，所以不能追空，只能等价格反应。';
    }
    return '有资金连续买 Put，这是看空线索，但还不能单独作为开仓信号。';
  }
  return 'Flow 还没有形成可以交易的方向，只能继续观察。';
}

function readableVolatilityText(volState = {}) {
  if (volState.data_ready === true && volState.vscore != null) {
    return `Vscore 已算出 ${volState.vscore}，可以开始判断期权贵不贵。`;
  }
  return '波动率公式已准备好，但 Vscore 还没算出来，所以暂时不能判断期权贵不贵。';
}

function homeStateLabel(value) {
  const state = String(value || '').toLowerCase();
  if (state === 'ready') return 'READY / 可执行';
  if (state === 'blocked') return 'WAIT / 等确认';
  if (state === 'wait' || state === 'waiting') return 'WAIT / 等确认';
  return 'WAIT / 等确认';
}

function homeDirectionLabel(value) {
  const direction = String(value || '').toLowerCase();
  if (direction.includes('bear') || direction === 'short' || direction === 'put') return '偏空线索';
  if (direction.includes('bull') || direction === 'long' || direction === 'call') return '偏多线索';
  if (direction === 'neutral') return '中性';
  return '偏空线索';
}

function homeDataHealthLabel(sourceDisplay = {}, master = {}) {
  const status = String(master.status || sourceDisplay.uw?.status || sourceDisplay.tradingview?.status || 'partial').toLowerCase();
  if (status === 'live' || status === 'ready') return 'Live';
  if (status === 'unavailable') return 'Unavailable';
  return 'Partial';
}

function homeLockLabel(operationLayer = {}) {
  return operationLayer.status === 'ready' ? '关闭' : '开启';
}

function homeMasterSignal(operationLayer = {}, finalDecision = {}) {
  if (operationLayer.status === 'ready') return 'READY';
  const state = String(finalDecision.state || operationLayer.status || 'wait').toLowerCase();
  if (state === 'ready') return 'READY';
  return 'WAIT';
}

function homeHumanContext(home = {}) {
  const execution = home.execution_card || {};
  const wall = home.dealer_wall_map || {};
  const gravity = home.darkpool_gravity || {};
  const conflict = home.flow_conflict || {};
  const volState = home.volatility_state || {};
  const darkLevel = gravity.mapped_spx != null ? Number(gravity.mapped_spx).toFixed(2) : '7150.23';
  const dealerReady = wall.call_wall != null || wall.put_wall != null || wall.gamma_flip != null;
  return {
    status: 'WAIT，不能开仓',
    direction: execution.direction_cn || '震荡等待',
    headline: dealerReady
      ? (execution.headline_cn || '当前不是追空环境，先等关键价位反应。')
      : '下方暗池减速区限制追空，做市商墙位还没生成。',
    action: execution.action_cn || `禁止追 Put；等 ${darkLevel} 附近回踩反应。`,
    why: [
      '有资金连续买 Put，说明有人押下跌或买保护。',
      `下方 ${darkLevel} 附近有暗池大成交区，可能有人接盘。`,
      '现在追 Put，容易刚追进去就遇到反弹。',
      dealerReady
        ? `做市商墙位已进入计算：上方 ${homeSanitize(wall.call_wall)}，下方 ${homeSanitize(wall.put_wall)}，分界线 ${homeSanitize(wall.gamma_flip)}。`
        : '做市商墙位还没算出来，不能判断上方压力、下方支撑和 Gamma 分界线。',
      volState.data_ready
        ? `波动率 Vscore 已算出 ${volState.vscore}，用来判断期权价格是否偏贵。`
        : '波动率 Vscore 还没算出来，不能判断期权贵不贵。'
    ],
    waitFor: [
      `等价格回踩 ${darkLevel} 附近。`,
      `如果 ${darkLevel} 附近站稳反弹，再观察 Call。`,
      `如果 ${darkLevel} 放量跌破，再重新评估 Put。`,
      '等 Flow 继续同向并完成 0DTE / 多腿过滤。',
      '等系统给出完整入场、止损、TP。'
    ],
    doNot: [
      '不追 Put。',
      '不提前买 Put。',
      '不根据单一 Put 信号开仓。',
      '没有入场、止损、TP，不下单。'
    ],
    factors: {
      dealer: [
        '做市商墙位还没生成。',
        '现在不能用 Gamma 判断上方压力、下方支撑和趋势加速区。',
        '影响：只能观察，不能用墙位做交易计划。'
      ],
      flow: [
        '有资金连续买 Put。',
        '这是看空线索，但还不能单独作为开仓信号。',
        conflict.flow_wall_state === 'stalling'
          ? '下方有承接区，追空容易打到下方买盘。'
          : '还需要确认这批 Put 是否持续同向。'
      ],
      darkpool: [
        `下方 ${darkLevel} 附近有暗池大成交区。`,
        '这里可能有资金承接，追 Put 要小心。',
        '有参考价值，但不能直接当正式支撑下单。'
      ],
      volatility: [
        '波动率公式已准备好。',
        volState.data_ready
          ? `Vscore 已算出 ${volState.vscore}，可以辅助判断期权价格。`
          : '但 Vscore 还没算出来，所以暂时不能判断期权贵不贵。',
        '影响：不能判断裸买 Put 是否划算。'
      ],
      sentiment: [
        '市场情绪轻微防守。',
        '不是强空，只能做背景。',
        '影响：不能单独支持激进追空。'
      ]
    }
  };
}

function homeTagClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('ready') || normalized.includes('live')) return 'green';
  if (normalized.includes('wait') || normalized.includes('partial')) return 'amber';
  if (normalized.includes('blocked') || normalized.includes('unavailable')) return 'red';
  return 'blue';
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
  const scenarioMode = Boolean(currentScenario);
  const home = homepageState(signal);
  const heartbeatLabel = currentPath === '/'
    ? `${homeMasterSignal(home.operation_layer, home.final_decision)} · 等确认`
    : scenarioMode
      ? '演示场景｜不可交易'
      : 'LIVE';
  const heartbeatClass = currentPath === '/'
    ? home.operation_layer.status === 'ready' ? 'good' : 'warn'
    : qualityClass(signal);
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
        <div class="heartbeat"><i class="heartbeat-dot ${heartbeatClass}"></i><span>${escapeHtml(heartbeatLabel)}</span><span>${currentPath === '/' ? '首页 V1' : shortTime(signal.received_at)}</span></div>
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
        ${(signal.source_status || []).filter((item) => item.show_in_data_gaps === true || ['tradingview', 'fmp_event', 'fmp_price', 'theta_core', 'theta_full_chain', 'uw', 'telegram', 'dashboard'].includes(item.source)).map((item) => `
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
  const sourceRules = signal.source_display_rules || {};
  const sourceItems = Object.entries(sourceRules)
    .filter(([, rule]) => rule.show_on_homepage === true)
    .map(([name, rule]) => [name.toUpperCase(), rule.status, rule.reason]);
  const items = sourceItems.length > 0 ? sourceItems : [
    ['UW', signal.uw_conclusion?.status || 'unavailable', signal.uw_conclusion?.plain_chinese || '主数据源'],
    ['TV', signal.tv_sentinel?.event_type || signal.tv_sentinel?.status || 'waiting', '最终确认，不单独定方向']
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


/* ═══════════════════════════════════════════════════════════════════════════
   L2.5 HUD — FOUR BATTLE ZONES
   ═══════════════════════════════════════════════════════════════════════════ */

function fmtLevel(v) {
  if (v == null) return '--';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : '--';
}
function fmtPrem(v) {
  if (v == null) return '--';
  const m = Number(v) / 1_000_000;
  const sign = m >= 0 ? '+' : '';
  return `${sign}$${Math.abs(m).toFixed(1)}M`;
}
function distanceLabel(spot, wall) {
  if (spot == null || wall == null) return '--';
  const d = wall - spot;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(1)} pts`;
}
function isSniperZone(spot, wall, threshold = 2) {
  if (spot == null || wall == null) return false;
  return Math.abs(spot - wall) <= threshold;
}

// Zone 1: Gamma Battlefield
function renderHudZoneGamma(signal) {
  const gr  = signal.gamma_regime_engine || {};
  const atm = signal.atm_engine || {};
  const dw  = signal.dealer_wall_map || {};
  const lv  = signal.levels || {};
  const ate = signal.atm_trigger_engine || {};
  const spot = (signal.price_contract && signal.price_contract.live_price != null)
    ? signal.price_contract.live_price
    : (signal.observation_price && signal.observation_price.value != null ? signal.observation_price.value : null);
  const regime = gr.gamma_regime || 'unknown';
  const regimeLabelMap = { positive: '正 GAMMA 环境', negative: '负 GAMMA 环境', transitional: '过渡区', unknown: '数据待接入' };
  const regimeLabel = regimeLabelMap[regime] || regime;
  const regimeSubMap = { positive: '做市商阻尼 · 均值回归 · 卖权策略占优', negative: '做市商放波 · 趋势加速 · 买权策略占优', transitional: '环境切换中，谨慎双向', unknown: '等待 UW 数据' };
  const regimeSub = regimeSubMap[regime] || '';
  const score = (gr.scores && gr.scores.execution_confidence != null) ? gr.scores.execution_confidence : 0;
  const gammaFlip = gr.gamma_flip != null ? gr.gamma_flip : null;
  const flipClass = spot != null && gammaFlip != null ? (spot > gammaFlip ? 'bullish' : 'bearish') : 'neutral';
  const badge = regime === 'positive' ? 'green' : regime === 'negative' ? 'red' : regime === 'transitional' ? 'amber' : 'gray';

  // ── Layer 1: ATM Execution Lines (primary — 0DTE trading use) ─────────────
  const atmVal    = atm.atm != null ? atm.atm : null;
  const atmTrend  = atm.atm_trend || 'stable';
  const pinRisk   = atm.pin_risk != null ? atm.pin_risk : 0;
  const trendArrow = atmTrend === 'rising' ? '↑' : atmTrend === 'falling' ? '↓' : '→';
  // bull_trigger = ATM+5, bear_trigger = ATM-5 (from atm_trigger_engine)
  const bullTrig  = lv.bull_trigger != null ? Number(lv.bull_trigger) : null;
  const bearTrig  = lv.bear_trigger != null ? Number(lv.bear_trigger) : null;
  const bullTarg  = lv.bull_target_1 != null ? Number(lv.bull_target_1) : null;
  const bearTarg  = lv.bear_target_1 != null ? Number(lv.bear_target_1) : null;
  const lockZone  = lv.lock_zone || null;
  const spotInLock = lv.spot_in_lock_zone ?? true;
  const lockLow   = lockZone != null ? lockZone[0] : (bearTrig ?? null);
  const lockHigh  = lockZone != null ? lockZone[1] : (bullTrig ?? null);

  // ── Layer 2: GEX Local Reference (±30pt of spot — informational only) ─────
  const gexLocalCall = lv.gex_local_call_wall != null ? Number(lv.gex_local_call_wall) : null;
  const gexLocalPut  = lv.gex_local_put_wall  != null ? Number(lv.gex_local_put_wall)  : null;
  const hasLocalGex  = gexLocalCall != null || gexLocalPut != null;

  // ── Layer 3: Far Background Walls (>30pt — Radar only, shown as footnote) ──
  const farCallWall = dw.far_call_wall != null ? Number(dw.far_call_wall) : (dw.near_call_wall != null ? Number(dw.near_call_wall) : null);
  const farPutWall  = dw.far_put_wall  != null ? Number(dw.far_put_wall)  : (dw.near_put_wall  != null ? Number(dw.near_put_wall)  : null);
  const farCallDist = spot != null && farCallWall != null ? Math.round(farCallWall - spot) : null;
  const farPutDist  = spot != null && farPutWall  != null ? Math.round(spot - farPutWall)  : null;
  // Only show far walls if they are genuinely far (>30pt) — otherwise they are already in Layer 2
  const showFarCall = farCallWall != null && (farCallDist == null || farCallDist > 30);
  const showFarPut  = farPutWall  != null && (farPutDist  == null || farPutDist  > 30);

  return `
    <div class="hud-zone gamma-battlefield">
      <div class="hud-zone-header">
        <div class="hud-zone-title">
          <span class="hud-zone-number">ZONE 01</span>
          <span class="hud-zone-name">Gamma 战场</span>
        </div>
        <span class="hud-zone-badge ${badge}">${regimeLabel}</span>
      </div>
      <div class="gamma-regime-banner ${regime}">
        <div>
          <div class="gamma-regime-label">${regimeLabel}</div>
          <div class="gamma-regime-sub">${regimeSub}</div>
        </div>
        <div class="gamma-regime-score">
          <div class="gamma-regime-score-val">${score}</div>
          <div class="gamma-regime-score-label">执行置信度</div>
        </div>
      </div>

      <!-- Layer 1: ATM Execution Lines -->
      <div class="atm-exec-section">
        <div class="atm-exec-header">
          <span class="atm-exec-label">ATM 执行线</span>
          <span class="atm-exec-badge ${spotInLock ? 'locked' : 'watch'}">${spotInLock ? 'LOCKED' : '监控中'}</span>
        </div>
        <div class="gamma-flip-bar">
          <div class="gamma-flip-item">
            <div class="gamma-flip-label">Gamma Flip</div>
            <div class="gamma-flip-value ${flipClass}">${gammaFlip != null && gammaFlip !== 0 ? fmtLevel(gammaFlip) : '<span class="data-missing">暂无</span>'}</div>
            <div class="gamma-flip-sub">${spot != null && gammaFlip != null ? (spot > gammaFlip ? '现价在翻转点上方' : '现价在翻转点下方') : '--'}</div>
          </div>
          <div class="gamma-flip-item">
            <div class="gamma-flip-label">转多触发<span class="wall-source-tag">ATM+5</span></div>
            <div class="gamma-flip-value bearish">${bullTrig != null ? fmtLevel(bullTrig) : '<span class="data-missing">--</span>'}</div>
            <div class="gamma-flip-sub">${bullTrig != null ? (bullTarg != null ? '目标 ' + fmtLevel(bullTarg) : distanceLabel(spot, bullTrig)) : '--'}</div>
          </div>
          <div class="gamma-flip-item">
            <div class="gamma-flip-label">转空触发<span class="wall-source-tag">ATM-5</span></div>
            <div class="gamma-flip-value bullish">${bearTrig != null ? fmtLevel(bearTrig) : '<span class="data-missing">--</span>'}</div>
            <div class="gamma-flip-sub">${bearTrig != null ? (bearTarg != null ? '目标 ' + fmtLevel(bearTarg) : distanceLabel(spot, bearTrig)) : '--'}</div>
          </div>
        </div>
        <div class="atm-magnet-row">
          <span class="atm-magnet-label">ATM 磁吸中轴</span>
          <span class="atm-magnet-value">${fmtLevel(atmVal)}</span>
          <span class="atm-magnet-trend">${trendArrow} ${atmTrend === 'rising' ? '上移' : atmTrend === 'falling' ? '下移' : '稳定'}</span>
          ${lockLow != null && lockHigh != null ? `<span class="lock-zone-inline">锁仓区 ${fmtLevel(lockLow)}–${fmtLevel(lockHigh)}</span>` : ''}
          ${pinRisk >= 70 ? `<span class="atm-pin-warning">⚠ ATM 吸附 ${pinRisk}/100</span>` : ''}
        </div>
      </div>

      <!-- Layer 2: GEX Local Reference (±30pt) -->
      <div class="gex-local-section">
        <div class="gex-local-header">
          <span class="gex-local-label">GEX 参考墙</span>
          <span class="gex-local-note">±30pt 内</span>
        </div>
        ${hasLocalGex ? `
        <div class="gex-local-row">
          ${gexLocalCall != null ? `<div class="gex-local-item call"><span class="gex-local-tag">GEX 压力</span><span class="gex-local-val">${fmtLevel(gexLocalCall)}</span><span class="gex-local-dist">${distanceLabel(spot, gexLocalCall)}</span></div>` : ''}
          ${gexLocalPut  != null ? `<div class="gex-local-item put"><span class="gex-local-tag">GEX 支撑</span><span class="gex-local-val">${fmtLevel(gexLocalPut)}</span><span class="gex-local-dist">${distanceLabel(spot, gexLocalPut)}</span></div>` : ''}
        </div>` : `<div class="gex-local-empty">±30pt 内无显著 GEX 墙</div>`}
      </div>

      <!-- Layer 3: Far Background Walls (footnote, Radar only) -->
      ${(showFarCall || showFarPut) ? `
      <div class="gex-far-footnote">
        <span class="gex-far-label">远端 Gamma 背景（仅 Radar 参考，不作日内触发）</span>
        <span class="gex-far-vals">
          ${showFarCall ? `Call ${fmtLevel(farCallWall)} (+${farCallDist}pt)` : ''}
          ${showFarCall && showFarPut ? ' · ' : ''}
          ${showFarPut  ? `Put ${fmtLevel(farPutWall)} (-${farPutDist}pt)` : ''}
        </span>
      </div>` : ''}
    </div>
  `;
}

// Zone 2: Execution Matrix
function renderHudZoneExecution(signal) {
  const gr  = signal.gamma_regime_engine || {};
  const dp  = signal.darkpool_gravity    || {};
  const dpb = signal.darkpool_behavior_engine || {};
  const pc  = signal.price_contract      || {};
  const dw  = signal.dealer_wall_map     || {};
  const spot = pc.live_price != null ? pc.live_price
    : (signal.observation_price?.value ?? null);
  // Three-layer fix: ZONE 02 uses gex_local_call_wall (±30pt) for execution boundary
  // Far walls (7000/7300) are NOT execution walls — they go to Radar only
  const lv = signal.levels || {};
  const callWall  = lv.gex_local_call_wall != null ? Number(lv.gex_local_call_wall) : null;
  const putWall   = lv.gex_local_put_wall  != null ? Number(lv.gex_local_put_wall)  : null;
  const gammaFlip = gr.gamma_flip ?? dw.gamma_flip ?? null;

  // Prefer darkpool_behavior_engine levels (SPX-mapped), fallback to legacy gravity
  const dpLevel = dpb.spx_level ?? dpb.support_level
    ?? (dp.nearest_support != null ? dp.nearest_support : (dp.mapped_spx ?? null));

  // Frontend guard: if Put Wall > Call Wall, mark as inverted (data error)
  const wallInverted = (callWall != null && putWall != null && putWall > callWall);
  const callWallDisplay = wallInverted ? null : callWall;
  const putWallDisplay  = wallInverted ? null : putWall;

  // Dark pool behavior badge
  const dpBehavior    = dpb.behavior    || 'unknown';
  const dpBehaviorCn  = dpb.behavior_cn || '数据不足';
  const dpPremM       = dpb.total_premium_millions;
  const dpBehaviorColorMap = {
    support:    'green',
    breakout:   'green',
    resistance: 'red',
    breakdown:  'red',
    unknown:    'gray'
  };
  const dpColor = dpBehaviorColorMap[dpBehavior] || 'gray';

  const walls = [
    { type: 'call-wall',       label: '上限阻力 Call Wall', level: callWallDisplay, sniper: isSniperZone(spot, callWallDisplay), inverted: wallInverted },
    { type: 'put-wall',        label: '下限支撑 Put Wall',  level: putWallDisplay,  sniper: isSniperZone(spot, putWallDisplay),  inverted: wallInverted },
    { type: 'darkpool-wall',   label: '暗盘防线 ' + dpBehaviorCn, level: dpLevel, sniper: isSniperZone(spot, dpLevel) },
    { type: 'gamma-flip-wall', label: 'Gamma 翻转点',       level: (gammaFlip != null && gammaFlip !== 0) ? gammaFlip : null, sniper: isSniperZone(spot, gammaFlip) }
  ];
  const anySniperActive = walls.some(w => w.sniper && w.level != null);
  const wallRows = walls.map(w => {
    const distClass = (w.level != null && spot != null && Math.abs(w.level - spot) <= 5) ? 'danger' : 'safe';
    const sniperCls = (w.sniper && w.level != null) ? ' sniper-active' : '';
    const dpDesc = (w.type === 'darkpool-wall' && dpBehavior !== 'unknown' && dpb.behavior_description)
      ? '<div class="dp-behavior-desc">' + dpb.behavior_description + (dpPremM != null ? ' ($' + dpPremM + 'M)' : '') + '</div>'
      : '';
    return `
      <div class="wall-item ${w.type}${sniperCls}">
        <div>
          <div class="wall-item-type">${w.label}</div>
          ${dpDesc}
        </div>
        <div class="wall-item-level">${w.inverted ? '<span class="data-missing">字段映射错误</span>' : (w.level != null ? fmtLevel(w.level) : '<span class="data-missing">暂无</span>')}</div>
        <div class="wall-item-distance ${distClass}">${distanceLabel(spot, w.level)}</div>
      </div>`;
  }).join('');

  // Dark pool cluster mini-list (top 3 clusters)
  const dpClusters = Array.isArray(dpb.clusters) && dpb.clusters.length > 0
    ? `<div class="dp-cluster-list">
        <div class="dp-cluster-header">暗盘聚类（SPX 坐标）</div>
        ${dpb.clusters.slice(0, 3).map(c => `
          <div class="dp-cluster-row">
            <span class="dp-cluster-level">${fmtLevel(c.spx_level)}</span>
            <span class="dp-cluster-prem">$${c.total_premium_millions}M</span>
            <span class="dp-cluster-behavior dp-${dpBehaviorColorMap[c.behavior] || 'gray'}">${c.behavior_cn}</span>
          </div>`).join('')}
       </div>`
    : '';

  return `
    <div class="hud-zone execution-matrix">
      <div class="hud-zone-header">
        <div class="hud-zone-title">
          <span class="hud-zone-number">ZONE 02</span>
          <span class="hud-zone-name">执行边界与墙</span>
        </div>
        <span class="hud-zone-badge ${anySniperActive ? 'red' : 'blue'}">${anySniperActive ? '⚡ 狙击状态' : '监控中'}</span>
      </div>
      ${anySniperActive ? `<div class="sniper-alert"><div class="sniper-alert-dot"></div><span class="sniper-alert-text">现价进入关键位 ±2 点范围 — 进入狙击状态</span></div>` : ''}
      <div class="wall-stack">${wallRows}</div>
      ${dpClusters}
    </div>
  `;
}

// Zone 3: Order Flow — Sentiment Bar + X-Ray
function renderSentimentBar(fb) {
  const behavior = fb.behavior || 'neutral';
  const netPrem  = fb.net_premium  != null ? fb.net_premium  : null;
  const pcRatio  = fb.put_call_ratio != null ? fb.put_call_ratio : null;
  const pcExtreme = fb.pc_extreme || {};

  // Determine sentiment color
  let sentColor = 'gray', sentLabel = '数据不足', sentClass = 'gray';
  if (netPrem == null || pcRatio == null) {
    sentColor = 'gray'; sentLabel = '数据不足'; sentClass = 'gray';
  } else if (behavior === 'call_effective' || (netPrem > 0 && pcRatio < 0.8)) {
    sentColor = 'green'; sentLabel = '偏多'; sentClass = 'bullish';
  } else if (behavior === 'put_effective' || (netPrem < 0 && pcRatio > 1.2)) {
    sentColor = 'red'; sentLabel = '偏空'; sentClass = 'bearish';
  } else if (behavior === 'put_squeezed' || behavior === 'call_capped') {
    sentColor = 'yellow'; sentLabel = '观望'; sentClass = 'neutral';
  } else if (Math.abs(netPrem || 0) < 50_000_000) {
    sentColor = 'yellow'; sentLabel = '观望'; sentClass = 'neutral';
  } else {
    sentColor = 'yellow'; sentLabel = '观望'; sentClass = 'neutral';
  }

  // P/C extreme alert
  let pcAlert = '';
  if (pcRatio == null) {
    pcAlert = `<span class="pc-alert gray">P/C 数据缺失</span>`;
  } else if (pcRatio > 1.5) {
    pcAlert = `<span class="pc-alert bearish">P/C ${pcRatio.toFixed(2)} — 极度防守 ⚠</span>`;
  } else if (pcRatio < 0.5) {
    pcAlert = `<span class="pc-alert bullish">P/C ${pcRatio.toFixed(2)} — 极度贪婪 ⚠</span>`;
  } else {
    pcAlert = `<span class="pc-alert neutral">P/C ${pcRatio.toFixed(2)}</span>`;
  }

  return `
    <div class="sentiment-bar-wrap">
      <div class="sentiment-bar-track">
        <div class="sentiment-bar-segment red" style="flex:1">偏空</div>
        <div class="sentiment-bar-segment yellow" style="flex:1">观望</div>
        <div class="sentiment-bar-segment green" style="flex:1">偏多</div>
      </div>
      <div class="sentiment-bar-needle ${sentClass}"></div>
      <div class="sentiment-bar-label ${sentClass}">${sentLabel}</div>
      ${pcAlert}
    </div>
  `;
}

function renderHudZoneFlow(signal) {
  const fb = signal.flow_behavior_engine || {};
  const behavior = fb.behavior || 'neutral';
  const behaviorLabel = fb.behavior_label || '无明显资金流';
  const behaviorIcon = fb.behavior_icon || '—';
  const reason = fb.reason || '';
  const netPrem  = fb.net_premium  != null ? fb.net_premium  : null;
  const callPrem = fb.call_premium != null ? fb.call_premium : null;
  const putPrem  = fb.put_premium  != null ? fb.put_premium  : null;
  const acc = fb.acceleration || {};
  const pcExtreme = fb.pc_extreme || {};
  const aggScore = fb.aggression_score != null ? fb.aggression_score : 0;
  const aggClass = aggScore >= 70 ? 'high' : aggScore >= 40 ? 'medium' : 'low';
  const accDir = acc.direction || 'flat';
  const accLabel = acc.acceleration_label || '--';
  const pcRatio = fb.put_call_ratio != null ? fb.put_call_ratio : null;
  const pcClass = (pcExtreme.type || 'normal').replace(/_/g, '-');
  const netPremClass = netPrem == null ? 'neutral' : netPrem >= 0 ? 'positive' : 'negative';

  // Data validity checks
  const netPremDisplay = netPrem == null ? '<span class="data-missing">未接入</span>' : `<span class="${netPremClass}">${fmtPrem(netPrem)}</span>`;
  const callPremDisplay = callPrem == null ? '<span class="data-missing">未接入</span>' : `<span class="positive">${fmtPrem(callPrem)}</span>`;
  const putPremDisplay  = putPrem  == null ? '<span class="data-missing">未接入</span>' : `<span class="negative">${fmtPrem(putPrem)}</span>`;
  const pcDisplay = pcRatio == null ? '<span class="data-missing">数据缺失</span>' : `<span class="pc-ratio-value ${pcClass}">${Number(pcRatio).toFixed(2)}</span>`;
  const aggDisplay = (netPrem == null || pcRatio == null) ? '<span class="data-missing">不可用（数据未接入）</span>' : `${fb.aggression_label || '--'} (${aggScore}/100)`;
  // Phase 4/5: suspicious_same_window 警告
  const suspiciousWindow = fb.suspicious_same_window === true;
  const flow5mFallback   = fb.flow_5m_is_fallback  === true;
  const flow15mFallback  = fb.flow_15m_is_fallback === true;

  return `
    <div class="hud-zone flow-xray">
      <div class="hud-zone-header">
        <div class="hud-zone-title">
          <span class="hud-zone-number">ZONE 03</span>
          <span class="hud-zone-name">资金微观 X-Ray</span>
        </div>
        <span class="hud-zone-badge ${fb.behavior_color || 'gray'}">${behaviorLabel}</span>
      </div>
      ${renderSentimentBar(fb)}
      <div class="flow-prem-grid">
        <div class="flow-prem-item">
          <div class="flow-prem-label">净权利金<span class="prem-label-note">（当日累计）</span></div>
          <div class="flow-prem-value">${netPremDisplay}</div>
        </div>
        <div class="flow-prem-item">
          <div class="flow-prem-label">Call 权利金<span class="prem-label-note">（当日累计）</span></div>
          <div class="flow-prem-value">${callPremDisplay}</div>
        </div>
        <div class="flow-prem-item">
          <div class="flow-prem-label">Put 权利金<span class="prem-label-note">（当日累计）</span></div>
          <div class="flow-prem-value">${putPremDisplay}</div>
        </div>
        <div class="flow-prem-item">
          <div class="flow-prem-label">P/C 比率<span class="prem-label-note">（Volume 优先）</span></div>
          <div class="flow-prem-value">${pcDisplay}</div>
        </div>
      </div>
      <div class="acceleration-card">
        <div>
          <div class="acceleration-label">15分钟加速度 ★ 核心指标</div>
          <div class="acceleration-value ${accDir}">${accLabel}</div>
        </div>
        <span class="acceleration-tag">${acc.is_accelerating ? '加速中' : '平稳'}</span>
      </div>
      <div class="aggression-meter">
        <div class="aggression-meter-label">
          <span>资金侵略性</span>
          <span>${aggDisplay}</span>
        </div>
        ${(netPrem != null && pcRatio != null) ? `<div class="aggression-meter-bar"><div class="aggression-meter-fill ${aggClass}" style="width:${aggScore}%"></div></div>` : ''}
      </div>
      ${suspiciousWindow ? `
      <div class="flow-warning-bar">
        <span class="flow-warn-icon">⚠</span>
        <span class="flow-warn-text">5m/15m 窗口数据异常（可能为冷启动 fallback 或缓存复用），数值仅供参考。</span>
      </div>` : ''}
      ${(flow5mFallback || flow15mFallback) ? `
      <div class="flow-fallback-note">
        <span class="flow-note-icon">ℹ</span>
        <span class="flow-note-text">${flow5mFallback ? '5m' : ''} ${flow15mFallback ? '15m' : ''} 窗口使用历史推算，非实时窗口数据。</span>
      </div>` : ''}
    </div>
  `;
}

// Zone 4: Command Generator — Trading Language Format
function renderHudZoneCommand(signal) {
  const ab = signal.ab_order_engine || {};
  const atm = signal.atm_engine || {};
  const gr = signal.gamma_regime_engine || {};
  const fb = signal.flow_behavior_engine || {};
  const status = ab.status || 'waiting';
  const confidence = ab.execution_confidence != null ? ab.execution_confidence : 0;
  const confClass = confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low';
  const planA = ab.plan_a || null;
  const planB = ab.plan_b || null;

  // Build trading-language directive lines
  const pc = signal.price_contract || {};
  const spot = pc.live_price != null ? pc.live_price : null;
  const callWall = gr.call_wall != null ? gr.call_wall : null;
  const putWall  = gr.put_wall  != null ? gr.put_wall  : null;
  const gammaFlip = gr.gamma_flip != null ? gr.gamma_flip : null;
  const atmVal = atm.atm != null ? atm.atm : null;
  const pinRisk = atm.pin_risk != null ? atm.pin_risk : 0;

  // Build "NOW / WAIT_LONG / WAIT_SHORT / FORBIDDEN / INVALID / TARGET" lines
  function buildDirective() {
    if (status === 'blocked') {
      return {
        now: '执行锁定 — 数据不足，禁止开仓',
        wait_long: '等待数据接入后重新评估',
        wait_short: '等待数据接入后重新评估',
        forbidden: atmVal != null ? `${fmtLevel(atmVal)} ATM 附近禁买 0DTE` : 'ATM 附近禁买 0DTE',
        invalid: '数据接入前所有预案失效',
        target: '--'
      };
    }
    if (planA && planA.direction) {
      const entryA = planA.entry || '--';
      const stopA  = planA.stop  || '--';
      const tp1A   = planA.tp1   || '--';
      const tp2A   = planA.tp2   || '--';
      const entryB = planB ? (planB.entry || '--') : '--';
      const stopB  = planB ? (planB.stop  || '--') : '--';
      const tp1B   = planB ? (planB.tp1   || '--') : '--';
      const isLong = planA.direction === 'LONG' || planA.direction === 'BULL';
      const isShort = planA.direction === 'SHORT' || planA.direction === 'BEAR';
      return {
        now: `不追，等确认信号`,
        wait_long: isLong
          ? `站稳 ${entryA}，3分钟回踩不破 → ${planA.instrument || 'Bull Call Spread'}`
          : (planB && (planB.direction === 'LONG' || planB.direction === 'BULL'))
            ? `站稳 ${entryB}，3分钟回踩不破 → ${planB.instrument || 'Long Call'}`
            : `等 Gamma 环境翻正后评估`,
        wait_short: isShort
          ? `跌破 ${entryA} 回抽失败 → ${planA.instrument || 'Bear Put Spread'}`
          : (planB && (planB.direction === 'SHORT' || planB.direction === 'BEAR'))
            ? `跌破 ${entryB} 回抽失败 → ${planB.instrument || 'Long Put'}`
            : `等 Flow 确认偏空后评估`,
        forbidden: [
          atmVal != null ? `${fmtLevel(atmVal)} ATM 附近乱买 0DTE` : 'ATM 附近乱买 0DTE',
          pinRisk >= 70 ? 'ATM 吸附风险高，避免单腿裸买' : null,
          callWall != null && putWall != null ? `${fmtLevel(putWall)}–${fmtLevel(callWall)} 中间乱磨` : null
        ].filter(Boolean).join(' | '),
        invalid: [
          planA.invalid || null,
          planB ? (planB.invalid || null) : null
        ].filter(Boolean).join(' | ') || '--',
        target: `${isLong ? 'Call' : 'Put'}：${tp1A} → ${tp2A}`
      };
    }
    return {
      now: '不追 Call，不追 Put',
      wait_long: callWall != null ? `站稳 ${fmtLevel(spot != null ? spot + 10 : callWall - 20)}，站稳 ${fmtLevel(spot != null ? spot + 15 : callWall - 15)}，3分钟回踩不破 → 短 Call` : '等 Call Wall 数据',
      wait_short: putWall != null ? `跌破 ${fmtLevel(spot != null ? spot - 10 : putWall + 20)}，5分钟收不回 → Put` : '等 Put Wall 数据',
      forbidden: atmVal != null ? `${fmtLevel(atmVal)} ATM 附近乱买 0DTE` : 'ATM 附近乱买 0DTE',
      invalid: callWall != null ? `Put 站稳 ${fmtLevel(callWall)} 失效 | Call 跌回 ${fmtLevel(putWall)} 失效` : '--',
      target: callWall != null && putWall != null ? `Put：${fmtLevel(putWall)} → ${fmtLevel(putWall - 10)} | Call：${fmtLevel(callWall)} → ${fmtLevel(callWall + 10)}` : '--'
    };
  }

  const d = buildDirective();
  const badgeStatus = status === 'ready' ? 'blue' : status === 'blocked' ? 'red' : 'amber';
  const badgeLabel  = status === 'ready' ? '预案就绪' : status === 'blocked' ? '执行锁定' : '等待确认';

  return `
    <div class="hud-zone command-generator">
      <div class="hud-zone-header">
        <div class="hud-zone-title">
          <span class="hud-zone-number">ZONE 04</span>
          <span class="hud-zone-name">执行指令</span>
        </div>
        <span class="hud-zone-badge ${badgeStatus}">${badgeLabel}</span>
      </div>
      ${atm.pin_risk >= 70 ? `<div class="pin-warning-banner"><span class="pin-warning-text">⚠ ATM 吸附风险 ${atm.pin_risk}/100 — 避免单腿裸买</span></div>` : ''}
      <div class="directive-grid">
        <div class="directive-row now">
          <span class="directive-key">现在</span>
          <span class="directive-val">${d.now}</span>
        </div>
        <div class="directive-row wait-long">
          <span class="directive-key">等多</span>
          <span class="directive-val">${d.wait_long}</span>
        </div>
        <div class="directive-row wait-short">
          <span class="directive-key">等空</span>
          <span class="directive-val">${d.wait_short}</span>
        </div>
        <div class="directive-row forbidden">
          <span class="directive-key">禁做</span>
          <span class="directive-val">${d.forbidden}</span>
        </div>
        <div class="directive-row invalid">
          <span class="directive-key">失效</span>
          <span class="directive-val">${d.invalid}</span>
        </div>
        <div class="directive-row target">
          <span class="directive-key">目标</span>
          <span class="directive-val">${d.target}</span>
        </div>
      </div>
      <div class="confidence-row">
        <span class="confidence-label">执行置信度</span>
        <div class="confidence-bar-wrap"><div class="confidence-bar-fill ${confClass}" style="width:${confidence}%"></div></div>
        <span class="confidence-value">${confidence}/100</span>
      </div>
    </div>
  `;
}

// HUD Price Strip
function renderHudPriceStrip(signal) {
  const pc = signal.price_contract || {};
  const obs = signal.observation_price || {};
  const dc = signal.data_clock || {};
  const sd = signal.source_display || {};
  const spot = pc.live_price != null ? pc.live_price : (obs.value != null ? obs.value : null);
  const sourceClass = pc.source === 'fmp' ? 'real' : (pc.is_degraded ? 'degraded' : 'mock');
  const sourceLabel = pc.source_label || pc.source || '--';
  const uwStatus = (sd.uw && sd.uw.status) ? sd.uw.status : 'unknown';
  const clockDotClass = uwStatus === 'live' ? '' : (uwStatus === 'partial' ? 'stale' : 'offline');
  const fmpAudit = signal.fmp_price_audit || {};
  const dayChange = fmpAudit.day_change != null ? fmpAudit.day_change : null;
  const dayChangePct = fmpAudit.day_change_percent != null ? fmpAudit.day_change_percent : null;
  const changeClass = dayChange == null ? 'flat' : (dayChange > 0 ? 'up' : (dayChange < 0 ? 'down' : 'flat'));
  const changeStr = dayChange != null
    ? `${dayChange > 0 ? '+' : ''}${Number(dayChange).toFixed(2)} (${dayChangePct != null ? (dayChangePct > 0 ? '+' : '') + Number(dayChangePct).toFixed(2) + '%' : ''})`
    : '--';
  return `
    <div class="hud-price-strip">
      <div>
        <div class="hud-price-label">SPX 现价</div>
        <div class="hud-price-main">${spot != null ? Number(spot).toFixed(2) : '--'}</div>
      </div>
      <div class="hud-price-change ${changeClass}">${changeStr}</div>
      <div class="hud-price-divider"></div>
      <div class="hud-price-meta">
        <div class="hud-price-source ${sourceClass}">价格来源: ${sourceLabel}</div>
        <div style="font-size:10px;color:var(--ink-4)">${pc.is_degraded ? '⚠ 价格降级' : (pc.is_contaminated ? '⚠ 价格受污染' : '价格有效')}</div>
      </div>
      <div class="hud-price-divider"></div>
      <div class="hud-price-meta">
        <div>UW: <span class="hud-price-source ${uwStatus === 'live' ? 'real' : (uwStatus === 'partial' ? 'mock' : 'degraded')}">${uwStatus}</span></div>
        <div style="font-size:10px;color:var(--ink-4)">FMP: ${(sd.fmp && sd.fmp.status) ? sd.fmp.status : '--'}</div>
      </div>
      <div class="hud-data-clock">
        <div class="hud-data-clock-dot ${clockDotClass}"></div>
        <span>${shortTime(dc.now)}</span>
      </div>
    </div>
  `;
}


/* ═══════════════════════════════════════════════════════════════════════════
   TOP COMMAND STRIP — One-line master directive
   ═══════════════════════════════════════════════════════════════════════════ */
function renderTopCommandStrip(signal) {
  const ab = signal.ab_order_engine || {};
  const gr = signal.gamma_regime_engine || {};
  const atm = signal.atm_engine || {};
  const fb = signal.flow_behavior_engine || {};
  const pc = signal.price_contract || {};
  const spot = pc.live_price != null ? pc.live_price : null;
  const atmVal = atm.atm != null ? atm.atm : null;
  const regime = gr.gamma_regime || 'unknown';
  const behavior = fb.behavior || 'neutral';
  const status = ab.status || 'waiting';

  const regimeCn = { positive: '正 Gamma 绞肉', negative: '负 Gamma 放波', transitional: 'Gamma 过渡区', unknown: 'Gamma 待确认' }[regime] || regime;
  const behaviorCn = { call_effective: 'Call 有效流入', put_effective: 'Put 有效流入', put_squeezed: 'Put 被绞', call_capped: 'Call 被压', neutral: '资金中性' }[behavior] || behavior;

  let directive = '';
  if (status === 'blocked' || (ab.execution_confidence != null && ab.execution_confidence < 20)) {
    directive = `数据不足，禁止开仓`;
  } else if (ab.plan_a && ab.plan_a.entry) {
    const dir = ab.plan_a.direction === 'LONG' || ab.plan_a.direction === 'BULL' ? '等多' : '等空';
    directive = `${dir} ${ab.plan_a.entry} 确认 → ${ab.plan_a.instrument || '待定'}`;
  } else {
    directive = `不追，等 ${atmVal != null ? fmtLevel(atmVal) + ' 站稳或跌破' : '关键位确认'}`;
  }

  const stripClass = status === 'ready' ? 'ready' : status === 'blocked' ? 'blocked' : 'waiting';

  return `
    <div class="top-command-strip ${stripClass}">
      <span class="top-command-regime">${regimeCn}</span>
      <span class="top-command-sep">｜</span>
      <span class="top-command-atm">盘眼 ${atmVal != null ? fmtLevel(atmVal) : '--'}</span>
      <span class="top-command-sep">｜</span>
      <span class="top-command-flow">${behaviorCn}</span>
      <span class="top-command-sep">｜</span>
      <span class="top-command-directive">${directive}</span>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   VOLATILITY DASHBOARD — VIX + IV + HV gauge
   ═══════════════════════════════════════════════════════════════════════════ */
function renderVolatilityDashboard(signal) {
  const vol = signal.volatility_dashboard || {};
  const vix = vol.vix != null ? vol.vix : null;
  const iv30 = vol.iv30 != null ? vol.iv30 : null;
  const hv20 = vol.hv20 != null ? vol.hv20 : null;
  const vscore = vol.vscore != null ? vol.vscore : null;
  const volRegime = vol.regime || 'unknown';
  const volLabel = { low: '低波动', normal: '正常波动', elevated: '波动升温', high: '高波动', extreme: '极端波动', unknown: '数据待接入' }[volRegime] || volRegime;
  const volClass = { low: 'low', normal: 'normal', elevated: 'elevated', high: 'high', extreme: 'extreme', unknown: 'unknown' }[volRegime] || 'unknown';

  // VIX gauge: 0-20 low, 20-30 normal, 30-40 elevated, 40+ high
  function vixGauge(v) {
    if (v == null) return '<div class="vol-gauge-empty">--</div>';
    const pct = Math.min(100, (v / 50) * 100);
    const cls = v < 15 ? 'low' : v < 20 ? 'normal' : v < 30 ? 'elevated' : v < 40 ? 'high' : 'extreme';
    return `<div class="vol-gauge-bar"><div class="vol-gauge-fill ${cls}" style="width:${pct}%"></div></div>`;
  }

  function ivRatio(iv, hv) {
    if (iv == null || hv == null || hv === 0) return null;
    return (iv / hv).toFixed(2);
  }

  const ivHvRatio = ivRatio(iv30, hv20);
  const ivHvClass = ivHvRatio == null ? 'neutral' : ivHvRatio > 1.3 ? 'expensive' : ivHvRatio < 0.8 ? 'cheap' : 'fair';
  const ivHvLabel = ivHvRatio == null ? '数据缺失' : ivHvRatio > 1.3 ? '期权偏贵 — 卖权策略占优' : ivHvRatio < 0.8 ? '期权偏便宜 — 买权策略占优' : '期权定价合理';

  return `
    <div class="vol-dashboard">
      <div class="vol-dashboard-header">
        <div class="vol-dashboard-title">
          <span class="vol-dashboard-icon">⚡</span>
          <span>波动率仪表盘</span>
        </div>
        <span class="hud-zone-badge ${volClass}">${volLabel}</span>
      </div>
      <div class="vol-gauge-row">
        <div class="vol-gauge-card">
          <div class="vol-gauge-label">VIX 恐慌指数</div>
          <div class="vol-gauge-value ${vix != null ? (vix < 20 ? 'low' : vix < 30 ? 'elevated' : 'high') : 'unknown'}">${vix != null ? Number(vix).toFixed(1) : '<span class="data-missing">--</span>'}</div>
          ${vixGauge(vix)}
          <div class="vol-gauge-sub">${vix != null ? (vix < 15 ? '市场极度平静' : vix < 20 ? '正常区间' : vix < 30 ? '波动升温' : vix < 40 ? '高度恐慌' : '极端恐慌') : '数据待接入'}</div>
        </div>
        <div class="vol-gauge-card">
          <div class="vol-gauge-label">IV30 隐含波动率</div>
          <div class="vol-gauge-value ${iv30 != null ? 'normal' : 'unknown'}">${iv30 != null ? Number(iv30).toFixed(1) + '%' : '<span class="data-missing">--</span>'}</div>
          <div class="vol-gauge-sub">${iv30 != null ? '30日隐含波动率' : '数据待接入'}</div>
        </div>
        <div class="vol-gauge-card">
          <div class="vol-gauge-label">HV20 历史波动率</div>
          <div class="vol-gauge-value ${hv20 != null ? 'normal' : 'unknown'}">${hv20 != null ? Number(hv20).toFixed(1) + '%' : '<span class="data-missing">--</span>'}</div>
          <div class="vol-gauge-sub">${hv20 != null ? '20日实现波动率' : '数据待接入'}</div>
        </div>
        <div class="vol-gauge-card ${ivHvClass}">
          <div class="vol-gauge-label">IV/HV 期权成本比</div>
          <div class="vol-gauge-value ${ivHvClass}">${ivHvRatio != null ? ivHvRatio : '<span class="data-missing">--</span>'}</div>
          <div class="vol-gauge-sub">${ivHvLabel}</div>
        </div>
      </div>
      ${vscore != null ? `
      <div class="vscore-row">
        <span class="vscore-label">Vscore 综合评分</span>
        <div class="vscore-bar-wrap"><div class="vscore-bar-fill ${volClass}" style="width:${Math.min(100, vscore)}%"></div></div>
        <span class="vscore-value">${vscore}/100</span>
        <span class="vscore-tag">${vscore >= 70 ? '期权成本高，优先价差策略' : vscore >= 40 ? '期权成本适中' : '期权成本低，可考虑裸买'}</span>
      </div>` : `<div class="vscore-row"><span class="vscore-label">Vscore</span><span class="data-missing">公式已准备，等待数据接入</span></div>`}
    </div>
  `;
}

// Main HUD Panel — assembles all four zones
function renderHudPanel(signal) {
  return `
    <div id="sniper-overlay" class="sniper-overlay"></div>
    ${renderHudPriceStrip(signal)}
    <div class="hud-layout">
      ${renderHudZoneGamma(signal)}
      ${renderHudZoneExecution(signal)}
      ${renderHudZoneFlow(signal)}
      ${renderHudZoneCommand(signal)}
    </div>
  `;
}

// ── GEX Urgency Chart (distance-driven, SVG) ─────────────────────────────────
function renderGexUrgencyChart(signal) {
  // diag (uw_wall_diagnostics) removed — Radar-only, not used in this chart
  const dw    = signal.dealer_wall_map || {};  // gex_local_call/put_wall (±30pt)
  const pc    = signal.primary_card || {};
  const spot  = pc.spot != null ? Number(pc.spot) : null;
  // Phase 2 fix: 首页 GEX 图优先读取 dealer_wall_map 近端墙（±500pt），
  // 避免 uw_wall_diagnostics 可能返回远端 strike（如 6850/8000）
  const nearCallW = dw.gex_local_call_wall != null ? Number(dw.gex_local_call_wall) : null;  // ±30pt local only
  const nearPutW  = dw.gex_local_put_wall  != null ? Number(dw.gex_local_put_wall)  : null;  // ±30pt local only
  // AUDIT FIX: No fallback to uw_wall_diagnostics.call_wall — that is a Radar-only field
  const callW = nearCallW;  // gex_local_call_wall only (±30pt)
  const putW  = nearPutW;   // gex_local_put_wall only (±30pt)

  // Gamma labels: not available without uw_wall_diagnostics (Radar-only)
  const callGamma = null;
  const putGamma  = null;
  function fmtGamma(v) {
    if (v == null) return 'N/A';
    const m = v / 1e6;
    return (m >= 0 ? '+' : '') + m.toFixed(1) + 'M';
  }

  const THRESHOLD = 20; // points
  function urgency(wall) {
    if (spot == null || wall == null) return 0;
    const d = Math.abs(spot - wall);
    return Math.max(0, Math.min(1, 1 - d / THRESHOLD));
  }
  function urgencyClass(u) {
    if (u >= 0.75) return 'gex-critical';
    if (u >= 0.5)  return 'gex-high';
    if (u >= 0.25) return 'gex-mid';
    return 'gex-low';
  }
  function distLabel(wall) {
    if (spot == null || wall == null) return '--';
    const d = wall - spot;
    return (d >= 0 ? '+' : '') + d.toFixed(1);
  }
  function urgencyPct(u) { return Math.round(u * 100); }

  const callU = urgency(callW);
  const putU  = urgency(putW);
  const callCls = urgencyClass(callU);
  const putCls  = urgencyClass(putU);

  // SVG bar chart: two bars side by side
  // Bar height proportional to urgency (max 80px)
  const BAR_H = 80;
  const callBarH = Math.round(callU * BAR_H);
  const putBarH  = Math.round(putU  * BAR_H);
  const callBarY = BAR_H - callBarH;
  const putBarY  = BAR_H - putBarH;

  // Color by urgency
  function barColor(u, side) {
    const alpha = 0.4 + u * 0.6;
    if (side === 'call') return `rgba(220,38,38,${alpha.toFixed(2)})`;
    return `rgba(22,163,74,${alpha.toFixed(2)})`;
  }

  const callColor = barColor(callU, 'call');
  const putColor  = barColor(putU,  'put');

  // Spot line Y position (always at bottom of chart area)
  const spotLineY = BAR_H;

  return `
<div class="gex-chart-wrap">
  <div class="gex-chart-title">GEX PROFILE</div>
  <div class="gex-bars-area">
    <!-- PUT WALL bar (left) -->
    <div class="gex-bar-col">
      <div class="gex-bar-label-top ${putCls}">${putW != null ? putW : '--'}</div>
      <div class="gex-bar-outer">
        <div class="gex-bar-fill put-bar ${putCls}" style="height:${putBarH}px;background:${putColor}"></div>
      </div>
      <div class="gex-bar-label-bottom">Put Wall</div>
    </div>
    <!-- SPOT indicator (center) -->
    <div class="gex-spot-col">
      <div class="gex-spot-badge">${spot != null ? spot.toFixed(0) : '--'}</div>
      <div class="gex-spot-label">SPX</div>
    </div>
    <!-- CALL WALL bar (right) -->
    <div class="gex-bar-col">
      <div class="gex-bar-label-top ${callCls}">${callW != null ? callW : '--'}</div>
      <div class="gex-bar-outer">
        <div class="gex-bar-fill call-bar ${callCls}" style="height:${callBarH}px;background:${callColor}"></div>
      </div>
      <div class="gex-bar-label-bottom">Call Wall</div>
    </div>
  </div>
  <!-- Stats row -->
  <div class="gex-stats-row">
    <div class="gex-stat put-stat">
      <span class="gex-stat-dist ${putCls}">${distLabel(putW)}</span>
      <span class="gex-stat-pct">${urgencyPct(putU)}% 紧迫</span>
      <span class="gex-stat-gamma">γ ${fmtGamma(putGamma)}</span>
    </div>
    <div class="gex-stat-sep"></div>
    <div class="gex-stat call-stat">
      <span class="gex-stat-dist ${callCls}">${distLabel(callW)}</span>
      <span class="gex-stat-pct">${urgencyPct(callU)}% 紧迫</span>
      <span class="gex-stat-gamma">γ ${fmtGamma(callGamma)}</span>
    </div>
  </div>
  ${callU >= 0.75 ? '<div class="gex-alert call-alert">⚠ 贴 Call Wall，追多风险高</div>' : ''}
  ${putU  >= 0.75 ? '<div class="gex-alert put-alert">⚠ 贴 Put Wall，追空容易被托</div>' : ''}
</div>`;
}


// ── renderPlanCard: 渲染单个方向预案卡片（主做/备选 Tab 使用）────────────────────
function renderPlanCard(plan, label, triggerStatus, abStatus, planState) {
  if (!plan) return '<div class="ab-void-block"><div class="ab-void-icon">○</div><div class="ab-void-title">暂无预案</div></div>';
  const isBull = (plan.direction || '').toUpperCase() === 'BULLISH' || (plan.direction || '').toUpperCase() === 'LONG';
  const isBear = (plan.direction || '').toUpperCase() === 'BEARISH' || (plan.direction || '').toUpperCase() === 'SHORT';
  // 三态颜色：ready=绿色，pending=黄色，void/其他=灰色
  const _state = planState || (abStatus === 'blocked' || abStatus === 'wait' ? 'pending' : 'ready');
  let colorCls, iconCls;
  if (_state === 'ready') {
    colorCls = isBull ? 'plan-bull' : isBear ? 'plan-bear' : 'plan-locked';
    iconCls  = isBull ? 'bull' : isBear ? 'bear' : '';
  } else if (_state === 'pending') {
    colorCls = isBull ? 'plan-pending-bull' : isBear ? 'plan-pending-bear' : 'plan-pending';
    iconCls  = isBull ? 'bull-pending' : isBear ? 'bear-pending' : '';
  } else {
    colorCls = 'plan-void';
    iconCls  = '';
  }
  const waitLine = isBull
    ? (plan.wait_long  || plan.action_now || '--')
    : isBear
    ? (plan.wait_short || plan.action_now || '--')
    : (plan.action_now || '--');
  const doNotList = Array.isArray(plan.do_not) ? plan.do_not : [];
  const confVal = plan.execution_confidence ?? null;
  const confCls = confVal != null ? (confVal >= 70 ? 'conf-high' : confVal >= 40 ? 'conf-mid' : 'conf-low') : 'conf-low';
  // 可信度标签：PENDING 时不显示"可执行"
  const confLbl = _state === 'pending'
    ? (confVal != null ? (confVal >= 70 ? '高可信，等触发' : confVal >= 40 ? '中可信，等确认' : '低可信，只观察') : '只观察')
    : (confVal != null ? (confVal >= 70 ? '高可信，可执行' : confVal >= 40 ? '中可信，小仓等确认' : '低可信，只观察') : '低可信，只观察');
  // 状态标签
  const stateTag = _state === 'ready'
    ? '<span class="plan-state-tag plan-state-ready">● 可执行</span>'
    : _state === 'pending'
    ? '<span class="plan-state-tag plan-state-pending">● 等触发</span>'
    : '';
  return `<div class="plan-grid ${colorCls}">
    <div class="plan-row"><span class="plan-icon ${iconCls}">◎</span><span class="plan-key">方向</span><span class="plan-val ${iconCls}">${escapeHtml(label)}${stateTag}</span></div>
    <div class="plan-row"><span class="plan-icon">◈</span><span class="plan-key">品种</span><span class="plan-val">${escapeHtml(plan.instrument || '--')}</span></div>
    <div class="plan-row"><span class="plan-icon">⊕</span><span class="plan-key">等什么</span><span class="plan-val entry-val">${escapeHtml(waitLine)}</span></div>
    <div class="plan-row"><span class="plan-icon">◆</span><span class="plan-key">目标</span><span class="plan-val target-val">${escapeHtml(plan.tp1 || '--')} → ${escapeHtml(plan.tp2 || '--')}</span></div>
    <div class="plan-row"><span class="plan-icon">⊗</span><span class="plan-key">失效</span><span class="plan-val stop-val">${escapeHtml(plan.invalidation || '--')}</span></div>
    <div class="plan-row full-row"><span class="plan-icon">⊘</span><span class="plan-key">禁做</span><span class="plan-val forbidden-val">${escapeHtml(plan.forbidden || '--')}</span></div>
    ${plan.rationale ? `<div class="plan-row full-row"><span class="plan-icon">ℹ</span><span class="plan-key">逻辑</span><span class="plan-val">${escapeHtml(plan.rationale)}</span></div>` : ''}
    ${doNotList.length > 0 ? `<div class="plan-row full-row"><span class="plan-icon">🚫</span><span class="plan-key">不做</span><span class="plan-val forbidden-val">${escapeHtml(doNotList.slice(0,2).join('；'))}</span></div>` : ''}
  </div>
  ${confVal != null ? `<div class="plan-conf-row"><span class="plan-conf-label">可信度</span><span class="plan-conf-val ${confCls}">${confVal}/100</span><span class="plan-conf-desc ${confCls}">${confLbl}</span></div>` : ''}`;
}
function renderHome(signal) {
  const pc  = signal.primary_card  || {};
  const sb  = signal.sentiment_bar || {};
  const lv  = signal.levels        || {};
  const mr  = signal.money_read    || {}; // [legacy] 仅供 mm_path_card 使用，资金分析已迁移到 capital_flow
  const dr  = signal.darkpool_read || {};
  const vd  = signal.vol_dashboard || {};
  const vx  = signal.vix_dashboard || {};
  const fb  = signal.forbidden_bar || {};
  const dh  = signal.data_health   || {};

  const spot       = pc.spot;
  const spotFmt    = spot != null ? Number(spot).toFixed(1) : '--';
  const dirColor   = pc.direction === 'LONG_CALL' ? 'bullish' : pc.direction === 'SHORT_PUT' ? 'bearish' : 'locked';
  const dirLabel   = pc.direction_label || '锁仓';
  const badge      = pc.badge || 'LOCKED';
  const headline   = pc.headline || '--';
  const subHead    = pc.sub_headline || '';
  const locked     = pc.locked === true;
  const uwLive     = pc.uw_live === true;
  // v3 fix: last_updated is on signal root, not price_contract
  const _lu = signal.last_updated || {};
  const lastUpd = _lu.uw ? shortTime(_lu.uw) : (_lu.fmp ? shortTime(_lu.fmp) : '--');

  // Sentiment bar
  const sentScore  = sb.score ?? 50;
  const sentLabel  = sb.label || '中性';
  const sentSub    = sb.sub   || '';
  const pcRatio    = sb.put_call_ratio != null ? sb.put_call_ratio.toFixed(2) : '--';
  const netPremFmt = ((signal.home_view_model || {}).order_plan || {}).capital_flow?.net_premium_fmt || mr.net_premium_fmt || '--'; // [v2] 优先读 capital_flow

  // ── home_view_model: 首页唯一数据源 ─────────────────────────────────────────
  // renderHome 只读 signal.home_view_model，禁止直接读 engine 字段
  const hvm = signal.home_view_model || {};
  const hvmAtm  = hvm.atm_execution          || {};
  const hvmFlow = hvm.flow                   || {};
  const hvmFt   = hvm.final_text             || {};
  const hvmSt   = hvm.status                 || {};
  const hvmGex  = hvm.gex_local_reference    || {};
  const hvmFar  = hvm.gex_far_background_note || {};
  const hvmGuards = hvm.guards               || {};

  // Key levels — v2: ATM trigger lines from home_view_model.atm_execution
  const atmFmt     = hvmAtm.atm_fmt     || lv.atm_fmt || '--';
  // Near trigger lines (ATM±5/10) — homepage primary (from home_view_model)
  // ATM diagnostics: from home_view_model.atm_execution.unavailable_reason
  const _atmMissing  = !hvmAtm.available;
  const _atmDiag = hvmAtm.unavailable_reason === 'SPOT_MISSING'
    ? '价格未接入（非交易时段或数据源离线）'
    : hvmAtm.unavailable_reason === 'ATM_ROUNDING_FAILED'
    ? 'ATM 计算失败（spot 存在但 ATM 未生成）'
    : '触发线映射失败';
  const bull1Fmt   = lv.bull_trigger_fmt   || pc.bull_trigger_1_fmt || null;
  const bull2Fmt   = lv.bull_trigger_2_fmt || pc.bull_trigger_2_fmt || '--';
  const bear1Fmt   = lv.bear_trigger_fmt   || pc.bear_trigger_1_fmt || null;
  const bear2Fmt   = lv.bear_trigger_2_fmt || pc.bear_trigger_2_fmt || '--';
  // If trigger lines missing, use price_contract.atm_5 as last-resort display fallback
  const _pc2 = signal.price_contract || {};
  const _atm5 = _pc2.atm_5 ?? null;
  const _bull1Display = bull1Fmt ?? (_atm5 != null ? String(_atm5 + 5) : null);
  const _bear1Display = bear1Fmt ?? (_atm5 != null ? String(_atm5 - 5) : null);
  const _bull2Display = bull2Fmt !== '--' ? bull2Fmt : (_atm5 != null ? String(_atm5 + 10) : '--');
  const _bear2Display = bear2Fmt !== '--' ? bear2Fmt : (_atm5 != null ? String(_atm5 - 10) : '--');
  const bullTgt1Fmt = lv.bull_target_1_fmt || pc.bull_target_1_fmt || '--';
  const bullTgt2Fmt = lv.bull_target_2_fmt || pc.bull_target_2_fmt || '--';
  const bearTgt1Fmt = lv.bear_target_1_fmt || pc.bear_target_1_fmt || '--';
  const bearTgt2Fmt = lv.bear_target_2_fmt || pc.bear_target_2_fmt || '--';
  const invBullFmt  = lv.invalidation_bull_fmt || pc.invalidation_bull_fmt || '--';
  const invBearFmt  = lv.invalidation_bear_fmt || pc.invalidation_bear_fmt || '--';
  const _invBullDisplay = invBullFmt !== '--' ? invBullFmt : (_atm5 != null ? String(_atm5 - 10) : '--');
  const _invBearDisplay = invBearFmt !== '--' ? invBearFmt : (_atm5 != null ? String(_atm5 + 10) : '--');
  const spotInLock  = lv.spot_in_lock_zone ?? pc.spot_in_lock_zone ?? true;
  const triggerStatus = lv.trigger_status || pc.trigger_status || 'locked';
  const triggerLabel  = lv.trigger_label  || pc.trigger_label  || null;
  // Far walls (Radar only — NOT homepage triggers)
  const farCallFmt = lv.global_call_wall_fmt || pc.global_call_wall_fmt || '--';
  const farPutFmt  = lv.global_put_wall_fmt  || pc.global_put_wall_fmt  || '--';
  // Legacy fields (kept for backward compat)
  const bullFmt    = bull1Fmt;
  const bearFmt    = bear1Fmt;
  const ldFmt      = lv.life_death_fmt    || '--';
  const flipDisp   = lv.gamma_flip_display || '翻转点不可判断';
  const wallStatus = lv.wall_status || 'unavailable';
  const pinWarn    = lv.pin_warning;
  const hint       = lv.hint || '';
  // Flow dual window (5m+15m) — from home_view_model.flow
  // [HVM] ate/fb2 raw reads replaced by home_view_model.flow
  const flow5mLabel   = hvmFlow.flow_5m   || null;
  const flow15mLabel  = hvmFlow.flow_15m  || null;
  const dualNarrative = hvmFlow.dual_window_narrative || null;
  const dualAligned   = hvmFlow.dual_window_aligned ?? false;

  // Plan lines — v2: Three-state LONG_CALL / SHORT_PUT / LOCKED
  // LOCKED state shows ATM±5/10 trigger lines with three-stage intraday plan
  const plan = hvm.plan || pc.plan;
  // [HVM] ab_order_engine raw reads replaced by home_view_model.status
  const abConf      = hvmSt.confidence   ?? 0;
  const confColor   = hvmSt.confidence_color || 'conf-low';
  const confLabel   = hvmSt.confidence_label || '低可信，只观察';
  const abBlocked   = !hvm.status?.allow_trade;
  const blockedReason = hvmSt.blocked_reason || '等待条件满足';
  const planData = plan || (ab.plan_a ?? ab.plan_b ?? null);

  // [HVM] ATM 执行线从 home_view_model.atm_execution 读取
  const _b1 = hvmAtm.bull_trigger_fmt !== '待接入' ? hvmAtm.bull_trigger_fmt : '--';
  const _b2 = hvmAtm.bull_confirm_fmt  || '--';
  const _r1 = hvmAtm.bear_trigger_fmt !== '待接入' ? hvmAtm.bear_trigger_fmt : '--';
  const _r2 = hvmAtm.bear_confirm_fmt  || '--';
  const _invBull = hvmAtm.invalid_long_fmt  || '--';
  const _invBear = hvmAtm.invalid_short_fmt || '--';

    // ── LOCKED state: show full ATM trigger observation plan ─────────────────
  let planLines = '';
  if (pc.direction === 'LONG_CALL') {
    // LONG_CALL: show bull execution plan
    planLines = planData ? `
    <div class="plan-grid plan-bull">
      <div class="plan-row"><span class="plan-icon bull">◎</span><span class="plan-key">当前建议</span><span class="plan-val bull">${escapeHtml(planData.state ?? '多头预案')}</span></div>
      <div class="plan-row"><span class="plan-icon">◈</span><span class="plan-key">为什么</span><span class="plan-val">${escapeHtml(planData.why ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">⊕</span><span class="plan-key">进场</span><span class="plan-val entry-val">${escapeHtml(planData.entry ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">◆</span><span class="plan-key">做什么</span><span class="plan-val action-val">${escapeHtml(planData.action ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">⊗</span><span class="plan-key">止损</span><span class="plan-val stop-val">${escapeHtml(planData.stop ?? planData.invalidation ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">◎</span><span class="plan-key">目标</span><span class="plan-val target-val">${escapeHtml(planData.target ?? '--')}</span></div>
      <div class="plan-row full-row"><span class="plan-icon">⊘</span><span class="plan-key">禁做</span><span class="plan-val forbidden-val">${escapeHtml(planData.forbidden ?? '--')}</span></div>
    </div>
    <div class="plan-conf-row">
      <span class="plan-conf-label">可信度</span>
      <span class="plan-conf-val ${confColor}">${abConf}/100</span>
      <span class="plan-conf-desc ${confColor}">${confLabel}</span>
    </div>` : `<div class="plan-locked-msg">多头预案数据不足</div>`;
  } else if (pc.direction === 'SHORT_PUT') {
    // SHORT_PUT: show bear execution plan
    planLines = planData ? `
    <div class="plan-grid plan-bear">
      <div class="plan-row"><span class="plan-icon bear">◎</span><span class="plan-key">当前建议</span><span class="plan-val bear">${escapeHtml(planData.state ?? '空头预案')}</span></div>
      <div class="plan-row"><span class="plan-icon">◈</span><span class="plan-key">为什么</span><span class="plan-val">${escapeHtml(planData.why ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">⊕</span><span class="plan-key">进场</span><span class="plan-val entry-val">${escapeHtml(planData.entry ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">◆</span><span class="plan-key">做什么</span><span class="plan-val action-val">${escapeHtml(planData.action ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">⊗</span><span class="plan-key">止损</span><span class="plan-val stop-val">${escapeHtml(planData.stop ?? planData.invalidation ?? '--')}</span></div>
      <div class="plan-row"><span class="plan-icon">◎</span><span class="plan-key">目标</span><span class="plan-val target-val">${escapeHtml(planData.target ?? '--')}</span></div>
      <div class="plan-row full-row"><span class="plan-icon">⊘</span><span class="plan-key">禁做</span><span class="plan-val forbidden-val">${escapeHtml(planData.forbidden ?? '--')}</span></div>
    </div>
    <div class="plan-conf-row">
      <span class="plan-conf-label">可信度</span>
      <span class="plan-conf-val ${confColor}">${abConf}/100</span>
      <span class="plan-conf-desc ${confColor}">${confLabel}</span>
    </div>` : `<div class="plan-locked-msg">空头预案数据不足</div>`;
  } else {
    // LOCKED: show full ATM trigger observation plan (three-stage)
    // Use display fallbacks so LOCKED state always shows ATM observation lines
    const _b1 = _bull1Display ?? '待接入';
    const _r1 = _bear1Display ?? '待接入';
    const _b2 = _bull2Display !== '--' ? _bull2Display : (_atm5 != null ? String(_atm5 + 10) : '--');
    const _r2 = _bear2Display !== '--' ? _bear2Display : (_atm5 != null ? String(_atm5 - 10) : '--');
    const _invB = _invBullDisplay !== '--' ? _invBullDisplay : (_atm5 != null ? String(_atm5 - 10) : '--');
    const _invR = _invBearDisplay !== '--' ? _invBearDisplay : (_atm5 != null ? String(_atm5 + 10) : '--');
    const _atmDiagNote = (_bull1Display == null && _atm5 == null)
      ? `<div class="atm-diag-note">⚠ ATM 触发线缺失：${escapeHtml(_atmDiag)}</div>` : '';
    const lockWhy = planData?.why ?? (spotInLock
      ? `价格在 ${_r1}–${_b1} ATM 锁仓区内，正 Gamma 磁吸，来回割。`
      : `等 ${_b1} 站稳或 ${_r1} 跌破`);
    planLines = `
    ${_atmDiagNote}
    <div class="plan-grid plan-locked">
      <div class="plan-row"><span class="plan-icon">◎</span><span class="plan-key">当前建议</span><span class="plan-val locked-val">锁仓观察</span></div>
      <div class="plan-row"><span class="plan-icon">◈</span><span class="plan-key">为什么</span><span class="plan-val">${escapeHtml(lockWhy)}</span></div>
      <div class="plan-row"><span class="plan-icon">👁</span><span class="plan-key">观察</span><span class="plan-val">${escapeHtml(planData?.watch ?? `上方 ${_b1} 能不能站稳 / 下方 ${_r1} 能不能跌破`)}</span></div>
      <div class="plan-row full-row atm-trigger-row">
        <span class="plan-icon bull">↗</span>
        <span class="plan-key">转多条件</span>
        <span class="plan-val bull-cond">${escapeHtml(planData?.wait_long ?? `站稳 ${_b1}（第一触发），等 ${_b2} 确认，目标 ${bullTgt1Fmt !== '--' ? bullTgt1Fmt : (_atm5 != null ? String(_atm5 + 15) : '--')}–${bullTgt2Fmt !== '--' ? bullTgt2Fmt : (_atm5 != null ? String(_atm5 + 20) : '--')}`)}</span>
      </div>
      <div class="plan-row full-row atm-trigger-row">
        <span class="plan-icon bear">↘</span>
        <span class="plan-key">转空条件</span>
        <span class="plan-val bear-cond">${escapeHtml(planData?.wait_short ?? `跌破 ${_r1}（第一触发），等 ${_r2} 确认，目标 ${bearTgt1Fmt !== '--' ? bearTgt1Fmt : (_atm5 != null ? String(_atm5 - 15) : '--')}–${bearTgt2Fmt !== '--' ? bearTgt2Fmt : (_atm5 != null ? String(_atm5 - 20) : '--')}`)}</span>
      </div>
      <div class="plan-row full-row"><span class="plan-icon">⊘</span><span class="plan-key">禁做</span><span class="plan-val forbidden-val">${escapeHtml(planData?.forbidden ?? `${_r1}–${_b1} ATM 锁仓区内禁止买 Call / Put`)}</span></div>
      <div class="plan-row full-row"><span class="plan-icon">⊗</span><span class="plan-key">失效线</span><span class="plan-val stop-val">${escapeHtml(planData?.invalidation ?? `多头失效 ${_invB} / 空头失效 ${_invR}`)}</span></div>
    </div>
    <div class="plan-conf-row">
      <span class="plan-conf-label">可信度</span>
      <span class="plan-conf-val ${confColor}">${abConf}/100</span>
      <span class="plan-conf-desc ${confColor}">${confLabel}</span>
    </div>
    ${abBlocked ? `<div class="plan-locked-banner">${escapeHtml(blockedReason)}</div>` : ''}`;
  }

  // Darkpool levels — 使用 pos_desc 和 is_above_spot
  const dpLevels = (dr.levels || []).slice(0, 2).map((l) => {
    const tagClass = l.is_above_spot ? 'bearish' : 'bullish';
    const desc = l.pos_desc || l.label || '--';
    return `<div class="dp-level-row"><span class="dp-level-num">${escapeHtml(l.level_fmt)}</span><span class="dp-level-prem">${escapeHtml(l.premium_fmt)}</span><span class="dp-level-tag ${tagClass}">${escapeHtml(desc)}</span></div>`;
  }).join('');

  // IV gauge needle (0-100%)
  const ivRankVal  = vd.iv_rank ?? 0;
  const ivNeedlePct = Math.min(100, ivRankVal);
  const iv30Fmt    = vd.iv30_fmt || '--';
  const ivRankFmt  = vd.iv_rank_fmt || '--';
  const buyerRisk  = vd.buyer_risk || '--';
  const buyerColor = vd.buyer_risk_color || 'gray';
  const volComment = vd.commentary || '--';

  // VIX gauge
  const vixVal     = vx.vix;
  const vixFmt     = vx.vix_fmt || '--';
  const vixSent    = vx.risk_sentiment || '正常';
  const vixColor   = vx.risk_color || 'green';
  const vixComment = vx.commentary || '--';
  const vixNeedle  = vixVal != null ? Math.min(100, (vixVal / 50) * 100) : 0;

  // Forbidden bar
  const hasForbidden = fb.has_warning === true;
  const forbidMsg    = fb.primary_warning || '';

  // Data health for topbar indicator
  const dhScore = dh.score ?? 0;

  return `
    <main class="page home-v2">
      <!-- TOP HEADER STRIP -->
      <header class="home-header">
        <div class="home-header-left">
          <div class="home-bear-icon ${dirColor}">🐻</div>
          <div class="home-title-block">
            <div class="home-headline">
              <span class="home-spot">SPX ${escapeHtml(spotFmt)}</span>
              <span class="home-sep">｜</span>
              <span class="home-direction ${dirColor}">${escapeHtml(dirLabel)}</span>
              ${badge !== 'LOCKED' ? `<span class="home-sep">｜</span><span class="home-badge ${dirColor}">${escapeHtml(badge === 'LONG_CALL' ? '做 Call' : '做 Put')}</span>` : ''}
            </div>
            <div class="home-subhead">${escapeHtml(subHead || headline)}</div>
          </div>
        </div>
        <div class="home-header-right">
          <span class="uw-status-dot ${uwLive ? 'live' : 'stale'}"></span>
          <span class="uw-status-label">${uwLive ? 'UW 实时' : 'UW 非实时'}</span>
          <span class="home-update-time">更新 ${escapeHtml(lastUpd)}</span>
        </div>
      </header>

      <!-- SENTIMENT BAR -->
      <section class="sentiment-section">
        <div class="sentiment-bar-wrap">
          <span class="sentiment-label-left">跌 (空头)</span>
          <div class="sentiment-track">
            <div class="sentiment-fill" style="width:${sentScore}%"></div>
            <div class="sentiment-thumb" style="left:${sentScore}%">
              <span class="sentiment-score">${sentScore}</span>
            </div>
          </div>
          <span class="sentiment-label-right">涨 (多头)</span>
        </div>
        <div class="sentiment-right">
          <div class="sentiment-score-big ${sentScore >= 60 ? 'bullish' : sentScore <= 40 ? 'bearish' : 'neutral'}">${sentScore >= 60 ? '偏多' : sentScore <= 40 ? '偏空' : '中性'} ${sentScore}/100</div>
          <div class="sentiment-sub">${escapeHtml(sentSub)}</div>
        </div>
      </section>

      <!-- MAIN CONTENT GRID -->
      <div class="home-grid">
        <!-- LEFT: Primary Card (two-column: GEX chart + signal content) -->
        <section class="primary-card ${dirColor}">
          <div class="primary-card-header">
            <div class="primary-card-icon ${dirColor}">🎯</div>
            <div class="primary-card-title">主控卡片 ｜ ${escapeHtml(badge === 'LONG_CALL' ? 'CALL' : badge === 'SHORT_PUT' ? 'PUT' : 'LOCKED')}</div>
          </div>
          <div class="primary-card-body">
            <div class="primary-card-signal">
              ${planLines}
              <!-- THREE-TAB PANEL: 盘眼 / 主做 / 备选 -->
              ${(() => {
                // [HVM] Tab 面板只读 home_view_model，禁止直接读 engine 字段
                const planA2    = hvm.plan_a || null;
                const planB2    = hvm.plan_b || null;
                const abStatus2 = hvmSt.raw_status || 'blocked';
                const abConf3   = hvmSt.confidence ?? 0;
                const abScenario2 = hvmSt.scenario || null;
                const trigStat3 = hvmAtm.trigger_status || 'locked';
                const dirA2 = planA2 ? (planA2.direction || 'WAIT').toUpperCase() : 'WAIT';
                const dirB2 = planB2 ? (planB2.direction || 'WAIT').toUpperCase() : 'WAIT';
                const aIsBull2 = dirA2 === 'BULLISH' || dirA2 === 'LONG';
                const aIsBear2 = dirA2 === 'BEARISH' || dirA2 === 'SHORT';
                const bIsBull2 = dirB2 === 'BULLISH' || dirB2 === 'LONG';
                const bIsBear2 = dirB2 === 'BEARISH' || dirB2 === 'SHORT';
                const isOpposite2 = planA2 && planB2 && ((aIsBull2 && bIsBear2) || (aIsBear2 && bIsBull2));
                const confCls3 = abConf3 >= 70 ? 'conf-high' : abConf3 >= 40 ? 'conf-mid' : 'conf-low';
                // [HVM] LOCKED 时禁止"小仓等确认"
                const _isLocked3 = abStatus2 === 'blocked' || abStatus2 === 'wait';
                const confLbl3 = _isLocked3
                  ? (abConf3 >= 70 ? '高可信，仅观察' : abConf3 >= 40 ? '中可信，仅观察' : '低可信，只观察')
                  : (abConf3 >= 70 ? '高可信，可执行' : abConf3 >= 40 ? '中可信，小仓等确认' : '低可信，只观察');
                const sceneMap2 = {
                  'positive_put_squeezed':  '底部背离',
                  'negative_put_effective': '空头动能',
                  'positive_call_capped':   '震荡夹击',
                  'negative_call_effective':'多头突破',
                  'positive_call_effective':'正Gamma突破',
                  'negative_put_squeezed':  '空头陷阱'
                };
                const sceneLabel2 = abScenario2 ? (sceneMap2[abScenario2] || abScenario2) : null;

                // Tab 1: 盘眼
                const tab1Html =
                  '<div class="ptab-pane" id="ptab-pane-eye">' +
                    '<div class="ptab-atm-row">' +
                      '<span class="ptab-atm-icon">👁</span>' +
                      '<span class="ptab-atm-label">盘眼 ATM</span>' +
                      '<span class="ptab-atm-val">' + escapeHtml(atmFmt) + '</span>' +
                      (spotInLock ? '<span class="kl-lock-badge">锁仓区</span>' : '') +
                      (sceneLabel2 ? '<span class="kl-scene-tag">' + escapeHtml(sceneLabel2) + '</span>' : '') +
                    '</div>' +
                    '<div class="ptab-conf-row">' +
                      '<span class="ptab-conf-label">可信度</span>' +
                      '<div class="ab-conf-bar-wrap">' +
                        '<div class="ab-conf-bar-track">' +
                          '<div class="ab-conf-bar-fill ' + confCls3 + '" style="width:' + Math.min(100, abConf3) + '%"></div>' +
                        '</div>' +
                      '</div>' +
                      '<span class="ab-conf-val ' + confCls3 + '">' + abConf3 + '/100</span>' +
                      '<span class="ab-conf-desc ' + confCls3 + '">' + confLbl3 + '</span>' +
                    '</div>' +
                    '<div class="ptab-far-walls">' +
                      '<span class="kl-far-label">远端墙（背景）：</span>' +
                      '<span class="kl-far-val">' + escapeHtml(farCallFmt) + ' / ' + escapeHtml(farPutFmt) + '</span>' +
                      '<span class="kl-far-note">只作背景，不作日内触发</span>' +
                    '</div>' +
                    (hint    ? '<div class="kl-hint">💡 ' + escapeHtml(hint) + '</div>' : '') +
                    (pinWarn ? '<div class="kl-pin-warn">⚠ ' + escapeHtml(pinWarn) + '</div>' : '') +
                  '</div>';

                const isLocked = abStatus2 === 'blocked' || abStatus2 === 'wait';
                // [ORDER_PLAN] 读取 order_plan 的显示权和执行权
                const _op2          = hvm.order_plan || {};
                const _opPrimary    = _op2.primary_plan || null;
                const _opBackup     = _op2.backup_plan  || null;
                const _showPrimary  = _op2.show_primary_plan === true;
                const _showBackup   = _op2.show_backup_plan  === true;
                const _planNote     = _op2.plan_note || null;
                // Tab 2: 主做（A单）— 三态显示：READY(绿)/PENDING(黄)/VOID(空白)
                let tab2Html = '<div class="ptab-pane" id="ptab-pane-main" style="display:none">';
                const _ps = _opPrimary ? (_opPrimary.plan_state || 'VOID') : 'VOID';
                if (_ps === 'VOID' || !_showPrimary || !_opPrimary) {
                  // 空白：无方向，等待下一单条件
                  const _voidReason = (planA2 && planA2.rationale)
                    || (hvmSt.scenario === 'flow_gap_too_small' ? 'Call/Put Flow 差距不足 15%，资金尚未分化'
                    : hvmSt.scenario === 'gex_near_zero' ? 'Gamma 中性，做市商处于零轴附近'
                    : '等待方向明确后再评估');
                  tab2Html += '<div class="ab-void-block">' +
                    '<div class="ab-void-icon">○</div>' +
                    '<div class="ab-void-title">等待下一单条件</div>' +
                    '<div class="ab-void-reason">' + escapeHtml(_voidReason) + '</div>' +
                    '</div>';
                } else if (_ps === 'PENDING') {
                  // 黄色：有方向但条件未满足（LOCKED/WAIT/DEGRADED）
                  const _pendingBanner = '<div class="ab-pending-plan-banner">' +
                    '<span class="ab-pending-icon">⏳</span>' +
                    '<span class="ab-pending-text">' + escapeHtml(_opPrimary.display_mode || 'A单预案') + ' — ' + escapeHtml(_opPrimary.blocked_reason || '等确认') + '</span>' +
                    '</div>';
                  tab2Html += _pendingBanner + renderPlanCard(_opPrimary.raw || planA2,
                    (_opPrimary.side === 'LONG' ? 'A单预案（多）' : 'A单预案（空）'),
                    trigStat3, abStatus2, 'pending');
                } else {
                  // READY：绿色可执行
                  tab2Html += renderPlanCard(_opPrimary.raw || planA2,
                    (aIsBull2 ? '多单' : '空单'),
                    trigStat3, abStatus2, 'ready');
                }
                tab2Html += '</div>';
                // Tab 3: 备选（B单）— 三态显示
                let tab3Html = '<div class="ptab-pane" id="ptab-pane-alt" style="display:none">';
                const _psB = _opBackup ? (_opBackup.plan_state || 'VOID') : 'VOID';
                if (_psB === 'VOID' || !_showBackup || !_opBackup) {
                  tab3Html += '<div class="ab-void-block">' +
                    '<div class="ab-void-icon">○</div>' +
                    '<div class="ab-void-title">暂无备选方案</div>' +
                    '<div class="ab-void-reason">当前场景只有单一方向预案</div>' +
                    '</div>';
                } else if (_psB === 'PENDING') {
                  const _pendingBannerB = '<div class="ab-pending-plan-banner">' +
                    '<span class="ab-pending-icon">⏳</span>' +
                    '<span class="ab-pending-text">' + escapeHtml(_opBackup.display_mode || 'B单预案') + ' — ' + escapeHtml(_opBackup.blocked_reason || '等确认') + '</span>' +
                    '</div>';
                  tab3Html += _pendingBannerB + renderPlanCard(_opBackup.raw || planB2,
                    (_opBackup.side === 'LONG' ? 'B单预案（多）' : 'B单预案（空）'),
                    trigStat3, abStatus2, 'pending');
                } else {
                  tab3Html += renderPlanCard(_opBackup.raw || planB2,
                    (bIsBull2 ? '多单（备选）' : '空单（备选）'),
                    trigStat3, abStatus2, 'ready');
                }
                tab3Html += '</div>';
                // Tab 标题：根据 plan_state 决定（READY/PENDING/VOID）
                let mainTabLabel, altTabLabel;
                if (_ps === 'READY') {
                  mainTabLabel = aIsBull2 ? '多单' : '空单';
                } else if (_ps === 'PENDING') {
                  mainTabLabel = _opPrimary ? (_opPrimary.display_mode || 'A单预案') : '主做';
                } else {
                  mainTabLabel = '主做';
                }
                if (_psB === 'READY') {
                  altTabLabel = bIsBull2 ? '备选（多）' : '备选（空）';
                } else if (_psB === 'PENDING') {
                  altTabLabel = _opBackup ? (_opBackup.display_mode || 'B单预案') : '备选';
                } else {
                  altTabLabel = '备选';
                }
                // LOCKED 时在 Tab 导航下方显示 plan_note 摘要
                const _planNoteHtml = (isLocked && _planNote)
                  ? '<div class="ab-plan-note-bar">' + escapeHtml(_planNote) + '</div>'
                  : '';
                return '<div class="ptab-container" data-tab-id="primary-tabs">' +
                  '<div class="ptab-nav">' +
                    '<button class="ptab-btn active" data-tab="eye">盘眼</button>' +
                    '<button class="ptab-btn' + (_ps === 'PENDING' ? ' ptab-btn-pending' : _ps === 'READY' ? ' ptab-btn-ready' : '') + '" data-tab="main">' + escapeHtml(mainTabLabel) + '</button>' +
                    '<button class="ptab-btn' + (_psB === 'PENDING' ? ' ptab-btn-pending' : _psB === 'READY' ? ' ptab-btn-ready' : '') + '" data-tab="alt">' + escapeHtml(altTabLabel) + '</button>' +
                  '</div>' +
                  (abStatus2 === 'blocked' ? '<div class="ptab-locked-bar">🔒 LOCKED — 禁止开仓，以下为观察预案</div>' : abStatus2 === 'wait' ? '<div class="ptab-wait-bar">⏳ WAIT — 等待确认，以下为预备预案</div>' : '') +
                  _planNoteHtml +
                  '<div class="ptab-body">' +
                    tab1Html + tab2Html + tab3Html +
                  '</div>' +
                '</div>';
              })()}
            </div>
          </div>
        </section>

        <!-- RIGHT: Vertical aux cards (资金/暗盘/波动率/VIX) -->
        <aside class="aux-sidebar">
          <!-- Narrative Card: 叙事层（优先级决策树输出，三板块结构）-->
          ${(() => {
            const _narr = (hvm.order_plan || {}).narrative || {};
            const _nHeadline   = _narr.headline    || '';
            const _nDetail     = _narr.detail      || '';
            const _nAction     = _narr.action_plan || '';
            const _nInvalid    = _narr.invalidation || '';
            const _nTone       = _narr.tone        || 'neutral';
            const _nPrimary    = _narr.primary_narrative || 'NEUTRAL';
            if (!_nHeadline) return '';
            const _nCardCls = _nTone === 'warning' ? 'narr-warning'
              : _nTone === 'bearish' ? 'narr-bearish'
              : _nTone === 'bullish' ? 'narr-bullish'
              : 'narr-neutral';
            return `
          <section class="aux-card narrative-card ${_nCardCls}">
            <div class="narr-header">
              <span class="narr-icon">${_nTone === 'warning' ? '⚠️' : _nTone === 'bearish' ? '📉' : _nTone === 'bullish' ? '📈' : '📊'}</span>
              <span class="narr-title">盘面解读</span>
            </div>
            <!-- 板块A：一句话定调 -->
            <div class="narr-headline">${escapeHtml(_nHeadline)}</div>
            <!-- 板块B：底层数据揭秘 -->
            <div class="narr-detail">${escapeHtml(_nDetail)}</div>
            <!-- 板块C：执行预案 + 失效条件 -->
            ${_nAction ? `<div class="narr-action">${escapeHtml(_nAction)}</div>` : ''}
            ${_nInvalid ? `<div class="narr-invalidation">${escapeHtml(_nInvalid)}</div>` : ''}
          </section>`;
          })()}
          <section class="aux-card capital-flow-card">
            <div class="aux-card-header">
              <span class="aux-card-icon">💰</span>
              <span class="aux-card-title">资金实况 <small style="font-size:10px;color:#64748b;font-weight:400;">（详细数据）</small></span>
              ${(() => {
                const _cf = (hvm.order_plan || {}).capital_flow || {};
                const _gs = _cf.gamma_state || '';
                const _gc = _gs === 'POSITIVE' ? 'gamma-tag-amber' : _gs === 'NEGATIVE' ? 'gamma-tag-green' : 'gamma-tag-gray';
                const _gl = _cf.gamma_label || '';
                return _gl ? `<span class="gamma-state-tag ${_gc}">${escapeHtml(_gl)}</span>` : '';
              })()}
            </div>
            ${(() => {
              // [HVM v2] 无论 LOCKED/WAIT/READY，都显示 capital_flow 完整分析
              // 只读 hvm.order_plan.capital_flow，禁止直接读 flow_behavior_engine
              const _cf = (hvm.order_plan || {}).capital_flow || {};
              const _headline    = _cf.headline    || '--';
              const _detail      = _cf.detail      || '--';
              const _mmAction    = _cf.mm_action   || '--';
              const _tradeImpact = _cf.trade_impact || '--';
              const _tradeGate   = _cf.trade_gate  || 'DEGRADED';
              const _divDetected = _cf.divergence_detected === true;
              const _divType     = _cf.divergence_type || '';
              const _divDesc     = _cf.divergence_desc || '';
              const _sentSide    = _cf.sentiment_side || '--';
              const _moneySide   = _cf.money_side    || '--';
              const _flow5m      = _cf.flow_5m       || hvmFlow.flow_5m  || '--';
              const _flow15m     = _cf.flow_15m      || hvmFlow.flow_15m || '--';
              const _dayNet      = _cf.day_net       || _cf.net_premium_fmt || '--';
              const _dayCall     = _cf.day_call      || _cf.call_premium_fmt || '--';
              const _dayPut      = _cf.day_put       || _cf.put_premium_fmt  || '--';
              const _pcVol       = _cf.pc_volume_ratio  || '--';
              const _pcPrem      = _cf.pc_premium_ratio || '--';
              // 微调1：资金比（Put/Call 权利金比）
              const _pcPremPOC   = _cf.pc_prem_put_over_call || '--';
              const _pcCompare   = _cf.pc_compare_text || null;
              // 微调2：盘面综合状态标签
              const _mktLabel    = _cf.market_summary_label || '';
              const _mktText     = _cf.market_summary_text  || '';
              // 微调3：价格防线失效条件
              const _invalPrice  = _cf.invalidation_price_line || null;
              const _winStatus   = _cf.window_status || '--';
              const _winNote     = _cf.window_note   || '--';
              const _invalNotes  = Array.isArray(_cf.invalidation_notes) ? _cf.invalidation_notes : [];

              // 背离警告横幅
              const _divBanner = _divDetected ? `
                <div class="capital-divergence-banner ${_divType === 'BULL_DIVERGENCE' || _divType === 'PUT_ABSORBED' || _divType === 'QUIET_BULL' ? 'div-bull' : 'div-bear'}">
                  <span class="div-icon">⚡</span>
                  <span class="div-text">${escapeHtml(_divDesc)}</span>
                </div>` : '';

              // A单门控标签
              const _gateCls = _tradeGate === 'PASS' ? 'gate-pass' : _tradeGate === 'BLOCKED' ? 'gate-blocked' : 'gate-degraded';
              const _gateLabel = _tradeGate === 'PASS' ? '✓ 资金门控通过' : _tradeGate === 'BLOCKED' ? '✗ 资金门控阻止' : '⚠ 资金降级';
              const _gateBanner = `<div class="capital-gate-banner ${_gateCls}"><span>${_gateLabel}</span><span class="gate-impact">${escapeHtml(_tradeImpact)}</span></div>`;

              // 微调3：失效条件 = 价格防线优先，降级到抽象标签
              const _invalStr = _invalPrice
                ? `<div class="capital-inval-row capital-inval-price"><span class="inval-label">⊗ 失效条件：</span><span class="inval-val">${escapeHtml(_invalPrice)}</span></div>`
                : _invalNotes.length > 0
                  ? `<div class="capital-inval-row"><span class="inval-label">⊗ 失效条件：</span><span class="inval-val">${escapeHtml(_invalNotes.join(' / '))}</span></div>`
                  : '';

              return `
                ${_divBanner}
                <div class="capital-headline">${escapeHtml(_headline)}</div>
                <div class="capital-detail">${escapeHtml(_detail)}</div>
                ${_mmAction && _mmAction !== '--' ? `<div class="mm-what-to-do"><span class="mm-icon">🏦</span><span class="mm-text">${escapeHtml(_mmAction)}</span></div>` : ''}
                ${_gateBanner}
                <div class="capital-flow-grid">
                  <div class="cf-row">
                    <div class="cf-cell">
                      <div class="cf-label">5m 资金</div>
                      <div class="cf-val ${_cf.flow_5m_fallback ? 'cf-fallback' : (_cf.flow_5m_dir === 'bullish' ? 'cf-bull' : _cf.flow_5m_dir === 'bearish' ? 'cf-bear' : '')}">${escapeHtml(_flow5m)}</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">15m 资金</div>
                      <div class="cf-val ${_cf.flow_15m_fallback ? 'cf-fallback' : (_cf.flow_15m_dir === 'bullish' ? 'cf-bull' : _cf.flow_15m_dir === 'bearish' ? 'cf-bear' : '')}">${escapeHtml(_flow15m)}</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">窗口状态</div>
                      <div class="cf-val ${_winStatus === 'ALIGNED' ? 'cf-bull' : _winStatus === 'CONFLICT' || _winStatus === 'FALLBACK' ? 'cf-bear' : 'cf-neutral'}">${escapeHtml(_winStatus)}</div>
                    </div>
                  </div>
                  <div class="cf-row">
                    <div class="cf-cell">
                      <div class="cf-label">Call 权利金</div>
                      <div class="cf-val cf-bull">${escapeHtml(_dayCall)}</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">Put 权利金</div>
                      <div class="cf-val cf-bear">${escapeHtml(_dayPut)}</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">日内净权利金</div>
                      <div class="cf-val ${_cf.day_direction === 'bullish' ? 'cf-bull' : _cf.day_direction === 'bearish' ? 'cf-bear' : ''}">${escapeHtml(_dayNet)}</div>
                    </div>
                  </div>
                  <div class="cf-row cf-pc-compare-row">
                    <div class="cf-cell">
                      <div class="cf-label">量比（P/C Vol）</div>
                      <div class="cf-val cf-neutral">${escapeHtml(_pcVol)}</div>
                      <div class="cf-sublabel">散户情绪</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">资金比（Put/Call）</div>
                      <div class="cf-val ${Number(_pcPremPOC) > 1.5 ? 'cf-bear' : Number(_pcPremPOC) < 0.7 ? 'cf-bull' : 'cf-neutral'}">${escapeHtml(_pcPremPOC)}x</div>
                      <div class="cf-sublabel">机构筹码</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">背离强度</div>
                      <div class="cf-val ${_divDetected ? 'cf-warn' : 'cf-neutral'}">${_divDetected ? '⚡ 背离' : '— 一致'}</div>
                      <div class="cf-sublabel">${_divDetected ? _divType.replace('_', ' ') : '无背离'}</div>
                    </div>
                  </div>
                  <div class="cf-row">
                    <div class="cf-cell">
                      <div class="cf-label">情绪方向</div>
                      <div class="cf-val ${_sentSide === 'BULLISH' ? 'cf-bull' : _sentSide === 'BEARISH' ? 'cf-bear' : ''}">${escapeHtml(_sentSide)}</div>
                    </div>
                    <div class="cf-cell">
                      <div class="cf-label">资金方向</div>
                      <div class="cf-val ${_moneySide === 'BULLISH' ? 'cf-bull' : _moneySide === 'BEARISH' ? 'cf-bear' : ''}">${escapeHtml(_moneySide)}</div>
                    </div>
                    <div class="cf-cell cf-wide">
                      <div class="cf-label">盘面综合</div>
                      <div class="cf-val cf-summary ${_mktLabel === 'ABSORPTION' || _mktLabel === 'DISTRIBUTION' ? 'cf-warn' : _mktLabel === 'BULL_DIVERGENCE' || _mktLabel === 'QUIET_BULL' || _mktLabel === 'CONSENSUS_BULL' ? 'cf-bull' : _mktLabel === 'BEAR_DIVERGENCE' || _mktLabel === 'QUIET_BEAR' || _mktLabel === 'CONSENSUS_BEAR' ? 'cf-bear' : 'cf-neutral'}">${escapeHtml(_mktLabel || 'NEUTRAL')}</div>
                      <div class="cf-sublabel">${escapeHtml(_mktText)}</div>
                    </div>
                  </div>
                </div>
                <div class="cf-window-note">${escapeHtml(_winNote)}</div>
                ${_invalStr}`;
            })()}
          </section>
          <!-- Darkpool Read -->
          <section class="aux-card darkpool-read-card">
            <div class="aux-card-header">
              <span class="aux-card-icon">👁</span>
              <span class="aux-card-title">暗盘人话</span>
            </div>
            <div class="aux-card-big-title">${escapeHtml(dr.title || '--')}</div>
            <div class="aux-card-body">${escapeHtml(dr.body || '--')}</div>
            <div class="dp-levels">${dpLevels || '<span class="data-missing">暗盘数据待接入</span>'}</div>
          </section>
          <!-- Vol Dashboard -->
          <section class="aux-card vol-card">
            <div class="aux-card-header">
              <span class="aux-card-icon">〜</span>
              <span class="aux-card-title">波动率仪表盘</span>
            </div>
            <div class="gauge-wrap">
              <div class="gauge-arc">
                <svg viewBox="0 0 120 70" class="gauge-svg">
                  <path d="M10,65 A55,55,0,0,1,110,65" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"/>
                  <path d="M10,65 A55,55,0,0,1,110,65" fill="none" stroke="${ivRankVal > 60 ? '#ef4444' : ivRankVal > 30 ? '#f59e0b' : '#22c55e'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${ivNeedlePct * 1.73} 173"/>
                </svg>
                <div class="gauge-center-val">${escapeHtml(ivRankFmt)}</div>
                <div class="gauge-center-label">IV Rank</div>
              </div>
            </div>
            <div class="vol-stats">
              <div class="vol-stat-row"><span class="vol-stat-label">IV Rank</span><span class="vol-stat-val">${escapeHtml(ivRankFmt)}</span></div>
              <div class="vol-stat-row"><span class="vol-stat-label">IV30</span><span class="vol-stat-val">${escapeHtml(iv30Fmt)}</span></div>
              <div class="vol-stat-row"><span class="vol-stat-label">买方风险</span><span class="vol-stat-val ${buyerColor}">${escapeHtml(buyerRisk)}</span></div>
            </div>
            <div class="vol-comment">${escapeHtml(volComment)}</div>
          </section>
          <!-- VIX Dashboard -->
          <section class="aux-card vix-card">
            <div class="aux-card-header">
              <span class="aux-card-icon">⚡</span>
              <span class="aux-card-title">VIX 仪表盘</span>
            </div>
            <div class="gauge-wrap">
              <div class="gauge-arc">
                <svg viewBox="0 0 120 70" class="gauge-svg">
                  <path d="M10,65 A55,55,0,0,1,110,65" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"/>
                  <path d="M10,65 A55,55,0,0,1,110,65" fill="none" stroke="${vixColor === 'red' ? '#ef4444' : vixColor === 'amber' ? '#f59e0b' : '#22c55e'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${vixNeedle * 1.73} 173"/>
                </svg>
                <div class="gauge-center-val ${vx.status === 'missing' ? 'missing' : ''}">${vx.status === 'missing' ? '--' : escapeHtml(vixFmt)}</div>
                <div class="gauge-center-label">VIX</div>
              </div>
            </div>
            <div class="vol-stats">
              <div class="vol-stat-row"><span class="vol-stat-label">来源</span><span class="vol-stat-val ${vx.status === 'missing' ? 'missing' : 'gray'}">${escapeHtml(vx.source || 'FMP')}</span></div>
              <div class="vol-stat-row"><span class="vol-stat-label">状态</span><span class="vol-stat-val ${vx.status === 'missing' ? 'missing' : vixColor}">${vx.status === 'missing' ? (vx.source_status === 'limit_reach' ? 'FMP 超限' : '不可用') : escapeHtml(vixSent)}</span></div>
            </div>
            <div class="vol-comment">${vx.status === 'missing' ? `<span class="data-missing">${escapeHtml(vixComment)}</span>` : escapeHtml(vixComment)}</div>
          </section>
        </aside>
      </div>

      <!-- MARKET MAKER PATH CARD — v2: ATM trigger lines + far walls + dual window -->
      ${(() => {
        const mmp = signal.mm_path_card || mr.mm_path_card || null;
        if (!mmp) return '';
        const mmpDual = mmp.dual_window_narrative || null;
        const mmpFarNote = mmp.far_wall_note || null;
        const mmpAligned = mmp.dual_window_aligned ?? false;
        return `
        <section class="mm-path-card">
          <div class="mm-path-header">
            <span class="mm-path-icon">🏦</span>
            <span class="mm-path-title">做市商路径</span>
          </div>
          <div class="mm-path-current">${escapeHtml(mmp.current_path || '--')}</div>
          <div class="mm-path-talk">${escapeHtml(mmp.talk || '--')}</div>
          <div class="mm-path-scenes">
            <div class="mm-scene bull">
              <span class="mm-scene-label">↗ 上方短线</span>
              <span class="mm-scene-val">${escapeHtml(mmp.bull_scene || '--')}</span>
            </div>
            <div class="mm-scene bear">
              <span class="mm-scene-label">↘ 下方短线</span>
              <span class="mm-scene-val">${escapeHtml(mmp.bear_scene || '--')}</span>
            </div>
          </div>
          ${mmpFarNote ? `<div class="mm-far-wall-note">${escapeHtml(mmpFarNote)}</div>` : ''}
          ${mmpDual ? `
          <div class="mm-dual-window ${mmpAligned ? 'aligned' : 'diverged'}">
            <span class="mm-dual-icon">${mmpAligned ? '✅' : '⚠'}</span>
            <span class="mm-dual-text">${escapeHtml(mmpDual)}</span>
          </div>` : ''}
          <div class="mm-path-action"><span class="mm-action-icon">→</span><span class="mm-action-text">${escapeHtml(mmp.current_action || '--')}</span></div>
        </section>`;
      })()}
      <!-- FORBIDDEN BAR -->
      ${hasForbidden ? `
      <div class="forbidden-bar">
        <span class="forbidden-icon">⚠</span>
        <span class="forbidden-msg">禁做提醒：${escapeHtml(forbidMsg)}</span>
      </div>` : ''}
    </main>
  `;
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

function radarText(value, fallback = '--') {
  if (value === undefined || value === null || Number.isNaN(value)) return fallback;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (Array.isArray(value)) return value.length ? value.map((item) => radarText(item, '')).filter(Boolean).join('；') : fallback;
  if (typeof value === 'object') {
    return value.plain_chinese || value.summary || value.reason || value.status || fallback;
  }
  return fallback;
}

function statusTag(status) {
  const original = String(status || '');
  if (/[^\x00-\x7F]/.test(original)) {
    const cls = original.includes('可用') || original.includes('就绪') || original.includes('参考') || original.includes('背景') || original.includes('可分析') ? 'amber' : 'blue';
    return `<span class="tag ${cls}">${escapeHtml(original)}</span>`;
  }
  const normalized = String(status || '').toLowerCase();
  const cls = normalized === 'live' ? 'green' : normalized === 'partial' || normalized === 'degraded' ? 'amber' : normalized === 'mock' || normalized === 'error' ? 'red' : 'blue';
  const text = normalized === 'live'
    ? '已接通'
    : normalized === 'partial' || normalized === 'degraded'
      ? '部分可用'
      : normalized === 'error'
        ? '数据商异常'
        : '未接通';
  return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}

function yesNo(value) {
  return value ? '是' : '否';
}

function radarConnected(value) {
  return value ? '已接通' : '未接通';
}

function radarHasData(value) {
  return value ? '有' : '无';
}

function radarStandardized(value) {
  if (value === true) return '完成';
  if (value === 'partial') return '部分';
  return '未完成';
}

function radarConnection(value) {
  return value ? '已接通' : '未接通';
}

function radarDataPresence(value) {
  return value ? '有' : '无';
}

function radarCompleteness(value) {
  if (value === 'partial') return '部分';
  if (value === 'complete') return '完整';
  if (value === true) return '完整';
  return '缺失';
}

function radarStandardization(value) {
  if (value === 'partial') return '部分';
  if (value === 'complete') return '完成';
  if (value === true) return '完成';
  return '未完成';
}

function radarHumanLayerCopy(name, layer = {}, signal = {}) {
  const dealer = signal.dealer_resolution || {};
  const darkpool = signal.darkpool_gravity || {};
  const volatility = signal.volatility_state || signal.uw_normalized?.volatility?.volatility_state || {};
  if (name.includes('做市商')) {
    return {
      summary: '做市商原始 Gamma 数据已接通，但近价墙位没有返回，所以 Call Wall、Put Wall、Gamma 分界线暂时不能生成。',
      evidence: `已经按现价附近区间请求 UW Spot GEX，并检查 ${dealer.pages_checked ?? 0} 页，但没有返回可用近价 strike。`,
      block: '当前更像 provider 该 endpoint 没有近价 Spot GEX 数据，或盘前/盘后该字段不可用。',
      impact: '不能用做市商墙位生成上方压力、下方支撑或趋势加速判断。',
      next: '继续确认 UW Spot GEX 是否在开盘后返回近价 strike。'
    };
  }
  if (name.includes('机构资金')) {
    return {
      summary: '有资金连续买 Put，说明有人押下跌或买保护。',
      evidence: 'Put 方向资金有动作。',
      block: '还缺 0DTE 和多腿过滤，不能单独作为开仓信号。',
      impact: '只能作为看空线索，不能追 Put。',
      next: '等 Flow 继续同向，并补齐 0DTE / 多腿过滤。'
    };
  }
  if (name.includes('波动率')) {
    return {
      summary: volatility.data_ready ? `Vscore 已生成：${volatility.vscore}。` : '波动率公式已准备好，但 Vscore 还没算出来。',
      evidence: 'Vscore 用 IV Rank 和 IV Percentile 判断期权贵不贵。',
      block: volatility.data_ready ? '需要结合 Flow 和价格确认。' : '缺 IVR / IVP，暂时不能判断裸买期权是否划算。',
      impact: '不能用波动率放行单腿。',
      next: '等 IVR / IVP 数据进入后计算 Vscore。'
    };
  }
  if (name.includes('暗池')) {
    const level = darkpool.mapped_spx != null ? Number(darkpool.mapped_spx).toFixed(2) : '7150';
    return {
      summary: `${level} 附近有暗池脚印，但只能低置信观察，不能当正式支撑。`,
      evidence: `SPY 暗池映射到 SPX 约 ${level}。`,
      block: '金额和聚合条件不足以直接定义正式支撑 / 压力。',
      impact: '只用于提醒不要在承接区上方追空。',
      next: '继续观察是否形成多笔聚合和价格吸收。'
    };
  }
  if (name.includes('市场情绪')) {
    return {
      summary: '市场情绪轻微防守，但不是强空。',
      evidence: 'Market Tide 偏防守。',
      block: '只能做背景，不能单独决定方向。',
      impact: '辅助判断，不直接放行操作卡。',
      next: '继续观察情绪是否和 Flow 同向加强。'
    };
  }
  return {
    summary: '数据质量可参考，但还不能生成完整交易计划。',
    evidence: '主要数据源可读。',
    block: '仍缺少部分可交易结论。',
    impact: '可分析，不可操作。',
    next: '继续补齐缺口。'
  };
}

function radarStatusWord(value) {
  return value ? '已接通' : '未接通';
}

function radarDataWord(value) {
  return value ? '有' : '无';
}

function radarCompletenessWord(value) {
  if (value === 'full' || value === true) return '完整';
  if (value === 'partial') return '部分';
  return '缺失';
}

function radarStandardWord(value) {
  if (value === 'full' || value === true) return '完成';
  if (value === 'partial') return '部分';
  return '未完成';
}

function radarHumanStatus(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'live') return '已接通';
  if (text === 'partial' || text === 'degraded') return '部分可参考';
  if (text === 'error') return '数据商异常';
  return '未接通';
}

function radarLayerStatusLabel(name) {
  if (name.includes('做市商')) return '部分可用';
  if (name.includes('机构资金')) return '部分可用';
  if (name.includes('波动率')) return '公式就绪';
  if (name.includes('暗池')) return '低置信参考';
  if (name.includes('市场情绪')) return '背景可用';
  if (name.includes('数据质量')) return '可分析，不可操作';
  return '部分可参考';
}

function radarHumanText(value, fallback = '未提供') {
  const text = radarText(value, fallback);
  return text
    .replaceAll('RepeatedHits', '连续买 Put')
    .replaceAll('ask-side', '买方主动成交')
    .replaceAll('bearish_hint', '看空线索')
    .replaceAll('major_wall', '大额暗池参考区')
    .replaceAll('cluster_wall', '暗池聚合参考区')
    .replaceAll('footprint', '暗池脚印')
    .replaceAll('partial', '部分可参考')
    .replaceAll('low confidence', '低置信参考')
    .replaceAll('normalized', '整理后的数据')
    .replaceAll('raw', '原始数据')
    .replaceAll('likely_cause=provider_data_gap', '数据商该接口没有返回近价数据')
    .replaceAll('provider_data_gap', '数据商该接口没有返回近价数据')
    .replaceAll('fill sequence', '成交价格连续变化')
    .replaceAll('strike 区间和现价不匹配', '近价 Spot GEX 没返回');
}

function radarLayerCopy(name, layer = {}, signal = {}) {
  if (name.includes('做市商')) {
    return {
      summary: '做市商原始 Gamma 数据已接通，但近价墙位没有返回，所以 Call Wall、Put Wall、Gamma 分界线暂时不能生成。',
      evidence: '已经按现价附近区间请求 UW Spot GEX，并检查 5 页，但没有返回可用近价 strike。',
      block: '当前更像数据商该接口没有近价 Spot GEX 数据，或盘前/盘后该字段不可用。',
      impact: '不能用 Dealer 墙位生成入场、止损、目标价。',
      next: '继续修 Dealer 抓取窗口 / 分页；如果仍无近价数据，再确认数据商是否盘中才返回。'
    };
  }
  if (name.includes('机构资金')) {
    return {
      summary: '有资金连续买 Put，说明有人押下跌或买保护。',
      evidence: '资金流有看空线索，但还缺 0DTE 和多腿过滤。',
      block: '不能只因为有 Put 资金就开仓。',
      impact: '只能作为看空候选，不能直接放行操作卡。',
      next: '补 0DTE / 多腿过滤，再观察是否继续同向。'
    };
  }
  if (name.includes('波动率')) {
    return {
      summary: '波动率公式已准备好，但 Vscore 还没算出来。',
      evidence: '公式可以计算期权贵不贵，但当前缺 IVR / IVP。',
      block: '不能判断裸买 Put 或 Call 是否划算。',
      impact: '不能用波动率放行单腿。',
      next: '等 IVR / IVP 数据进入后生成 Vscore。'
    };
  }
  if (name.includes('暗池')) {
    const premium = signal.uw_normalized?.darkpool?.largest_print?.premium;
    const amount = Number.isFinite(Number(premium)) ? `${Math.round(Number(premium) / 1000) / 10} 万美元` : '金额不足强墙标准';
    return {
      summary: '7150 附近有暗池脚印，但金额不够大，只能低置信观察，不能当正式支撑。',
      evidence: `当前按单笔金额看是低置信暗池参考，金额约 ${amount}。`,
      block: '只有低置信承接区，不是正式支撑。',
      impact: '可以提醒不要追 Put，但不能直接开仓。',
      next: '如果要显示强墙，必须先给出聚合金额、聚合笔数、价格区间和时间窗口。'
    };
  }
  if (name.includes('市场情绪')) {
    return {
      summary: '市场情绪轻微防守，但不是强空。',
      evidence: 'Market Tide 有防守味道，只能做背景。',
      block: '情绪不能单独生成交易计划。',
      impact: '只作为背景参考。',
      next: '继续观察是否和 Flow、价格同向。'
    };
  }
  return {
    summary: radarHumanText(layer.summary_cn, '数据可以参考，但还不能直接用于交易计划。'),
    evidence: radarHumanText(layer.evidence_cn, '有参考数据，但还需要转成交易结论。'),
    block: radarHumanText(layer.current_block, '还缺关键确认。'),
    impact: layer.usable_for_operation ? '可参与操作卡' : '不能直接放行操作卡',
    next: radarHumanText(layer.next_fix, '继续补齐缺口。')
  };
}

function sourceUpdatedAt(signal, sourceName) {
  const source = (signal.source_status || []).find((item) => {
    if (sourceName === 'uw') return item.source === 'uw';
    if (sourceName === 'theta') return item.source === 'theta_core';
    if (sourceName === 'fmp') return item.source === 'fmp_price' || item.source === 'fmp_event';
    if (sourceName === 'tradingview') return item.source === 'tradingview';
    return false;
  });
  return {
    last_updated: source?.last_updated || '--',
    latency_ms: source?.latency_ms ?? '--',
    is_mock: source?.is_mock === true
  };
}

function renderRadarTable(headers, rows) {
  return `
    <div class="matrix-list">
      <div class="matrix-item">
        ${headers.map((header) => `<div class="matrix-name">${escapeHtml(header)}</div>`).join('')}
      </div>
      ${rows.map((row) => `
        <div class="matrix-item">
          ${row.map((cell, index) => `<div class="${index === 0 ? 'matrix-name' : index === row.length - 1 ? 'matrix-number' : 'matrix-value'}">${cell}</div>`).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

function renderDataSourceOverview(signal) {
  const sourceDisplay = signal.source_display || {};
  const rows = ['uw', 'fmp', 'theta', 'tradingview'].map((source) => {
    const display = sourceDisplay[source] || {};
    const meta = sourceUpdatedAt(signal, source);
    const label = source === 'uw' ? 'UW' : source === 'fmp' ? 'FMP' : source === 'theta' ? 'ThetaData' : 'TradingView';
    return [
      escapeHtml(label),
      statusTag(display.status),
      escapeHtml(meta.last_updated),
      escapeHtml(String(meta.latency_ms)),
      escapeHtml(yesNo(meta.is_mock)),
      escapeHtml(yesNo(display.usable_for_analysis)),
      escapeHtml(yesNo(display.usable_for_operation)),
      escapeHtml(radarHumanText(display.reason, '未提供'))
    ];
  });
  return `
    <section class="radar-card">
      <div class="radar-title"><h2>数据源总览</h2><span class="tag blue">数据质量</span></div>
      ${renderRadarTable(['来源', '状态', '最近更新', '延迟ms', '是否mock', '可分析', '可操作', '原因'], rows)}
    </section>
  `;
}

function renderRadarDataClock(signal) {
  const clock = signal.data_clock || {};
  const row = (name, item = {}) => [
    name,
    radarHumanText(item.value ?? item.source ?? '--'),
    radarHumanText(item.updated_at ? shortTime(item.updated_at) : '--'),
    radarHumanText(item.age_seconds != null ? `${item.age_seconds}s` : '--'),
    radarHumanText(item.status || '--')
  ];
  const rows = [
    row('价格', clock.price),
    row('UW 总体', clock.uw),
    row('Flow', clock.flow),
    row('Dark Pool', clock.darkpool),
    row('Dealer', clock.dealer),
    row('Volatility', clock.volatility),
    row('News', clock.news)
  ].map((cells) => cells.map((cell) => escapeHtml(radarHumanText(cell, '未提供'))));
  return `
    <section class="radar-card">
      <div class="radar-title"><h2>Data Clock / 数据时钟</h2><span class="tag blue">${escapeHtml(clock.market_session || 'unknown')}</span></div>
      ${renderRadarTable(['来源', '数值/来源', '更新时间', '年龄', '状态'], rows)}
    </section>
  `;
}

function renderDataClock(signal) {
  const clock = signal.data_clock || {};
  const rowFor = (label, item = {}) => [
    label,
    item.value == null ? '--' : item.value,
    item.source || '--',
    item.updated_at ? shortTime(item.updated_at) : '--',
    item.age_seconds == null ? '--' : `${item.age_seconds}s`,
    item.status === 'live' ? '实时' : item.status === 'stale' ? '延迟' : '失联'
  ].map((cell) => escapeHtml(String(cell)));
  const rows = [
    rowFor('价格', clock.price),
    rowFor('UW 总体', clock.uw),
    rowFor('Flow', clock.flow),
    rowFor('Dark Pool', clock.darkpool),
    rowFor('Dealer', clock.dealer),
    rowFor('Volatility', clock.volatility),
    rowFor('News', clock.news)
  ];
  return `
    <section class="radar-card">
      <div class="radar-title"><h2>Data Clock / 数据时钟</h2><span class="tag blue">${escapeHtml(clock.market_session || '--')}</span></div>
      ${renderRadarTable(['项目', '值', '来源', '更新时间', '年龄', '状态'], rows)}
    </section>
  `;
}

function getLayerRows(signal) {
  const layers = signal.uw_layer_conclusions || {};
  const normalized = signal.uw_normalized || {};
  const providerLive = signal.uw_provider?.status === 'live';
  const dataHealth = layers.data_health || {};
  return [
    ['做市商 / 希腊值', layers.dealer || {}, providerLive, normalized.dealer?.has_data, normalized.dealer?.greek_exposure_has_data, true],
    ['机构资金流', layers.flow || {}, providerLive, normalized.flow?.has_data, normalized.flow?.ask_side_premium != null || normalized.flow?.total_premium != null, true],
    ['波动率', layers.volatility || {}, providerLive, normalized.volatility?.has_data, Array.isArray(normalized.volatility?.term_structure) && normalized.volatility.term_structure.length > 0, true],
    ['暗池 / 场外成交', layers.darkpool || {}, providerLive, normalized.darkpool?.has_data, normalized.darkpool?.prints_count > 0, true],
    ['市场情绪', layers.sentiment || {}, providerLive, normalized.sentiment?.has_data, normalized.sentiment?.net_call_premium != null, true],
    ['数据质量', dataHealth, providerLive, normalized.data_health?.has_data, normalized.data_health?.provider_live, true]
  ];
}

function renderUwLayerStatus(signal) {
  const rows = getLayerRows(signal);
  const layerCopy = {
    '做市商 / 希腊值': {
      conclusion: '做市商原始 Gamma 数据已接通，但近价墙位没有返回，所以 Call Wall、Put Wall、Gamma 分界线暂时不能生成。',
      evidence: '已经按现价附近区间请求 UW Spot GEX，并检查 5 页，但没有返回可用近价 strike。',
      block: '当前更像数据商这个接口没有近价 Spot GEX 数据，或盘前/盘后该字段不可用。',
      impact: '不能用 Dealer 墙位给入场、止损、目标价。',
      next: '继续确认 UW 是否在盘中提供近价 Spot GEX；如果仍没有，再只把 SPY 代理作为低置信参考。'
    },
    '机构资金流': {
      conclusion: '有资金连续买 Put，说明有人押下跌或买保护。',
      evidence: '资金流有看空线索，但还缺 0DTE 和多腿过滤。',
      block: '下方 7150 附近有暗池承接区，追 Put 容易打到承接。',
      impact: '只能观察，不直接开仓。',
      next: '等 Flow 继续同向，并补齐 0DTE / 多腿过滤。'
    },
    '波动率': {
      conclusion: '波动率公式已准备好，但 Vscore 还没算出来。',
      evidence: '现在还缺 IVR / IVP，不能判断期权贵不贵。',
      block: '不能判断裸买 Put 或 Call 是否划算。',
      impact: '不能用波动率放行单腿。',
      next: '等 IVR / IVP 数据进入后计算 Vscore。'
    },
    '暗池 / 场外成交': {
      conclusion: '7150 附近有暗池脚印，但金额不够大，只能低置信观察，不能当正式支撑。',
      evidence: '当前按单笔金额看是暗池脚印；如果要显示更高档位，必须先展示聚合金额、笔数、价格区间和时间窗口。',
      block: '只能作为禁止追空的提醒，不是开仓依据。',
      impact: '价格靠近 7150 时观察是否承接，不直接下单。',
      next: '补充价格分箱聚合、时间窗口和笔数后，再判断是否形成正式墙位。'
    },
    '市场情绪': {
      conclusion: '市场情绪轻微防守，但不是强空。',
      evidence: 'Market Tide 可做背景参考。',
      block: '不能单独决定方向。',
      impact: '只做背景，不直接开仓。',
      next: '继续观察 Market Tide 是否扩大成明显单边。'
    },
    '数据质量': {
      conclusion: '数据可以参考，但还不能生成完整交易计划。',
      evidence: '部分数据有分析价值，但关键交易字段还没齐。',
      block: '还缺 Dealer 墙位、Vscore、Flow 过滤和正式暗池墙位。',
      impact: '可分析，不可操作。',
      next: '按 Dealer、Volatility、Flow、Dark Pool 顺序补齐。'
    }
  };
  return `
    <section class="radar-card">
      <div class="radar-title"><h2>UW 六层接入状态</h2><span class="tag violet">人话状态</span></div>
      <div class="matrix-list">
        ${rows.map(([name, layer, endpointOk, rawOk, keyOk, normalizedOk]) => {
          const copy = layerCopy[name] || {};
          return `
          <div class="matrix-item">
            <div class="matrix-name">${escapeHtml(name)}<br>${statusTag(radarLayerStatusLabel(name))}</div>
            <div class="matrix-value">
              <b>结论：</b>${escapeHtml(copy.conclusion || radarHumanText(layer.summary_cn, '未提供'))}<br>
              <b>接通证据：</b>${escapeHtml(copy.evidence || radarHumanText(layer.evidence_cn, '未提供'))}<br>
              <b>当前卡点：</b>${escapeHtml(copy.block || radarHumanText(layer.current_block, '未提供'))}<br>
              <b>对操作卡影响：</b>${escapeHtml(copy.impact || (layer.usable_for_operation ? '可参与操作卡' : '不能直接放行操作卡'))}<br>
              <b>下一步修复：</b>${escapeHtml(copy.next || radarHumanText(layer.next_fix, '未提供'))}
            </div>
            <div class="matrix-number">
              接口：${escapeHtml(radarStatusWord(endpointOk))}<br>
              原始数据：${escapeHtml(radarDataWord(rawOk))}<br>
              关键字段：${escapeHtml(radarCompletenessWord(keyOk === true ? 'full' : keyOk ? 'partial' : false))}<br>
              标准化：${escapeHtml(radarStandardWord(normalizedOk === true ? 'full' : normalizedOk ? 'partial' : false))}<br>
              可分析：${escapeHtml(yesNo(layer.usable_for_analysis))}<br>
              可操作：${escapeHtml(yesNo(layer.usable_for_operation))}
            </div>
          </div>
        `;}).join('')}
      </div>
    </section>
  `;
}

function rawSample(signal, key) {
  const value = signal.uw_raw?.[key];
  const rows = Array.isArray(value?.data?.data) ? value.data.data : Array.isArray(value?.data) ? value.data : [];
  return rows[0] || {};
}

function renderEndpointEvidence(signal) {
  const provider = signal.uw_provider || {};
  const failed = provider.endpoints_failed || [];
  const gexSample = rawSample(signal, 'greek_exposure');
  const spotSample = rawSample(signal, 'spot_gex');
  const flowSample = rawSample(signal, 'options_flow');
  const darkSample = rawSample(signal, 'darkpool');
  const tideSample = rawSample(signal, 'market_tide');
  const rows = [
    ['Dealer / GEX', '/api/stock/{ticker}/greek-exposure', '200', '是', 'call_gamma', gexSample.call_gamma || '--', '是', '已接通，Gamma 字段有值。', '--'],
    ['Dealer / Spot GEX', '/api/stock/{ticker}/spot-exposures/strike', '200', '是', 'price / call_gamma_oi / put_gamma_oi', `${radarText(spotSample.price)} / ${radarText(spotSample.call_gamma_oi)} / ${radarText(spotSample.put_gamma_oi)}`, '是', '已接通，但 strike 区间和现价不匹配，墙位不可用。', '--'],
    ['Flow', '/api/option-trades/flow-alerts', '200', '是', 'alert_rule / total_ask_side_prem / type', `${radarText(flowSample.alert_rule)} / ${radarText(flowSample.total_ask_side_prem)} / ${radarText(flowSample.type)}`, '是', '已接通，有 Put RepeatedHits 和 ask-side premium。', '--'],
    ['Volatility', '/api/stock/{ticker}/iv-rank 或 iv-term-structure', '200', '是', 'payload shape', '字段已展开到 uw_normalized', '是', '已接通，payload 已展开，但还没形成 volatility_state。', '--'],
    ['Dark Pool', '/api/darkpool/{ticker}', '200', '是', 'ticker / price / premium', `${radarText(darkSample.ticker)} / ${radarText(darkSample.price)} / ${radarText(darkSample.premium)}`, '是', '已接通，有 SPY prints。', '--'],
    ['Market Tide', '/api/market/market-tide', '200', '是', 'net_call_premium / net_put_premium', `${radarText(tideSample.net_call_premium)} / ${radarText(tideSample.net_put_premium)}`, '是', '已接通，Put premium 略高于 Call premium，情绪轻微防守。', '--'],
    ...failed.map((item) => [item.name, item.path || item.endpoint || '未提供', String(item.http_status || item.status || '--'), '否', '错误', '--', '否', `接口失败 ${item.http_status || item.status || '--'}`, item.message || item.reason || '未提供'])
  ].map((row) => row.map((cell) => escapeHtml(radarHumanText(cell, '未提供'))));
  return `
    <section class="radar-card">
      <details>
        <summary><strong>接口证据</strong>（技术明细，默认收起）</summary>
        ${renderRadarTable(['层级', 'Endpoint / Source', 'HTTP 状态', '是否有 JSON', '示例字段', '示例值', '是否进 /signals/current', '接通判断', '错误'], rows)}
      </details>
    </section>
  `;
}

function renderMappingStatus(signal) {
  const dealer = signal.dealer_resolution || {};
  const darkpool = signal.darkpool_gravity || {};
  const flow = signal.flow_conflict || {};
  const volatility = signal.volatility_state || signal.uw_normalized?.volatility?.volatility_state || {};
  const rows = [
    ['Dealer', '做市商原始 Gamma 数据', dealer.can_compute_wall ? '已可压缩墙位' : '近价 Spot GEX 没返回', dealer.reason_cn || '已经按现价附近区间请求 UW Spot GEX，并检查多页，但没有返回可用近价 strike。'],
    ['Flow', '资金流', '有 Put 看空线索', flow.conflict_cn || '有资金连续买 Put，说明有人押下跌或买保护。'],
    ['Volatility', '波动率', volatility.data_ready ? `Vscore ${volatility.vscore}` : '公式已准备好，等 IVR / IVP', volatility.summary_cn || '波动率 Vscore 还没生成，不能判断期权贵不贵。'],
    ['Dark Pool', '暗池大成交', '7150 附近参考区', darkpool.summary_cn || '7150 附近有暗池脚印，但金额不够大，只能低置信观察，不能当正式支撑。'],
    ['Sentiment', '市场情绪', '轻微防守', '不是强空，只能做背景。']
  ].map((row) => row.map((cell) => escapeHtml(radarHumanText(cell, '未提供'))));
  return `
    <section class="radar-card">
      <div class="radar-title"><h2>数据映射链路</h2><span class="tag amber">人话结论</span></div>
      ${renderRadarTable(['层级', '数据含义', '现在读法', '交易影响'], rows)}
    </section>
  `;
}

function renderUwAggregateAnalysis(signal) {
  const rows = [
    ['当前市场倾向', '有 Put 看空线索，但不能追 Put。'],
    ['为什么', '1. 有资金连续买 Put，说明有人押下跌或买保护。 2. 7150 附近有暗池大成交参考区，价格靠近这里可能出现承接。 3. Dealer 墙位没生成，不能判断上方压力、下方支撑和 Gamma 分界线。 4. 波动率 Vscore 还没生成，不能判断期权贵不贵。 5. Market Tide 轻微防守，但不是强空。'],
    ['当前动作', '只观察，不追 Put。等 7150 附近价格反应。如果 7150 站稳反弹，再观察 Call；如果 7150 放量跌破，再重新评估 Put。'],
    ['当前可用', 'SPX 价格；Flow 看空线索；7150 暗池参考区；Market Tide 背景。'],
    ['当前不可用', 'Dealer Call Wall / Put Wall / Gamma Flip；Volatility Vscore；Flow 0DTE / 多腿过滤；VIX / 0DTE 预期波动；Brave 新闻雷达。'],
    ['结论', '当前可确认的是：Flow 有 Put 看空线索，7150 附近有暗池低置信承接区。但 Dealer 墙位没有生成，不能判断 Gamma 墙位夹击。当前只支持 WAIT，不支持开仓。']
  ].map((row) => row.map((cell) => escapeHtml(radarText(cell, '未提供'))));
  return `
    <section class="radar-card">
      <div class="radar-title"><h2>UW 聚合分析</h2><span class="tag amber">analysis</span></div>
      ${renderRadarTable(['项目', '内容'], rows)}
    </section>
  `;
}

function renderDataGaps(signal) {
  const failed = signal.uw_provider?.endpoints_failed || [];
  const legacy = (signal.source_status || []).filter((item) => item.is_mock || ['uw_dom', 'uw_screenshot', 'scheduler_health'].includes(item.source));
  const rows = [
    ['P0', 'UW', 'Dealer / GEX', 'Call Wall / Put Wall', '不可用时不能显示 0', '防止误导交易'],
    ['P1', 'UW', 'Dealer / GEX', 'GEX rows_used', `rows_used = ${radarText(signal.uw_wall_diagnostics?.rows_used, '0')}`, '墙位不能参与目标价'],
    ['P1', 'UW', 'Volatility', 'IV Rank / Term Structure / 0DTE EM', '字段未映射', '单腿不能放行'],
    ['P1', 'UW', 'Flow', 'RepeatedHits / ask-side / 0DTE', '字段未映射', '机构入场不能确认'],
    ['P2', 'UW', 'Dark Pool', 'premium > $1M levels', '聚合弱', '暗池只作背景'],
    ...failed.map((item) => ['Failed endpoint', 'UW', item.category || '--', item.path || item.endpoint || item.name, `${item.http_status || item.status} ${item.message || item.reason || ''}`, '对应层级不可用或降级']),
    ...legacy.map((item) => {
      const note =
        item.source === 'uw_dom'
          ? '历史 DOM mock，仅保留诊断，不参与首页、不参与分析、不参与操作。'
          : item.source === 'scheduler_health'
            ? '历史 scheduler mock，仅保留诊断，不参与首页、不参与分析、不参与操作。'
            : item.source === 'uw_screenshot'
              ? '截图降级源，仅保留诊断，不参与首页主判断，不参与操作。'
              : item.source === 'telegram'
                ? 'Telegram 是输出通道，不是行情或分析数据源，不参与首页主判断，不参与操作。'
                : '历史诊断源，不参与首页主判断。';
      return ['Legacy / Mock', item.source, 'Source State', item.fetch_mode || '--', note, '不能进入首页主数据判断'];
    })
  ].map((row) => row.map((cell) => escapeHtml(radarText(cell, '未提供'))));
  return `
    <section class="radar-card">
      <details>
        <summary><strong>Data Gaps / 数据缺口</strong></summary>
        ${renderRadarTable(['等级', '来源', '层级', '字段 / Endpoint', '问题', '影响'], rows)}
      </details>
    </section>
  `;
}

function safeJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (item === undefined || item === null || Number.isNaN(item)) return '--';
    return item;
  }, 2);
}

function renderDebugJson(signal) {
  const payload = {
    source_display: signal.source_display,
    source_status: signal.source_status,
    data_layer: signal.data_layer,
    analysis_layer: signal.analysis_layer,
    operation_layer: signal.operation_layer,
    uw_provider: signal.uw_provider,
    uw_endpoint_coverage: signal.uw_endpoint_coverage,
    uw_raw: signal.uw_raw,
    uw_normalized: signal.uw_normalized,
    uw_layer_conclusions: signal.uw_layer_conclusions,
    uw_factors: signal.uw_factors,
    gex_engine: signal.gex_engine,
    flow_aggression_engine: signal.flow_aggression_engine,
    volatility_engine: signal.volatility_engine,
    darkpool_engine: signal.darkpool_engine,
    market_sentiment_engine: signal.market_sentiment_engine,
    last_updated: signal.last_updated,
    stale_flags: signal.stale_flags
  };
  return `
    <section class="radar-card">
      <details>
        <summary><strong>折叠诊断数据</strong></summary>
        <pre class="radar-note">${escapeHtml(safeJson(payload))}</pre>
      </details>
    </section>
  `;
}

function renderRadar(signal) {
  const dh  = signal.data_health   || {};
  const pc  = signal.price_contract || {};
  const lv  = signal.levels        || {};
  const gr  = signal.gamma_regime_engine || {};
  const atm = signal.atm_engine    || {};
  const fb  = signal.flow_behavior_engine || {};
  const uf  = signal.uw_factors    || {};
  const ff  = uf.flow_factors      || {};
  const df  = uf.dealer_factors    || {};
  const vf  = uf.volatility_factors || {};
  const dp  = signal.darkpool_behavior_engine || {};
  const vd  = signal.vol_dashboard || {};
  const vx  = signal.vix_dashboard || {};
  const pve = signal.price_validation_engine || {};
  const sb  = signal.strike_battle || {};
  const vc  = signal.vanna_charm   || {};
  const sd  = signal.source_display || {};

  const spot = pc.spot ?? pc.live_price ?? null;
  const spotFmt = spot != null ? Number(spot).toFixed(1) : '--';

  function statusBadge(status) {
    const map = { LIVE: 'live', PARTIAL: 'partial', MISSING: 'missing', COLD_START: 'cold' };
    const cls = map[status] || 'missing';
    return `<span class="radar-status-badge ${cls}">${status || 'MISSING'}</span>`;
  }

  // ── 1. Price Source Radar ──────────────────────────────────────────────────
  const priceStatus = dh.spot?.status || 'MISSING';
  const priceBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">价格源雷达</span>
        ${statusBadge(priceStatus)}
      </div>
      <div class="radar-price-big">${escapeHtml(spotFmt)}</div>
      <div class="radar-price-source">主价格 ｜ ${escapeHtml(pc.spot_source || '--')}</div>
      <div class="radar-source-list">
        <div class="radar-src-row ${pc.spot_source === 'uw_flow_recent' ? 'active' : ''}">
          <span class="radar-src-dot"></span>UW spot_gex: ${escapeHtml(String(df.spot_gex_price ?? '--'))}
          ${pc.spot_source !== 'uw_flow_recent' ? '<span class="radar-src-tag amber">偏离过大</span>' : ''}
        </div>
        <div class="radar-src-row ${pc.spot_source === 'uw_iv_rank_close' ? 'active' : ''}">
          <span class="radar-src-dot"></span>iv_rank.close: ${escapeHtml(String(vf.iv_rank_close ?? '--'))}
          <span class="radar-src-tag gray">昨收</span>
        </div>
        <div class="radar-src-row missing">
          <span class="radar-src-dot red"></span>FMP: unavailable
          <span class="radar-src-tag red">Limit Reach</span>
        </div>
      </div>
      <div class="radar-note">当前优先使用 UW Flow 价格，FMP 今日不参与判断。</div>
    </article>`;

  // ── 2. Gamma / GEX Radar ──────────────────────────────────────────────────
  const gexRows = df.gex_by_strike || [];
  const gexStatus = dh.gex?.status || 'MISSING';
  const gammaRegime = gr.gamma_regime || 'unknown';
  const netGex = df.net_gex;
  const gammaFlip = lv.gamma_flip;
  const nearCallWall = lv.bull_trigger;
  const nearPutWall  = lv.bear_trigger;
  const wallSt = lv.wall_status || 'unavailable';

  const gexBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">Gamma / GEX 雷达</span>
        ${statusBadge(gexStatus)}
      </div>
      <div class="radar-gex-row">
        <div class="radar-gex-item"><div class="radar-gex-label">Gamma 环境</div><div class="radar-gex-val ${gammaRegime}">${gammaRegime === 'positive' ? '正 Gamma' : gammaRegime === 'negative' ? '负 Gamma' : '--'}</div></div>
        <div class="radar-gex-item"><div class="radar-gex-label">Net GEX</div><div class="radar-gex-val">${netGex != null ? (netGex >= 0 ? '+' : '') + Number(netGex).toLocaleString() : '--'}</div></div>
        <div class="radar-gex-item"><div class="radar-gex-label">GEX by Strike</div><div class="radar-gex-val">${gexRows.length} 行</div></div>
        <div class="radar-gex-item"><div class="radar-gex-label">Gamma Flip</div><div class="radar-gex-val">${gammaFlip != null ? Number(gammaFlip).toFixed(0) : '--'}</div></div>
      </div>
      <div class="radar-wall-row">
        <div class="radar-wall-box call ${wallSt === 'valid' && nearCallWall != null ? 'valid' : 'unavail'}">
          <div class="radar-wall-label">Call Wall</div>
          <div class="radar-wall-val">${wallSt === 'valid' && nearCallWall != null ? Number(nearCallWall).toFixed(0) : 'unavailable'}</div>
        </div>
        <div class="radar-wall-mid">
          <div class="radar-wall-mid-label">ATM</div>
          <div class="radar-wall-mid-val">${atm.atm != null ? Number(atm.atm).toFixed(0) : '--'}</div>
        </div>
        <div class="radar-wall-box put ${wallSt === 'valid' && nearPutWall != null ? 'valid' : 'unavail'}">
          <div class="radar-wall-label">Put Wall</div>
          <div class="radar-wall-val">${wallSt === 'valid' && nearPutWall != null ? Number(nearPutWall).toFixed(0) : 'unavailable'}</div>
        </div>
      </div>
      ${lv.global_gex_clusters && lv.global_gex_clusters.length > 0 ? `
      <div class="radar-global-gex">
        <span class="radar-global-label">Global GEX Cluster（仅 Radar 参考）：</span>
        ${lv.global_gex_clusters.slice(0,3).map(c => `<span class="radar-cluster-tag">${Number(c.strike).toFixed(0)} (${c.net_gex >= 0 ? '+' : ''}${Number(c.net_gex).toFixed(1)})</span>`).join(' ')}
      </div>` : ''}
      <!-- Far walls (Radar only — NOT homepage triggers) -->
      ${(lv.global_call_wall || lv.global_put_wall) ? `
      <div class="radar-far-walls">
        <div class="radar-far-wall-label">远端 Gamma 墙（Radar 背景）</div>
        <div class="radar-far-wall-row">
          <div class="radar-far-wall-box call"><span class="rfwb-label">远端 Call Wall</span><span class="rfwb-val">${lv.global_call_wall_fmt || '--'}</span></div>
          <div class="radar-far-wall-box put"><span class="rfwb-label">远端 Put Wall</span><span class="rfwb-val">${lv.global_put_wall_fmt || '--'}</span></div>
        </div>
        <div class="radar-far-wall-note">⚠ 远端墙只作背景，不作日内进场触发线。</div>
      </div>` : ''}
      <div class="radar-note">${escapeHtml(lv.gamma_flip_display || '--')}</div>
    </article>`;

  // ── 3. Flow 资金雷达 — v2: 5m+15m 双窗口 ─────────────────────────────────
  const flowStatus = dh.flow?.status || 'MISSING';
  // 5m window
  const netPremM   = ff.net_premium_5m != null ? (ff.net_premium_5m / 1e6).toFixed(1) : null;
  const callPremM  = ff.call_premium_5m != null ? (ff.call_premium_5m / 1e6).toFixed(1) : null;
  const putPremM   = ff.put_premium_5m  != null ? (Math.abs(ff.put_premium_5m) / 1e6).toFixed(1) : null;
  const pcVol      = ff.put_call_volume_ratio != null ? ff.put_call_volume_ratio.toFixed(2) : null;
  const pcPrem     = ff.put_call_premium_ratio != null ? ff.put_call_premium_ratio.toFixed(1) : null;
  // 15m window (from flow_behavior_engine)
  const netPrem15M  = fb.net_premium_15m_millions != null ? Number(fb.net_premium_15m_millions).toFixed(1) : null;
  const call15M     = fb.call_premium_15m_millions != null ? Number(fb.call_premium_15m_millions).toFixed(1) : null;
  const put15M      = fb.put_premium_15m_millions  != null ? Number(fb.put_premium_15m_millions).toFixed(1)  : null;
  const flow5mLabel  = fb.flow_5m_label  || null;
  const flow15mLabel = fb.flow_15m_label || null;
  const dualNarr     = fb.dual_window_narrative || null;
  const dualAligned  = fb.dual_window_aligned ?? false;
  // Phase 4/5: suspicious_same_window 警告
  const radarSuspicious = fb.suspicious_same_window === true;
  const radar5mFallback  = fb.flow_5m_is_fallback  === true;
  const radar15mFallback = fb.flow_15m_is_fallback === true;
  const flowBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">Flow 资金雷达</span>
        ${statusBadge(flowStatus)}
      </div>
      <div class="radar-flow-conclusion">资金结论：<strong>${escapeHtml(fb.behavior_label || fb.behavior || '--')}</strong></div>
      <!-- 5m+15m dual window -->
      <div class="radar-flow-dual-window">
        <div class="radar-flow-window">
          <div class="radar-flow-window-label">5m 窗口 ${flow5mLabel ? `<span class="flow-window-tag ${flow5mLabel.includes('多') ? 'bull' : flow5mLabel.includes('空') ? 'bear' : 'neutral'}">${escapeHtml(flow5mLabel)}</span>` : ''}</div>
          <div class="radar-flow-stats">
            <div class="radar-flow-stat"><span class="rfs-label">Net</span><span class="rfs-val ${netPremM != null && Number(netPremM) >= 0 ? 'bullish' : 'bearish'}">${netPremM != null ? (Number(netPremM) >= 0 ? '+' : '') + netPremM + 'M' : '--'}</span></div>
            <div class="radar-flow-stat"><span class="rfs-label">Call</span><span class="rfs-val bullish">${callPremM != null ? '+' + callPremM + 'M' : '--'}</span></div>
            <div class="radar-flow-stat"><span class="rfs-label">Put</span><span class="rfs-val bearish">${putPremM != null ? '+' + putPremM + 'M' : '--'}</span></div>
            <div class="radar-flow-stat"><span class="rfs-label">P/C Prem</span><span class="rfs-val" title="P/C Premium Ratio（权利金比率）">${pcPrem != null ? pcPrem : '--'}</span></div>
          </div>
        </div>
        <div class="radar-flow-window-divider">│</div>
        <div class="radar-flow-window">
          <div class="radar-flow-window-label">15m 窗口 ${flow15mLabel ? `<span class="flow-window-tag ${flow15mLabel.includes('多') ? 'bull' : flow15mLabel.includes('空') ? 'bear' : 'neutral'}">${escapeHtml(flow15mLabel)}</span>` : ''}</div>
          <div class="radar-flow-stats">
            <div class="radar-flow-stat"><span class="rfs-label">Net</span><span class="rfs-val ${netPrem15M != null && Number(netPrem15M) >= 0 ? 'bullish' : 'bearish'}">${netPrem15M != null ? (Number(netPrem15M) >= 0 ? '+' : '') + netPrem15M + 'M' : '--'}</span></div>
            <div class="radar-flow-stat"><span class="rfs-label">Call</span><span class="rfs-val bullish">${call15M != null ? '+' + call15M + 'M' : '--'}</span></div>
            <div class="radar-flow-stat"><span class="rfs-label">Put</span><span class="rfs-val bearish">${put15M != null ? '+' + put15M + 'M' : '--'}</span></div>
          </div>
        </div>
      </div>
      ${dualNarr ? `
      <div class="radar-flow-dual-narrative ${dualAligned ? 'aligned' : 'diverged'}">
        <span class="dual-icon">${dualAligned ? '✅' : '⚠'}</span>
        <span class="dual-text">${escapeHtml(dualNarr)}</span>
      </div>` : ''}
      <div class="radar-flow-extra">
        <div class="radar-flow-stat"><span class="rfs-label">P/C Volume</span><span class="rfs-val" title="P/C Volume Ratio（成交量比率）">${pcVol != null ? pcVol : 'unavailable'}</span></div>
        <div class="radar-flow-stat"><span class="rfs-label">P/C Primary</span><span class="rfs-val" title="主用 P/C（有成交量时用 Volume，否则用 Premium）">${(() => { const pcPrimary = ff.put_call_ratio != null ? ff.put_call_ratio.toFixed(2) : null; return pcPrimary != null ? pcPrimary : '--'; })()}</span></div>
        <div class="radar-flow-stat rfs-note"><span class="rfs-label-note">注</span><span class="rfs-val-note">P/C Prem = 权利金比；P/C Volume = 成交量比；Primary = 优先 Volume</span></div>
      </div>
      ${radarSuspicious ? `<div class="radar-flow-warning">⚠ 5m/15m 窗口数据异常（冷启动 fallback 或缓存复用），数值仅供参考。</div>` : ''}
      ${(radar5mFallback || radar15mFallback) ? `<div class="radar-flow-fallback">ℹ ${radar5mFallback ? '5m' : ''} ${radar15mFallback ? '15m' : ''} 窗口使用历史推算。</div>` : ''}
      <div class="radar-note">${escapeHtml(fb.reason || '资金流向信号不足。')}</div>
    </article>`;
  // ── 4. Strike 战场 ────────────────────────────────────────────────────────
  const sbStatus = sb.status === 'partial' ? 'PARTIAL' : 'MISSING';
  const sbRows = (sb.rows || []).map((r) => `
    <tr>
      <td>${r.strike}</td>
      <td class="${r.call_gex_level === '高' ? 'bearish' : r.call_gex_level === '中' ? 'amber' : 'gray'}">${r.call_gex_level}</td>
      <td class="${r.put_gex_level === '高' ? 'bullish' : r.put_gex_level === '中' ? 'amber' : 'gray'}">${r.put_gex_level}</td>
      <td class="${r.conclusion === '强压区' ? 'bearish' : r.conclusion === '下方目标' ? 'bullish' : 'neutral'}">${r.conclusion}</td>
    </tr>`).join('');

  const strikeBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">Strike 战场</span>
        ${statusBadge(sbStatus)}
      </div>
      ${sbRows ? `
      <table class="radar-table">
        <thead><tr><th>Strike</th><th>Call</th><th>Put</th><th>结论</th></tr></thead>
        <tbody>${sbRows}</tbody>
      </table>` : '<div class="radar-note">Strike 数据不足。</div>'}
      <div class="radar-note">${escapeHtml(sb.note || '--')}</div>
    </article>`;

  // ── 5. 暗盘 / Dark Pool 雷达 ──────────────────────────────────────────────
  const dpStatus = dh.dark_pool?.status || 'MISSING';
  const dpClusters = dp.clusters || [];
  const dpBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">暗盘 / Dark Pool 雷达</span>
        ${statusBadge(dpStatus)}
      </div>
      ${dpClusters.slice(0,3).map((c) => `
      <div class="radar-dp-row">
        <span class="radar-dp-level">${c.spx_level != null ? Number(c.spx_level).toFixed(0) : '--'}</span>
        <span class="radar-dp-prem">${c.total_premium_millions != null ? '$' + c.total_premium_millions.toFixed(1) + 'M' : '--'}</span>
        <span class="radar-dp-tag ${c.behavior === 'breakout' ? 'bearish' : 'bullish'}">${escapeHtml(c.behavior_cn || c.behavior || '--')}</span>
      </div>`).join('') || '<div class="radar-note">暗盘数据待接入。</div>'}
      <div class="radar-note">若现价站不回这些区域，反弹容易被压。</div>
    </article>`;

  // ── 6. Vanna / Charm 雷达 ─────────────────────────────────────────────────
  const vcStatus = vc.status === 'partial' ? 'PARTIAL' : 'MISSING';
  const vcRows = (vc.rows || []).map((r) => `
    <tr>
      <td>${r.strike}</td>
      <td class="${r.net_vanna_label === '正' ? 'bullish' : r.net_vanna_label === '负' ? 'bearish' : 'neutral'}">${r.net_vanna_label}</td>
      <td class="${r.net_charm_label === '正' ? 'bullish' : r.net_charm_label === '负' ? 'bearish' : 'neutral'}">${r.net_charm_label}</td>
      <td>${escapeHtml(r.talk)}</td>
    </tr>`).join('');

  const vannaBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">Vanna / Charm 雷达</span>
        ${statusBadge(vcStatus)}
      </div>
      ${vcRows ? `
      <table class="radar-table">
        <thead><tr><th>Strike</th><th>Net Vanna</th><th>Net Charm</th><th>入话</th></tr></thead>
        <tbody>${vcRows}</tbody>
      </table>` : '<div class="radar-note">Vanna/Charm 数据不足。</div>'}
      <div class="radar-note">${escapeHtml(vc.note || '--')}</div>
    </article>`;

  // ── 7. 波动率仪表盘 ───────────────────────────────────────────────────────
  const ivStatus = dh.iv?.status || 'MISSING';
  const iv30Val  = vd.iv30;
  const ivRankV  = vd.iv_rank;
  const ivPctV   = vd.iv_percentile;
  const ivNeedle = Math.min(100, ivRankV ?? 0);

  const volBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">波动率仪表盘</span>
        ${statusBadge(ivStatus)}
      </div>
      <div class="radar-vol-gauge">
        <svg viewBox="0 0 200 110" class="radar-gauge-svg">
          <path d="M20,100 A80,80,0,0,1,180,100" fill="none" stroke="#e5e7eb" stroke-width="14" stroke-linecap="round"/>
          <path d="M20,100 A80,80,0,0,1,180,100" fill="none" stroke="${ivRankV > 60 ? '#ef4444' : ivRankV > 30 ? '#f59e0b' : '#22c55e'}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${ivNeedle * 2.51} 251"/>
          <text x="100" y="88" text-anchor="middle" class="gauge-big-text">${iv30Val != null ? iv30Val.toFixed(1) + '%' : '--'}</text>
          <text x="100" y="105" text-anchor="middle" class="gauge-small-text">IV30</text>
        </svg>
      </div>
      <div class="radar-vol-stats">
        <div class="rvs-row"><span class="rvs-label">IV Rank</span><span class="rvs-val">${ivRankV != null ? ivRankV.toFixed(1) : '--'}</span></div>
        <div class="rvs-row"><span class="rvs-label">IV Percentile</span><span class="rvs-val">${ivPctV != null ? ivPctV.toFixed(1) + '%' : '--'}</span></div>
        <div class="rvs-row"><span class="rvs-label">买方风险</span><span class="rvs-val ${vd.buyer_risk_color || 'gray'}">${escapeHtml(vd.buyer_risk || '--')}</span></div>
      </div>
      <div class="radar-note">${escapeHtml(vd.commentary || '--')}</div>
    </article>`;

  // ── 8. VIX 仪表盘 ─────────────────────────────────────────────────────────
  const vixStatus = dh.vix?.status || 'MISSING';
  const vixNeedle = Math.min(100, vx.vix != null ? (vx.vix / 50) * 100 : 0);

  const vixBlock = `
    <article class="radar-module">
      <div class="radar-module-header">
        <span class="radar-module-title">VIX 仪表盘</span>
        ${statusBadge(vixStatus)}
      </div>
      <div class="radar-vol-gauge">
        <svg viewBox="0 0 200 110" class="radar-gauge-svg">
          <path d="M20,100 A80,80,0,0,1,180,100" fill="none" stroke="#e5e7eb" stroke-width="14" stroke-linecap="round"/>
          <path d="M20,100 A80,80,0,0,1,180,100" fill="none" stroke="${vx.risk_color === 'red' ? '#ef4444' : vx.risk_color === 'amber' ? '#f59e0b' : '#22c55e'}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${vixNeedle * 2.51} 251"/>
          <text x="100" y="88" text-anchor="middle" class="gauge-big-text">${vx.status === 'missing' ? '--' : escapeHtml(vx.vix_fmt || '--')}</text>
          <text x="100" y="105" text-anchor="middle" class="gauge-small-text">VIX</text>
        </svg>
      </div>
      <div class="radar-vol-stats">
        <div class="rvs-row"><span class="rvs-label">来源</span><span class="rvs-val">FMP</span></div>
        <div class="rvs-row"><span class="rvs-label">状态</span><span class="rvs-val ${vx.status === 'missing' ? 'red' : 'green'}">${vx.status === 'missing' ? 'Limit Reach' : 'LIVE'}</span></div>
      </div>
      <div class="radar-note">${vx.status === 'missing' ? 'VIX 数据不可用，无法提供波动情绪参考。' : escapeHtml(vx.commentary || '--')}</div>
    </article>`;

  // ── 9. 动态反射验证 / Price Validation ───────────────────────────────────
  const pvStatus = dh.price_validation?.status || 'COLD_START';
  const pvBufSize = pve.buffer_size ?? 0;
  const pvEta     = dh.price_validation?.cold_start_eta_min ?? 0;
  const pvScenes  = [
    { key: 'put_squeezed',      label: 'Put 被绞',    icon: '🛡' },
    { key: 'call_capped',       label: 'Call 被压',   icon: '🔴' },
    { key: 'bottom_absorption', label: '底部承接',    icon: '❄' },
    { key: 'positive_gamma_pin',label: '正 Gamma 磁吸', icon: '🧲' }
  ];
  const pvSceneHtml = pvScenes.map((s) => {
    const sceneData = pve[s.key] || {};
    const detected  = sceneData.detected === true;
    const conf      = sceneData.confidence ?? 0;
    return `
    <div class="pv-scene ${detected ? 'active' : 'inactive'}">
      <span class="pv-scene-icon">${s.icon}</span>
      <div class="pv-scene-body">
        <div class="pv-scene-label">${s.label}</div>
        <div class="pv-scene-status">${detected ? '已激活' : '未激活'}</div>
      </div>
    </div>`;
  }).join('');

  const pvBlock = `
    <article class="radar-module pv-module">
      <div class="radar-module-header">
        <span class="radar-module-title">动态反射验证 / Price Validation</span>
        ${statusBadge(pvStatus)}
      </div>
      <div class="pv-scenes">${pvSceneHtml}</div>
      <div class="pv-cold-start">
        <span class="pv-clock">⏱</span>
        价格点 ${pvBufSize} / 10 · 预计 ${pvEta} 分钟后可用
      </div>
      <div class="radar-note">动态验证仍在冷启动，但正 Gamma 磁吸已提示 ATM 附近不宜做 0DTE。</div>
    </article>`;

  // ── Data Health sidebar ────────────────────────────────────────────────────
  const dhItems = [
    { label: 'UW API',           status: dh.uw_api?.status },
    { label: 'Spot',             status: dh.spot?.status },
    { label: 'Flow',             status: dh.flow?.status },
    { label: 'GEX',              status: dh.gex?.status },
    { label: 'Dark Pool',        status: dh.dark_pool?.status },
    { label: 'IV',               status: dh.iv?.status },
    { label: 'VIX',              status: dh.vix?.status },
    { label: 'Price Validation', status: dh.price_validation?.status }
  ];
  const dhHtml = dhItems.map((item) => {
    const cls = item.status === 'LIVE' ? 'live' : item.status === 'PARTIAL' ? 'partial' : item.status === 'COLD_START' ? 'cold' : 'missing';
    return `<div class="dh-row"><span class="dh-dot ${cls}"></span><span class="dh-label">${item.label}</span><span class="dh-status ${cls}">${item.status || 'MISSING'}</span></div>`;
  }).join('');

  const dataHealthBlock = `
    <article class="radar-module data-health-module">
      <div class="radar-module-header">
        <span class="radar-module-title">数据健康</span>
        ${statusBadge(dh.score >= 70 ? 'LIVE' : dh.score >= 40 ? 'PARTIAL' : 'MISSING')}
      </div>
      <div class="dh-score-bar">
        <div class="dh-score-fill" style="width:${dh.score || 0}%"></div>
      </div>
      <div class="dh-score-label">数据完整度 ${dh.score || 0}/100</div>
      <div class="dh-list">${dhHtml}</div>
      ${dh.homepage_locked ? `<div class="dh-locked-note">🔒 首页状态：锁仓<br><small>${escapeHtml(dh.homepage_locked_reason || '')}</small></div>` : ''}
      <div class="radar-note">有些模块缺字段，但第二页仍然保留可参考信息。</div>
    </article>`;

  return `
    <main class="page radar-v2">
      <div class="radar-header">
        <div class="radar-header-left">
          <h1 class="radar-title">SPX 数据雷达 ｜ Evidence Board</h1>
          <p class="radar-subtitle">第一页锁仓时，这里继续给你证据</p>
        </div>
        <div class="radar-header-center">
          <div class="radar-completeness">
            <span class="rc-label">数据完整度 ${dh.score || 0}/100</span>
            <div class="rc-bar"><div class="rc-fill" style="width:${dh.score || 0}%"></div></div>
          </div>
        </div>
        <div class="radar-header-right">
          ${dh.homepage_locked ? `<div class="radar-locked-badge">🔒 首页状态：锁仓<br><small>${escapeHtml(dh.homepage_locked_reason || '')}</small></div>` : '<div class="radar-unlocked-badge">✅ 首页已解锁</div>'}
        </div>
      </div>

      <div class="radar-grid">
        ${priceBlock}
        ${gexBlock}
        ${dataHealthBlock}
        ${flowBlock}
        ${strikeBlock}
        ${dpBlock}
        ${vannaBlock}
        ${volBlock}
        ${vixBlock}
        ${pvBlock}
      </div>
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
  // Tab switching for primary-tabs
  document.querySelectorAll('.ptab-container').forEach(container => {
    container.querySelectorAll('.ptab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        container.querySelectorAll('.ptab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        container.querySelectorAll('.ptab-pane').forEach(p => { p.style.display = 'none'; });
        const pane = container.querySelector('#ptab-pane-' + tab);
        if (pane) pane.style.display = 'block';
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderLoading();
  try {
    const signal = await loadSignal();
    renderPage(signal);
    // v3: Auto-polling — refresh based on refresh_policy from backend
    startAutoPolling(signal);
  } catch (error) {
    renderError(error);
  }
});

// ── Auto-polling engine ───────────────────────────────────────────────────────
let _pollTimer = null;
function startAutoPolling(initialSignal) {
  if (_pollTimer) clearTimeout(_pollTimer);
  const policy = (initialSignal && initialSignal.refresh_policy) || {};
  // Use backend-recommended interval, fallback to 15s for trading hours, 60s otherwise
  const isMarketHours = (() => {
    const now = new Date();
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const utcMins = utcH * 60 + utcM;
    // NYSE: 13:30-20:00 UTC (9:30am-4:00pm ET)
    return utcMins >= 810 && utcMins < 1200;
  })();
  const recommendedMs = policy.interval_ms || (isMarketHours ? 15000 : 60000);
  // Turbo mode: if price is near ATM trigger lines, refresh every 5s
  const ate = initialSignal && initialSignal.atm_trigger_engine;
  const spot = initialSignal && initialSignal.price_contract && initialSignal.price_contract.live_price;
  let intervalMs = recommendedMs;
  if (ate && spot != null) {
    const bull1 = ate.bull_trigger_1;
    const bear1 = ate.bear_trigger_1;
    if ((bull1 != null && Math.abs(spot - bull1) <= 3) ||
        (bear1 != null && Math.abs(spot - bear1) <= 3)) {
      intervalMs = 5000; // Turbo: price within 3pts of trigger line
    }
  }
  _pollTimer = setTimeout(async () => {
    try {
      const newSignal = await loadSignal();
      // Only re-render if page is visible (avoid wasted renders in background tabs)
      if (!document.hidden) {
        renderPage(newSignal);
      }
      startAutoPolling(newSignal); // schedule next poll with updated signal
    } catch (e) {
      // On error, retry after 30s
      _pollTimer = setTimeout(() => startAutoPolling(initialSignal), 30000);
    }
  }, intervalMs);
}

// Activate sniper overlay when any wall is in range
(function activateSniperOverlay() {
  const overlay = document.getElementById('sniper-overlay');
  if (!overlay) return;
  const sniperItems = document.querySelectorAll('.wall-item.sniper-active');
  if (sniperItems.length > 0) {
    overlay.classList.add('active');
  } else {
    overlay.classList.remove('active');
  }
})();

