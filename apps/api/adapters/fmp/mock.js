export async function fetchFmpMock() {
  return {
    source: 'fmp',
    configured: false,
    available: true,
    is_mock: true,
    message: 'Mock FMP fallback payload.'
  };
}
