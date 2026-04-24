export async function fetchFmpEventMock(overrides = {}) {
  const timestamp = new Date().toISOString();

  return {
    source: 'fmp_event',
    configured: false,
    available: true,
    is_mock: true,
    fetch_mode: 'mock_fallback',
    last_updated: timestamp,
    data_timestamp: timestamp,
    received_at: timestamp,
    latency_ms: 0,
    event_risk: 'low',
    fmp_signal: 'clear',
    event_note: '',
    message: 'Mock FMP event fallback payload.',
    ...overrides
  };
}

export async function fetchFmpPriceMock(overrides = {}) {
  const timestamp = new Date().toISOString();

  return {
    source: 'fmp_price',
    configured: false,
    available: true,
    is_mock: true,
    fetch_mode: 'mock_fallback',
    last_updated: timestamp,
    data_timestamp: timestamp,
    received_at: timestamp,
    latency_ms: 0,
    state: 'mock',
    stale: false,
    price: null,
    day_change: null,
    day_change_percent: null,
    message: 'Mock FMP price fallback payload.',
    ...overrides
  };
}
