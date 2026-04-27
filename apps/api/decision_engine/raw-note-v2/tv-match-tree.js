const TV_TO_SETUP = Object.freeze({
  breakout_confirmed: 'A_long_candidate',
  pullback_holding: 'B_long_candidate',
  breakdown_confirmed: 'A_short_candidate',
  retest_failed: 'B_short_candidate'
});

const LABEL_BY_SETUP = Object.freeze({
  A_long_candidate: 'A多候选',
  B_long_candidate: 'B多候选',
  A_short_candidate: 'A空候选',
  B_short_candidate: 'B空候选',
  iron_condor_observe: '铁鹰观察'
});

export function applyTvMatchTree(inputs, state) {
  const tv = inputs.tv_sentinel;
  if (tv.event_type === 'structure_invalidated' || tv.status === 'invalidated') {
    return {
      ...state,
      state: 'invalidated',
      reason: 'TV structure invalidated.',
      label: '作废',
      position_multiplier: 0,
      waiting_for: '',
      trace: [...state.trace, { step: 'tv_match', result: 'invalidated', reason: 'TV structure invalidated.' }]
    };
  }
  if (tv.stale || tv.status === 'stale') {
    return {
      ...state,
      state: 'blocked',
      reason: 'TV stale.',
      label: '禁做',
      position_multiplier: 0,
      waiting_for: '等待新的 TV 结构信号。',
      trace: [...state.trace, { step: 'tv_match', result: 'blocked', reason: 'TV stale.' }]
    };
  }
  const mapped = TV_TO_SETUP[tv.event_type];
  if ((tv.status === 'fresh' || tv.status === 'matched') && mapped && state.allowed_setups.includes(mapped)) {
    return {
      ...state,
      state: 'actionable',
      matched_setup: mapped,
      label: LABEL_BY_SETUP[mapped] || '可执行',
      selected_setup: mapped,
      waiting_for: '',
      trace: [...state.trace, { step: 'tv_match', result: 'actionable', event_type: tv.event_type, setup: mapped }]
    };
  }
  if (tv.status === 'waiting' || !mapped) {
    return {
      ...state,
      state: 'wait',
      reason: mapped ? 'TV waiting.' : 'TV event unmatched.',
      label: '等确认',
      position_multiplier: 0,
      waiting_for: state.waiting_for || '等 TV breakdown_confirmed / retest_failed / breakout_confirmed / pullback_holding。',
      trace: [...state.trace, { step: 'tv_match', result: 'wait', reason: mapped ? 'TV waiting.' : 'TV event unmatched.' }]
    };
  }
  return {
    ...state,
    state: 'wait',
    reason: 'TV unmatched allowed setups.',
    label: '等确认',
    position_multiplier: 0,
    waiting_for: `TV ${tv.event_type || tv.status} 未匹配允许 setup。`,
    trace: [...state.trace, { step: 'tv_match', result: 'wait', reason: 'TV unmatched allowed setups.' }]
  };
}
