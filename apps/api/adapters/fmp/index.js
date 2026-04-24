import { fetchFmpEventRisk, fetchFmpPrice } from './real.js';
import { fetchFmpEventMock, fetchFmpPriceMock } from './mock.js';

function createFmpEventFailureFallback(real = {}, overrides = {}) {
  const timestamp = new Date().toISOString();
  return fetchFmpEventMock({
    configured: real.configured ?? false,
    available: real.available ?? true,
    state: real.available === false ? 'degraded' : null,
    stale: false,
    is_mock: overrides.is_mock ?? true,
    fetch_mode: real.fetch_mode ?? 'mock_fallback',
    last_updated: real.last_updated || real.data_timestamp || timestamp,
    data_timestamp: real.data_timestamp || real.last_updated || timestamp,
    received_at: timestamp,
    latency_ms: typeof real.latency_ms === 'number' ? real.latency_ms : 0,
    message: 'FMP 数据异常，事件风险不可确认。',
    fallback_reason: real.message || 'FMP unavailable',
    event_risk: 'medium',
    fmp_signal: 'event_risk_unknown',
    event_note: 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。',
    no_short_vol_window: true,
    trade_permission_adjustment: 'downgrade',
    ...overrides
  });
}

function createFmpPriceFailureFallback(real = {}, overrides = {}) {
  const timestamp = new Date().toISOString();
  return fetchFmpPriceMock({
    configured: real.configured ?? false,
    available: false,
    state: real.state || 'degraded',
    stale: real.stale ?? true,
    is_mock: overrides.is_mock ?? false,
    fetch_mode: real.fetch_mode ?? 'quote_short_poll',
    last_updated: real.last_updated || real.data_timestamp || timestamp,
    data_timestamp: real.data_timestamp || real.last_updated || timestamp,
    received_at: timestamp,
    latency_ms: typeof real.latency_ms === 'number' ? real.latency_ms : 0,
    message: 'FMP SPX price unavailable',
    fallback_reason: real.message || 'FMP SPX price unavailable',
    price: null,
    day_change: null,
    day_change_percent: null,
    ...overrides
  });
}

export async function getFmpSnapshot(options = {}) {
  const event = await fetchFmpEventRisk(options.event || {});
  const price = await fetchFmpPrice(options.price || {});

  const eventSnapshot = event.configured && event.available
    ? event
    : event.configured
      ? await createFmpEventFailureFallback(event, {
        configured: true,
        available: true,
        is_mock: true
      })
      : await fetchFmpEventMock();

  const priceSnapshot = price.configured && price.available && Number.isFinite(price.price)
    ? price
    : price.configured
      ? await createFmpPriceFailureFallback(price, {
        configured: true,
        available: false,
        state: price.state || 'degraded',
        stale: price.stale ?? true,
        is_mock: false
      })
      : await createFmpPriceFailureFallback(price, {
        configured: false,
        available: false,
        state: 'degraded',
        stale: true,
        is_mock: false
      });

  return {
    event: eventSnapshot,
    price: priceSnapshot
  };
}
