/**
 * UW API Normalizer — Production v3
 *
 * 基于真实 API 返回结构的精确字段映射（2026-04-30 验证）
 *
 * 真实字段路径（已通过 fetchUwApiSnapshot() 验证）：
 *   GEX/Vanna/Charm  → greek_exposure_strike[].{call_gex, put_gex, call_vanna, put_vanna, call_charm, put_charm}
 *   Net Premium      → net_prem_ticks[].{net_call_premium, net_put_premium}
 *   Flow Recent      → flow_recent[].{option_type, premium, underlying_price}
 *   Darkpool         → darkpool_spy[].{price, premium, size, executed_at}
 *   IV Rank          → iv_rank[].{iv_rank_1y}
 *   Interpolated IV  → interpolated_iv[].{volatility, percentile, days}
 *   Realized Vol     → realized_volatility[].{volatility}
 */

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

/**
 * normalizeDealer
 *
 * 真实字段路径（已验证）：
 *   greek_exposure_strike[].{call_gex, put_gex, call_vanna, put_vanna, call_charm, put_charm, strike}
 *   greek_exposure[].{call_gamma, put_gamma, call_vanna, put_vanna, call_charm, put_charm, date}
 *
 * net_gex = sum(call_gex) + sum(put_gex) across all strikes
 * call_wall = strike with max absolute call_gex
 * put_wall = strike with max absolute put_gex
 * gamma_flip = strike where call_gex + put_gex ≈ 0 (zero-crossing)
 */
function normalizeDealer(raw = {}) {
  const strikeRows = asArray(raw.greek_exposure_strike);
  const greekRows = asArray(raw.greek_exposure);
  const expiryRows = asArray(raw.greek_exposure_expiry);

  // --- GEX from strike-level data ---
  let netCallGex = null;
  let netPutGex = null;
  let callWall = null;
  let putWall = null;
  let gammaFlip = null;

  if (strikeRows.length > 0) {
    // Sum all call_gex and put_gex
    const callGexSum = sumRows(strikeRows, ['call_gex', 'call_gamma_exposure', 'call_gamma']);
    const putGexSum = sumRows(strikeRows, ['put_gex', 'put_gamma_exposure', 'put_gamma']);
    netCallGex = callGexSum;
    netPutGex = putGexSum;

    // Call Wall = strike with highest absolute call_gex (above-spot bias handled by ab-order-engine)
    const callWallRow = [...strikeRows]
      .filter(r => firstNumber(r, ['call_gex', 'call_gamma_exposure', 'call_gamma']) != null)
      .sort((a, b) => Math.abs(firstNumber(b, ['call_gex', 'call_gamma_exposure', 'call_gamma']) ?? 0)
                    - Math.abs(firstNumber(a, ['call_gex', 'call_gamma_exposure', 'call_gamma']) ?? 0))[0];
    callWall = callWallRow ? firstNumber(callWallRow, ['strike', 'price', 'level']) : null;

    // Put Wall = strike with highest absolute put_gex
    const putWallRow = [...strikeRows]
      .filter(r => firstNumber(r, ['put_gex', 'put_gamma_exposure', 'put_gamma']) != null)
      .sort((a, b) => Math.abs(firstNumber(b, ['put_gex', 'put_gamma_exposure', 'put_gamma']) ?? 0)
                    - Math.abs(firstNumber(a, ['put_gex', 'put_gamma_exposure', 'put_gamma']) ?? 0))[0];
    putWall = putWallRow ? firstNumber(putWallRow, ['strike', 'price', 'level']) : null;

    // Gamma Flip = strike where net GEX (call_gex + put_gex) crosses zero
    // Sort by strike, find zero-crossing
    const sorted = [...strikeRows]
      .map(r => ({
        strike: firstNumber(r, ['strike', 'price', 'level']),
        netGex: (firstNumber(r, ['call_gex', 'call_gamma_exposure', 'call_gamma']) ?? 0)
               + (firstNumber(r, ['put_gex', 'put_gamma_exposure', 'put_gamma']) ?? 0)
      }))
      .filter(r => r.strike != null)
      .sort((a, b) => a.strike - b.strike);

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].netGex * sorted[i].netGex <= 0) {
        // Linear interpolation for zero-crossing
        const s1 = sorted[i - 1].strike, g1 = sorted[i - 1].netGex;
        const s2 = sorted[i].strike, g2 = sorted[i].netGex;
        gammaFlip = g1 === g2 ? s1 : Math.round(s1 + (0 - g1) * (s2 - s1) / (g2 - g1));
        break;
      }
    }
  }

  // --- Vanna / Charm from greek_exposure (aggregate) or strike-level ---
  const combined = [...greekRows, ...strikeRows, ...expiryRows];
  const first = combined[0] || {};

  const callVanna = sumRows(strikeRows, ['call_vanna']) ?? firstNumber(first, ['call_vanna', 'vanna', 'net_vanna']);
  const putVanna = sumRows(strikeRows, ['put_vanna']) ?? firstNumber(first, ['put_vanna']);
  const netVanna = (callVanna != null || putVanna != null) ? (callVanna ?? 0) + (putVanna ?? 0) : null;

  const callCharm = sumRows(strikeRows, ['call_charm']) ?? firstNumber(first, ['call_charm', 'charm', 'net_charm']);
  const putCharm = sumRows(strikeRows, ['put_charm']) ?? firstNumber(first, ['put_charm']);
  const netCharm = (callCharm != null || putCharm != null) ? (callCharm ?? 0) + (putCharm ?? 0) : null;

  const netGex = (netCallGex != null || netPutGex != null)
    ? (netCallGex ?? 0) + (netPutGex ?? 0)
    : null;

  return {
    net_gex: netGex,
    net_call_gex: netCallGex,
    net_put_gex: netPutGex,
    call_wall: callWall,
    put_wall: putWall,
    gamma_flip: gammaFlip,
    vanna: netVanna,
    charm: netCharm,
    call_vanna: callVanna,
    put_vanna: putVanna,
    call_charm: callCharm,
    put_charm: putCharm,
    top_gex_strikes: topByAbs(strikeRows, ['call_gex', 'put_gex', 'gamma_exposure'], ['strike']),
    top_call_gamma_strikes: topByAbs(strikeRows, ['call_gex', 'call_gamma', 'call_gamma_exposure'], ['strike']),
    top_put_gamma_strikes: topByAbs(strikeRows, ['put_gex', 'put_gamma', 'put_gamma_exposure'], ['strike']),
    expiry_breakdown: expiryRows.slice(0, 10),
    vanna_bias: biasFromNumber(netVanna),
    charm_bias: biasFromNumber(netCharm),
    delta_bias: biasFromNumber(firstNumber(first, ['dex', 'delta_exposure', 'net_dex']) ?? sumRows(combined, ['dex', 'delta_exposure', 'net_dex']))
  };
}

