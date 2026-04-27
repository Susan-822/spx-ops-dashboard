export function applyTechnicalTree(state, inputs) {
  const channel = inputs.channel_shape?.state || inputs.channel_shape?.shape || inputs.uw_conclusion.channel_shape || inputs.volatility_activation?.channel_shape || 'unknown';
  if (channel === 'chop') {
    state.allowed_setups = [];
    state.blocked_setups_reason.push('channel chop -> 禁做');
    state.final_state = 'blocked';
    state.label = '禁做';
    state.reason = '通道是 chop，方向和铁鹰都不放行。';
  } else if (channel === 'spiral') {
    state.allowed_setups = state.allowed_setups.filter((setup) => setup === 'iron_condor_observe');
    state.blocked_setups_reason.push('spiral -> 禁做方向单');
  } else if (channel === 'compression') {
    state.allowed_setups = state.allowed_setups.filter((setup) => setup.startsWith('B_') || setup === 'iron_condor_observe');
    state.blocked_setups_reason.push('compression -> 只保留 B / 铁鹰观察');
  } else if (channel === 'expansion_channel' && (inputs.uw_conclusion.rvol ?? 0) <= 2) {
    state.allowed_setups = state.allowed_setups.filter((setup) => !setup.startsWith('A_'));
    state.blocked_setups_reason.push('expansion_channel 且 rvol <= 2.0 -> 移除 A 单');
  }
  const rvol = inputs.uw_conclusion.rvol;
  if (Number.isFinite(rvol) && rvol < 1.5) {
    state.allowed_setups = state.allowed_setups.filter((setup) => !setup.startsWith('A_'));
    state.blocked_setups_reason.push('rvol < 1.5 -> 移除 A 单');
  }
  if (Number.isFinite(rvol) && rvol < 1) {
    state.allowed_setups = state.allowed_setups.filter((setup) => !setup.startsWith('B_'));
    state.blocked_setups_reason.push('rvol < 1.0 -> 移除 B 单');
  }
  state.trace.push({ step: 'technical_tree', channel, rvol: rvol ?? null, allowed_setups: [...state.allowed_setups] });
  return state;
}
