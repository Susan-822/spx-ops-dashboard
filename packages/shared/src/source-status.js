export const SOURCE_STATE = Object.freeze({
  REAL: 'real',
  MOCK: 'mock',
  DELAYED: 'delayed',
  DEGRADED: 'degraded',
  DOWN: 'down'
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
  stale_reason = '',
  state = null,
  refresh_interval_ms = null,
  stale_threshold_ms = null,
  down_threshold_ms = null,
  event_triggers = []
}) {
  const derivedState = state ?? (is_mock ? SOURCE_STATE.MOCK : SOURCE_STATE.REAL);

  return {
    source,
    configured,
    available,
    is_mock,
    fetch_mode,
    stale,
    state: derivedState,
    message,
    last_updated,
    data_timestamp,
    received_at,
    latency_ms,
    stale_reason,
    refresh_interval_ms,
    stale_threshold_ms,
    down_threshold_ms,
    event_triggers
  };
}
