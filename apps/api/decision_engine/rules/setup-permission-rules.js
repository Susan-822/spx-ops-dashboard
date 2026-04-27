function blockedPlanReason({
  commandEnvironment,
  dataHealth,
  conflictResolver,
  tvSentinel,
  tradePlan
} = {}) {
  const reasons = [];
  if (commandEnvironment?.executable !== true) reasons.push(commandEnvironment?.reason || 'command_environment_not_executable');
  if (dataHealth?.executable !== true) reasons.push(dataHealth?.summary || 'data_health_not_executable');
  if (conflictResolver?.action === 'block') reasons.push(conflictResolver?.plain_chinese || 'conflict_block');
  if (tvSentinel?.fresh !== true) reasons.push('tv_not_fresh');
  if (tvSentinel?.matched_allowed_setup !== true) reasons.push('tv_not_matched');
  if (!tradePlan?.entry_zone || tradePlan.entry_zone.text === '--') reasons.push('entry_unavailable');
  if (!tradePlan?.stop_loss || tradePlan.stop_loss.level === 0 || tradePlan.stop_loss.text === '--') reasons.push('stop_unavailable');
  if (!Array.isArray(tradePlan?.targets) || tradePlan.targets.every((item) => item.level == null)) reasons.push('tp1_unavailable');
  return reasons;
}

export function evaluateReadyGate(inputs = {}) {
  const reasons = blockedPlanReason(inputs);
  return {
    ready: reasons.length === 0,
    reasons,
    plain_chinese: reasons.length === 0
      ? '硬门槛全部通过。'
      : `不能 ready：${reasons.join('；')}。`
  };
}

export function reconcileConflictResolver({
  conflictResolver = {},
  commandEnvironment = {},
  tradePlan = {},
  dealerConclusion = {}
} = {}) {
  const reason = String(commandEnvironment?.reason || commandEnvironment?.plain_chinese || '');
  const baseConflicts = Array.isArray(conflictResolver.conflicts)
    ? conflictResolver.conflicts
    : [];

  if (/价格地图冲突|mock key levels|mock.*key|price_map_conflict/i.test(reason)) {
    return {
      ...conflictResolver,
      has_conflict: true,
      severity: 'high',
      action: 'block',
      conflicts: [...new Set([...baseConflicts, 'price_map_conflict'])],
      plain_chinese: '价格地图冲突，禁止执行。'
    };
  }

  const thetaPartialBlocked =
    dealerConclusion?.status === 'partial'
    || /ThetaData dealer partial|Theta partial|dealer partial|partial，不可执行|dealer 不可执行/i.test(reason);

  if (thetaPartialBlocked) {
    return {
      ...conflictResolver,
      has_conflict: false,
      severity: conflictResolver.severity === 'high' ? 'medium' : conflictResolver.severity || 'low',
      action: conflictResolver.action === 'block' ? 'block' : 'wait',
      conflicts: [...new Set([...baseConflicts, 'theta_partial'])],
      plain_chinese: 'ThetaData partial，Dealer 主源不完整，只能等待。'
    };
  }

  if (
    commandEnvironment?.state === 'blocked'
    || commandEnvironment?.executable === false
    || tradePlan?.status === 'blocked'
  ) {
    return {
      ...conflictResolver,
      action: conflictResolver.action === 'block' ? 'block' : 'wait',
      conflicts: baseConflicts.length > 0 ? baseConflicts : ['waiting_gate'],
      plain_chinese: conflictResolver.plain_chinese || '硬门槛未通过，只能等待。'
    };
  }

  return conflictResolver;
}

export function applySetupPermissionRules({
  commandEnvironment = {},
  allowedSetups = {},
  volatilityActivation = {},
  dealerPath = {},
  uwDealerGreeks = {}
} = {}) {
  const blocked = new Set(commandEnvironment.blocked_setups || []);
  for (const item of volatilityActivation.block || []) {
    blocked.add(item);
  }
  if (dealerPath.status !== 'live') {
    blocked.add('ready');
  }
  if (uwDealerGreeks.dealer_crosscheck === 'conflict') {
    blocked.add('all_directional');
  }
  return {
    allowed_setups: commandEnvironment.allowed_setups || [],
    blocked_setups: Array.from(blocked),
    permitted_setup_codes: allowedSetups.permitted_setup_codes || [],
    plain_chinese: blocked.has('ready')
      ? 'Dealer 主源不完整，只允许观察，不允许 ready。'
      : commandEnvironment.plain_chinese || '等待指挥部结论。'
  };
}

export function buildConfidenceScore({
  externalSpot = {},
  dealerConclusion = {},
  uwConclusion = {},
  uwDealerGreeks = {},
  tvSentinel = {},
  fmpConclusion = {},
  volumePressure = {},
  commandEnvironment = {},
  conflictResolver = {}
} = {}) {
  let score = 50;
  const reasons = [];
  if (externalSpot.status === 'real' && externalSpot.source === 'fmp') {
    score += 5;
    reasons.push('FMP spot real +5');
  }
  if (dealerConclusion.status === 'live') score += 15;
  if (dealerConclusion.status === 'partial') {
    score += 3;
    reasons.push('Theta partial +3 executable=false');
  }
  if (dealerConclusion.gamma_regime === 'unknown') {
    score -= 15;
    reasons.push('Gamma unavailable -15');
  }
  if (uwConclusion.status === 'partial') score -= 5;
  if (uwConclusion.status === 'unavailable') score -= 10;
  if (uwDealerGreeks.dealer_crosscheck === 'confirm') score += 10;
  if (uwDealerGreeks.dealer_crosscheck === 'conflict') score -= 20;
  if (tvSentinel.fresh === true && tvSentinel.matched_allowed_setup === true) score += 15;
  if (volumePressure.level === 'active') score += 8;
  if (volumePressure.level === 'impulse') score += 12;
  if (fmpConclusion.event_risk === 'caution') score -= 10;
  if (fmpConclusion.event_risk === 'blocked' || conflictResolver.action === 'block') {
    score = Math.min(score, 20);
    reasons.push('hard block cap');
  }
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: bounded,
    reason: reasons.join('；') || '基础分。',
    executable: commandEnvironment.executable === true && bounded >= 80,
    plain_chinese: `指挥部置信度 ${bounded}，confidence 高不等于 ready。`
  };
}
