const TRADINGVIEW_EVENT_MAP = Object.freeze({
  breakout_confirmed: 'breakout_confirmed_pullback_ready',
  breakdown_confirmed: 'breakdown_confirmed',
  pullback_holding: 'breakout_confirmed_pullback_ready',
  retest_failed: 'breakdown_confirmed',
  structure_invalidated: 'structure_invalidated'
});

let tradingViewSnapshot = null;

export function getAcceptedTradingViewEvents() {
  return Object.keys(TRADINGVIEW_EVENT_MAP);
}

export function mapTradingViewEventToStructure(eventType) {
  return TRADINGVIEW_EVENT_MAP[eventType] ?? null;
}

export function updateTradingViewSnapshot(payload) {
  const mappedEvent = mapTradingViewEventToStructure(payload.event_type);
  const now = new Date().toISOString();

  tradingViewSnapshot = {
    source: 'tradingview',
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    event_type: payload.event_type,
    tv_structure_event: mappedEvent,
    price: payload.price,
    level: payload.level,
    side: payload.side,
    trigger_time: payload.trigger_time,
    last_updated: payload.trigger_time || now,
    received_at: now,
    is_mock: false,
    fetch_mode: 'webhook_event'
  };

  return tradingViewSnapshot;
}

export function getTradingViewSnapshot() {
  return tradingViewSnapshot;
}

export function clearTradingViewSnapshot() {
  tradingViewSnapshot = null;
}
