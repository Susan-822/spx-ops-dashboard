export const TV_EVENT_SETUP_MAP = Object.freeze({
  breakout_confirmed: {
    setup_code: 'A_LONG_PULLBACK',
    matched_setup: 'A_long',
    direction: 'bullish',
    tv_signal: 'long_breakout_watch',
    plain_chinese: '突破确认，A多候选。'
  },
  breakdown_confirmed: {
    setup_code: 'A_SHORT_RETEST',
    matched_setup: 'A_short',
    direction: 'bearish',
    tv_signal: 'short_breakdown_watch',
    plain_chinese: '跌破确认，A空候选。'
  },
  pullback_holding: {
    setup_code: 'B_LONG_PULLBACK',
    matched_setup: 'B_long',
    direction: 'bullish',
    tv_signal: 'B_long_candidate',
    plain_chinese: '回踩关键位不破，B多候选。'
  },
  retest_failed: {
    setup_code: 'B_SHORT_RETEST',
    matched_setup: 'B_short',
    direction: 'bearish',
    tv_signal: 'B_short_candidate',
    plain_chinese: '反抽失败，B空候选。'
  },
  structure_invalidated: {
    setup_code: null,
    matched_setup: null,
    direction: 'neutral',
    tv_signal: 'structure_invalidated',
    plain_chinese: '旧方向作废，停止追随。'
  }
});

const TV_STRUCTURE_FALLBACK_MAP = Object.freeze({
  breakout_confirmed_pullback_ready: {
    setup_code: 'A_LONG_PULLBACK',
    matched_setup: 'A_long',
    direction: 'bullish',
    tv_signal: 'A_long_candidate',
    plain_chinese: 'TradingView 多头结构已确认，可作为 A多候选。'
  },
  breakdown_confirmed: {
    setup_code: 'A_SHORT_RETEST',
    matched_setup: 'A_short',
    direction: 'bearish',
    tv_signal: 'A_short_candidate',
    plain_chinese: 'TradingView 空头结构已确认，可作为 A空候选。'
  },
  range_holding: {
    setup_code: 'B_IRON_CONDOR',
    matched_setup: null,
    direction: 'neutral',
    tv_signal: 'range_hold',
    plain_chinese: 'TradingView 区间结构已确认。'
  },
  structure_invalidated: {
    setup_code: null,
    matched_setup: null,
    direction: 'neutral',
    tv_signal: 'structure_invalidated',
    plain_chinese: '旧方向作废，停止追随。'
  }
});

function defaultSentinel({
  snapshot,
  confirmation,
  signal,
  status,
  reason,
  fresh = false,
  stale = false,
  triggered = false,
  matched_allowed_setup = false,
  setup_code = null,
  matched_setup = null,
  direction = 'neutral',
  plain_chinese = ''
}) {
  return {
    source: 'tradingview',
    event_type: snapshot?.event_type || null,
    symbol: snapshot?.symbol || 'SPX',
    timeframe: snapshot?.timeframe || null,
    side: snapshot?.side || direction,
    price: snapshot?.price ?? null,
    invalidation_level: snapshot?.invalidation_level ?? snapshot?.level ?? null,
    fresh,
    stale,
    status,
    triggered,
    setup_code,
    matched_setup,
    matched_allowed_setup,
    direction,
    tv_signal: signal,
    price_confirmation: confirmation,
    reason,
    plain_chinese: plain_chinese || reason
  };
}

export function runTvSentinelEngine({
  priceStructure,
  tv_structure_event = null,
  snapshot = null,
  snapshotFresh = true,
  allowedSetups = []
}) {
  const confirmation = priceStructure?.confirmation_status || 'unconfirmed';
  const fallbackSignal = priceStructure?.price_signal || 'wait_pullback';
  const eventType = snapshot?.event_type || null;
  const mapping = eventType
    ? TV_EVENT_SETUP_MAP[eventType]
    : TV_STRUCTURE_FALLBACK_MAP[tv_structure_event] || null;
  const signal = mapping?.tv_signal || fallbackSignal;

  if (!snapshotFresh) {
    return defaultSentinel({
      snapshot,
      confirmation,
      signal,
      status: 'stale',
      triggered: false,
      stale: true,
      fresh: false,
      matched_allowed_setup: false,
      setup_code: mapping?.setup_code ?? null,
      matched_setup: null,
      direction: mapping?.direction || 'neutral',
      reason: '最近 TV 事件已过期，仅保留参考，不作为新触发。',
      plain_chinese: '最近 TV 事件已过期，仅保留参考，不作为新触发。'
    });
  }

  if (eventType === 'structure_invalidated') {
    return defaultSentinel({
      snapshot,
      confirmation,
      signal,
      status: 'invalidated',
      triggered: false,
      stale: false,
      fresh: true,
      matched_allowed_setup: false,
      setup_code: null,
      matched_setup: null,
      direction: 'neutral',
      reason: 'TradingView 结构作废，旧计划失效。',
      plain_chinese: TV_EVENT_SETUP_MAP.structure_invalidated.plain_chinese
    });
  }

  if (confirmation !== 'confirmed') {
    return defaultSentinel({
      snapshot,
      confirmation,
      signal,
      status: 'waiting',
      triggered: false,
      stale: false,
      fresh: true,
      matched_allowed_setup: false,
      setup_code: null,
      matched_setup: null,
      direction: mapping?.direction || 'neutral',
      reason: 'TradingView 价格结构尚未确认。',
      plain_chinese: 'TradingView 哨兵尚未确认价格条件。'
    });
  }

  if (!mapping) {
    return defaultSentinel({
      snapshot,
      confirmation,
      signal,
      status: 'waiting',
      triggered: false,
      stale: false,
      fresh: true,
      matched_allowed_setup: false,
      setup_code: null,
      matched_setup: null,
      direction: 'neutral',
      reason: 'TradingView 结构已确认，但事件类型未映射到可执行 setup。',
      plain_chinese: 'TradingView 结构已确认，但尚未映射到允许的 A/B 单。'
    });
  }

  const allowedLabels = Array.isArray(allowedSetups?.allowed_setup_labels)
    ? allowedSetups.allowed_setup_labels
    : Array.isArray(allowedSetups)
      ? allowedSetups
      : [];
  const allowedCodes = Array.isArray(allowedSetups?.permitted_setup_codes)
    ? allowedSetups.permitted_setup_codes
    : [];
  const matchedAllowedSetup =
    (mapping.matched_setup && allowedLabels.includes(mapping.matched_setup))
    || (mapping.setup_code && allowedCodes.includes(mapping.setup_code));

  return defaultSentinel({
    snapshot,
    confirmation,
    signal,
    status: matchedAllowedSetup ? 'matched' : 'triggered',
    triggered: true,
    stale: false,
    fresh: true,
    matched_allowed_setup: matchedAllowedSetup,
    setup_code: mapping.setup_code,
    matched_setup: mapping.matched_setup,
    direction: mapping.direction,
    reason: matchedAllowedSetup
      ? `TradingView 哨兵已匹配 ${mapping.matched_setup}。`
      : `TradingView 哨兵触发，但当前未匹配允许的 ${mapping.matched_setup || 'setup'}。`,
    plain_chinese: mapping.plain_chinese
  });
}
