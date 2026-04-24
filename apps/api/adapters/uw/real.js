export async function fetchUwReal() {
  const configured = Boolean(process.env.UW_READER_ENABLED);
  return {
    source: 'uw',
    configured,
    available: false,
    is_mock: false,
    message: configured
      ? 'Real UW adapter skeleton is present but image processing is disabled.'
      : 'UW reader is not configured.'
  };
}
