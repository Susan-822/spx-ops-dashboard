function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(row = {}, keys = []) {
  for (const key of keys) {
    const value = numberOrNull(row?.[key]);
    if (value != null) return { value, field: key };
  }
  return { value: null, field: '' };
}

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

function top(rows, key, limit = 5) {
  return rows
    .filter((row) => row.strike != null && row[key] != null)
    .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]))
    .slice(0, limit)
    .map((row) => ({ strike: row.strike, value: row[key] }));
}

function findZeroGamma(rows) {
  let running = 0;
  let previous = null;
  for (const row of rows) {
    running += row.net_gamma ?? 0;
    if (previous && Math.sign(previous.running) !== 0 && Math.sign(previous.running) !== Math.sign(running)) {
      return row.strike;
    }
    previous = { strike: row.strike, running };
  }
  return null;
}

export function buildUwWallDiagnostics(raw = {}) {
  const rows = asArray(raw.spot_gex_strike ?? raw.spot_gex);
  const normalized = rows.map((row) => {
    const strike = firstNumber(row, ['strike', 'price', 'level']);
    const call = firstNumber(row, ['call_gamma_oi', 'call_gex', 'call_gamma', 'call_gamma_exposure']);
    const putRaw = firstNumber(row, ['put_gamma_oi', 'put_gex', 'put_gamma', 'put_gamma_exposure']);
    const net = firstNumber(row, ['net_gamma', 'gex', 'gamma_exposure', 'net_gex']);
    const put = putRaw.value == null ? null : Math.abs(putRaw.value);
    return {
      strike: strike.value,
      call_gamma: call.value,
      put_gamma: put,
      net_gamma: net.value ?? ((call.value ?? 0) - (put ?? 0)),
      fields: {
        strike: strike.field,
        call: call.field,
        put: putRaw.field,
        net: net.field
      }
    };
  }).filter((row) => row.strike != null);

  const sorted = [...normalized].sort((a, b) => a.strike - b.strike);
  const callWall = top(normalized, 'call_gamma', 1)[0]?.strike ?? null;
  const putWall = top(normalized, 'put_gamma', 1)[0]?.strike ?? null;
  const zeroGamma = findZeroGamma(sorted);
  const first = normalized.find((row) => row.fields.strike || row.fields.call || row.fields.put || row.fields.net) || { fields: {} };
  const confidence = normalized.length >= 5 && callWall != null && putWall != null ? 'high' : normalized.length > 0 ? 'medium' : 'low';
  const sameWall = callWall != null && callWall === putWall;

  return {
    raw_fields_used: {
      strike_field: first.fields.strike || '',
      call_gamma_field: first.fields.call || '',
      put_gamma_field: first.fields.put || '',
      net_gamma_field: first.fields.net || ''
    },
    top_call_gamma_strikes: top(normalized, 'call_gamma'),
    top_put_gamma_strikes: top(normalized, 'put_gamma'),
    top_net_gex_strikes: top(normalized, 'net_gamma'),
    call_wall: callWall,
    put_wall: putWall,
    zero_gamma: zeroGamma,
    zero_gamma_method: zeroGamma == null ? 'running_net_gamma_no_cross' : 'running_net_gamma_first_cross',
    confidence,
    plain_chinese: sameWall
      ? `Call Wall 与 Put Wall 同为 ${callWall}，因为该 strike 同时拥有最大的 call/put gamma；需要人工复核字段。`
      : `Wall diagnostics 使用 ${normalized.length} 行 spot exposure strike 数据。`
  };
}

function statusFromProvider(provider = {}, greeksAvailable, flowAvailable) {
  if (provider.status === 'unavailable') return 'unavailable';
  if (provider.status === 'stale') return 'stale';
  if (provider.status === 'live' && greeksAvailable && flowAvailable) return 'live';
  if (provider.status === 'live' || provider.status === 'partial') return 'partial';
  return provider.status || 'unavailable';
}

