export async function fetchThetaReal() {
  const configured = Boolean(process.env.THETA_DATA_API_KEY);
  return {
    source: 'theta',
    configured,
    available: false,
    is_mock: false,
    message: configured
      ? 'Real ThetaData adapter skeleton is present but network calls are disabled.'
      : 'ThetaData is not configured.'
  };
}
