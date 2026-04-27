function ageSeconds(value, now = new Date()) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((new Date(now).getTime() - parsed.getTime()) / 1000));
}

function freshness(age, fresh, usable) {
  if (age == null) return 'unavailable';
  if (age <= fresh) return 'fresh';
  if (age <= usable) return 'usable';
  return 'stale';
}

export function runHealthMatrixEngine({
  signal = {},
  uwProvider = {},
  tvSentinel = {},
  dealerEngine = {},
  tradePlan = {},
  now = new Date()
} = {}) {
  const fmpAge = ageSeconds(signal.command_inputs?.external_spot?.last_updated || signal.market_snapshot?.spot_last_updated, now);
  const uwAge = uwProvider.age_seconds ?? ageSeconds(uwProvider.last_update, now);
  const tvAge = ageSeconds(tvSentinel.event_time || tvSentinel.trigger_time || signal.last_updated?.tradingview, now);
  const thetaAge = ageSeconds(signal.theta?.last_update || signal.last_updated?.theta, now);
  const fmpFreshness = freshness(fmpAge, 10, 30);
  const uwFreshness = freshness(uwAge, 120, 300);
  const tvFreshness = tvSentinel.matched_allowed_setup === true ? freshness(tvAge, 60, 180) : 'waiting';
  const thetaFreshness = freshness(thetaAge, 60, 60);

  let state = 'WAIT';
  const reasons = [];
  if (signal.command_inputs?.external_spot?.status !== 'real') {
    state = 'BLOCKED';
    reasons.push('FMP spot unavailable');
  }
  if (tvFreshness === 'stale') {
    state = 'BLOCKED';
    reasons.push('TV stale');
  }
  if (dealerEngine.status === 'unavailable') {
    state = 'BLOCKED';
    reasons.push('UW gamma 完全不可用');
  }
  if (state !== 'BLOCKED' && uwProvider.status === 'live' && tvSentinel.matched_allowed_setup === true && dealerEngine.status === 'live') {
    state = 'READY';
  } else if (state !== 'BLOCKED' && ['partial', 'stale'].includes(uwProvider.status) && tvSentinel.matched_allowed_setup === true) {
    state = 'DEGRADED_CANDIDATE';
  } else if (state !== 'BLOCKED' && signal.command_inputs?.external_spot?.status === 'real' && ['live', 'partial'].includes(uwProvider.status)) {
    state = tvSentinel.status === 'waiting' ? 'WAIT' : 'OBSERVE_ONLY';
  }

  return {
    state,
    fmp: { age_seconds: fmpAge, freshness: fmpFreshness },
    uw: { age_seconds: uwAge, freshness: uwFreshness, status: uwProvider.status || 'unavailable' },
    tv: { age_seconds: tvAge, freshness: tvFreshness },
    theta: { age_seconds: thetaAge, freshness: thetaFreshness, status: signal.theta?.status || 'unavailable' },
    reasons,
    plain_chinese: reasons.length > 0 ? reasons.join('；') : `${state} 条件。`
  };
}
