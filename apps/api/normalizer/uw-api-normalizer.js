function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data?.data)) return value.data.data;
  if (Array.isArray(value?.data?.results)) return value.data.results;
  if (Array.isArray(value?.data?.items)) return value.data.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(row = {}, keys = []) {
  for (const key of keys) {
    const value = numberOrNull(row?.[key]);
    if (value != null) return value;
  }
  return null;
}

function biasFromNumber(value, positive = 'bullish', negative = 'bearish') {
  const parsed = numberOrNull(value);
  if (parsed == null) return 'unknown';
  if (parsed > 0) return positive;
  if (parsed < 0) return negative;
  return 'neutral';
}

function sumRows(rows, keys) {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = firstNumber(row, keys);
    if (value != null) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

function topByAbs(rows, valueKeys, strikeKeys = ['strike', 'price', 'level'], limit = 5) {
  return rows
    .map((row) => ({
      strike: firstNumber(row, strikeKeys),
      value: firstNumber(row, valueKeys),
      expiry: row.expiry || row.expiration || row.expiration_date || null
    }))
    .filter((item) => item.strike != null || item.value != null)
    .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0))
    .slice(0, limit);
}

function directionFromPremium(callPremium, putPremium) {
  if (callPremium == null && putPremium == null) return 'none';
  const call = callPremium ?? 0;
  const put = putPremium ?? 0;
  if (call > put * 1.25) return 'bullish';
  if (put > call * 1.25) return 'bearish';
  return 'mixed';
}

function normalizeDealer(raw = {}) {
  const greekRows = asArray(raw.greek_exposure);
  const strikeRows = asArray(raw.greek_exposure_strike);
  const expiryRows = asArray(raw.greek_exposure_expiry);
  const strikeExpiryRows = asArray(raw.greek_exposure_strike_expiry);
  const combined = [...greekRows, ...strikeRows, ...expiryRows, ...strikeExpiryRows];
  const first = combined[0] || {};

  return {
    gex: firstNumber(first, ['gex', 'gamma_exposure', 'net_gex']) ?? sumRows(combined, ['gex', 'gamma_exposure', 'net_gex']),
    dex: firstNumber(first, ['dex', 'delta_exposure', 'net_dex']) ?? sumRows(combined, ['dex', 'delta_exposure', 'net_dex']),
    vanna: firstNumber(first, ['vanna', 'net_vanna']) ?? sumRows(combined, ['vanna', 'net_vanna']),
    charm: firstNumber(first, ['charm', 'net_charm']) ?? sumRows(combined, ['charm', 'net_charm']),
    top_gex_strikes: topByAbs(strikeRows, ['gex', 'gamma_exposure', 'net_gex']),
    top_call_gamma_strikes: topByAbs(strikeRows, ['call_gex', 'call_gamma', 'call_gamma_exposure']),
    top_put_gamma_strikes: topByAbs(strikeRows, ['put_gex', 'put_gamma', 'put_gamma_exposure']),
    zero_gamma_or_flip: firstNumber(first, ['zero_gamma', 'zero_gamma_level', 'flip', 'flip_point']),
    expiry_breakdown: expiryRows.slice(0, 10),
    vanna_bias: biasFromNumber(firstNumber(first, ['vanna', 'net_vanna']) ?? sumRows(combined, ['vanna', 'net_vanna'])),
    charm_bias: biasFromNumber(firstNumber(first, ['charm', 'net_charm']) ?? sumRows(combined, ['charm', 'net_charm'])),
    delta_bias: biasFromNumber(firstNumber(first, ['dex', 'delta_exposure', 'net_dex']) ?? sumRows(combined, ['dex', 'delta_exposure', 'net_dex']))
  };
}

function normalizeSpotGex(raw = {}) {
  const spotRows = asArray(raw.spot_gex);
  const explicitStrikeRows = asArray(raw.spot_gex_strike);
  const strikeExpiryRows = asArray(raw.spot_gex_strike_expiry);
  const looksLikeStrikeRows = (rows) => rows.some((row) =>
    row?.strike != null
    || row?.call_gamma_oi != null
    || row?.put_gamma_oi != null
    || row?.call_gamma != null
    || row?.put_gamma != null
  );
  const strikeRows = [
    ...explicitStrikeRows,
    ...(looksLikeStrikeRows(spotRows) ? spotRows : []),
    ...strikeExpiryRows
  ];
  const expiryRows = looksLikeStrikeRows(spotRows) ? [] : [];
  const callWall = topByAbs(strikeRows, ['call_gamma_oi', 'call_gex', 'call_gamma', 'gamma_exposure'], ['strike', 'price', 'level'])[0]?.strike ?? null;
  const putWall = topByAbs(strikeRows, ['put_gamma_oi', 'put_gex', 'put_gamma', 'gamma_exposure'], ['strike', 'price', 'level'])[0]?.strike ?? null;
  return {
    spot_gex_by_strike: strikeRows.slice(0, 50),
    spot_gex_by_expiry: expiryRows.slice(0, 50),
    call_wall_candidate: callWall,
    put_wall_candidate: putWall,
    gex_pivots: topByAbs(strikeRows, ['gex', 'gamma_exposure', 'net_gex'], ['strike'], 8)
  };
}

