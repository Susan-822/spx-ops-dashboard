export function buildDegradationMatrix({
  fmpConclusion = {},
  dealerConclusion = {},
  uwConclusion = {},
  tvSentinel = {},
  dataHealth = {},
  conflictResolver = {},
  tradePlan = {}
} = {}) {
  const resolver = conflictResolver || {};
  const plan = tradePlan || {};
  const reasons = [];
  const fmpReal = fmpConclusion.status === 'live' && ['valid', 'real'].includes(fmpConclusion.price_status);
  const thetaLive = dealerConclusion.status === 'live';
  const thetaPartial = dealerConclusion.status === 'partial';
  const thetaUnavailable = ['unavailable', 'error', 'stale', 'mock'].includes(dealerConclusion.status);
  const uwLive = uwConclusion.status === 'live';
  const uwPartial = uwConclusion.status === 'partial';
  const uwUnavailable = ['unavailable', 'error', 'stale'].includes(uwConclusion.status);
  const tvMatched = tvSentinel.fresh === true && tvSentinel.matched_allowed_setup === true;
  const tvWaiting = tvSentinel.status === 'waiting' || tvSentinel.status === 'triggered';
  const tvStale = tvSentinel.stale === true || tvSentinel.status === 'stale';
  const invalidStops = plan?.stop_loss?.level === 0 || plan?.targets?.some?.((item) => item.level === 0);

  let state = 'OBSERVE_ONLY';
  if (!fmpReal) {
    state = 'BLOCKED';
    reasons.push('fmp_not_real');
  } else if (fmpConclusion.event_risk === 'blocked') {
    state = 'BLOCKED';
    reasons.push('event_blocked');
  } else if (tvStale) {
    state = 'BLOCKED';
    reasons.push('tv_stale');
  } else if (resolver.action === 'block') {
    state = 'BLOCKED';
    reasons.push('conflict_block');
  } else if (invalidStops) {
    state = 'BLOCKED';
    reasons.push('invalid_stop_or_target');
  } else if (thetaLive && (uwLive || uwPartial) && tvMatched && dataHealth.executable === true) {
    state = 'READY';
  } else if (thetaLive && uwUnavailable && tvMatched) {
    state = 'DEGRADED_CANDIDATE';
    reasons.push('uw_unavailable');
  } else if (thetaPartial && uwLive && tvMatched) {
    state = 'DEGRADED_CANDIDATE';
    reasons.push('theta_partial');
  } else if (thetaPartial && uwPartial && tvMatched) {
    state = 'OBSERVE_ONLY';
    reasons.push('theta_partial_uw_partial');
  } else if (thetaPartial && uwUnavailable) {
    state = 'OBSERVE_ONLY';
    reasons.push('theta_partial_uw_unavailable');
  } else if (thetaUnavailable) {
    state = 'OBSERVE_ONLY';
    reasons.push('theta_unavailable');
  } else if (thetaLive && (uwLive || uwPartial) && tvWaiting) {
    state = 'WAIT';
    reasons.push('tv_waiting');
  } else {
    reasons.push('missing_ready_gate');
  }

  return {
    state,
    reason: reasons.join(', ') || 'ready_matrix_pass',
    one_source_blocks: ['BLOCKED', 'OBSERVE_ONLY'].includes(state),
    plain_chinese:
      state === 'READY'
        ? '四源与硬门槛允许 ready。'
        : state === 'DEGRADED_CANDIDATE'
          ? '数据允许候选，但不允许直接 ready。'
          : state === 'WAIT'
            ? '环境可观察，等待 TV 价格哨兵。'
            : state === 'BLOCKED'
              ? '关键源或硬门槛阻断，禁止执行。'
              : '数据不完整，只允许观察。'
  };
}
