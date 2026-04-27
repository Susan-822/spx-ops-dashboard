export function runSetupSynthesisEngine({
  volatilityActivation = {},
  institutionalAlert = {},
  darkpoolSummary = {},
  technicalEngine = {},
  dealerEngine = {},
  marketSentiment = {}
} = {}) {
  const allowed = [];
  const allowedReason = [];
  const blockedReason = [];
  const rvolOkA = technicalEngine.volume_pressure === 'high';
  const rvolOkB = ['high', 'normal'].includes(technicalEngine.volume_pressure);
  const flowBull = institutionalAlert.direction === 'bullish';
  const flowBear = institutionalAlert.direction === 'bearish';
  const volDirectional = ['active', 'strong', 'extreme'].includes(volatilityActivation.strength)
    || ['active', 'expansion'].includes(volatilityActivation.state);

  if (volDirectional && flowBull && technicalEngine.trend_bias === 'bullish' && rvolOkA) {
    allowed.push('A_long_candidate');
    allowedReason.push('A_long: 波动 active/expansion + flow bullish + price above VWAP/EMA + rvol ok.');
  } else {
    blockedReason.push('A_long blocked: 需要波动、flow、VWAP/EMA、rvol 同向。');
  }
  if ((flowBull || darkpoolSummary.bias === 'support') && technicalEngine.trend_bias !== 'bearish' && rvolOkB) {
    allowed.push('B_long_candidate');
    allowedReason.push('B_long: flow/support 与 VWAP 附近结构支持。');
  } else {
    blockedReason.push('B_long blocked: 需要 bullish flow/support 与 B 单量能。');
  }
  if (volDirectional && flowBear && technicalEngine.trend_bias === 'bearish' && rvolOkA) {
    allowed.push('A_short_candidate');
    allowedReason.push('A_short: 波动 active/expansion + flow bearish + price below VWAP/EMA + rvol ok.');
  } else {
    blockedReason.push('A_short blocked: 需要波动、flow、VWAP/EMA、rvol 同向。');
  }
  if ((flowBear || darkpoolSummary.bias === 'resistance') && technicalEngine.trend_bias !== 'bullish' && rvolOkB) {
    allowed.push('B_short_candidate');
    allowedReason.push('B_short: flow/resistance 与 VWAP 附近结构支持。');
  } else {
    blockedReason.push('B_short blocked: 需要 bearish flow/resistance 与 B 单量能。');
  }
  if (
    dealerEngine.regime === 'positive_gamma'
    && ['inactive', 'warming'].includes(volatilityActivation.state)
    && ['mixed', 'unavailable'].includes(marketSentiment.state)
    && institutionalAlert.state !== 'bombing'
  ) {
    allowed.push('iron_condor_observe');
    allowedReason.push('Iron condor observe: 正 Gamma 控波、非单边情绪、无 bombing flow。');
  } else {
    blockedReason.push('Iron condor blocked: 需要正 Gamma、低/升温波动、非单边情绪、无 bombing。');
  }

  return {
    allowed_setups: allowed,
    allowed_setups_reason: allowedReason,
    blocked_setups_reason: blockedReason
  };
}