function normalizeFlow(raw = {}) {
  const alertRows = [
    ...asArray(raw.options_flow),
    ...asArray(raw.flow_recent),
    ...asArray(raw.flow_per_expiry),
    ...asArray(raw.flow_per_strike),
    ...asArray(raw.flow_per_strike_intraday)
  ];
  const ticks = asArray(raw.net_prem_ticks);
  const callPremium = sumRows(alertRows.filter((row) => row.is_call === true || row.option_type === 'call'), ['premium', 'total_premium', 'ask_vol_premium'])
    ?? sumRows(ticks, ['call_premium', 'call_net_premium']);
  const putPremium = sumRows(alertRows.filter((row) => row.is_put === true || row.option_type === 'put'), ['premium', 'total_premium', 'ask_vol_premium'])
    ?? sumRows(ticks, ['put_premium', 'put_net_premium']);
  const netPremium = (callPremium != null || putPremium != null) ? (callPremium ?? 0) - (putPremium ?? 0) : sumRows(ticks, ['net_premium']);
  return {
    call_premium_5m: callPremium,
    put_premium_5m: putPremium,
    net_premium_5m: netPremium,
    sweep_count_5m: alertRows.filter((row) => row.is_sweep === true || String(row.rule_name || '').toLowerCase().includes('sweep')).length || null,
    large_trade_count_5m: alertRows.filter((row) => numberOrNull(row.premium ?? row.total_premium) >= 100000).length || null,
    call_put_ratio: callPremium != null && putPremium > 0 ? Number((callPremium / putPremium).toFixed(2)) : null,
    direction: directionFromPremium(callPremium, putPremium)
  };
}

function normalizeDarkpool(raw = {}) {
  const rows = [
    ...asArray(raw.darkpool_recent),
    ...asArray(raw.darkpool_spy),
    ...asArray(raw.darkpool_spx),
    ...asArray(raw.darkpool_qqq),
    ...asArray(raw.darkpool_iwm),
    ...asArray(raw.stock_price_levels)
  ];
  const levels = rows
    .map((row) => ({
      price: firstNumber(row, ['price', 'level']),
      premium: firstNumber(row, ['premium', 'notional', 'volume']),
      side: row.side || row.sentiment || null
    }))
    .filter((item) => item.price != null)
    .sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0));
  const nearestSupport = levels.filter((item) => item.side !== 'resistance')[0]?.price ?? null;
  const nearestResistance = levels.filter((item) => item.side !== 'support')[0]?.price ?? null;
  return {
    nearest_support: nearestSupport,
    nearest_resistance: nearestResistance,
    off_lit_ratio: firstNumber(rows[0], ['off_lit_ratio', 'darkpool_ratio', 'off_exchange_ratio']),
    large_levels: levels.slice(0, 10),
    darkpool_bias: nearestSupport != null && nearestResistance == null
      ? 'support'
      : nearestResistance != null && nearestSupport == null
        ? 'resistance'
        : nearestSupport != null || nearestResistance != null ? 'neutral' : 'unknown'
  };
}

function normalizeVolatility(raw = {}) {
  const volatilityRows = asArray(raw.volatility);
  const ivRank = asArray(raw.iv_rank)[0] || raw.iv_rank || volatilityRows[0] || {};
  const stats = asArray(raw.volatility_stats)[0] || raw.volatility_stats || volatilityRows[0] || {};
  const realized = asArray(raw.realized_volatility)[0] || raw.realized_volatility || {};
  return {
    atm_iv: firstNumber(ivRank, ['atm_iv', 'iv', 'implied_volatility']) ?? firstNumber(stats, ['atm_iv', 'iv']),
    iv_rank: firstNumber(ivRank, ['iv_rank', 'rank']),
    iv_percentile: firstNumber(ivRank, ['iv_percentile', 'percentile']),
    term_structure: raw.term_structure || raw.iv_term_structure || {},
    realized_volatility: firstNumber(realized, ['realized_volatility', 'rv', 'volatility']),
    iv_change_5m: firstNumber(stats, ['iv_change_5m', 'iv_change'])
  };
}

