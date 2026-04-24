const WEIGHTS = Object.freeze({
  theta: 0.4,
  tradingview: 0.3,
  uw: 0.2,
  fmp: 0.1
});

function classifySignal(signal) {
  if (['bullish_pullback', 'long_pullback_ready', 'bullish_probe', 'bullish_flow'].includes(signal)) {
    return 'bullish';
  }

  if (['bearish_pressure', 'short_retest_ready', 'bearish_flow', 'event_risk_high'].includes(signal)) {
    return 'bearish';
  }

  return 'neutral';
}

export function runConflictEngine({ theta_signal, tv_signal, uw_signal, fmp_signal, stale_flags }) {
  const directions = {
    theta: stale_flags.theta ? 'neutral' : classifySignal(theta_signal),
    tradingview: stale_flags.tradingview ? 'neutral' : classifySignal(tv_signal),
    uw: stale_flags.uw ? 'neutral' : classifySignal(uw_signal),
    fmp: stale_flags.fmp ? 'neutral' : classifySignal(fmp_signal)
  };

  const bullishWeight = Object.entries(directions).reduce(
    (sum, [source, direction]) => sum + (direction === 'bullish' ? WEIGHTS[source] : 0),
    0
  );
  const bearishWeight = Object.entries(directions).reduce(
    (sum, [source, direction]) => sum + (direction === 'bearish' ? WEIGHTS[source] : 0),
    0
  );

  const thetaTvConflict =
    directions.theta !== 'neutral' &&
    directions.tradingview !== 'neutral' &&
    directions.theta !== directions.tradingview;

  let conflict_points = Math.round(Math.min(bullishWeight, bearishWeight) * 100);
  if (thetaTvConflict) {
    conflict_points += 25;
  }

  const stalePenalty = Object.values(stale_flags).filter(Boolean).length > 0 ? 20 : 0;
  const adjusted_confidence = Math.max(0, 85 - conflict_points - stalePenalty);

  let conflict_level = 'low';
  if (conflict_points >= 35) {
    conflict_level = 'high';
  } else if (conflict_points >= 15) {
    conflict_level = 'medium';
  }

  return {
    has_conflict: conflict_points > 0,
    conflict_level,
    conflict_points,
    adjusted_confidence,
    theta_tv_conflict: thetaTvConflict,
    weights: WEIGHTS,
    directions
  };
}
