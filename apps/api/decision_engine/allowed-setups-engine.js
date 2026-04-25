export function runAllowedSetupsEngine({
  dataHealth,
  commandEnvironment,
  eventRisk,
  volatility
}) {
  if (!dataHealth.executable || commandEnvironment.allowed === false) {
    return {
      A_long: { allowed: false, reason: commandEnvironment.reason },
      B_long: { allowed: false, reason: commandEnvironment.reason },
      A_short: { allowed: false, reason: commandEnvironment.reason },
      B_short: { allowed: false, reason: commandEnvironment.reason },
      single_leg: { allowed: false, reason: commandEnvironment.reason },
      vertical: { allowed: false, reason: commandEnvironment.reason },
      iron_condor: { allowed: false, reason: commandEnvironment.reason },
      allowed_setup_labels: [],
      permitted_setup_codes: [],
      reason: commandEnvironment.reason
    };
  }

  const ironCondorAllowed =
    volatility.short_vol_allowed &&
    eventRisk.risk_gate === 'open' &&
    commandEnvironment.regime_bias === 'income';

  const allowALong = commandEnvironment.regime_bias === 'long';
  const allowBLong = commandEnvironment.regime_bias === 'long';
  const allowAShort = commandEnvironment.regime_bias === 'short';
  const allowBShort = commandEnvironment.regime_bias === 'short';
  const directionalAllowed = allowALong || allowAShort;

  const permitted_setup_codes = [];
  const allowed_setup_labels = [];
  if (allowALong) {
    permitted_setup_codes.push('A_LONG_PULLBACK');
    allowed_setup_labels.push('A_long');
  }
  if (allowBLong) {
    permitted_setup_codes.push('B_LONG_PULLBACK');
    allowed_setup_labels.push('B_long');
  }
  if (allowAShort) {
    permitted_setup_codes.push('A_SHORT_RETEST');
    allowed_setup_labels.push('A_short');
  }
  if (allowBShort) {
    permitted_setup_codes.push('B_SHORT_RETEST');
    allowed_setup_labels.push('B_short');
  }
  if (ironCondorAllowed) {
    permitted_setup_codes.push('B_IRON_CONDOR');
    allowed_setup_labels.push('B_iron_condor');
  }

  return {
    A_long: {
      allowed: allowALong,
      reason: commandEnvironment.regime_note
    },
    B_long: {
      allowed: allowBLong,
      reason: commandEnvironment.regime_note
    },
    A_short: {
      allowed: allowAShort,
      reason: commandEnvironment.regime_note
    },
    B_short: {
      allowed: allowBShort,
      reason: commandEnvironment.regime_note
    },
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
    allowed_setup_labels,
    permitted_setup_codes,
    reason: ironCondorAllowed
      ? '指挥部允许观察收入型结构。'
      : commandEnvironment.regime_note
  };
}
