export async function fetchThetaMock() {
  return {
    source: 'theta',
    configured: false,
    available: true,
    is_mock: true,
    message: 'Mock ThetaData fallback payload.'
  };
}
