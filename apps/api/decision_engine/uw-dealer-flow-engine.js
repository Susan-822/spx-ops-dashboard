function scoreBias(value) {
  if (value === 'bullish' || value === 'supportive' || value === 'positive') {
    return 1;
  }

  if (value === 'bearish' || value === 'defensive' || value === 'negative') {
    return -1;
  }

  return 0;
}

export function runUwDealerFlowEngine({
  uw_flow_bias,
  uw_dark_pool_bias,
  uw_dealer_bias,
  advanced_greeks
}) {
  const greekScore = scoreBias(advanced_greeks?.vanna) + scoreBias(advanced_greeks?.charm);
  const totalScore =
    scoreBias(uw_flow_bias) * 25 +
    scoreBias(uw_dark_pool_bias) * 20 +
    scoreBias(uw_dealer_bias) * 20 +
    greekScore * 10;

  const flow_quality_score = Math.max(0, Math.min(100, 50 + totalScore));

  let uw_signal = 'mixed_flow';
  if (flow_quality_score >= 65) {
    uw_signal = 'bullish_flow';
  } else if (flow_quality_score <= 35) {
    uw_signal = 'bearish_flow';
  }

  let dealer_behavior = '主力偏中性';
  if (uw_dealer_bias === 'supportive' || uw_dealer_bias === 'stabilizing') {
    dealer_behavior = '主力偏承接，回落更容易被接住';
  } else if (uw_dealer_bias === 'defensive') {
    dealer_behavior = '主力偏防守，追价风险更高';
  }

  return {
    uw_signal,
    dealer_behavior,
    flow_quality_score
  };
}
