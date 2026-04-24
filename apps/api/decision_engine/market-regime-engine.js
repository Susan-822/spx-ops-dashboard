export function runMarketRegimeEngine({ gamma_regime, spot, flip_level, event_risk }) {
  const flipDistance = Math.round(spot - flip_level);
  let market_state = 'mixed_regime';

  if (event_risk === 'high') {
    market_state = 'event_locked';
  } else if (Math.abs(flipDistance) <= 5) {
    market_state = 'flip_zone';
  } else if (gamma_regime === 'negative_gamma') {
    market_state = spot < flip_level ? 'negative_gamma_trend' : 'negative_gamma_whipsaw';
  } else if (gamma_regime === 'positive_gamma') {
    market_state = 'positive_gamma_range';
  }

  return {
    market_state,
    flip_distance: flipDistance,
    event_risk
  };
}
