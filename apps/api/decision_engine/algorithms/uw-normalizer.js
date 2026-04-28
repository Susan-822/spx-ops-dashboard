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
  const interpolatedIv = firstNumberFromRows(raw.interpolated_iv, ['atm_iv', 'iv', 'implied_volatility']);
  const realizedVolatility = firstNumberFromRows(raw.realized_volatility, ['realized_volatility', 'rv', 'volatility']);
  const frontIv = firstNumberFromRows({ data: termRows.slice(0, 1) }, ['iv', 'implied_volatility', 'volatility']);
  const backIv = firstNumberFromRows({ data: termRows.slice(-1) }, ['iv', 'implied_volatility', 'volatility']);
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
    interpolated_iv: interpolatedIv,
    term_structure: termRows,
    front_iv: frontIv,
    back_iv: backIv,
    realized_volatility: realizedVolatility,
    implied_move: impliedMove,
    implied_move_perc: impliedMovePerc,
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

function normalizeDarkpool(raw = {}) {
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
  const majorThreshold = 1000000;
  const majorPrints = prints.filter((row) => (row.premium ?? 0) >= majorThreshold);
  const largestPrint = [...prints].sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0))[0] || {};
  const bins = new Map();
  for (const row of majorPrints) {
    if (row.price == null) continue;
    const key = String(Math.round(row.price * 2) / 2);
    const current = bins.get(key) || { price: Number(key), prints_count: 0, total_premium: 0 };
    current.prints_count += 1;
    current.total_premium += row.premium ?? 0;
    bins.set(key, current);
  }
  return {
    status: prints.length > 0 ? 'partial' : 'unavailable',
    has_data: prints.length > 0,
    source_ticker: largestPrint.ticker || 'SPY',
    proxy_for_spx: (largestPrint.ticker || 'SPY') === 'SPY',
    prints_count: prints.length,
    major_prints_count: majorPrints.length,
    major_threshold: majorThreshold,
    largest_print: largestPrint,
    price_bins: [...bins.values()].sort((a, b) => b.total_premium - a.total_premium),
    nearest_support: null,
    nearest_resistance: null,
    parser_status: prints.length > 0 ? 'partial' : 'failed',
    missing_fields: ['nearest_support', 'nearest_resistance', 'SPX 支撑压力映射'],
    current_block_cn: prints.length > 0
      ? '暗池 prints 已接通，但支撑/压力聚合尚未完成。'
      : '暗池 raw 暂无可用样本。',
    summary_cn: 'SPY 暗池数据已接通，但 $1M+ 聚合层还在生成，暂不能作为支撑压力。'
  };
}

function normalizeDealer(raw = {}) {
  const greekRow = firstRow(raw.greek_exposure);
  const spotRows = rows(raw.spot_gex);
  const strikes = spotRows.map((row) => numberOrNull(row.strike)).filter((value) => value != null);
  const spotPrice = firstNumberFromRows(raw.spot_gex, ['price']);
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
    rows_used: 0,
    wall_algorithm_allowed: false,
    parser_status: hasGreek || spotRows.length > 0 ? 'partial' : 'failed',
    missing_fields: missingFields,
    current_block_cn: 'Spot GEX 有数据，但 strike 区间和现价不匹配，暂不允许计算 Call Wall / Put Wall / Gamma Flip。'
  };
}

export function buildUwNormalized({ raw = {}, provider = {} } = {}) {
  const dealer = normalizeDealer(raw);
  const flow = normalizeFlow(raw);
  const volatility = normalizeVolatility(raw, provider);
  const darkpool = normalizeDarkpool(raw);
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
