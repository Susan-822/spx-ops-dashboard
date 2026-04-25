export function runConflictResolver({
  fmp_conclusion = {},
  dealer_conclusion = {},
  uw_conclusion = {},
  tv_sentinel = {},
  data_health = {},
  command_environment = {}
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
    command_environment.preferred_strategy === 'iron_condor'
    && uw_conclusion.volatility_light === 'green'
  ) {
    conflicts.push('波动绿灯与铁鹰许可冲突，禁止提前卖波。');
  }
  if (fmp_conclusion.event_risk === 'blocked' && tv_sentinel.matched_allowed_setup) {
    conflicts.push('事件风险阻断优先于 TV 触发。');
  }
  if (data_health.data_mode === 'mixed' || data_health.data_mode === 'mock') {
    conflicts.push('数据模式不是 live，全部计划不可执行。');
  }
  if (fmp_conclusion.price_status === 'conflict') {
    conflicts.push('价格状态冲突，禁止执行。');
  }

  let severity = 'none';
  let action = 'allow';
  if (conflicts.length >= 3) {
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
