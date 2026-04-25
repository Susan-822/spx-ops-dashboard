export function runCommandEnvironmentEngine({
  dataHealth,
  marketRegime,
  gammaWall,
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
      bias: 'blocked',
      regime_bias: 'neutral',
      day_type: 'unknown',
      allowed_setups: [],
      blocked_setups: ['A_long', 'B_long', 'A_short', 'B_short'],
      preferred_strategy: 'wait',
      key_support: null,
      key_resistance: null,
      forbidden_zone: 'middle_chop',
      confidence_score: 0,
      data_mode: dataHealth?.state === 'healthy' ? 'live' : dataHealth?.state === 'degraded' ? 'partial' : 'mixed',
      regime_note: blockers.join('；'),
      reason: blockers.join('；'),
      blockers,
      plain_chinese: `指挥部阻断：${blockers.join('；')}。`
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

  const day_type =
    marketRegime.market_state === 'flip_chop'
      ? 'rotation'
      : marketRegime.market_state === 'negative_gamma_expand'
        ? 'expansion'
        : regime_bias === 'income'
          ? 'pin'
          : regime_bias === 'long' || regime_bias === 'short'
            ? 'trend'
            : 'cleanup';

  const allowed_setups = [];
  if (regime_bias === 'long') {
    allowed_setups.push('A_long', 'B_long');
  } else if (regime_bias === 'short') {
    allowed_setups.push('A_short', 'B_short');
  } else if (regime_bias === 'income') {
    allowed_setups.push('B_long', 'B_short');
  }

  const blocked_setups = ['A_long', 'B_long', 'A_short', 'B_short'].filter(
    (setup) => !allowed_setups.includes(setup)
  );

  const key_support = Number.isFinite(Number(gammaWall?.distance_to_put_wall)) ? marketRegime?.flip_distance != null ? undefined : undefined : undefined;
  const preferred_strategy =
    regime_bias === 'income'
      ? 'iron_condor'
      : regime_bias === 'long' || regime_bias === 'short'
        ? 'vertical'
        : 'wait';

  const plainChinese = volatility.short_vol_allowed
    ? '指挥部偏区间，允许观察 B 类回踩/反抽与收入型结构。'
    : regime_bias === 'long'
      ? '指挥部底层偏多，允许多头 A/B 单观察。'
      : regime_bias === 'short'
        ? '指挥部底层偏空，允许空头 A/B 单观察。'
        : '指挥部底层未形成可执行方向，只允许等待。';

  return {
    state: 'ready',
    allowed: true,
    executable: true,
    bias: regime_bias === 'long' ? 'bullish' : regime_bias === 'short' ? 'bearish' : regime_bias === 'income' ? 'mixed' : 'neutral',
    regime_bias,
    day_type,
    allowed_setups,
    blocked_setups,
    preferred_strategy,
    key_support: gammaWall?.distance_to_put_wall != null ? 'put_wall' : null,
    key_resistance: gammaWall?.distance_to_call_wall != null ? 'call_wall' : null,
    forbidden_zone: marketRegime.market_state === 'flip_chop' ? 'middle_chop' : 'none',
    confidence_score: conflict?.adjusted_confidence ?? 0,
    data_mode: dataHealth?.state === 'healthy' ? 'live' : dataHealth?.state === 'degraded' ? 'partial' : 'mixed',
    regime_note: volatility.short_vol_allowed
      ? '指挥部允许观察波动率与结构联动。'
      : '指挥部允许观察方向结构，但仍需价格触发。',
    reason: volatility.short_vol_allowed
      ? '指挥部允许观察波动率与结构联动。'
      : '指挥部允许观察方向结构，但仍需价格触发。',
    plain_chinese: plainChinese
  };
}
