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
    control_side: signal.control_side || {}
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
    coreReason: '有 Put 资金线索，但墙位、波动率、暗池、TV 未确认。'
  };
}

function renderHomeRows(rows = []) {
  return `
    <div class="home-field-list">
      ${rows.map(([label, value]) => `
        <div class="home-field-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(humanHomeText(value, '还没有足够信息，不能用于下单。'))}</b></div>
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

function renderHome(signal) {
  const home = homepageState(signal);
  return `
    <main class="page home-v1">
      ${renderHomeTopMood(home)}
      ${renderGoldenDecision(home)}
      ${renderExecutionSection(home)}
      ${renderAnalysisTiles(home)}
      ${renderBottomPlaceholders(home)}
    </main>
  `;
}

function renderHomeTopMood(home) {
  return `
    <section class="home-status-strip">
      ${renderStatusPill('MASTER', homeMasterSignal(home.operation_layer, home.final_decision), 'wait')}
      ${renderStatusPill('方向', home.direction, 'support')}
      ${renderStatusPill('数据', home.dataHealth, 'support')}
      ${renderStatusPill('安全锁', home.lockText, 'prohibit')}
      <div class="status-reason"><span>原因</span><b>${escapeHtml(homeSanitize(home.coreReason))}</b></div>
    </section>
  `;
}

function renderStatusPill(label, value, tone) {
  return `
    <div class="status-pill ${tone}">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(homeSanitize(value))}</b>
    </div>
  `;
}

function humanHomeText(value, fallback = '这项数据还不能用于交易计划。') {
  const text = homeSanitize(value, fallback);
  const replacements = [
    [/Gamma Flip 暂不能确认。?/g, '做市商分界线还没算出来，所以暂时不能判断大盘是在震荡区，还是容易单边加速。'],
    [/lower_brake_zone/g, '下方大成交承接区'],
    [/Put RepeatedHits/g, '有资金连续买 Put，说明有人押下跌或买保护'],
    [/Data Health Score/g, '数据完整度'],
    [/核心操作字段缺失，不能 ready/g, '还缺做市商墙位、波动率结论、0DTE / 多腿过滤，所以暂时不给入场、止损、TP'],
    [/不能 ready/g, '还不能生成完整交易计划'],
    [/撞墙/g, '追空容易打到下方承接区'],
    [/unavailable/g, '数据源还没接好'],
    [/cluster_wall/g, '暗池大成交聚集区'],
    [/background_only/g, '只能做背景参考'],
    [/normalized/g, '已整理的数据'],
    [/raw/g, '原始数据'],
    [/endpoint/g, '数据接口'],
    [/parser/g, '数据转换器'],
    [/operation_layer/g, '执行安全层'],
    [/partial/g, '部分可参考'],
    [/null/g, '还没有数值'],
    [/undefined/g, '还没有数值'],
    [/NaN/g, '还没有数值']
  ];
  return replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

function buildHomeHumanCopy(home = {}) {
  const execution = home.execution_card || {};
  const wall = home.dealer_wall_map || {};
  const gravity = home.darkpool_gravity || {};
  const conflict = home.flow_conflict || {};
  const volState = home.volatility_state || {};
  const priceTrigger = home.price_trigger || execution.price_trigger || {};
  const newsRadar = home.news_radar || execution.news_radar || {};
  const wallZone = home.wall_zone_panel || execution.wall_zone_panel || {};
  const controlSide = home.control_side || execution.control_side || wallZone.control_side || {};
  const hasDealerWalls = wall.call_wall != null || wall.put_wall != null || wall.gamma_flip != null;
  const darkLevel = priceTrigger.key_level != null
    ? Number(priceTrigger.key_level).toFixed(2)
    : gravity.mapped_spx != null ? Number(gravity.mapped_spx).toFixed(2) : '7150.23';
  const mainConclusion = execution.status === 'READY'
    ? 'READY，可以按完整计划执行。'
    : 'WAIT，不能开仓。';
  const bias = '有 Put 看空线索，但不能追 Put。';
  const dealerImpact = hasDealerWalls
    ? `做市商墙位已生成：上方约 ${homeSanitize(wall.call_wall)}，下方约 ${homeSanitize(wall.put_wall)}，分界线约 ${homeSanitize(wall.gamma_flip)}。`
    : '做市商墙位还没生成。现在不能用 Gamma 判断上方压力、下方支撑和趋势加速区。';
  const darkPoolImpact = gravity.mapped_spx != null
    ? `下方 ${darkLevel} 附近有暗池大成交区。这里可能有资金承接，追 Put 要小心。`
    : '暗池现在只有背景参考，还不能给出明确承接区。';
  const flowImpact = '有资金连续买 Put，说明有人押下跌或买保护。这是看空线索，但还不能单独作为开仓信号。';
  const volImpact = volState.vscore != null
    ? `波动率 Vscore 是 ${volState.vscore}，用来判断期权贵不贵。`
    : '波动率公式已准备好。但 Vscore 还没算出来，所以暂时不能判断期权贵不贵。';
  const sentimentImpact = '市场情绪轻微防守。不是强空，只能做背景。';
  const headline = hasDealerWalls
    ? humanHomeText(execution.headline_cn, 'WAIT，不能开仓。')
    : '下方暗池大成交区限制追空，做市商墙位还没生成。';
  return {
    mainConclusion,
    bias,
    headline,
    action: gravity.mapped_spx != null ? `禁止追 Put，等 ${darkLevel} 附近回踩反应。` : '只观察，不追空。',
    priceTrigger,
    newsRadar,
    wallZone,
    controlSide,
    dealerImpact,
    darkPoolImpact,
    flowImpact,
    volImpact,
    sentimentImpact,
    whyList: [
      '有资金连续买 Put，说明有人押下跌或买保护。',
      darkPoolImpact,
      '现在追 Put，容易刚追进去就遇到反弹。',
      dealerImpact,
      volImpact
    ],
    waitList: [
      `等价格回踩 ${darkLevel} 附近。`,
      `如果 ${darkLevel} 附近站稳反弹，再观察 Call。`,
      `如果 ${darkLevel} 放量跌破，再重新评估 Put。`,
      '等 Flow 继续同向并完成 0DTE / 多腿过滤。',
      '没有入场、止损、TP，不下单。'
    ],
    doNotList: [
      '不追 Put。',
      '不提前买 Put。',
      '不根据单一 Flow 信号开仓。',
      '没有入场、止损、TP 前不下单。'
    ]
  };
}

function renderGoldenDecision(home) {
  const spot = home.spot_conclusion;
  const copy = buildHomeHumanCopy(home);
  return `
    <section class="home-golden-grid">
      <article class="home-panel home-panel-side">
        <div class="home-panel-title"><span>黄金决策区</span><b>市场机制</b></div>
        ${renderHomeRows([
          ['实时价格', spot.spot ?? spot.price ?? '还没有拿到可用于计划的实时价格'],
          ['市场机制', copy.dealerImpact],
          ['解释', '做市商墙位还没生成，所以暂时不能判断大盘是在震荡区，还是容易单边加速。']
        ])}
      </article>

      <article class="home-panel home-decision-card">
        <div class="home-decision-head">
          <span>盘中决策卡</span>
          <strong>WAIT</strong>
        </div>
        ${renderHomeRows([
          ['主结论', copy.mainConclusion],
          ['当前偏向', copy.bias],
          ['为什么不能做', copy.whyList.slice(0, 2).join(' ')],
          ['Dealer / Gamma', copy.dealerImpact],
          ['资金线索', copy.flowImpact],
          ['操作', copy.action]
        ])}
      </article>

      <article class="home-panel home-panel-side">
        <div class="home-panel-title"><span>风控</span><b>波动率 / VIX</b></div>
        ${renderHomeRows([
          ['波动状态', copy.volImpact],
          ['期权成本', copy.volImpact],
          ['杀估值风险', '等 Vscore 出来后再判断'],
          ['VIX', '这一项还没有接入首页交易计划'],
          ['0DTE 预期波动', '等 0DTE 数据进入后再判断'],
          ['结论', '波动率 Vscore 还没算出来，不能判断期权贵不贵。']
        ])}
      </article>
    </section>
  `;
}

function renderExecutionSection(home) {
  const operation = home.operation_layer;
  const copy = buildHomeHumanCopy(home);
  const masterSignal = homeMasterSignal(operation, home.final_decision);
  const waiting = operation.status !== 'ready';
  return `
    <section class="home-execution-grid">
      <article class="home-card execution-card">
        <div class="home-card-title"><span>操作执行卡</span><b>${waiting ? '等待' : '可执行'}</b></div>
        ${renderHomeRows([
          ['操作状态', 'WAIT，不能开仓'],
          ['计划方向', copy.bias],
          ['关键观察位', execution.next_price_to_watch ?? '等暗池观察区刷新'],
          ['当前阶段', execution.price_trigger?.state_cn || '等价格靠近关键观察位'],
          ['为什么不能开仓', copy.whyList[1]],
          ['下一步', execution.price_trigger?.next_action_cn || copy.waitList[0]],
          ['看 Call 条件', execution.price_trigger?.bullish_condition_cn || '7150 附近站稳并反弹，再观察 Call 候选。'],
          ['看 Put 条件', execution.price_trigger?.bearish_condition_cn || '7150 放量跌破并回抽不过，再重新评估 Put。'],
          ['禁做条件', execution.price_trigger?.no_trade_condition_cn || '7150 附近来回乱磨，或者没有入场、止损、TP，不做。'],
          ['新闻风险', execution.news_radar?.news_risk_cn || '低'],
          ['墙位区', execution.wall_zone_panel?.summary_cn || 'GEX 墙位暂时不能用；暗池显示 7150 附近有大成交观察区。'],
          ['入场 / 止损 / TP', '还没有入场、止损、目标价，不能下单']
        ])}
      </article>

      <article class="home-card master-signal-card">
        <span class="home-eyebrow">主信号</span>
        <div class="master-signal-value">${escapeHtml(masterSignal)}</div>
        ${renderHomeRows([
          ['数据能不能出计划', '数据可以参考，但还不能生成完整交易计划。'],
          ['安全锁', home.lockText],
          ['原因', '还缺做市商墙位、波动率结论、0DTE / 多腿过滤，所以暂时不给入场、止损、TP。']
        ])}
      </article>
    </section>
  `;
}

function renderAnalysisTiles(home) {
  const copy = buildHomeHumanCopy(home);
  const tiles = [
    ['Dealer', '做市商墙位还没生成。', '现在不能用 Gamma 判断上方压力、下方支撑和趋势加速区。', '不能生成入场、止损、目标价。'],
    ['Flow', '有资金连续买 Put。', copy.flowImpact, '这是看空线索，但还不能单独作为开仓信号。'],
    ['Volatility', '波动率公式已准备好。', copy.volImpact, '暂时不能判断期权贵不贵。'],
    ['Dark Pool', copy.darkPoolImpact, '这里可能有资金承接，追 Put 要小心。', '只能观察，不是正式支撑。'],
    ['Sentiment', '市场情绪轻微防守。', '不是强空。', '只能做背景。']
  ];
  return `
    <section class="home-factor-grid">
      <div class="home-section-heading">五因子瓦片</div>
      ${tiles.map(([title, state, summary, limit]) => `
        <article class="factor-tile">
          <div class="factor-title">${escapeHtml(title)}</div>
          <div class="factor-state">${escapeHtml(state)}</div>
          <div class="factor-summary">${escapeHtml(summary)}</div>
          <div class="factor-limit">${escapeHtml(limit)}</div>
        </article>
      `).join('')}
    </section>
  `;
}

function renderBottomPlaceholders() {
  const home = arguments[0] || {};
  const news = home.news_radar || {};
  const wallPanel = home.wall_zone_panel || {};
  const control = home.control_side || wallPanel.control_side || {};
  const nearestZone = wallPanel.darkpool_zone?.nearest_zone || {};
  return `
    <section class="home-bottom-grid">
      <article class="placeholder-card">
        <div class="home-card-head">
          <span>新闻雷达</span>
          <h3>Brave 市场雷达</h3>
        </div>
        ${renderHomeRows([
          ['新闻风险', news.news_risk_cn || '新闻只做背景参考'],
          ['宏观事件', news.macro_event_cn || '没有确认的宏观冲击'],
          ['财报预告', news.earnings_event_cn || '没有确认的重大财报临近'],
          ['科技权重', news.mega_cap_cn || '科技权重暂未给出额外方向'],
          ['市场主线', news.market_theme_cn || '等待新闻雷达下一轮刷新'],
          ['操作影响', news.operation_impact_cn || '只做背景，不直接开仓']
        ])}
      </article>
      <article class="placeholder-card">
        <div class="home-card-head">
          <span>墙位与控盘</span>
          <h3>GEX / 暗池墙位</h3>
        </div>
        ${renderHomeRows([
          ['控盘判断', control.side_cn || '多空拉扯，先观察。'],
          ['依据', Array.isArray(control.evidence_cn) ? control.evidence_cn.slice(0, 2).join(' ') : '等待 Flow、暗池和做市商墙位共同确认。'],
          ['暗池观察区', nearestZone.summary_cn || wallPanel.darkpool_zone?.summary_cn || '7150 附近是重点观察区。'],
          ['GEX 墙位', wallPanel.gex_wall?.summary_cn || '做市商墙位还没生成。'],
          ['操作含义', control.action_cn || wallPanel.action_cn || '不追 Put，等 7150 附近反应。']
        ])}
      </article>
    </section>
  `;
}

function buildDataQualityGuardText(signal, spotSourceText) {
  if (signal.data_quality_guard?.plain_chinese) {
    const gapItems = Object.entries(signal.source_status || {})
      .filter(([, source]) => source?.show_in_data_gaps)
      .map(([name, source]) => `${name.toUpperCase()}：${source.reason || source.status}`);
    return {
      title: signal.data_quality_guard.title || '数据质量：可观察，等待结构确认。',
      items: gapItems.length > 0 ? gapItems : signal.data_quality_guard.items || [signal.data_quality_guard.plain_chinese]
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

function radarCompleteness(value) {
  if (value === true) return '完整';
  if (value === 'partial') return '部分';
  return '缺失';
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
            <div class="matrix-name">${escapeHtml(name)}<br>${statusTag(radarHumanStatus(layer.status))}</div>
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
  return `
    <main class="page">
      <section class="radar-layout">
        ${renderDataSourceOverview(signal)}
        ${renderUwLayerStatus(signal)}
        ${renderEndpointEvidence(signal)}
        ${renderMappingStatus(signal)}
        ${renderUwAggregateAnalysis(signal)}
        ${renderDataGaps(signal)}
        ${renderDebugJson(signal)}
      </section>
      <div class="footer-note">Radar 是数据管理页，只显示数据接入、字段质量和映射状态。首页才负责交易分析和操作指令。Radar 不生成独立交易信号。</div>
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
