export const SOURCE_STATE = Object.freeze({
  READY: 'ready',
  STALE: 'stale',
  MOCK_FALLBACK: 'mock_fallback'
});

export function createSourceStatus({
  source,
  configured = false,
  available = true,
  is_mock = true,
  fetch_mode = 'mock_scenario',
  message = 'Mock source active.',
  last_updated = null,
  data_timestamp = null,
  received_at = null,
  latency_ms = 0,
  stale = false,
  stale_reason = ''
}) {
  return {
    source,
    configured,
    available,
    is_mock,
    fetch_mode,
    stale,
    state: stale ? SOURCE_STATE.STALE : is_mock ? SOURCE_STATE.MOCK_FALLBACK : SOURCE_STATE.READY,
    message,
    last_updated,
    data_timestamp,
    received_at,
    latency_ms,
    stale_reason
  };
}
