export async function fetchTradingViewReal() {
  const configured = Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET);
  return {
    source: 'tradingview',
    configured,
    available: false,
    is_mock: false,
    message: configured
      ? 'Real TradingView adapter skeleton is present but external integration is disabled.'
      : 'TradingView webhook secret is not configured.'
  };
}
