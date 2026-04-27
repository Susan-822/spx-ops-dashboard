export function applyHealthMatrix(ctx, draft) {
  const trace = draft.trace;
  const timeToClose = ctx.command_environment.time_to_close_minutes;

  if (Number.isFinite(timeToClose) && timeToClose < 15) {
    trace.push({ step: 0, rule: 'time_to_close_lt_15', result: 'blocked' });
    return {
      ...draft,
      state: 'blocked',
      label: '禁做',
      reason: '收盘前 15 分钟内禁做新仓。',
      instruction: '只平仓，不开新仓。',
      position_multiplier: 0,
      do_not_do: [...draft.do_not_do, '收盘前 15 分钟不开新仓。'],
      stop: true
    };
  }

  if (Number.isFinite(timeToClose) && timeToClose < 30) {
    draft.position_multiplier = Math.min(draft.position_multiplier, 0.25);
    trace.push({ step: 0, rule: 'time_to_close_lt_30', result: 'position_0.25' });
  } else {
    trace.push({ step: 0, rule: 'time_window', result: 'ok' });
  }

  if (!ctx.fmp_conclusion.spot_is_real) {
    trace.push({ step: 1, rule: 'fmp_spot_unavailable', result: 'blocked' });
    return {
      ...draft,
      state: 'blocked',
      label: '禁做',
      direction: 'unknown',
      reason: 'FMP 现价不可靠。',
      instruction: '禁做，等待真实现价。',
      position_multiplier: 0,
      do_not_do: [...draft.do_not_do, '现价不可靠时不开仓。'],
      stop: true
    };
  }

  if (ctx.fmp_conclusion.event_risk === 'blocked') {
    trace.push({ step: 1, rule: 'event_risk_blocked', result: 'blocked' });
    return {
      ...draft,
      state: 'blocked',
      label: '禁做',
      reason: 'FMP 事件风险阻断。',
      instruction: '禁做，等待事件风险解除。',
      position_multiplier: 0,
      do_not_do: [...draft.do_not_do, '事件风险阻断时不开仓。'],
      stop: true
    };
  }

  if (ctx.uw_conclusion.status === 'unavailable') {
    trace.push({ step: 1, rule: 'uw_unavailable', result: 'blocked' });
    return {
      ...draft,
      state: 'blocked',
      label: '禁做',
      reason: 'UW 主数据不可用。',
      instruction: '禁做，等待 UW 主数据恢复。',
      position_multiplier: 0,
      do_not_do: [...draft.do_not_do, 'UW 主数据不可用时不开方向单。'],
      stop: true
    };
  }

  trace.push({ step: 1, rule: 'hard_data_health', result: 'ok' });
  return draft;
}

export function deriveDataTier(ctx, draft) {
  let dataTier = 'full';
  if (!ctx.uw_conclusion.greeks_available && !ctx.uw_conclusion.flow_available) {
    dataTier = 'critical';
  } else if (!ctx.uw_conclusion.greeks_available) {
    dataTier = 'partial_gamma';
  } else if (!ctx.uw_conclusion.flow_available || !ctx.uw_conclusion.darkpool_available) {
    dataTier = 'no_flow';
  }

  draft.data_tier = dataTier;
  if (dataTier === 'critical') {
    draft.allowed_setups = [];
    draft.state = 'wait';
    draft.label = '等确认';
    draft.reason = 'UW Greeks 与 Flow 都不可用，只能观察。';
    draft.instruction = '观察，不做方向单。';
    draft.position_multiplier = 0;
    draft.blocked_setups_reason.push('critical 数据层禁止方向单。');
  } else if (dataTier === 'partial_gamma' || dataTier === 'no_flow') {
    draft.allowed_setups = ['B_long_candidate', 'B_short_candidate', 'iron_condor_observe'];
    draft.position_multiplier = Math.min(draft.position_multiplier, 0.5);
    draft.blocked_setups_reason.push(`${dataTier} 禁止 A 单。`);
  } else {
    draft.allowed_setups = ['A_long_candidate', 'B_long_candidate', 'A_short_candidate', 'B_short_candidate', 'iron_condor_observe'];
  }

  draft.trace.push({ step: 2, rule: 'degradation_matrix', data_tier: dataTier, allowed_setups: [...draft.allowed_setups] });
  return draft;
}

export function evaluateHealthMatrix(ctx) {
  let draft = {
    trace: [],
    do_not_do: [],
    position_multiplier: 1,
    blocked: false,
    reason: '',
    instruction: '',
    data_tier: 'full'
  };
  draft = applyHealthMatrix(ctx, draft);
  if (draft.stop) {
    return {
      blocked: true,
      reason: draft.reason,
      instruction: draft.instruction,
      position_multiplier: 0,
      data_tier: 'blocked',
      trace: draft.trace
    };
  }
  draft.allowed_setups = [];
  draft.blocked_setups_reason = [];
  draft = deriveDataTier(ctx, draft);
  return {
    blocked: false,
    reason: '',
    instruction: '',
    position_multiplier: draft.position_multiplier,
    data_tier: draft.data_tier,
    trace: draft.trace
  };
}
