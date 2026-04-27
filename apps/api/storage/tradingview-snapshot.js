const TRADINGVIEW_EVENT_MAP = Object.freeze({
  breakout_confirmed: {
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    sentinel_signal: 'A_long_candidate',
    plain_chinese: '突破确认，进入 A多候选。'
  },
  breakdown_confirmed: {
    tv_structure_event: 'breakdown_confirmed',
    sentinel_signal: 'A_short_candidate',
    plain_chinese: '跌破确认，进入 A空候选。'
  },
  pullback_holding: {
    tv_structure_event: 'breakout_confirmed_pullback_ready',
    sentinel_signal: 'B_long_candidate',
    plain_chinese: '回踩守住，进入 B多候选。'
  },
  retest_failed: {
    tv_structure_event: 'breakdown_confirmed',
    sentinel_signal: 'B_short_candidate',
    plain_chinese: '反抽失败，进入 B空候选。'
  },
  structure_invalidated: {
    tv_structure_event: 'structure_invalidated',
    sentinel_signal: 'previous_plan_invalidated',
    plain_chinese: '旧方向结构作废，停止追随。'
  }
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
  return TRADINGVIEW_EVENT_MAP[eventType]?.tv_structure_event ?? null;
}

export function mapTradingViewEvent(eventType) {
  return TRADINGVIEW_EVENT_MAP[eventType] ?? null;
}

export async function updateTradingViewSnapshot(payload) {
  const mappedEvent = mapTradingViewEvent(payload.event_type);
  const now = new Date().toISOString();

  const snapshot = {
    source: 'tradingview',
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    event_type: payload.event_type,
    tv_structure_event: mappedEvent?.tv_structure_event ?? null,
    sentinel_signal: mappedEvent?.sentinel_signal ?? null,
    plain_chinese: mappedEvent?.plain_chinese ?? '',
    price: payload.price == null ? null : Number(payload.price),
    invalidation_level: payload.invalidation_level ?? payload.level ?? null,
    side: payload.side,
    spy_price: payload.spy_price == null ? null : Number(payload.spy_price),
    spy_last_updated: payload.spy_last_updated || payload.trigger_time || now,
    es_price: payload.es_price == null ? null : Number(payload.es_price),
    es_last_updated: payload.es_last_updated || payload.trigger_time || now,
    futures_price: payload.futures_price == null ? null : Number(payload.futures_price),
    futures_last_updated: payload.futures_last_updated || payload.trigger_time || now,
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
