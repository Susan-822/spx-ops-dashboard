export function runConflictResolver({
  fmp_conclusion = {},
  dealer_conclusion = {},
  uw_conclusion = {},
  tv_sentinel = {},
  data_health = {},
  command_environment = {},
  allowed_setups = {}
} = {}) {
  const conflicts = [];

  const fmpBias = fmp_conclusion.market_bias;
  const dealerPath = dealer_conclusion.least_resistance_path;
  const uwCrosscheck = uw_conclusion.dealer_crosscheck;

  if (fmpBias === 'risk_on' && dealerPath === 'down') {
    conflicts.push('FMP 风险偏多，但 Dealer 路径偏下。');
  }
  if (fmpBias === 'risk_off' && dealerPath === 'up') {
    conflicts.push('FMP 风险偏空，但 Dealer 路径偏上。');
  }
  if (uwCrosscheck === 'conflict') {
    conflicts.push('UW 与 Dealer 主源结论冲突。');
  }
  if (
    tv_sentinel.event_type === 'breakout_confirmed'
    && uw_conclusion.flow_bias === 'bearish'
  ) {
    conflicts.push('TV 突破触发，但 UW Flow 偏空，不追突破。');
  }
  if (
    tv_sentinel.event_type === 'breakdown_confirmed'
    && uw_conclusion.flow_bias === 'bullish'
  ) {
    conflicts.push('TV 跌破触发，但 UW Flow 偏多，不追跌。');
  }
  if (
    tv_sentinel.event_type === 'breakdown_confirmed'
    && uw_conclusion.flow_bias === 'bullish'
  ) {
    conflicts.push('UW flow bullish，但 TV breakdown_confirmed，等待新结构。');
  }
  if (
    tv_sentinel.event_type === 'breakout_confirmed'
    && uw_conclusion.flow_bias === 'bearish'
  ) {
    conflicts.push('UW flow bearish，但 TV breakout_confirmed，等待 B 结构。');
  }
  if (
    command_environment.preferred_strategy === 'iron_condor'
    && uw_conclusion.volatility_light === 'green'
  ) {
    conflicts.push('波动绿灯与铁鹰许可冲突，禁止提前卖波。');
  }
  if (
    allowed_setups?.iron_condor?.allowed === true
    && uw_conclusion.volatility_light === 'green'
  ) {
    conflicts.push('UW volatility green，但 iron_condor allow，强制 block。');
  }
  if (fmp_conclusion.event_risk === 'blocked' && tv_sentinel.matched_allowed_setup) {
    conflicts.push('事件风险阻断优先于 TV 触发。');
  }
  if (fmp_conclusion.event_risk === 'blocked' && ['bullish', 'bearish', 'mixed'].includes(uw_conclusion.flow_bias)) {
    conflicts.push('FMP event_risk blocked，但 UW 有方向，事件风险优先。');
  }
  if (tv_sentinel.stale === true && uw_conclusion.status === 'live') {
    conflicts.push('TV stale，但 UW live，只观察不 ready。');
  }
  if (
    uw_conclusion.status === 'unavailable'
    && command_environment.preferred_strategy === 'vertical'
    && command_environment.allowed === true
  ) {
    conflicts.push('UW unavailable 时，不允许 single_leg/方向策略直接放行。');
  }
  if (data_health.data_mode === 'mixed' || data_health.data_mode === 'mock') {
    conflicts.push('数据模式不是 live，全部计划不可执行。');
  }
  if (fmp_conclusion.price_status === 'conflict') {
    conflicts.push('价格状态冲突，禁止执行。');
  }
  if (data_health.coherence === 'mixed') {
    conflicts.push('真实现价与 scenario/mock Gamma 地图混用，禁止执行。');
  }
  if (data_health.coherence === 'conflict') {
    conflicts.push('现价与 Flip/Wall/Max Pain 地图严重冲突，禁止执行。');
  }
  if (data_health.coherence === 'mock') {
    conflicts.push('当前为演示场景，不可交易。');
  }

  let severity = 'none';
  let action = 'allow';
  if (
    uw_conclusion.dealer_crosscheck === 'conflict'
    || fmp_conclusion.event_risk === 'blocked'
    || (allowed_setups?.iron_condor?.allowed === true && uw_conclusion.volatility_light === 'green')
    || ['mixed', 'conflict', 'mock'].includes(data_health.coherence)
  ) {
    severity = 'high';
    action = 'block';
  } else if (conflicts.length >= 3) {
    severity = 'high';
    action = 'block';
  } else if (conflicts.length === 2) {
    severity = 'medium';
    action = 'wait';
  } else if (conflicts.length === 1) {
    severity = 'low';
    action = 'downgrade';
  }

  return {
    has_conflict: conflicts.length > 0,
    severity,
    conflicts,
    action,
    plain_chinese:
      conflicts.length === 0
        ? '跨源结论没有明显冲突。'
        : severity === 'high'
          ? '跨源冲突过高，禁止执行。'
          : severity === 'medium'
            ? '跨源存在中等冲突，先等待。'
            : '跨源存在轻度冲突，降低计划等级。'
  };
}
