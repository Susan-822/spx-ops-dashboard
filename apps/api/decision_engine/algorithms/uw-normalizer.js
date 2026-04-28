import { numberOrNull } from './safe-number.js';

function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data?.data)) return value.data.data;
  if (Array.isArray(value?.data?.results)) return value.data.results;
  if (Array.isArray(value?.data?.items)) return value.data.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function firstRow(value) {
  return rows(value)[0] || {};
}

function endpointShape(value) {
  const row = firstRow(value);
  const data = value?.data;
  return {
    top_level_keys: Object.keys(value || {}),
    data_type: Array.isArray(data?.data) ? 'data.data[]' : Array.isArray(data) ? 'data[]' : data == null ? 'none' : typeof data,
    first_row_keys: Object.keys(row)
  };
}

function bool(value) {
  return value === true;
}

function parseDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function dteFromExpiry(expiry, now = new Date()) {
  const expiryDate = parseDate(expiry);
  if (!expiryDate) return null;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUtc = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
  return Math.max(0, Math.round((expiryUtc - todayUtc) / 86400000));
}

function normalizeContractType(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'put' || text === 'p') return 'put';
  if (text === 'call' || text === 'c') return 'call';
  return 'unknown';
}

function normalizeFlow(raw = {}, now = new Date()) {
  const row = firstRow(raw.options_flow);
  const contractType = normalizeContractType(row.type ?? row.option_type);
  const hasData = Object.keys(row).length > 0;
  const missingFields = [
    hasData ? null : 'flow sample',
    'ask/bid 官方语义',
    '0DTE 标记',
    '多腿比例'
  ].filter(Boolean);
  return {
    status: hasData ? 'partial' : 'unavailable',
    has_data: hasData,
    alert_rule: row.alert_rule || row.rule_name || '',
    contract_type: contractType,
    ask_side_premium: numberOrNull(row.total_ask_side_prem),
    bid_side_premium: numberOrNull(row.total_bid_side_prem),
    total_premium: numberOrNull(row.total_premium ?? row.premium),
    trade_count: numberOrNull(row.trade_count),
    expiry: row.expiry || '',
    dte: dteFromExpiry(row.expiry, now),
    has_multileg: bool(row.has_multileg),
    has_sweep: bool(row.has_sweep || row.is_sweep),
    open_interest: numberOrNull(row.open_interest),
    volume: numberOrNull(row.volume),
    parser_status: hasData ? 'partial' : 'failed',
    missing_fields: missingFields,
    current_block_cn: hasData
      ? 'ask-side / bid-side 官方语义未完全确认，不能生成强交易结论。'
      : 'Flow raw 暂无可用样本。',
    field_semantics_confirmed: false,
    raw_interpretation_cn: hasData
      ? `有 ${contractType === 'put' ? 'Put' : contractType === 'call' ? 'Call' : '未知合约'} ${row.alert_rule || row.rule_name || 'flow'} 和 ask-side premium，但 ask-side 语义未完全确认，只能作为资金线索。`
      : 'Flow raw 暂无可用样本。'
  };
}

