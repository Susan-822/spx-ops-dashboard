const TRADINGVIEW_EVENT_MAP = Object.freeze({
  breakout_confirmed: 'breakout_confirmed_pullback_ready',
  breakdown_confirmed: 'breakdown_confirmed',
  pullback_holding: 'breakout_confirmed_pullback_ready',
  retest_failed: 'breakdown_confirmed',
  structure_invalidated: 'structure_invalidated'
});
import {
  clearTvSnapshot,
  readTvSnapshot,
  writeTvSnapshot
} from '../state/tvSnapshotStore.js';

export function getAcceptedTradingViewEvents() {
  return Object.keys(TRADINGVIEW_EVENT_MAP);
}

export function mapTradingViewEventToStructure(eventType) {
  return TRADINGVIEW_EVENT_MAP[eventType] ?? null;
}

export async function updateTradingViewSnapshot(payload) {
  const mappedEvent = mapTradingViewEventToStructure(payload.event_type);
  const now = new Date().toISOString();

  const snapshot = {
    source: 'tradingview',
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    event_type: payload.event_type,
    tv_structure_event: mappedEvent,
    price: payload.price == null ? null : Number(payload.price),
    invalidation_level: payload.invalidation_level ?? payload.level ?? null,
    side: payload.side,
    trigger_time: payload.trigger_time,
    last_updated: payload.trigger_time || now,
    received_at: now,
    status: 'live',
    is_mock: false,
    fetch_mode: 'webhook_event'
  };

  await writeTvSnapshot(snapshot);
  return snapshot;
}

export async function getTradingViewSnapshot() {
  return readTvSnapshot();
}

export async function clearTradingViewSnapshot() {
  await clearTvSnapshot();
}
