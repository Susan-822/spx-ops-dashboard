export async function fetchFmpMock(overrides = {}) {
  const timestamp = new Date().toISOString();

  return {
    source: 'fmp',
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
    message: 'Mock FMP fallback payload.',
    ...overrides
  };
}