function firstNumberFromRows(rawEndpoint, keys = []) {
  for (const row of rows(rawEndpoint)) {
    for (const key of keys) {
      const value = numberOrNull(row?.[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function normalizeIvPercent(value) {
  const number = numberOrNull(value);
  if (number == null) return null;
  return number <= 1 ? number * 100 : number;
}

function classifyVscore(value) {
  if (value == null) return 'unavailable';
  if (value < 30) return 'long_gamma_friendly';
  if (value <= 75) return 'normal';
  if (value <= 85) return 'expensive';
  return 'prohibit_long_single';
}

function allRowsForKeys(raw = {}, keys = []) {
  return keys.flatMap((key) => rows(raw[key]));
}

function normalizeStrikeValue(value, multiplier = 1) {
  const number = numberOrNull(value);
  return number == null ? null : number * multiplier;
}

function dealerLikelyCause({ rowsNearSpot, pagesChecked, spxHasNearSpot, spyProxyHasNearSpot, spotPrice, rowsTotal, strikes }) {
  if (rowsNearSpot > 0 || spxHasNearSpot) return 'unknown';
  if (pagesChecked < 3 && rowsTotal > 0) return 'pagination_issue';
  if (spyProxyHasNearSpot) return 'ticker_mapping_issue';
  if (spotPrice != null && rowsTotal > 0 && strikes.length > 0) return 'missing_strike_filter';
  if (rowsTotal > 0 && strikes.length === 0) return 'endpoint_field_issue';
  if (rowsTotal === 0) return 'provider_data_gap';
  return 'unknown';
}

function buildDealerDiagnostics({ spotPrice, spotRows = [], pagedRows = [], spyRows = [], raw = {} } = {}) {
  const requestedMin = spotPrice == null ? null : Number((spotPrice * 0.85).toFixed(2));
  const requestedMax = spotPrice == null ? null : Number((spotPrice * 1.15).toFixed(2));
  const spxRows = pagedRows.length > 0 ? pagedRows : spotRows;
  const spxStrikes = spxRows.map((row) => normalizeStrikeValue(row.strike ?? row.price ?? row.level)).filter((value) => value != null);
  const spyStrikes = spyRows.map((row) => normalizeStrikeValue(row.strike ?? row.price ?? row.level, 10)).filter((value) => value != null);
  const near = (value) => spotPrice != null && value != null && Math.abs(value - spotPrice) / spotPrice <= 0.15;
  const rowsNearSpot = spxStrikes.filter(near).length;
  const spyRowsNearSpot = spyStrikes.filter(near).length;
  const pagesChecked = raw.spot_gex_paged?.meta?.pages_checked
    || new Set(spxRows.map((row) => numberOrNull(row.page)).filter((page) => page != null)).size
    || (pagedRows.length > 0 ? 1 : 0);
  const likelyCause = dealerLikelyCause({
    rowsNearSpot,
    pagesChecked,
    spxHasNearSpot: rowsNearSpot > 0,
    spyProxyHasNearSpot: spyRowsNearSpot > 0,
    spotPrice,
    rowsTotal: spxRows.length,
    strikes: spxStrikes
  });
  return {
    spot_price: spotPrice ?? null,
    requested_min_strike: requestedMin,
    requested_max_strike: requestedMax,
    rows_total: spxRows.length,
    rows_near_spot: rowsNearSpot,
    spy_rows_near_spot: spyRowsNearSpot,
    pages_checked: pagesChecked,
    spx_has_near_spot: rowsNearSpot > 0,
    spy_proxy_has_near_spot: spyRowsNearSpot > 0,
    likely_cause: likelyCause,
    next_fix: likelyCause === 'pagination_issue'
      ? '继续检查 page=2/page=3 并确认缓存是否覆盖。'
      : likelyCause === 'ticker_mapping_issue'
        ? 'SPX 区间无近现价行，SPY*10 有近现价行；检查 UW ticker 映射。'
        : likelyCause === 'missing_strike_filter'
          ? '请求已带 min_strike/max_strike；检查 provider 是否忽略 strike filter。'
          : likelyCause === 'endpoint_field_issue'
            ? '检查 spot exposure 返回字段是否从 strike 改成 price/level。'
            : likelyCause === 'provider_data_gap'
              ? 'provider 当前没有返回可用 strike rows。'
              : '继续比对 SPX/SPY 分页与字段。'
  };
}

function requestSummary(endpoint = {}, ticker, fallbackPage = 1) {
  const endpointRows = rows(endpoint);
  const strikes = endpointRows.map((row) => normalizeStrikeValue(row.strike ?? row.price ?? row.level)).filter((value) => value != null);
  const params = endpoint.query_params || {};
  return {
    endpoint: endpoint.path || null,
    ticker,
    query_params: params,
    page: numberOrNull(params.page) ?? fallbackPage,
    limit: numberOrNull(params.limit),
    min_strike: numberOrNull(params.min_strike),
    max_strike: numberOrNull(params.max_strike),
    date: endpoint.fetched_at || null,
    response_rows: endpointRows.length,
    returned_min_strike: strikes.length ? Math.min(...strikes) : null,
    returned_max_strike: strikes.length ? Math.max(...strikes) : null
  };
}

function buildDealerResolution({ diagnostics = {}, raw = {}, spotRows = [], pagedRows = [], spyRows = [] } = {}) {
  const dynamicPages = raw.spot_gex_paged?.pages || [];
  const dynamicWindowRequest = dynamicPages[0] ? requestSummary(dynamicPages[0], 'SPX', 1) : requestSummary(raw.spot_gex_paged, 'SPX', 1);
  const spyProxyRequest = requestSummary(raw.spot_gex_spy_proxy, 'SPY', 1);
  const spxResult = {
    rows_total: pagedRows.length || spotRows.length,
    rows_near_spot: diagnostics.rows_near_spot,
    returned_min_strike: dynamicWindowRequest.returned_min_strike,
    returned_max_strike: dynamicWindowRequest.returned_max_strike,
    has_near_spot: diagnostics.spx_has_near_spot
  };
  const spyProxyResult = {
    rows_total: spyRows.length,
    rows_near_spot: diagnostics.spy_rows_near_spot || 0,
    returned_min_strike_x10: spyRows.length ? Math.min(...spyRows.map((row) => normalizeStrikeValue(row.strike ?? row.price ?? row.level, 10)).filter((value) => value != null)) : null,
    returned_max_strike_x10: spyRows.length ? Math.max(...spyRows.map((row) => normalizeStrikeValue(row.strike ?? row.price ?? row.level, 10)).filter((value) => value != null)) : null,
    has_near_spot: diagnostics.spy_proxy_has_near_spot
  };
  const canComputeWall = diagnostics.rows_near_spot > 0 && diagnostics.rows_total > 0 && diagnostics.spx_has_near_spot === true;
  return {
    old_request: requestSummary(raw.spot_gex, 'SPX', 1),
    dynamic_window_request: dynamicWindowRequest,
    pages_checked: diagnostics.pages_checked,
    spx_result: spxResult,
    spy_proxy_result: spyProxyResult,
    likely_cause: diagnostics.likely_cause,
    fixed: diagnostics.spx_has_near_spot === true || diagnostics.spy_proxy_has_near_spot === true,
    can_compute_wall: canComputeWall,
    reason_cn: canComputeWall
      ? '动态窗口已拿到现价附近 strike，但墙位算法仍需 rows_used 和 freshness 通过后才计算。'
      : `现价附近 strike 仍不足，主因判定为 ${diagnostics.likely_cause}。`,
    next_action: diagnostics.next_fix
  };
}

function normalizeVolatility(raw = {}, provider = {}) {
  const endpoints = {
    interpolated_iv: raw.interpolated_iv,
    iv_rank: raw.iv_rank,
    realized_volatility: raw.realized_volatility,
    volatility: raw.volatility,
    term_structure: raw.term_structure
  };
  const endpointsOk = (provider.endpoints_ok || []).filter((name) => [
    'interpolated_iv',
    'iv_rank',
    'realized_volatility',
    'volatility',
    'term_structure'
  ].includes(name));
  const topLevelKeys = Object.fromEntries(Object.entries(endpoints).map(([name, value]) => [name, endpointShape(value)]));
  const termRows = rows(raw.term_structure);
  const hasAnyData = Object.values(endpoints).some((value) => rows(value).length > 0 || Object.keys(value || {}).length > 0);
  const ivRank = firstNumberFromRows(raw.iv_rank, ['iv_rank', 'rank']);
  const ivPercentile = firstNumberFromRows(raw.iv_rank, ['iv_percentile', 'percentile']);
  const ivRankNormalized = normalizeIvPercent(ivRank);
  const ivPercentileNormalized = normalizeIvPercent(ivPercentile);
  const vscore = ivRankNormalized != null && ivPercentileNormalized != null
    ? Number((ivRankNormalized * 0.3 + ivPercentileNormalized * 0.7).toFixed(2))
    : null;
  const interpolatedIv = firstNumberFromRows(raw.interpolated_iv, ['atm_iv', 'iv', 'implied_volatility']);
  const realizedVolatility = firstNumberFromRows(raw.realized_volatility, ['realized_volatility', 'rv', 'volatility']);
  const frontIv = firstNumberFromRows({ data: termRows.slice(0, 1) }, ['iv', 'implied_volatility', 'volatility']);
  const backIv = firstNumberFromRows({ data: termRows.slice(-1) }, ['iv', 'implied_volatility', 'volatility']);
  const termStructureState = frontIv != null && backIv != null
    ? frontIv > backIv ? 'front_loaded' : frontIv < backIv ? 'back_loaded' : 'flat'
    : 'unknown';
  const impliedMove = firstNumberFromRows({ data: termRows.slice(0, 1) }, ['implied_move']);
  const impliedMovePerc = firstNumberFromRows({ data: termRows.slice(0, 1) }, ['implied_move_perc']);
  const missingFields = [
    ivRank == null ? 'IV Rank' : null,
    ivPercentile == null ? 'IV Percentile' : null,
    interpolatedIv == null ? 'Interpolated IV' : null,
    termRows.length === 0 ? 'Term Structure' : null,
    realizedVolatility == null ? 'Realized Volatility' : null,
    impliedMove == null ? '0DTE Implied Move' : null
  ].filter(Boolean);
  return {
    status: hasAnyData ? 'partial' : 'unavailable',
    has_data: hasAnyData,
    endpoints_ok: endpointsOk,
    top_level_keys: topLevelKeys,
    iv_rank: ivRank,
    iv_percentile: ivPercentile,
    iv_rank_normalized: ivRankNormalized,
    iv_percentile_normalized: ivPercentileNormalized,
    vscore,
    interpolated_iv: interpolatedIv,
    term_structure: termRows,
    term_structure_state: termStructureState,
    front_iv: frontIv,
    back_iv: backIv,
    realized_volatility: realizedVolatility,
    implied_move: impliedMove,
    implied_move_perc: impliedMovePerc,
    volatility_state: {
      formula_ready: true,
      parser_ready: true,
      data_ready: ivRankNormalized != null && ivPercentileNormalized != null,
      vscore,
      iv_rank_normalized: ivRankNormalized,
      iv_percentile_normalized: ivPercentileNormalized,
      term_structure_state: termStructureState,
      state: classifyVscore(vscore),
      classification: classifyVscore(vscore),
      summary_cn: vscore == null
        ? '公式已就绪，等 IVR / IVP 数据进入即可计算。'
        : classifyVscore(vscore) === 'long_gamma_friendly'
          ? '期权相对便宜，可以等待单腿触发。'
          : classifyVscore(vscore) === 'normal'
            ? '期权价格正常，需要 Flow 和价格确认。'
            : classifyVscore(vscore) === 'expensive'
              ? '期权偏贵，裸买单腿要谨慎。'
              : '期权很贵，禁止追单腿，防杀估值。',
      reason_cn: vscore == null
        ? '公式已就绪，等 IVR / IVP 数据进入即可计算。'
        : 'Vscore = IVR * 0.3 + IVP * 0.7；IVR/IVP 小于等于 1 时按百分比放大。',
      missing_fields: [
        ivRankNormalized == null ? 'IV Rank' : null,
        ivPercentileNormalized == null ? 'IV Percentile' : null
      ].filter(Boolean)
    },
    parser_status: missingFields.length === 0 ? 'parsed' : hasAnyData ? 'partial' : 'failed',
    missing_fields: missingFields,
    current_block_cn: missingFields.length > 0
      ? '接口已通，但 IV Rank / Term Structure 字段路径尚未完全展开。'
      : ''
  };
}

function normalizeSentiment(raw = {}) {
  const row = firstRow(raw.market_tide);
  const hasData = Object.keys(row).length > 0;
  const netCallPremium = numberOrNull(row.net_call_premium);
  const netPutPremium = numberOrNull(row.net_put_premium);
  const netVolume = numberOrNull(row.net_volume);
  const score = netCallPremium != null && netPutPremium != null
    ? netCallPremium - netPutPremium
    : null;
  return {
    status: hasData ? 'partial' : 'unavailable',
    has_data: hasData,
    net_call_premium: netCallPremium,
    net_put_premium: netPutPremium,
    net_volume: netVolume,
    sentiment_score: score,
    scope_confirmed: false,
    parser_status: hasData ? 'partial' : 'failed',
    missing_fields: ['NOPE', 'ETF Tide', 'Sector Tide'],
    current_block_cn: hasData
      ? 'Market Tide 范围和辅助字段未完全确认，不能生成 risk-on / risk-off 强结论。'
      : 'Market Tide raw 暂无可用样本。',
    summary_cn: 'Market Tide 有真实数据，但范围和辅助字段未完全确认，只能做情绪背景。'
  };
}

function normalizeDarkpool(raw = {}, context = {}) {
  const printRows = [
    ...rows(raw.darkpool_spy),
    ...rows(raw.darkpool_spx),
    ...rows(raw.darkpool_recent),
    ...rows(raw.darkpool)
  ];
  const prints = printRows
    .map((row) => ({
      ticker: row.ticker || null,
      price: numberOrNull(row.price),
      premium: numberOrNull(row.premium),
      size: numberOrNull(row.size),
      executed_at: row.executed_at || null
    }))
    .filter((row) => row.price != null || row.premium != null);
  const footprintThreshold = 100000;
  const watchThreshold = 500000;
  const majorThreshold = 1000000;
  const clusterThreshold = 3000000;
  const footprintPrints = prints.filter((row) => (row.premium ?? 0) >= footprintThreshold);
  const watchPrints = prints.filter((row) => (row.premium ?? 0) >= watchThreshold);
  const majorPrints = prints.filter((row) => (row.premium ?? 0) >= majorThreshold);
  const largestPrint = [...prints].sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0))[0] || {};
  const bins = new Map();
  for (const row of footprintPrints) {
    if (row.price == null) continue;
    const key = String(Math.round(row.price * 2) / 2);
    const current = bins.get(key) || { price: Number(key), prints_count: 0, total_premium: 0, tier: 'footprint' };
    current.prints_count += 1;
    current.total_premium += row.premium ?? 0;
    current.tier = current.total_premium >= clusterThreshold ? 'cluster_wall' : current.total_premium >= majorThreshold ? 'major_wall' : current.total_premium >= watchThreshold ? 'watch_zone' : 'footprint';
    bins.set(key, current);
  }
  const currentSpx = numberOrNull(context.current_spx)
    ?? firstNumberFromRows(raw.spx_price, ['price', 'spot', 'spx'])
    ?? numberOrNull(raw.current_spx)
    ?? null;
  const mappedSpx = (largestPrint.ticker || 'SPY') === 'SPY' && largestPrint.price != null ? largestPrint.price * 10 : largestPrint.price ?? null;
  const distancePct = currentSpx != null && mappedSpx != null
    ? Math.abs(currentSpx - mappedSpx) / currentSpx * 100
    : null;
  const tier = (largestPrint.premium ?? 0) >= majorThreshold
    ? 'major_wall'
    : (largestPrint.premium ?? 0) >= watchThreshold
      ? 'watch_zone'
      : (largestPrint.premium ?? 0) >= footprintThreshold
        ? 'footprint'
        : 'none';
  const tierCn = tier === 'major_wall'
    ? '主要墙位'
    : tier === 'watch_zone'
      ? '观察区'
      : tier === 'footprint'
        ? '零星脚印'
        : '无有效脚印';
  return {
    status: prints.length > 0 ? 'partial' : 'unavailable',
    has_data: prints.length > 0,
    source_ticker: largestPrint.ticker || 'SPY',
    proxy_for_spx: (largestPrint.ticker || 'SPY') === 'SPY',
    prints_count: prints.length,
    footprint_prints_count: footprintPrints.length,
    watch_zone_prints_count: watchPrints.length,
    major_prints_count: majorPrints.length,
    footprint_threshold: footprintThreshold,
    watch_zone_threshold: watchThreshold,
    major_threshold: majorThreshold,
    cluster_threshold: clusterThreshold,
    tier,
    state: [...bins.values()].some((bin) => bin.tier === 'cluster_wall') ? 'cluster_wall' : tier,
    tier_cn: tierCn,
    largest_print: largestPrint,
    mapped_spx: mappedSpx,
    current_spx: currentSpx,
    distance_pct: distancePct,
    price_bins: [...bins.values()].sort((a, b) => b.total_premium - a.total_premium),
    nearest_support: null,
    nearest_resistance: null,
    parser_status: prints.length > 0 ? 'partial' : 'failed',
    missing_fields: ['nearest_support', 'nearest_resistance', 'SPX 支撑压力映射'],
    reason_cn: prints.length > 0
      ? `金额约 ${Math.round((largestPrint.premium ?? 0) / 1000) / 10} 万美元，低于强墙阈值时不能定义正式支撑 / 压力。`
      : '暗池 raw 暂无可用样本。',
    current_block_cn: prints.length > 0
      ? '有低置信空间参考，但不能作为墙位。'
      : '暗池 raw 暂无可用样本。',
    summary_cn: prints.length > 0
      ? tier === 'footprint'
        ? '有 SPY 暗池零星脚印，可作为低置信参考。'
        : tier === 'watch_zone'
          ? '暗池观察区，值得盯。'
          : tier === 'major_wall'
            ? '强支撑 / 压力候选，但仍需聚合确认。'
            : '有低置信空间参考，但不能作为墙位。'
      : '暗池 raw 暂无可用样本。'
  };
}

function normalizeDealer(raw = {}, context = {}) {
  const greekRow = firstRow(raw.greek_exposure);
  const spotRows = rows(raw.spot_gex);
  const strikes = spotRows.map((row) => numberOrNull(row.strike)).filter((value) => value != null);
  const spotPrice = numberOrNull(context.spot_price)
    ?? firstNumberFromRows(raw.spot_gex, ['price']);
  const rowsNearSpot = spotPrice == null
    ? 0
    : strikes.filter((strike) => Math.abs(strike - spotPrice) / spotPrice <= 0.15).length;
  const hasGreek = Object.keys(greekRow).length > 0;
  const missingFields = [
    hasGreek ? null : 'greek_exposure sample',
    rowsNearSpot === 0 ? '有效 strike 区间' : null,
    'Call Wall',
    'Put Wall',
    'Gamma Flip'
  ].filter(Boolean);
  const pagedRows = rows(raw.spot_gex_paged);
  const spyRows = rows(raw.spot_gex_spy_proxy);
  const dealerDiagnostics = buildDealerDiagnostics({
    spotPrice,
    spotRows,
    pagedRows,
    spyRows,
    raw
  });
  const dealerResolution = buildDealerResolution({
    diagnostics: dealerDiagnostics,
    raw,
    spotRows,
    pagedRows,
    spyRows
  });
  return {
    status: hasGreek || spotRows.length > 0 ? 'partial' : 'unavailable',
    has_data: hasGreek || spotRows.length > 0,
    greek_exposure_has_data: hasGreek,
    call_gamma: numberOrNull(greekRow.call_gamma),
    put_gamma: numberOrNull(greekRow.put_gamma),
    call_vanna: numberOrNull(greekRow.call_vanna),
    put_vanna: numberOrNull(greekRow.put_vanna),
    call_charm: numberOrNull(greekRow.call_charm),
    put_charm: numberOrNull(greekRow.put_charm),
    spot_gex_rows_total: spotRows.length,
    spot_price: spotPrice,
    min_strike: strikes.length ? Math.min(...strikes) : null,
    max_strike: strikes.length ? Math.max(...strikes) : null,
    rows_near_spot: rowsNearSpot,
    dealer_diagnostics: dealerDiagnostics,
    dealer_resolution: dealerResolution,
    rows_used: 0,
    wall_algorithm_allowed: false,
    parser_status: hasGreek || spotRows.length > 0 ? 'partial' : 'failed',
    missing_fields: missingFields,
    current_block_cn: 'Spot GEX 有数据，但 strike 区间和现价不匹配，暂不允许计算 Call Wall / Put Wall / Gamma Flip。'
  };
}

export function buildUwNormalized({ raw = {}, provider = {}, context = {} } = {}) {
  const dealer = normalizeDealer(raw, context);
  const flow = normalizeFlow(raw);
  const volatility = normalizeVolatility(raw, provider);
  const darkpool = normalizeDarkpool(raw, context);
  const sentiment = normalizeSentiment(raw);
  const missingByLayer = {
    dealer: dealer.missing_fields,
    flow: flow.missing_fields,
    volatility: volatility.missing_fields,
    darkpool: darkpool.missing_fields,
    sentiment: sentiment.missing_fields
  };
  return {
    dealer,
    flow,
    volatility,
    darkpool,
    sentiment,
    data_health: {
      status: provider.status || 'unavailable',
      has_data: Array.isArray(provider.endpoints_ok) && provider.endpoints_ok.length > 0,
      provider_live: provider.status === 'live',
      is_mock: provider.is_mock === true,
      last_update: provider.last_update || null,
      age_seconds: numberOrNull(provider.age_seconds),
      endpoints_ok_count: (provider.endpoints_ok || []).length,
      endpoints_failed_count: (provider.endpoints_failed || []).length,
      endpoints_ok: provider.endpoints_ok || [],
      endpoints_failed: provider.endpoints_failed || [],
      parser_status: provider.status === 'live' ? 'parsed' : provider.status ? 'partial' : 'failed',
      missing_fields: Object.values(missingByLayer).flat(),
      missing_fields_by_layer: missingByLayer,
      current_block_cn: provider.status === 'live'
        ? ''
        : 'UW provider 未处于 live 状态。'
    }
  };
}
