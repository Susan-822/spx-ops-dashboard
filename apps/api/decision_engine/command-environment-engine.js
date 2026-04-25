export function runCommandEnvironmentEngine({
  dataHealth,
  marketRegime,
  eventRisk,
  volatility,
  uwFlow,
  marketSentiment,
  conflict
}) {
  const blockers = [];

  if (dataHealth.hard_block || dataHealth.command_inputs_fresh === false) {
    blockers.push('数据健康不足');
  }
  if (eventRisk.risk_gate === 'blocked') {
    blockers.push('事件风险阻断');
  }
  if (conflict.conflict_level === 'high') {
    blockers.push('多源冲突过高');
  }

  if (blockers.length > 0) {
    return {
      state: 'blocked',
      allowed: false,
      executable: false,
      regime_bias: 'neutral',
      regime_note: blockers.join('；'),
      reason: blockers.join('；'),
      blockers
    };
  }

  let regime_bias = 'neutral';
  if (
    marketRegime.market_state === 'negative_gamma_expand'
    || uwFlow.uw_signal === 'bearish_flow'
    || marketSentiment.sentiment === 'risk_off'
  ) {
    regime_bias = 'short';
  } else if (
    marketRegime.market_state === 'positive_gamma_grind'
    || uwFlow.uw_signal === 'bullish_flow'
    || marketSentiment.sentiment === 'risk_on'
  ) {
    regime_bias = volatility.short_vol_allowed ? 'income' : 'long';
  }

  return {
    state: 'ready',
    allowed: true,
    executable: true,
    regime_bias,
    regime_note: volatility.short_vol_allowed
      ? '指挥部允许观察波动率与结构联动。'
      : '指挥部允许观察方向结构，但仍需价格触发。',
    reason: volatility.short_vol_allowed
      ? '指挥部允许观察波动率与结构联动。'
      : '指挥部允许观察方向结构，但仍需价格触发。'
  };
}
