const WEIGHTS = Object.freeze({
  theta: 0.4,
  tradingview: 0.3,
  uw: 0.2,
  fmp: 0.1
});

function classifySignal(signal) {
  if (
    [
      'bullish_pullback',
      'long_pullback_ready',
      'bullish_probe',
      'bullish_flow',
      'income_supportive',
      'range_hold'
    ].includes(signal)
  ) {
    return 'positive';
  }

  if (['bearish_pressure', 'short_retest_ready', 'bearish_flow', 'event_risk_high'].includes(signal)) {
    return 'negative';
  }

  return 'neutral';
}

function baseConfidenceFromAgreement(count) {
  if (count >= 4) {
    return 92;
  }
  if (count === 3) {
    return 80;
  }
  if (count === 2) {
    return 70;
  }
  if (count === 1) {
    return 62;
  }
  return 50;
}

function clampConfidence(value) {
  return Math.max(35, Math.min(92, value));
}

function describeTheta(signal) {
  if (signal === 'bearish_pressure') {
    return 'ThetaData 偏空';
  }
  if (signal === 'income_supportive') {
    return 'ThetaData 偏向区间收敛';
  }
  if (signal === 'bullish_pullback') {
    return 'ThetaData 偏多';
  }
  return 'ThetaData 暂无明显方向';
}

function describeTradingView(signal) {
  if (signal === 'long_pullback_ready') {
    return 'TradingView 出现回踩做多结构';
  }
  if (signal === 'short_retest_ready') {
    return 'TradingView 出现反抽做空结构';
  }
  if (signal === 'bullish_probe') {
    return 'TradingView 只有上破试探，还没确认';
  }
  if (signal === 'range_hold') {
    return 'TradingView 仍在区间结构中';
  }
  return 'TradingView 仍未确认方向';
}

export function runConflictEngine({
  theta_signal,
  tv_signal,
  uw_signal,
  fmp_signal,
  stale_flags,
  tv_confirmation
}) {
  const directions = {
    theta: stale_flags.theta ? 'neutral' : classifySignal(theta_signal),
    tradingview: stale_flags.tradingview ? 'neutral' : classifySignal(tv_signal),
    uw: stale_flags.uw ? 'neutral' : classifySignal(uw_signal),
    fmp: stale_flags.fmp ? 'neutral' : classifySignal(fmp_signal)
  };

  const counts = {
    positive: Object.values(directions).filter((value) => value === 'positive').length,
    negative: Object.values(directions).filter((value) => value === 'negative').length
  };
  const agreementCount = Math.max(counts.positive, counts.negative);
  let adjusted_confidence = baseConfidenceFromAgreement(agreementCount);

  const conflict_points = [];
  const thetaTvConflict =
    directions.theta !== 'neutral' &&
    directions.tradingview !== 'neutral' &&
    directions.theta !== directions.tradingview;

  if (thetaTvConflict) {
    conflict_points.push(`${describeTheta(theta_signal)}，但 ${describeTradingView(tv_signal)}`);
  }

  if (directions.uw === 'positive' && tv_confirmation !== 'confirmed') {
    conflict_points.push('UW 偏多但价格未确认');
  }

  if (counts.positive > 0 && counts.negative > 0 && !thetaTvConflict) {
    conflict_points.push('多空来源不一致，先等主导方向更清晰');
  }

  let conflict_level = 'low';
  if (thetaTvConflict || conflict_points.length >= 2) {
    conflict_level = 'high';
    adjusted_confidence -= 15;
  } else if (conflict_points.length === 1) {
    conflict_level = 'medium';
    adjusted_confidence -= 6;
  }

  if (stale_flags.any_stale) {
    adjusted_confidence -= 12;
  }

  return {
    has_conflict: conflict_points.length > 0,
    conflict_level,
    conflict_points,
    adjusted_confidence: clampConfidence(adjusted_confidence),
    theta_tv_conflict: thetaTvConflict,
    weights: WEIGHTS,
    directions,
    agreement_count: agreementCount
  };
}
