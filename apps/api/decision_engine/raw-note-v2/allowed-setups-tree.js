export const ALL_SETUPS = Object.freeze([
  'A_long_candidate',
  'B_long_candidate',
  'A_short_candidate',
  'B_short_candidate',
  'iron_condor_observe'
]);

export function createSetupState() {
  return {
    allowed_setups: [...ALL_SETUPS],
    allowed_setups_reason: ['初始化 A/B/铁鹰候选。'],
    blocked_setups_reason: []
  };
}

export function removeSetups(state, setups = [], reason = '') {
  const remove = new Set(setups);
  const before = new Set(state.allowed_setups);
  state.allowed_setups = state.allowed_setups.filter((setup) => !remove.has(setup));
  for (const setup of setups) {
    if (before.has(setup)) {
      state.blocked_setups_reason.push(`${setup}: ${reason}`);
    }
  }
  return state;
}

export function onlySetups(state, setups = [], reason = '') {
  const keep = new Set(setups);
  for (const setup of [...state.allowed_setups]) {
    if (!keep.has(setup)) {
      state.blocked_setups_reason.push(`${setup}: ${reason}`);
    }
  }
  state.allowed_setups = state.allowed_setups.filter((setup) => keep.has(setup));
  return state;
}

export function finalizeAllowedSetups(_inputs, context) {
  context.allowed_setups = [...new Set(context.allowed_setups)];
  context.trace.push({
    step: 8,
    rule: 'candidate_list',
    allowed_setups: context.allowed_setups,
    blocked_count: context.blocked_setups_reason.length
  });
  return context;
}