function normalizeSpotGex(raw = {}) {
  // spot_gex may be empty during non-trading hours; fall back to greek_exposure_strike
  const spotRows = asArray(raw.spot_gex);
  const strikeRows = asArray(raw.greek_exposure_strike);
  const strikeExpiryRows = asArray(raw.greek_exposure_strike_expiry);

  const looksLikeStrikeRows = (rows) => rows.some((row) =>
    row?.strike != null || row?.call_gex != null || row?.put_gex != null
  );

  const allStrikeRows = [
    ...(looksLikeStrikeRows(spotRows) ? spotRows : []),
    ...strikeRows,
    ...strikeExpiryRows
  ];

  const callWall = topByAbs(allStrikeRows, ['call_gex', 'call_gamma', 'call_gamma_exposure'], ['strike'])[0]?.strike ?? null;
  const putWall = topByAbs(allStrikeRows, ['put_gex', 'put_gamma', 'put_gamma_exposure'], ['strike'])[0]?.strike ?? null;

  return {
    spot_gex_by_strike: allStrikeRows.slice(0, 50),
    call_wall_candidate: callWall,
    put_wall_candidate: putWall,
    gex_pivots: topByAbs(allStrikeRows, ['call_gex', 'put_gex'], ['strike'], 8)
  };
}

/**
 * normalizeFlow
 *
 * 真实字段路径（已验证）：
 *   net_prem_ticks[].{net_call_premium, net_put_premium, call_volume, put_volume, tape_time}
 *   flow_recent[].{option_type, premium, underlying_price, underlying_symbol}
 *   options_flow[].{type, total_premium, total_ask_side_prem, total_bid_side_prem}
 *
 * 同时输出 call_put_ratio 和 put_call_ratio，统一使用 put_call_ratio (P/C)
 */
