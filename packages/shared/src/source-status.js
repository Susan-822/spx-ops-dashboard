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
  message = 'Mock source active.',
  last_updated = null,
  stale = false
}) {
  return {
    source,
    configured,
    available,
    is_mock,
    stale,
    state: stale ? SOURCE_STATE.STALE : is_mock ? SOURCE_STATE.MOCK_FALLBACK : SOURCE_STATE.READY,
    message,
    last_updated
  };
}
