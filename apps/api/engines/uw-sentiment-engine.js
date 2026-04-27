export function runUwSentimentEngine({ sentimentFactors = {}, sentiment_factors = {}, provider = {} } = {}) {
  const factors = Object.keys(sentimentFactors || {}).length > 0 ? sentimentFactors : sentiment_factors;
  if (!['live', 'partial', 'stale'].includes(provider.status)) {
    return {
      state: 'unavailable',
      score: 0,
      conflict: false,
      plain_chinese: 'UW 市场情绪不可用，只能等待其它主源。'
    };
  }

  const call = Number(factors.call_flow ?? 0);
  const put = Number(factors.put_flow ?? 0);
  const net = factors.net_flow == null ? call - put : Number(factors.net_flow);
  const state = factors.sentiment || (net > 0 ? 'risk_on' : net < 0 ? 'risk_off' : 'mixed');
  const score = Math.max(0, Math.min(100, Math.round(50 + (net === 0 ? 0 : net > 0 ? 20 : -20))));

  return {
    state,
    score,
    conflict: state === 'mixed',
    plain_chinese:
      state === 'risk_on'
        ? 'UW Market Tide 偏 risk-on，只作为环境加权。'
        : state === 'risk_off'
          ? 'UW Market Tide 偏 risk-off，只作为环境加权。'
          : 'UW Market Tide 混合，不能单独决定入场。'
  };
}
