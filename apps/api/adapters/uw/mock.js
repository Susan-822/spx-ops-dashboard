export async function fetchUwMock() {
  return {
    source: 'uw',
    configured: false,
    available: true,
    is_mock: true,
    message: 'Mock UW fallback payload.'
  };
}
