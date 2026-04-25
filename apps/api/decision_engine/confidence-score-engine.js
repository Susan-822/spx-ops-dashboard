function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function runConfidenceScoreEngine({
  fmpConclusion,
  dealerConclusion,
  uwConclusion,
  tvSentinel,
  commandEnvironment,
  dataHealth,
  conflictResolver
}) {
  if (dataHealth?.data_mode === 'mixed' || dataHealth?.data_mode === 'mock' || dataHealth?.price_conflict === true) {
    return {
      score: 0,
      executable: false,
      plain_chinese: '数据模式不可信，禁止执行。'
    };
  }

  let score = 50;

  if (dealerConclusion?.least_resistance_path === 'up' && commandEnvironment?.bias === 'bullish') {
    score += 15;
  } else if (dealerConclusion?.least_resistance_path === 'down' && commandEnvironment?.bias === 'bearish') {
    score += 15;
  }

  if (uwConclusion?.flow_bias === 'bullish' && commandEnvironment?.bias === 'bullish') {
    score += 15;
  } else if (uwConclusion?.flow_bias === 'bearish' && commandEnvironment?.bias === 'bearish') {
    score += 15;
  }

  if (uwConclusion?.institutional_entry === 'building') {
    score += 10;
  } else if (uwConclusion?.institutional_entry === 'bombing') {
    score += 20;
  }

  if (fmpConclusion?.market_bias === 'risk_on' && commandEnvironment?.bias === 'bullish') {
    score += 5;
  } else if (fmpConclusion?.market_bias === 'risk_off' && commandEnvironment?.bias === 'bearish') {
    score += 5;
  }

  if (uwConclusion?.volatility_light === 'green' || commandEnvironment?.preferred_strategy === 'vertical') {
    score += 10;
  }

  if (tvSentinel?.matched_allowed_setup === true && tvSentinel?.fresh === true) {
    score += 15;
  }

  if (fmpConclusion?.event_risk === 'caution') {
    score -= 10;
  }
  if (conflictResolver?.has_conflict && ['medium', 'high'].includes(conflictResolver.severity)) {
    score -= 15;
  }
  if (uwConclusion?.status === 'partial') {
    score -= 10;
  }
  if (dealerConclusion?.status === 'unavailable') {
    score -= 15;
  }
  if (uwConclusion?.status === 'unavailable') {
    score -= 10;
  }
  if (tvSentinel?.stale === true) {
    score -= 30;
  }

  return {
    score: boundedScore(score),
    executable: boundedScore(score) >= 80,
    plain_chinese:
      boundedScore(score) >= 80
        ? '强确认，可进入 ready。'
        : boundedScore(score) >= 65
          ? '可观察，等待触发。'
          : boundedScore(score) >= 50
            ? '弱确认，保持等待。'
            : '确认度不足，禁止执行。'
  };
}
