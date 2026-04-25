export function runCommandInputAggregator({
  fmpConclusion,
  dealerConclusion,
  uwConclusion,
  tvSentinel,
  dataHealth
}) {
  const missing_inputs = [];
  const conflicts = [];

  if (fmpConclusion?.status === 'unavailable' || fmpConclusion?.status === 'error') {
    missing_inputs.push('fmp');
  }
  if (dealerConclusion?.status === 'unavailable' || dealerConclusion?.status === 'error') {
    missing_inputs.push('theta');
  }
  if (uwConclusion?.status === 'unavailable' || uwConclusion?.status === 'error') {
    missing_inputs.push('uw');
  }
  if (tvSentinel?.status === 'unavailable') {
    missing_inputs.push('tradingview');
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

  return {
    market: {
      fmp_conclusion: fmpConclusion
    },
    dealer: {
      dealer_conclusion: dealerConclusion
    },
    flow: {
      uw_conclusion: uwConclusion
    },
    volatility: {
      uw_volatility_light: uwConclusion?.volatility_light ?? 'unavailable',
      event_risk: fmpConclusion?.event_risk ?? 'unavailable'
    },
    sentiment: {
      market_bias: fmpConclusion?.market_bias ?? 'unavailable',
      market_tide: uwConclusion?.market_tide ?? 'unavailable'
    },
    price_sentinel: {
      tv_sentinel: tvSentinel
    },
    data_health: {
      data_health: dataHealth
    },
    missing_inputs,
    conflicts
  };
}
