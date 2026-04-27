function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusFrom(provider = {}, factors = {}) {
  if (provider.status === 'error') return 'error';
  if (provider.status === 'stale') return 'stale';
  if (provider.status === 'unavailable') return 'unavailable';
  const hasWall = factors.call_wall_candidate != null
    || factors.put_wall_candidate != null
    || (Array.isArray(factors.top_call_gamma_strikes) && factors.top_call_gamma_strikes.length > 0)
    || (Array.isArray(factors.top_put_gamma_strikes) && factors.top_put_gamma_strikes.length > 0);
  const hasGreek = factors.gex != null || factors.dex != null || factors.vanna != null || factors.charm != null || factors.zero_gamma_or_flip != null;
  if (hasWall && hasGreek && provider.status === 'live') return 'live';
  if (hasWall || hasGreek) return 'partial';
  return provider.status === 'live' ? 'partial' : provider.status || 'unavailable';
}

export function runUwDealerEngine({ provider = {}, dealerFactors = {}, spotGexFactors = {} } = {}) {
  const status = statusFrom(provider, dealerFactors);
  const gex = n(dealerFactors.gex);
  const dex = n(dealerFactors.dex);
  const upperWall = n(spotGexFactors.call_wall_candidate ?? dealerFactors.top_call_gamma_strikes?.[0]?.strike);
  const lowerWall = n(spotGexFactors.put_wall_candidate ?? dealerFactors.top_put_gamma_strikes?.[0]?.strike);
  const flipZone = n(dealerFactors.zero_gamma_or_flip ?? spotGexFactors.gex_pivots?.[0]?.strike);
  const regime = status === 'live' || status === 'partial'
    ? gex > 0 ? 'positive_gamma' : gex < 0 ? 'negative_gamma' : 'neutral'
    : 'unknown';
  const behavior =
    regime === 'positive_gamma'
      ? 'pin'
      : regime === 'negative_gamma'
        ? 'expand'
        : regime === 'neutral'
          ? 'mixed'
          : 'unknown';
  const path =
    behavior === 'pin'
      ? 'range'
      : dex > 0
        ? 'up'
        : dex < 0
          ? 'down'
          : 'unknown';

  return {
    status,
    source: ['live', 'partial', 'stale'].includes(status) ? 'uw' : 'unavailable',
    regime,
    behavior,
    path_of_least_resistance: path,
    upper_wall: upperWall,
    lower_wall: lowerWall,
    flip_zone: flipZone,
    plain_chinese:
      status === 'live'
        ? `UW Dealer ${regime}，路径 ${path}。`
        : status === 'partial'
          ? 'UW Dealer 部分可读，只能辅助判断。'
          : 'UW Dealer 数据不可用，不能主导交易。'
  };
}
