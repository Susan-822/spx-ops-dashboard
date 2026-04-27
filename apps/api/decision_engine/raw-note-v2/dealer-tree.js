function pctDistance(spot, level) {
  const s = Number(spot);
  const l = Number(level);
  if (!Number.isFinite(s) || !Number.isFinite(l) || s === 0) return null;
  return Math.abs(s - l) / s;
}

export function runDealerTree(ctx) {
  const spot = ctx.fmp_conclusion.spot ?? ctx.price_sources?.spx?.price;
  const uw = ctx.uw_conclusion;
  const distanceToCallWall = pctDistance(spot, uw.call_wall);
  const distanceToPutWall = pctDistance(spot, uw.put_wall);
  let dealer_bias = 'range';

  if (distanceToCallWall != null && distanceToPutWall != null && distanceToCallWall < 0.003 && distanceToPutWall > 0.01) {
    dealer_bias = 'bearish';
  } else if (distanceToCallWall != null && distanceToPutWall != null && distanceToPutWall < 0.003 && distanceToCallWall > 0.01) {
    dealer_bias = 'bullish';
  } else if (spot != null && uw.zero_gamma != null && spot > uw.zero_gamma && uw.gamma_regime === 'negative') {
    dealer_bias = 'bullish_or_momentum';
  } else if (spot != null && uw.zero_gamma != null && spot < uw.zero_gamma && uw.gamma_regime === 'negative') {
    dealer_bias = 'bearish_or_momentum';
  }

  const remove = [];
  if (dealer_bias === 'bearish' || dealer_bias === 'bearish_or_momentum') remove.push('A_long_candidate', 'B_long_candidate');
  if (dealer_bias === 'bullish' || dealer_bias === 'bullish_or_momentum') remove.push('A_short_candidate', 'B_short_candidate');
  if (dealer_bias === 'range') remove.push('A_long_candidate', 'A_short_candidate');

  return {
    dealer_bias,
    distance_to_call_wall_pct: distanceToCallWall,
    distance_to_put_wall_pct: distanceToPutWall,
    remove,
    trace: `Dealer ${dealer_bias}：Call Wall 距离 ${distanceToCallWall ?? '--'}，Put Wall 距离 ${distanceToPutWall ?? '--'}。`
  };
}

export function applyDealerTree(inputs, context) {
  const result = runDealerTree(inputs);
  const remove = new Set(result.remove);
  const allowed_setups = context.allowed_setups.filter((setup) => !remove.has(setup));
  return {
    ...context,
    dealer_bias: result.dealer_bias,
    allowed_setups,
    blocked_setups_reason: [
      ...context.blocked_setups_reason,
      ...result.remove.map((setup) => `${setup} 被 Dealer ${result.dealer_bias} 过滤。`)
    ],
    allowed_setups_reason: [
      ...context.allowed_setups_reason,
      `Dealer bias ${result.dealer_bias}。`
    ],
    trace: [
      ...context.trace,
      {
        step: 6,
        rule: 'dealer_path',
        dealer_bias: result.dealer_bias,
        removed: result.remove,
        reason: result.trace
      }
    ]
  };
}
