export function runAllowedSetupsEngine({
  dataHealth,
  commandEnvironment,
  eventRisk,
  volatility
}) {
  if (!dataHealth.executable || commandEnvironment.allowed === false) {
    return {
      single_leg: { allowed: false, reason: commandEnvironment.reason },
      vertical: { allowed: false, reason: commandEnvironment.reason },
      iron_condor: { allowed: false, reason: commandEnvironment.reason },
      permitted_setup_codes: [],
      reason: commandEnvironment.reason
    };
  }

  const ironCondorAllowed =
    volatility.short_vol_allowed &&
    eventRisk.risk_gate === 'open' &&
    commandEnvironment.regime_bias === 'income';

  const directionalAllowed =
    commandEnvironment.regime_bias === 'long'
    || commandEnvironment.regime_bias === 'short';

  const permitted_setup_codes = [];
  if (commandEnvironment.regime_bias === 'long') {
    permitted_setup_codes.push('A_LONG_PULLBACK');
  }
  if (commandEnvironment.regime_bias === 'short') {
    permitted_setup_codes.push('A_SHORT_RETEST');
  }
  if (ironCondorAllowed) {
    permitted_setup_codes.push('B_IRON_CONDOR');
  }

  return {
    single_leg: {
      allowed: directionalAllowed,
      reason: commandEnvironment.regime_note
    },
    vertical: {
      allowed: directionalAllowed,
      reason: commandEnvironment.regime_note
    },
    iron_condor: {
      allowed: ironCondorAllowed,
      reason: ironCondorAllowed
        ? '指挥部允许观察收入型结构。'
        : '当前不满足收入型结构的指挥部许可。'
    },
    permitted_setup_codes,
    reason: ironCondorAllowed
      ? '指挥部允许观察收入型结构。'
      : commandEnvironment.regime_note
  };
}
