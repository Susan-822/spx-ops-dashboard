export function runPositionSizingEngine({ healthMatrix = {}, commandCenter = {} } = {}) {
  const base = healthMatrix.overall_state === 'READY'
    ? 1
    : healthMatrix.overall_state === 'DEGRADED_CANDIDATE'
      ? 0.5
      : 0;
  const confidence = commandCenter.confidence_score >= 70
    ? 1
    : commandCenter.confidence_score >= 50
      ? 0.5
      : commandCenter.confidence_score >= 35
        ? 0.25
        : 0;
  const volatility = commandCenter.final_state === 'actionable' ? 1 : commandCenter.final_state === 'candidate' ? 0.5 : 0;
  const final = ['wait', 'blocked'].includes(commandCenter.final_state)
    ? 0
    : Number((base * confidence * volatility).toFixed(2));

  return {
    base_multiplier: base,
    confidence_multiplier: confidence,
    volatility_multiplier: volatility,
    final_multiplier: final,
    plain_chinese:
      final === 0
        ? '当前 WAIT/BLOCKED 或硬门槛不足，仓位强制 0。'
        : `仓位乘数 ${final}，仍禁止自动下单。`
  };
}