function normalizeFlow(raw = {}) {
  const ticks = asArray(raw.net_prem_ticks);
  const flowRecent = asArray(raw.flow_recent);
  const optionsFlow = asArray(raw.options_flow);

  // --- From net_prem_ticks (most reliable aggregate source) ---
  // Fields: net_call_premium, net_put_premium (confirmed by deep inspect)
  const callPremFromTicks = sumRows(ticks, ['net_call_premium', 'call_premium', 'call_net_premium']);
  const putPremFromTicks = sumRows(ticks, ['net_put_premium', 'put_premium', 'put_net_premium']);

  // --- From flow_recent (individual trades) ---
  const callRows = flowRecent.filter(r => r.option_type === 'call' || r.is_call === true);
  const putRows = flowRecent.filter(r => r.option_type === 'put' || r.is_put === true);
  const callPremFromFlow = sumRows(callRows, ['premium', 'total_premium', 'ask_vol_premium']);
  const putPremFromFlow = sumRows(putRows, ['premium', 'total_premium', 'ask_vol_premium']);

  // --- From options_flow (alerts) ---
  const callPremFromAlerts = sumRows(
    optionsFlow.filter(r => r.type === 'call' || r.option_type === 'call'),
    ['total_premium', 'total_ask_side_prem', 'premium']
  );
  const putPremFromAlerts = sumRows(
    optionsFlow.filter(r => r.type === 'put' || r.option_type === 'put'),
    ['total_premium', 'total_ask_side_prem', 'premium']
  );

  // Prefer ticks > flow_recent > options_flow
  const callPremium = callPremFromTicks ?? callPremFromFlow ?? callPremFromAlerts;
  const putPremium = putPremFromTicks ?? putPremFromFlow ?? putPremFromAlerts;
  const netPremium = (callPremium != null || putPremium != null)
    ? (callPremium ?? 0) - (putPremium ?? 0)
    : null;

  // call_put_ratio = C/P (Call dominance)
  // put_call_ratio = P/C (Put dominance — standard market convention)
  const callPutRatio = callPremium != null && putPremium != null && putPremium > 0
    ? Number((callPremium / putPremium).toFixed(2))
    : null;
  const putCallRatio = callPremium != null && putPremium != null && callPremium > 0
    ? Number((putPremium / callPremium).toFixed(2))
    : null;

  // Sweep count
  const sweepCount = flowRecent.filter(r =>
    r.is_sweep === true || String(r.rule_name || '').toLowerCase().includes('sweep')
  ).length || null;

  // Large trade count (premium >= $100k)
  const largeTradeCount = flowRecent.filter(r =>
    numberOrNull(r.premium ?? r.total_premium) >= 100000
  ).length || null;

  return {
    call_premium_5m: callPremium,
    put_premium_5m: putPremium,
    net_premium_5m: netPremium,
    call_put_ratio: callPutRatio,     // C/P ratio (Call dominance)
    put_call_ratio: putCallRatio,     // P/C ratio (standard convention, used by UI)
    sweep_count_5m: sweepCount,
    large_trade_count_5m: largeTradeCount,
    direction: directionFromPremium(callPremium, putPremium),
    ticks_count: ticks.length,
    flow_recent_count: flowRecent.length
  };
}

/**
 * normalizeDarkpool
 *
 * 真实字段路径（已验证）：
 *   darkpool_spy[].{price, premium, size, executed_at, ticker, nbbo_bid, nbbo_ask}
 *   darkpool_spx[].{price, premium, size, executed_at}
 *
 * SPX 坐标映射：SPY price × 10 = SPX equivalent
 */
