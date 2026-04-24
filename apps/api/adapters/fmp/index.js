import { fetchFmpReal } from './real.js';
import { fetchFmpMock } from './mock.js';

function createFmpFailureFallback(real = {}, overrides = {}) {
  const timestamp = new Date().toISOString();
  return fetchFmpMock({
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

export async function getFmpSnapshot(options = {}) {
  const real = await fetchFmpReal(options);
  if (real.configured && real.available) {
    return real;
  }

  if (real.configured) {
    return createFmpFailureFallback(real, {
      configured: true,
      available: true,
      is_mock: true
    });
  }

  return fetchFmpMock();
}
