export function runMarketRegimeEngine({ gamma_regime, spot, flip_level, event_risk }) {
  const flipDistance = Math.round(spot - flip_level);
  let market_state = 'unknown';

  if (event_risk === 'high') {
    market_state = 'event_risk';
  } else if (gamma_regime === 'critical' || Math.abs(flipDistance) <= 5) {
    market_state = 'flip_chop';
  } else if (gamma_regime === 'negative') {
    market_state = 'negative_gamma_expand';
  } else if (gamma_regime === 'positive') {
    market_state = 'positive_gamma_grind';
  }

  return {
    market_state,
    flip_distance: flipDistance,
    event_risk
  };
}