export function buildUwConclusionV2({ provider = {}, factors = {}, raw = {}, institutionalAlert = {}, darkpoolSummary = {}, marketSentiment = {}, technicalEngine = {} } = {}) {
  const dealer = factors.dealer_factors || {};
  const flow = factors.flow_factors || {};
  const volumeOi = factors.volume_oi_factors || {};
  const technical = factors.technical_factors || {};
  const volatility = factors.volatility_factors || {};
  const diagnostics = buildUwWallDiagnostics(raw);
  const callWall = diagnostics.call_wall ?? dealer.call_wall_candidate ?? dealer.top_call_gamma_strikes?.[0]?.strike ?? null;
  const putWall = diagnostics.put_wall ?? dealer.put_wall_candidate ?? dealer.top_put_gamma_strikes?.[0]?.strike ?? null;
  const zeroGamma = diagnostics.zero_gamma ?? dealer.zero_gamma_or_flip ?? dealer.gex_pivots?.[0]?.strike ?? null;
  const netGex = numberOrNull(dealer.gex ?? diagnostics.top_net_gex_strikes.reduce((sum, item) => sum + (item.value ?? 0), 0));
  const greeksAvailable = callWall != null || putWall != null || netGex != null || dealer.vanna != null || dealer.charm != null || dealer.dex != null;
  const flowBias = institutionalAlert.direction && institutionalAlert.direction !== 'none'
    ? institutionalAlert.direction
    : flow.direction === 'mixed' ? 'neutral' : flow.direction || 'unavailable';
  const flowAvailable = ['bullish', 'bearish', 'neutral'].includes(flowBias);
  const darkpoolBias = darkpoolSummary.bias === 'support' ? 'bullish' : darkpoolSummary.bias === 'resistance' ? 'bearish' : darkpoolSummary.bias || 'unavailable';
  const marketTide = marketSentiment.state === 'risk_on' ? 'bullish' : marketSentiment.state === 'risk_off' ? 'bearish' : marketSentiment.state === 'mixed' ? 'neutral' : 'unavailable';
  const status = statusFromProvider(provider, greeksAvailable, flowAvailable);
  const gammaRegime = netGex == null ? 'unknown' : netGex > 0 ? 'positive' : netGex < 0 ? 'negative' : 'neutral';

  return {
    uw_conclusion: {
      status,
      age_s: provider.age_seconds ?? null,
      net_gex: netGex,
      call_wall: callWall,
      put_wall: putWall,
      zero_gamma: zeroGamma,
      max_pain: volumeOi.max_pain ?? null,
      gamma_regime: gammaRegime,
      vanna: dealer.vanna ?? null,
      charm: dealer.charm ?? null,
      delta_exposure: dealer.dex ?? null,
      flow_available: flowAvailable,
      flow_bias: flowAvailable ? flowBias : 'unavailable',
      flow_strength: institutionalAlert.score >= 70 ? 'strong' : institutionalAlert.score >= 35 ? 'medium' : flowAvailable ? 'weak' : 'unknown',
      darkpool_available: ['bullish', 'bearish', 'neutral'].includes(darkpoolBias),
      darkpool_bias: ['bullish', 'bearish', 'neutral'].includes(darkpoolBias) ? darkpoolBias : 'unavailable',
      market_tide: ['bullish', 'bearish', 'neutral'].includes(marketTide) ? marketTide : 'unavailable',
      iv_rank: volatility.iv_rank ?? null,
      iv_percentile: volatility.iv_percentile ?? null,
      rvol: technical.rvol ?? null,
      vwap: technical.vwap ?? null,
      ema50: technical.ema50 ?? null,
      atr_5min: technical.atr ?? null,
      greeks_available: greeksAvailable,
      dealer_confirm: greeksAvailable && flowAvailable ? 'confirm' : greeksAvailable ? 'partial' : 'unavailable',
      plain_chinese: status === 'unavailable'
        ? 'UW 主数据不可用。'
        : `UW ${status}：Wall/Greeks/Flow 已晋升到统一结论层。`
    },
    uw_wall_diagnostics: diagnostics
  };
}
