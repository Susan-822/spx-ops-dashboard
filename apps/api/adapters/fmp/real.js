export async function fetchFmpReal() {
  const configured = Boolean(process.env.FMP_API_KEY);
  return {
    source: 'fmp',
    configured,
    available: false,
    is_mock: false,
    message: configured
      ? 'Real FMP adapter skeleton is present but network calls are disabled.'
      : 'FMP is not configured.'
  };
}
