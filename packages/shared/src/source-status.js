export const SOURCE_STATE = Object.freeze({
  CONFIGURED: "configured",
  MISSING_CONFIG: "missing_config",
  MOCK_FALLBACK: "mock_fallback",
});

export function createSourceStatus({
  source,
  configured = false,
  available = false,
  is_mock = true,
  message = "Mock fallback active.",
  last_updated = null,
}) {
  return {
    source,
    configured,
    available,
    is_mock,
    state: configured
      ? is_mock
        ? SOURCE_STATE.MOCK_FALLBACK
        : SOURCE_STATE.CONFIGURED
      : SOURCE_STATE.MISSING_CONFIG,
    message,
    last_updated,
  };
}
