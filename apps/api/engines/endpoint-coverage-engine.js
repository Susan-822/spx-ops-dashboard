export function buildEndpointCoverageReport(coverage = {}) {
  const required = {
    dealer_gex: [
      '/api/stock/{ticker}/spot-exposures/strike',
      '/api/stock/{ticker}/greek-exposure',
      '/api/stock/{ticker}/greek-exposure/strike',
      '/api/stock/{ticker}/greek-exposure/expiry',
      '/api/stock/{ticker}/spot-exposures/strike-expiry'
    ],
    flow: [
      '/api/stock/{ticker}/flow-recent',
      '/api/option-trades/flow-alerts',
      '/api/stock/{ticker}/net-prem-ticks',
      '/api/stock/{ticker}/flow-per-expiry',
      '/api/stock/{ticker}/flow-per-strike',
      '/api/stock/{ticker}/flow-per-strike-intraday'
    ],
    darkpool: [
      '/api/darkpool/recent',
      '/api/darkpool/{ticker}',
      '/api/stock/{ticker}/stock-volume-price-levels'
    ],
    sentiment: [
      '/api/market/market-tide',
      '/api/market/top-net-impact',
      '/api/market/net-flow-expiry',
      '/api/market/total-options-volume',
      '/api/market/sector-tide',
      '/api/market/etf-tide'
    ],
    volatility: [
      '/api/stock/{ticker}/interpolated-iv',
      '/api/stock/{ticker}/iv-rank',
      '/api/stock/{ticker}/realized-volatility',
      '/api/stock/{ticker}/volatility-statistics',
      '/api/stock/{ticker}/iv-term-structure'
    ],
    technical: [
      '/api/stock/{ticker}/technical-indicator/{function}',
      '/api/stock/{ticker}/ohlc',
      '/api/stock/{ticker}/options-volume',
      '/api/stock/{ticker}/oi-per-strike',
      '/api/stock/{ticker}/oi-per-expiry',
      '/api/stock/{ticker}/max-pain',
      '/api/stock/{ticker}/option-price-levels',
      '/api/stock/{ticker}/volume-oi-expiry'
    ]
  };
  const empty = (group) => ({
    required: required[group],
    required: [],
    ok: [],
    failed: [],
    missing: required[group]
  });
  return {
    dealer_gex: { ...empty('dealer_gex'), ...(coverage.dealer_gex || {}) },
    flow: { ...empty('flow'), ...(coverage.flow || {}) },
    darkpool: { ...empty('darkpool'), ...(coverage.darkpool || {}) },
    sentiment: { ...empty('sentiment'), ...(coverage.sentiment || {}) },
    volatility: { ...empty('volatility'), ...(coverage.volatility || {}) },
    technical: { ...empty('technical'), ...(coverage.technical || {}) }
  };
}
