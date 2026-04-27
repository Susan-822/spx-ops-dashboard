function statusFromDealer(dealerConclusion = {}) {
  if (dealerConclusion.status === 'live') return 'live';
  if (['partial', 'stale', 'error'].includes(dealerConclusion.status)) return dealerConclusion.status;
  return 'unavailable';
}

export function buildDealerPath({
  dealerConclusion = {},
  externalSpot = {},
  uwDealerGreeks = {},
  volatilityActivation = {}
} = {}) {
  const status = statusFromDealer(dealerConclusion);
  const missing = [];
  if (dealerConclusion.gamma_regime === 'unknown') missing.push('gamma');
  if (dealerConclusion.zero_gamma == null) missing.push('zero_gamma');

  let path = dealerConclusion.least_resistance_path || 'unknown';
  let confidence = status === 'live' ? 55 : status === 'partial' ? 25 : 0;
  const spot = Number(externalSpot.spot);
  if (Number.isFinite(spot) && Number.isFinite(Number(dealerConclusion.call_wall)) && Math.abs(spot - Number(dealerConclusion.call_wall)) <= 25) {
    confidence += 5;
  }
  if (Number.isFinite(spot) && Number.isFinite(Number(dealerConclusion.put_wall)) && Math.abs(spot - Number(dealerConclusion.put_wall)) <= 25) {
    confidence += 5;
  }
  if (dealerConclusion.gamma_regime === 'positive') {
    path = path === 'unknown' ? 'range' : path;
    confidence += 10;
  }
  if (dealerConclusion.gamma_regime === 'negative') {
    path = path === 'unknown' ? 'up' : path;
    confidence += 10;
  }
  if (uwDealerGreeks.dealer_crosscheck === 'confirm') {
    confidence += 10;
  }
  if (uwDealerGreeks.dealer_crosscheck === 'conflict') {
    path = 'unknown';
    confidence -= 20;
  }
  if (volatilityActivation.state === 'expansion' && dealerConclusion.gamma_regime === 'negative') {
    confidence += 8;
  }

  confidence = Math.max(0, Math.min(100, confidence));
  return {
    status,
    path: status === 'live' ? path : path === 'range' ? 'range_reference' : 'unknown',
    confidence,
    reason: missing.length > 0
      ? `Dealer 主源缺少 ${missing.join(', ')}，只能 partial 参考。`
      : 'Dealer 主源可用于路径判断。',
    plain_chinese: status === 'live'
      ? `Dealer path ${path}，置信度 ${confidence}。`
      : 'ThetaData Gamma 不完整，Dealer path 仅参考，不可执行。'
  };
}
