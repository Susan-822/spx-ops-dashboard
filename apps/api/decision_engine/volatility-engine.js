export function runVolatilityEngine({ iv_state, gamma_regime, event_risk, uw_dealer_bias }) {
  const shortVolAllowed =
    iv_state === 'cooling' &&
    gamma_regime === 'positive_gamma' &&
    event_risk === 'low' &&
    uw_dealer_bias !== 'defensive';

  let vol_state = 'mixed';
  if (event_risk === 'high') {
    vol_state = 'event_loaded';
  } else if (gamma_regime === 'negative_gamma' || iv_state === 'elevated') {
    vol_state = 'expanding';
  } else if (shortVolAllowed) {
    vol_state = 'contained';
  }

  return {
    vol_state,
    short_vol_allowed: shortVolAllowed,
    income_allowed_reason: shortVolAllowed
      ? 'IV is cooling, gamma is positive, and no event gate is active.'
      : 'Short-vol income is blocked by gamma, IV, event risk, or dealer posture.'
  };
}
