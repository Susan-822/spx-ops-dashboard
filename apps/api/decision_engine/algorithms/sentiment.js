export function buildMarketSentimentConclusion({ marketSentiment = {} } = {}) {
  return {
    status: marketSentiment.state && marketSentiment.state !== 'unavailable' ? 'live' : 'unavailable',
    bias: marketSentiment.state === 'risk_on' ? 'bullish' : marketSentiment.state === 'risk_off' ? 'bearish' : marketSentiment.state === 'mixed' ? 'mixed' : 'unknown',
    confidence: marketSentiment.state && marketSentiment.state !== 'unavailable' ? 'medium' : 'low',
    score: null,
    usable_for_analysis: marketSentiment.state && marketSentiment.state !== 'unavailable',
    usable_for_operation: false,
    supports_bullish: marketSentiment.state === 'risk_on',
    supports_bearish: marketSentiment.state === 'risk_off',
    blocks_operation: false,
    summary_cn: marketSentiment.plain_chinese || '市场情绪：未形成可靠 risk-on / risk-off 结论。',
    evidence_cn: [],
    missing_fields: marketSentiment.state && marketSentiment.state !== 'unavailable' ? [] : ['market_tide_score', 'etf_tide', 'sector_tide', 'nope'],
    current_block: marketSentiment.state && marketSentiment.state !== 'unavailable' ? '' : 'Market Tide 未转成可操作情绪分数。',
    next_fix: '补全 Market Tide / ETF Tide / Sector Tide / NOPE 映射。'
  };
}
