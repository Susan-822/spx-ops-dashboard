function scoreGamma(gammaRegime) {
  if (gammaRegime === 'positive') return 1;
  if (gammaRegime === 'negative') return -1;
  return 0;
}

function scoreTheta(thetaSignal) {
  if (thetaSignal === 'bullish_pullback') return 1;
  if (thetaSignal === 'income_supportive') return 0;
  if (thetaSignal === 'bearish_pressure') return -1;
  return 0;
}

function scoreUw(uwSignal) {
  if (uwSignal === 'bullish_flow') return 1;
  if (uwSignal === 'bearish_flow') return -1;
  return 0;
}

export function runMarketSentimentEngine({ gamma_regime, theta_signal, uw_signal, conflict_level }) {
  const score = scoreGamma(gamma_regime) + scoreTheta(theta_signal) + scoreUw(uw_signal);

  let sentiment = 'neutral';
  if (conflict_level === 'high') {
    sentiment = 'conflicted';
  } else if (theta_signal === 'income_supportive' && gamma_regime === 'positive') {
    sentiment = 'event_muted';
  } else if (score >= 2) {
    sentiment = 'risk_on';
  } else if (score <= -2) {
    sentiment = 'risk_off';
  }

  return {
    sentiment,
    score,
    summary:
      sentiment === 'conflicted'
        ? '市场情绪冲突，先观察。'
        : sentiment === 'event_muted'
          ? '市场情绪偏中性，倾向区间而非追方向。'
        : sentiment === 'risk_on'
          ? '市场情绪偏积极。'
          : sentiment === 'risk_off'
            ? '市场情绪偏谨慎。'
            : '市场情绪中性。'
  };
}
