function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function status(value, fallback = 'unavailable') {
  return typeof value === 'string' && value ? value : fallback;
}

function ageSeconds(lastUpdated, now = new Date()) {
  if (!lastUpdated) return null;
  const time = new Date(lastUpdated).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((new Date(now).getTime() - time) / 1000));
}

function deriveMarketMinutes(now = new Date()) {
  const date = new Date(now);
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short'
  }).formatToParts(date);
  const byType = Object.fromEntries(eastern.map((part) => [part.type, part.value]));
  const hour = Number(byType.hour);
  const minute = Number(byType.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const minutes = hour * 60 + minute;
  return Math.max(0, (16 * 60) - minutes);
}

export function normalizeRawNoteInputs(input = {}, now = new Date()) {
  const fmp = input.fmp_conclusion || {};
  const uw = input.uw_conclusion || {};
  const theta = input.theta_conclusion || {};
  const tv = input.tv_sentinel || {};
  const priceSources = input.price_sources || {};
  const spotConclusion = input.spot_conclusion || {};
  const eventConclusion = input.event_conclusion || {};
  const spxSpot = numberOrNull(spotConclusion.spot ?? spotConclusion.spx_value ?? priceSources.spx?.price ?? fmp.spot ?? input.market_snapshot?.spot);

  return {
    spot_conclusion: {
      status: status(spotConclusion.status, spxSpot == null ? 'unavailable' : 'degraded'),
      spot: spxSpot,
      spx_value: spxSpot,
      source: status(spotConclusion.source, spxSpot == null ? 'unavailable' : 'unknown'),
      confidence: status(spotConclusion.confidence, spxSpot == null ? 'unavailable' : 'low'),
      plain_chinese: spotConclusion.plain_chinese || ''
    },
    event_conclusion: {
      risk: status(eventConclusion.risk, 'unknown'),
      source: status(eventConclusion.source, 'unavailable'),
      sell_vol_permission: status(eventConclusion.sell_vol_permission, 'wait'),
      reason: eventConclusion.reason || '',
      plain_chinese: eventConclusion.plain_chinese || ''
    },
    fmp_conclusion: {
      status: status(fmp.status, fmp.spot_is_real === true ? 'live' : 'unavailable'),
      spot_is_real: fmp.spot_is_real === true || fmp.price_status === 'valid',
      spot: spxSpot,
      event_risk: status(fmp.event_risk, 'unavailable'),
      plain_chinese: fmp.plain_chinese || ''
    },
    uw_conclusion: {
      status: status(uw.status),
      age_s: numberOrNull(uw.age_s ?? uw.age_seconds),
      net_gex: numberOrNull(uw.net_gex),
      call_wall: numberOrNull(uw.call_wall),
      put_wall: numberOrNull(uw.put_wall),
      zero_gamma: numberOrNull(uw.zero_gamma),
      max_pain: numberOrNull(uw.max_pain),
      gamma_regime: status(uw.gamma_regime, 'unknown'),
      vanna: numberOrNull(uw.vanna),
      charm: numberOrNull(uw.charm),
      delta_exposure: numberOrNull(uw.delta_exposure),
      flow_available: uw.flow_available === true,
      flow_bias: status(uw.flow_bias, 'unavailable'),
      flow_strength: status(uw.flow_strength, 'unknown'),
      darkpool_available: uw.darkpool_available === true,
      darkpool_bias: status(uw.darkpool_bias, 'unavailable'),
      market_tide: status(uw.market_tide, 'unavailable'),
      iv_rank: numberOrNull(uw.iv_rank),
      iv_percentile: numberOrNull(uw.iv_percentile),
      rvol: numberOrNull(uw.rvol),
      vwap: numberOrNull(uw.vwap),
      ema50: numberOrNull(uw.ema50),
      atr_5min: numberOrNull(uw.atr_5min),
      greeks_available: uw.greeks_available === true,
      dealer_confirm: status(uw.dealer_confirm, 'unavailable'),
      plain_chinese: uw.plain_chinese || ''
    },
    theta_conclusion: {
      status: status(theta.status, 'disabled'),
      role: theta.role || 'disabled',
      em_available: theta.em_available === true,
      expected_move: numberOrNull(theta.expected_move),
      em_upper: numberOrNull(theta.em_upper),
      em_lower: numberOrNull(theta.em_lower),
      atm_call_mid: numberOrNull(theta.atm_call_mid),
      atm_put_mid: numberOrNull(theta.atm_put_mid),
      plain_chinese: theta.plain_chinese || 'ThetaData 暂停使用，系统以 UW API 为主。'
    },
    tv_sentinel: {
      status: status(tv.status, 'waiting'),
      event_type: tv.event_type || null,
      fresh: tv.fresh === true || tv.status === 'fresh' || tv.status === 'matched',
      stale: tv.stale === true || tv.status === 'stale',
      matched_allowed_setup: tv.matched_allowed_setup === true,
      price: numberOrNull(tv.price),
      plain_chinese: tv.plain_chinese || tv.reason || ''
    },
    volume_pressure: input.volume_pressure || {},
    channel_shape: input.channel_shape || {},
    volatility_activation: input.volatility_activation || {},
    conflict_resolver: input.conflict_resolver || {},
    command_environment: {
      time_to_close_minutes: numberOrNull(input.command_environment?.time_to_close_minutes) ?? deriveMarketMinutes(now),
      ...input.command_environment
    },
    price_sources: priceSources,
    cross_asset_projection: input.cross_asset_projection || {},
    now
  };
}
