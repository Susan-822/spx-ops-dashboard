function hasActionableTradePlan(tradePlan = {}) {
  const entry = tradePlan.entry_zone?.text && tradePlan.entry_zone.text !== '--';
  const stop = tradePlan.stop_loss?.text && tradePlan.stop_loss.text !== '--';
  const target = Array.isArray(tradePlan.targets) && tradePlan.targets.some((item) => item.level != null);
  const invalidation = tradePlan.invalidation?.text && tradePlan.invalidation.text !== '--';
  return Boolean(entry && stop && target && invalidation);
}

function directionFromInputs({ institutionalAlert = {}, dealerEngine = {}, darkpoolSummary = {}, marketSentiment = {} } = {}) {
  if (institutionalAlert.direction === 'bullish' && dealerEngine.path_of_least_resistance !== 'down') return 'bullish';
  if (institutionalAlert.direction === 'bearish' && dealerEngine.path_of_least_resistance !== 'up') return 'bearish';
  if (dealerEngine.path_of_least_resistance === 'range' || darkpoolSummary.bias === 'neutral') return 'range';
  if (marketSentiment.state === 'risk_on') return 'bullish';
  if (marketSentiment.state === 'risk_off') return 'bearish';
  return 'unknown';
}

export function runCommandCenterEngine({
  uwProvider = {},
  dealerEngine = {},
  institutionalAlert = {},
  volatilityActivation = {},
  marketSentiment = {},
  darkpoolSummary = {},
  dataHealth = {},
  tvSentinel = {},
  theta = {},
  tradePlan = {},
  flowPriceDivergence = {},
  conflictResolver = {},
  healthMatrix = {},
  crossAssetProjection = {}
} = {}) {
  const reasons = [];
  const direction = directionFromInputs({ institutionalAlert, dealerEngine, darkpoolSummary, marketSentiment });
  let finalState = 'wait';

  if (dataHealth.summary?.label === 'BLOCKED' || dataHealth.executable === false) {
    finalState = 'blocked';
    reasons.push(dataHealth.summary?.plain_chinese || 'data_health blocked');
  }
  if (healthMatrix.state === 'BLOCKED') {
    finalState = 'blocked';
    reasons.push(healthMatrix.plain_chinese || 'health_matrix blocked');
  } else if (healthMatrix.state === 'DEGRADED_CANDIDATE' && finalState !== 'blocked') {
    finalState = 'candidate';
    reasons.push(healthMatrix.plain_chinese || 'health_matrix degraded candidate');
  } else if (healthMatrix.state === 'OBSERVE_ONLY' && finalState !== 'blocked') {
    finalState = 'wait';
    reasons.push(healthMatrix.plain_chinese || 'observe only');
  }
  if (uwProvider.status === 'unavailable') reasons.push('UW unavailable，不得主导交易。');
  if (uwProvider.status === 'error') {
    finalState = 'blocked';
    reasons.push('UW API 全部核心 endpoint 失败。');
  }
  if (uwProvider.status === 'partial' && finalState !== 'blocked') {
    finalState = 'candidate';
    reasons.push('UW partial，最多 candidate。');
  }
  if (tvSentinel.status === 'stale' || tvSentinel.stale === true) {
    finalState = 'blocked';
    reasons.push('TV stale。');
  } else if (tvSentinel.status === 'waiting' || tvSentinel.matched_allowed_setup !== true) {
    if (finalState !== 'blocked') finalState = 'wait';
    reasons.push('TV waiting，不得 actionable。');
  }
  if (theta.status === 'unavailable' || dealerEngine.status === 'unavailable') {
    reasons.push('Theta unavailable，Dealer 主结论降级。');
  }
  if (!hasActionableTradePlan(tradePlan)) {
    if (finalState !== 'blocked') finalState = 'wait';
    reasons.push('entry / stop / target / invalidation 缺失。');
  }
  if (flowPriceDivergence.action === 'wait') {
    if (finalState !== 'blocked') finalState = 'wait';
    reasons.push(flowPriceDivergence.plain_chinese || 'Flow 与 Price 背离。');
  }
  if (conflictResolver.action === 'block') {
    finalState = 'blocked';
    reasons.push(conflictResolver.plain_chinese || 'data conflict。');
  }

  if (
    finalState !== 'blocked'
    && finalState !== 'wait'
    && uwProvider.status === 'live'
    && tvSentinel.matched_allowed_setup === true
    && hasActionableTradePlan(tradePlan)
  ) {
    finalState = 'actionable';
  }

  const action = {
    blocked: '禁做',
    wait: '等确认',
    candidate: '候选',
    actionable: '可执行'
  }[finalState];
  const projectionLine = crossAssetProjection?.projected_levels?.find((item) => item.type === 'zero_gamma' && item.es_equiv != null);
  const mainReason = reasons[0] || 'UW / TV / Theta 条件同步，等待执行细节确认。';
  const confidence = Math.max(0, Math.min(100,
    (uwProvider.status === 'live' ? 25 : uwProvider.status === 'partial' ? 15 : 0)
    + (tvSentinel.matched_allowed_setup === true ? 25 : 0)
    + (theta.status === 'live' ? 20 : theta.status === 'partial' ? 10 : 0)
    + (institutionalAlert.score || 0) * 0.2
    + (marketSentiment.score || 0) * 0.1
  ));

  return {
    final_state: finalState,
    direction,
    action,
    main_reason: mainReason,
    forbidden_action: finalState === 'actionable' ? '禁止自动下单。' : '不追高，不提前押方向。',
    confidence_score: Math.round(confidence),
    plain_chinese: projectionLine
      ? `${action}：${mainReason} 关键位：SPX Zero Gamma ${projectionLine.spx} → ES ${projectionLine.es_equiv}。`
      : `${action}：${mainReason}`
  };
}