function normalizeSentiment(raw = {}) {
  const tideRows = [
    ...asArray(raw.market_tide),
    ...asArray(raw.top_net_impact),
    ...asArray(raw.net_flow_expiry),
    ...asArray(raw.total_options_volume),
    ...asArray(raw.sector_tide),
    ...asArray(raw.etf_tide)
  ];
  const first = tideRows[0] || {};
  const callFlow = firstNumber(first, ['call_flow', 'calls_premium', 'call_premium']);
  const putFlow = firstNumber(first, ['put_flow', 'puts_premium', 'put_premium']);
  const netFlow = firstNumber(first, ['net_flow', 'net_premium']) ?? ((callFlow != null || putFlow != null) ? (callFlow ?? 0) - (putFlow ?? 0) : null);
  const sentiment = netFlow == null ? 'unavailable' : netFlow > 0 ? 'risk_on' : netFlow < 0 ? 'risk_off' : 'mixed';
  return {
    market_tide: first.market_tide || first.tide || null,
    call_flow: callFlow,
    put_flow: putFlow,
    net_flow: netFlow,
    sentiment
  };
}

function normalizeVolumeOi(raw = {}) {
  const oiStrike = asArray(raw.oi_per_strike);
  const oiExpiry = asArray(raw.oi_per_expiry);
  const maxPainRows = asArray(raw.max_pain);
  const volumeRows = [
    ...asArray(raw.options_volume),
    ...asArray(raw.option_price_levels),
    ...asArray(raw.volume_oi)
  ];
  return {
    call_volume_levels: topByAbs(volumeRows.filter((row) => row.is_call === true || row.option_type === 'call'), ['volume', 'call_volume'], ['strike']),
    put_volume_levels: topByAbs(volumeRows.filter((row) => row.is_put === true || row.option_type === 'put'), ['volume', 'put_volume'], ['strike']),
    oi_by_strike: oiStrike.slice(0, 50),
    oi_by_expiry: oiExpiry.slice(0, 50),
    max_pain: firstNumber(maxPainRows[0] || {}, ['max_pain', 'strike', 'price']),
    volume_wall_candidates: topByAbs(volumeRows, ['volume', 'total_volume'], ['strike'], 8),
    volume_magnet_candidates: topByAbs(oiStrike, ['open_interest', 'oi', 'total_oi'], ['strike'], 8)
  };
}

function normalizeTechnical(raw = {}) {
  const close = asArray(raw.ohlc)[0] || {};
  const vwap = firstNumber(asArray(raw.technical_vwap)[0] || {}, ['value', 'vwap']);
  const atr = firstNumber(asArray(raw.technical_atr)[0] || {}, ['value', 'atr']);
  const ema = firstNumber(asArray(raw.technical_ema)[0] || {}, ['value', 'ema']);
  const rsi = firstNumber(asArray(raw.technical_rsi)[0] || {}, ['value', 'rsi']);
  const price = firstNumber(close, ['close', 'price']);
  const trend_bias =
    price != null && ema != null && vwap != null
      ? price > ema && price > vwap ? 'bullish' : price < ema && price < vwap ? 'bearish' : 'neutral'
      : 'unknown';
  const channel_shape =
    atr == null ? 'unknown' : atr >= 20 ? 'expansion' : atr >= 12 ? 'chop' : 'compression';
  const volumePressure =
    firstNumber(close, ['volume']) == null ? 'unknown' : firstNumber(close, ['volume']) > 1000000 ? 'high' : 'normal';
  return {
    vwap,
    atr,
    ema50: ema,
    rsi,
    macd: firstNumber(asArray(raw.technical_macd)[0] || {}, ['value', 'macd']),
    bb_width: firstNumber(asArray(raw.technical_bbands)[0] || {}, ['bb_width', 'width']),
    trend_bias,
    channel_shape,
    volume_pressure: volumePressure
  };
}

export function normalizeUwApiSnapshot(snapshot = {}) {
  const raw = snapshot.raw || {};
  const dealer = normalizeDealer(raw);
  const spotGex = normalizeSpotGex(raw);
  const flow = normalizeFlow(raw);
  const darkpool = normalizeDarkpool(raw);
  const volatility = normalizeVolatility(raw);
  const sentiment = normalizeSentiment(raw);
  const volumeOi = normalizeVolumeOi(raw);
  const technical = normalizeTechnical(raw);

  return {
    uw_raw: {
      greek_exposure: raw.greek_exposure || {},
      spot_gex: raw.spot_gex || {},
      options_flow: raw.options_flow || {},
      darkpool: raw.darkpool_spy || raw.darkpool_spx || {},
      volatility: raw.volatility || raw.volatility_stats || raw.iv_rank || {},
      market_tide: raw.market_tide || {},
      volume_oi: raw.options_volume || raw.oi_per_strike || {}
    },
    uw_factors: {
      dealer_factors: {
        ...dealer,
        ...spotGex
      },
      flow_factors: flow,
      darkpool_factors: darkpool,
      volatility_factors: volatility,
      sentiment_factors: sentiment,
      volume_oi_factors: volumeOi,
      technical_factors: technical
    }
  };
}
