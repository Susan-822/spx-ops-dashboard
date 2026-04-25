function safeLine(value, fallback = '--') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function setupTitle(tradePlan = {}, tvSentinel = {}) {
  if (tradePlan.status === 'invalidated' || tvSentinel.event_type === 'structure_invalidated') {
    return '结构作废';
  }
  if (tradePlan.status === 'blocked' && tvSentinel.stale) {
    return 'TV过期';
  }
  if (tradePlan.direction_label && tradePlan.direction_label !== '禁做') {
    if (tradePlan.status === 'ready') {
      return `${tradePlan.direction_label}准备`;
    }
    return tradePlan.direction_label;
  }
  if (tradePlan.status === 'blocked') {
    return '突破不追';
  }
  if (tradePlan.status === 'waiting') {
    return '等待';
  }
  return '等待';
}

function buildTargetsLine(targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return '--';
  }
  const parts = targets
    .map((item) => {
      const level = item?.level == null ? '--' : item.level;
      return `${item?.name || 'TP'} ${level}${item?.basis ? ` ${item.basis}` : ''}`;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join('；') : '--';
}

function buildStrategyLine(permission = {}) {
  const single = permission.single_leg || 'wait';
  const vertical = permission.vertical || 'wait';
  const iron = permission.iron_condor || 'wait';
  return `单腿 ${single}；垂直 ${vertical}；铁鹰 ${iron}`;
}

function buildDataLine(signal = {}, commandEnvironment = {}, tvSentinel = {}) {
  const tradingviewStatus = tvSentinel.stale ? 'TV stale' : 'TV live';
  const dealer = signal?.dealer_conclusion?.plain_chinese || 'Dealer 结论待确认';
  const flow = signal?.uw_conclusion?.plain_chinese || 'UW 结论待确认';
  const uwStatus = signal?.source_status_uw?.state
    ? `UW ${signal.source_status_uw.state}${signal?.source_status_uw?.stale ? ' stale' : ''}`
    : 'UW unavailable';
  const fmp = signal?.fmp_conclusion?.plain_chinese || 'FMP 结论待确认';
  const mode = commandEnvironment.data_mode || 'partial';
  return `${tradingviewStatus}；${uwStatus}；${dealer}；${flow}；${fmp}；数据模式 ${mode}`;
}

export function determineTelegramLevel({ tradePlan = {}, tvSentinel = {}, commandEnvironment = {}, dataQuality = {} }) {
  if (tradePlan.status === 'invalidated' || tvSentinel.event_type === 'structure_invalidated') {
    return 'L4';
  }
  if (tvSentinel.stale || dataQuality.coherence === 'mixed' || commandEnvironment.data_mode === 'mock') {
    return 'L4';
  }
  if (tradePlan.status === 'ready') {
    return 'L3';
  }
  if (tradePlan.status === 'waiting' && commandEnvironment.allowed) {
    return 'L2';
  }
  return 'L1';
}

export function buildTelegramDedupeKey({ signal = {}, tradePlan = {}, tvSentinel = {} }) {
  return [
    signal.symbol || 'SPX',
    tvSentinel.timeframe || signal.timeframe || '1m',
    tvSentinel.event_type || 'none',
    tvSentinel.side || tradePlan.side || 'neutral',
    tradePlan.setup_type || tradePlan.setup_code || 'none',
    tradePlan.status || 'waiting'
  ].join('|');
}

export function getTelegramAlertMeta({ signal = {} }) {
  const commandEnvironment = signal?.engines?.command_environment || {};
  const tvSentinel = signal?.engines?.tv_sentinel || {};
  const tradePlan = signal?.engines?.trade_plan || {};
  const dataQuality = signal?.engines?.data_health || {};

  return {
    level: determineTelegramLevel({
      tradePlan,
      tvSentinel,
      commandEnvironment,
      dataQuality
    }),
    dedupeKey: buildTelegramDedupeKey({
      signal,
      tradePlan,
      tvSentinel
    }),
    tradePlan,
    tvSentinel,
    commandEnvironment,
    dataQuality
  };
}

export function buildTradePlanTelegramMessage({ signal }) {
  const commandEnvironment = signal?.engines?.command_environment || {};
  const tvSentinel = signal?.engines?.tv_sentinel || {};
  const tradePlan = signal?.engines?.trade_plan || {};
  const dataQuality = signal?.engines?.data_health || {};

  return [
    `【SPX 指挥台｜${setupTitle(tradePlan, tvSentinel)}】`,
    '',
    `指挥部：${safeLine(commandEnvironment.plain_chinese || commandEnvironment.reason, '等待底层环境确认')}`,
    `哨兵：${safeLine(tvSentinel.plain_chinese || tvSentinel.reason, '等待 TV 条件')}`,
    `结论：${safeLine(tradePlan.plain_chinese, '等待新的价格确认。')}`,
    `方向：${safeLine(tradePlan.direction_label, '观望')}`,
    '',
    `进场：${safeLine(tradePlan.entry_zone?.text, '--')}`,
    `止损：${safeLine(tradePlan.stop_loss?.text, '--')}`,
    `失效：${safeLine(tradePlan.invalidation?.text, '--')}`,
    `止盈：${buildTargetsLine(tradePlan.targets)}`,
    '',
    `策略：${buildStrategyLine(tradePlan.strategy_permission || {})}`,
    `数据：${buildDataLine(signal, commandEnvironment, tvSentinel)}`,
    `禁做：${Array.isArray(tradePlan.forbidden_actions) && tradePlan.forbidden_actions.length > 0 ? tradePlan.forbidden_actions.join('，') : '不追高'}`
  ].join('\n');
}