function normalizeDarkpool(raw = {}) {
  const spyRows = asArray(raw.darkpool_spy).map(r => ({
    ...r,
    _source: 'SPY',
    _spx_price: firstNumber(r, ['price']) != null ? firstNumber(r, ['price']) * 10 : null
  }));
  const spxRows = asArray(raw.darkpool_spx).map(r => ({
    ...r,
    _source: 'SPX',
    _spx_price: firstNumber(r, ['price'])
  }));
  const recentRows = asArray(raw.darkpool_recent).map(r => ({
    ...r,
    _source: 'RECENT',
    _spx_price: r.ticker === 'SPX'
      ? firstNumber(r, ['price'])
      : r.ticker === 'SPY' ? (firstNumber(r, ['price']) != null ? firstNumber(r, ['price']) * 10 : null) : null
  }));
  const stockLevels = asArray(raw.stock_price_levels);

  // Combine all darkpool rows, prefer SPX-equivalent price
  const allRows = [...spxRows, ...spyRows, ...recentRows]
    .filter(r => r._spx_price != null)
    .sort((a, b) => (numberOrNull(b.premium) ?? 0) - (numberOrNull(a.premium) ?? 0));

  // Cluster nearby levels (within 5 SPX points)
  const clusters = [];
  for (const row of allRows) {
    const spxPrice = row._spx_price;
    const existing = clusters.find(c => Math.abs(c.price - spxPrice) <= 5);
    if (existing) {
      existing.premium += numberOrNull(row.premium) ?? 0;
      existing.size += numberOrNull(row.size) ?? 0;
      existing.count += 1;
    } else {
      clusters.push({
        price: Math.round(spxPrice),
        premium: numberOrNull(row.premium) ?? 0,
        size: numberOrNull(row.size) ?? 0,
        source: row._source,
        executed_at: row.executed_at || null,
        count: 1
      });
    }
  }
  clusters.sort((a, b) => b.premium - a.premium);

  const levels = clusters.slice(0, 10);
  const nearestSupport = levels[0]?.price ?? null;
  const nearestResistance = levels.length > 1 ? levels[1]?.price ?? null : null;

  const offLitRatio = firstNumber(allRows[0] || {}, ['off_lit_ratio', 'darkpool_ratio', 'off_exchange_ratio'])
    ?? firstNumber(stockLevels[0] || {}, ['off_lit_ratio', 'darkpool_ratio']);

  return {
    levels,
    nearest_support: nearestSupport,
    nearest_resistance: nearestResistance,
    off_lit_ratio: offLitRatio,
    large_levels: levels,
    spy_row_count: spyRows.length,
    spx_row_count: spxRows.length,
    darkpool_bias: levels.length === 0 ? 'unknown'
      : nearestSupport != null && nearestResistance == null ? 'support'
      : nearestResistance != null && nearestSupport == null ? 'resistance'
      : 'neutral'
  };
}

/**
 * normalizeVolatility
 *
 * 真实字段路径（已验证）：
 *   iv_rank[].{iv_rank_1y, close, volatility}
 *   interpolated_iv[].{volatility, percentile, days}
 *   realized_volatility[].{volatility}
 *   volatility[].{volatility, close}
 */
function normalizeVolatility(raw = {}) {
  const ivRankRows = asArray(raw.iv_rank);
  const interpolatedRows = asArray(raw.interpolated_iv);
  const realizedRows = asArray(raw.realized_volatility);
  const volRows = asArray(raw.volatility);

  const ivRankRow = ivRankRows[0] || {};
  const interpRow = interpolatedRows.find(r => numberOrNull(r.days) === 30) || interpolatedRows[0] || {};
  const realizedRow = realizedRows[0] || {};
  const volRow = volRows[0] || {};

  // iv_rank_1y is the confirmed field name from deep inspect
  const ivRank = firstNumber(ivRankRow, ['iv_rank_1y', 'iv_rank', 'rank']);

  // ATM IV: from interpolated_iv (30-day) or iv_rank close
  const atmIv = firstNumber(interpRow, ['volatility', 'iv', 'implied_volatility'])
    ?? firstNumber(ivRankRow, ['close', 'volatility', 'atm_iv', 'iv']);

  // IV Percentile
  const ivPercentile = firstNumber(interpRow, ['percentile', 'iv_percentile'])
    ?? firstNumber(ivRankRow, ['percentile', 'iv_percentile']);

  // Realized Volatility (HV)
  const realizedVol = firstNumber(realizedRow, ['volatility', 'realized_volatility', 'rv'])
    ?? firstNumber(volRow, ['volatility', 'rv']);

  return {
    atm_iv: atmIv,
    iv30: atmIv,
    iv_rank: ivRank,
    iv_percentile: ivPercentile,
    realized_volatility: realizedVol,
    hv20: realizedVol,
    term_structure: raw.term_structure || raw.iv_term_structure || {},
    iv_change_5m: null  // Not available from current endpoints
  };
}

