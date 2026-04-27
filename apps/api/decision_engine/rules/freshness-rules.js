function toTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function ageMs(lastUpdated, now = Date.now()) {
  const time = toTime(lastUpdated);
  return time == null ? null : Math.max(0, now - time);
}

function ageLabel(ms) {
  if (ms == null) return 'unavailable';
  if (ms <= 5_000) return '<5s';
  if (ms <= 30_000) return '<30s';
  if (ms <= 60_000) return '>30s';
  if (ms <= 180_000) return '>1m';
  return '>3m';
}

function sourceAge(sourceStatus = [], source) {
  const item = Array.isArray(sourceStatus) ? sourceStatus.find((entry) => entry.source === source) : null;
  const ms = ageMs(item?.last_updated || item?.data_timestamp);
  return { item, age_ms: ms, age_label: ageLabel(ms) };
}

export function buildFreshnessSummary({ signal = {}, normalized = {}, fmpConclusion = {}, dealerConclusion = {}, uwConclusion = {}, tvSentinel = {}, conflictResolver = {}, dataHealth = {}, tradePlan = {} } = {}) {
  const sourceStatus = signal.source_status || normalized.source_status || [];
  const fmp = sourceAge(sourceStatus, 'fmp_price');
  const thetaCore = sourceAge(sourceStatus, 'theta_core');
  const uw = sourceAge(sourceStatus, 'uw');
  const tradingview = sourceAge(sourceStatus, 'tradingview');
  const fmpStatus = fmpConclusion.price_status === 'valid' || fmp.item?.state === 'real' ? 'real' : fmp.item?.state === 'delayed' ? 'stale' : 'unavailable';
  const thetaStatus = dealerConclusion.status || 'unavailable';
  const uwStatus = uwConclusion.status || 'unavailable';
  const tvStatus = tvSentinel.stale ? 'stale' : tvSentinel.matched_allowed_setup ? 'fresh' : tvSentinel.triggered ? 'unmatched' : 'waiting';
  const thetaExecutable = dealerConclusion.status === 'live' && dataHealth.executable === true;
  const stopInvalid = tradePlan?.stop_loss?.level === 0;
  const health =
    fmpStatus !== 'real'
    || ['partial', 'unavailable'].includes(thetaStatus)
    || tvStatus === 'stale'
    || conflictResolver.action === 'block'
    || stopInvalid
      ? 'red'
      : fmpStatus === 'real' && thetaStatus === 'live' && ['live', 'partial'].includes(uwStatus) && tvSentinel.matched_allowed_setup === true && dataHealth.executable === true
        ? 'green'
        : 'yellow';
  const label = health === 'green' ? 'READY' : health === 'yellow' ? 'DEGRADED' : 'BLOCKED';

  return {
    summary: {
      health,
      label,
      plain_chinese:
        health === 'green'
          ? '四源健康，仍需交易计划硬门槛。'
          : health === 'yellow'
            ? '核心现价可用，但部分源降级，只能候选或观察。'
            : '关键源不可执行或存在阻断，禁止交易。'
    },
    fmp: {
      status: fmpStatus,
      age_ms: fmp.age_ms,
      age_label: fmp.age_label
    },
    theta: {
      status: thetaStatus,
      age_ms: thetaCore.age_ms,
      age_label: thetaCore.age_label,
      gamma_status: dealerConclusion.gamma_regime === 'unknown' ? 'incomplete' : 'complete',
      em_status: dealerConclusion.expected_move_upper != null && dealerConclusion.expected_move_lower != null ? 'available' : 'unavailable',
      fallback: Array.isArray(normalized.theta?.quality?.warnings) && normalized.theta.quality.warnings.includes('walls_from_oi_fallback')
    },
    uw: {
      status: uwStatus,
      age_ms: uw.age_ms,
      age_label: uw.age_label,
      flow_enabled: ['live', 'partial'].includes(uwStatus),
      greeks_enabled: false
    },
    tv: {
      status: tvStatus,
      age_ms: tradingview.age_ms,
      age_label: tradingview.age_label,
      last_match: tvSentinel.event_type || null
    }
  };
}
