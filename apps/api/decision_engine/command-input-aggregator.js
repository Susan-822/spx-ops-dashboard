export function runCommandInputAggregator({
  fmpConclusion,
  dealerConclusion,
  uwConclusion,
  tvSentinel,
  dataHealth,
  externalSpot = {}
}) {
  const missing_inputs = [];
  const conflicts = [];

  if (['unavailable', 'error'].includes(fmpConclusion?.status)) {
    missing_inputs.push('fmp');
  }
  if (!['live', 'stale', 'mock'].includes(dealerConclusion?.status) || dealerConclusion?.status === 'error') {
    missing_inputs.push('theta');
  }
  if (['unavailable', 'error'].includes(uwConclusion?.status)) {
    missing_inputs.push('uw');
  }
  if (tvSentinel?.status === 'unavailable') {
    missing_inputs.push('tradingview');
  }
  if (uwConclusion?.status === 'partial') {
    conflicts.push('UW partial，仅可展示，不可执行');
  }
  if (uwConclusion?.status === 'stale') {
    conflicts.push('UW stale，仅可参考，不可执行');
  }

  if (
    fmpConclusion?.market_bias === 'risk_on'
    && dealerConclusion?.least_resistance_path === 'down'
  ) {
    conflicts.push('FMP risk_on，但 Dealer 偏空');
  }
  if (
    fmpConclusion?.market_bias === 'risk_off'
    && dealerConclusion?.least_resistance_path === 'up'
  ) {
    conflicts.push('FMP risk_off，但 Dealer 偏多');
  }
  if (uwConclusion?.dealer_crosscheck === 'conflict') {
    conflicts.push('UW 与 Dealer 主源交叉验证冲突');
  }
  if (dataHealth?.coherence === 'mixed') {
    conflicts.push('真实 Spot 与 scenario/mock Dealer 地图混用');
  }
  if (dataHealth?.coherence === 'conflict') {
    conflicts.push('真实 Spot 与 Gamma / Wall 地图严重冲突');
  }

  return {
    market: {
      fmp_conclusion: fmpConclusion
    },
    dealer: {
      dealer_conclusion: dealerConclusion,
      uw_dealer_crosscheck: uwConclusion?.dealer_crosscheck ?? 'unavailable'
    },
    flow: {
      flow_bias: uwConclusion?.flow_bias ?? 'unavailable',
      institutional_entry: uwConclusion?.institutional_entry ?? 'unavailable'
    },
    volatility: {
      volatility_light: uwConclusion?.volatility_light ?? 'unavailable',
      event_risk: fmpConclusion?.event_risk ?? 'unavailable'
    },
    sentiment: {
      market_bias: fmpConclusion?.market_bias ?? 'unavailable',
      market_tide: uwConclusion?.market_tide ?? 'unavailable'
    },
    price_sentinel: {
      tv_sentinel: tvSentinel
    },
    externalSpot: {
      source: externalSpot?.source ?? 'unavailable',
      price: Number.isFinite(Number(externalSpot?.price)) ? Number(externalSpot.price) : null,
      last_updated: externalSpot?.last_updated ?? null,
      coherent: dataHealth?.coherence === 'live'
    },
    data_health: {
      data_health: dataHealth
    },
    missing_inputs,
    conflicts
  };
}