function normalizeSentiment(raw = {}) {
  const tideRows = [
    ...asArray(raw.market_tide),
    ...asArray(raw.top_net_impact),
    ...asArray(raw.net_flow_expiry),
    ...asArray(raw.total_options_volume),
    ...asArray(raw.etf_tide)
  ];
  const first = tideRows[0] || {};
  const callFlow = firstNumber(first, ['call_flow', 'calls_premium', 'call_premium', 'net_call_premium']);
  const putFlow = firstNumber(first, ['put_flow', 'puts_premium', 'put_premium', 'net_put_premium']);
  const netFlow = firstNumber(first, ['net_flow', 'net_premium'])
    ?? ((callFlow != null || putFlow != null) ? (callFlow ?? 0) - (putFlow ?? 0) : null);
  const sentiment = netFlow == null ? 'unavailable'
    : netFlow > 0 ? 'risk_on'
    : netFlow < 0 ? 'risk_off'
    : 'mixed';
  return {
    market_tide: first.market_tide || first.tide || null,
    call_flow: callFlow,
    put_flow: putFlow,
    net_flow: netFlow,
    sentiment
  };
}

function normalizeVolumeOi(raw = {}) {
  const oiStrike = asArray(raw.oi_by_strike);
  const oiExpiry = asArray(raw.oi_by_expiry);
  const maxPainRows = asArray(raw.max_pain);
  const volumeRows = [
    ...asArray(raw.options_volume),
    ...asArray(raw.option_price_levels),
    ...asArray(raw.volume_oi)
  ];
  return {
    call_volume_levels: topByAbs(
      volumeRows.filter(r => r.is_call === true || r.option_type === 'call'),
      ['volume', 'call_volume'], ['strike']
    ),
    put_volume_levels: topByAbs(
      volumeRows.filter(r => r.is_put === true || r.option_type === 'put'),
      ['volume', 'put_volume'], ['strike']
    ),
    oi_by_strike: oiStrike.slice(0, 50),
    oi_by_expiry: oiExpiry.slice(0, 50),
    max_pain: firstNumber(maxPainRows[0] || {}, ['max_pain', 'strike', 'price']),
    volume_wall_candidates: topByAbs(volumeRows, ['volume', 'total_volume'], ['strike'], 8),
    volume_magnet_candidates: topByAbs(oiStrike, ['open_interest', 'oi', 'total_oi'], ['strike'], 8)
  };
}

function normalizeTechnical(raw = {}) {
  const vwap = firstNumber(asArray(raw.technical_vwap)[0] || {}, ['value', 'vwap']);
  const atr = firstNumber(asArray(raw.technical_atr)[0] || {}, ['value', 'atr']);
  const ema = firstNumber(asArray(raw.technical_ema)[0] || {}, ['value', 'ema']);
  const rsi = firstNumber(asArray(raw.technical_rsi)[0] || {}, ['value', 'rsi']);
  const trend_bias =
    vwap != null && ema != null
      ? 'unknown'  // Need price context; resolved in decision engine
      : 'unknown';
  const channel_shape =
    atr == null ? 'unknown' : atr >= 20 ? 'expansion' : atr >= 12 ? 'chop' : 'compression';
  return {
    vwap,
    atr,
    ema50: ema,
    rsi,
    macd: firstNumber(asArray(raw.technical_macd)[0] || {}, ['value', 'macd']),
    bb_width: firstNumber(asArray(raw.technical_bbands)[0] || {}, ['bb_width', 'width']),
    trend_bias,
    channel_shape,
    volume_pressure: 'unknown'
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
      greek_exposure_strike: raw.greek_exposure_strike || {},
      spot_gex: raw.spot_gex || {},
      options_flow: raw.options_flow || {},
      darkpool_spy: raw.darkpool_spy || {},
      darkpool_spx: raw.darkpool_spx || {},
      volatility: raw.volatility || {},
      iv_rank: raw.iv_rank || {},
      interpolated_iv: raw.interpolated_iv || {},
      market_tide: raw.market_tide || {},
      net_prem_ticks: raw.net_prem_ticks || {}
    },
    uw_factors: {
      dealer_factors: {
        ...dealer,
        // Merge spot_gex candidates as fallback when greek_exposure_strike is empty
        call_wall: dealer.call_wall ?? spotGex.call_wall_candidate,
        put_wall: dealer.put_wall ?? spotGex.put_wall_candidate,
        spot_gex_by_strike: spotGex.spot_gex_by_strike,
        gex_pivots: spotGex.gex_pivots
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
