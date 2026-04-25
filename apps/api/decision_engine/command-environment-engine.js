export function runCommandEnvironmentEngine(input = {}) {
  const dataHealth = input.dataHealth || input.data_health || {};
  const commandInputs = input.commandInputs || input.command_inputs || {};
  const conflictResolver = input.conflictResolver || input.conflict_resolver || {};
  const confidenceScore = input.confidenceScore || input.confidence_score || {};
  const fmpConclusion = input.fmpConclusion || input.fmp_conclusion || {};
  const dealerConclusion = input.dealerConclusion || input.dealer_conclusion || {};
  const uwConclusion = input.uwConclusion || input.uw_conclusion || {};
  const priceSignal = input.priceSignal || input.price_signal || '';
  const tvSentinel = input.tvSentinel || input.tv_sentinel || {};
  const blockers = [];

  if (dataHealth.hard_block || dataHealth.command_inputs_fresh === false) {
    blockers.push('数据健康不足');
  }
  if (fmpConclusion?.event_risk === 'blocked') {
    blockers.push('事件风险阻断');
  }
  if (conflictResolver?.action === 'block') {
    blockers.push('跨源冲突过高');
  }
  if (dataHealth.data_mode === 'mixed' || dataHealth.data_mode === 'mock') {
    blockers.push('数据模式不可执行');
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
      confidence_score: confidenceScore?.score ?? 0,
      data_mode: dataHealth?.data_mode ?? 'mixed',
      regime_note: blockers.join('；'),
      reason: blockers.join('；'),
      blockers,
      plain_chinese: `指挥部阻断：${blockers.join('；')}。`
    };
  }

  let directionalScore = 0;
  if (dealerConclusion?.least_resistance_path === 'up') directionalScore += 2;
  if (dealerConclusion?.least_resistance_path === 'down') directionalScore -= 2;
  if (uwConclusion?.flow_bias === 'bullish') directionalScore += 2;
  if (uwConclusion?.flow_bias === 'bearish') directionalScore -= 2;
  if (fmpConclusion?.market_bias === 'risk_on') directionalScore += 1;
  if (fmpConclusion?.market_bias === 'risk_off') directionalScore -= 1;

  const volatilityLight = uwConclusion?.volatility_light;
  const tvSignal = input.tvSentinel?.tv_signal || input.tv_sentinel?.tv_signal || '';
  const rangeHoldSignal =
    String(tvSignal) === 'range_hold'
    || String(tvSentinel.tv_signal || '') === 'range_hold';
  const breakoutLikeSignal =
    String(tvSignal).includes('A_long_candidate')
    || String(tvSignal).includes('A_short_candidate')
    || String(tvSignal).includes('breakout')
    || String(tvSignal).includes('breakdown');

  const canConsiderIncome =
    dealerConclusion?.gamma_regime === 'positive'
    && dealerConclusion?.dealer_behavior === 'pin'
    && (volatilityLight === 'green' || volatilityLight === 'yellow')
    && fmpConclusion?.event_risk === 'normal'
    && (rangeHoldSignal || priceSignal === 'range_hold')
    && !breakoutLikeSignal;

  let regime_bias = 'neutral';
  if (canConsiderIncome) {
    regime_bias = 'income';
  } else if (directionalScore >= 1 && !rangeHoldSignal) {
    regime_bias = 'long';
  } else if (directionalScore <= -1 && !rangeHoldSignal) {
    regime_bias = 'short';
  }

  const day_type =
    dealerConclusion?.dealer_behavior === 'mixed'
      ? 'rotation'
      : dealerConclusion?.dealer_behavior === 'expand'
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
    allowed_setups.push('B_long', 'B_short', 'B_IRON_CONDOR');
  }

  const blocked_setups = ['A_long', 'B_long', 'A_short', 'B_short'].filter(
    (setup) => !allowed_setups.includes(setup)
  );

  const preferred_strategy =
    regime_bias === 'income'
      ? 'iron_condor'
      : regime_bias === 'long' || regime_bias === 'short'
        ? 'vertical'
        : 'wait';

  const plainChinese = regime_bias === 'income'
    ? '指挥部偏区间，允许观察 B 类回踩/反抽与收入型结构。'
    : regime_bias === 'long'
      ? '指挥部底层偏多，允许多头 A/B 单观察。'
      : regime_bias === 'short'
        ? '指挥部底层偏空，允许空头 A/B 单观察。'
        : '指挥部底层未形成可执行方向，只允许等待。';

  return {
    state: 'ready',
    allowed: true,
    executable: confidenceScore?.executable !== false,
    bias: regime_bias === 'long' ? 'bullish' : regime_bias === 'short' ? 'bearish' : regime_bias === 'income' ? 'mixed' : 'neutral',
    regime_bias,
    day_type,
    allowed_setups,
    blocked_setups,
    preferred_strategy,
    key_support: dealerConclusion?.put_wall ?? null,
    key_resistance: dealerConclusion?.call_wall ?? null,
    forbidden_zone: dealerConclusion?.dealer_behavior === 'mixed' ? 'middle_chop' : 'none',
    confidence_score: confidenceScore?.score ?? 0,
    data_mode: dataHealth?.data_mode ?? 'partial',
    regime_note: regime_bias === 'income'
      ? '指挥部允许观察波动率与结构联动。'
      : '指挥部允许观察方向结构，但仍需价格触发。',
    reason: regime_bias === 'income'
      ? '指挥部允许观察波动率与结构联动。'
      : '指挥部允许观察方向结构，但仍需价格触发。',
    plain_chinese: plainChinese
  };
}
