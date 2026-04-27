export function applyVolatilityTree(inputs, context) {
  const state = inputs.volatility_activation?.state || inputs.volatility_activation?.strength || 'unknown';
  const removeSetup = (setup, reason) => {
    context.allowed_setups = context.allowed_setups.filter((item) => item !== setup);
    context.blocked_setups_reason.push(`${setup}: ${reason}`);
  };
  if (state === 'inactive' || state === 'off') {
    removeSetup('A_long_candidate', '波动未启动，移除 A 多。');
    removeSetup('A_short_candidate', '波动未启动，移除 A 空。');
  } else if (state === 'warming' || state === 'yellow') {
    context.trace.push({ step: 3, rule: 'volatility_warming', result: 'B first' });
  } else if (state === 'expansion' || state === 'strong' || state === 'extreme') {
    removeSetup('iron_condor_observe', '波动扩张禁止铁鹰。');
    if (context.dealer_bias === 'bearish') removeSetup('A_long_candidate', '波动扩张禁止逆势 A 多。');
    if (context.dealer_bias === 'bullish') removeSetup('A_short_candidate', '波动扩张禁止逆势 A 空。');
  }
  context.trace.push({ step: 3, rule: 'volatility_tree', state, allowed_setups: [...context.allowed_setups] });
  return context;
}
