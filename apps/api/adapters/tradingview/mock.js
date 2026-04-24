export async function fetchTradingViewMock() {
  return {
    source: 'tradingview',
    configured: false,
    available: true,
    is_mock: true,
    message: 'Mock TradingView fallback payload.'
  };
}
