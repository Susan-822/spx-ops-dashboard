const DEFAULT_THETADATA_BASE_URL = process.env.THETADATA_BASE_URL || 'http://127.0.0.1:25503';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SYMBOL = 'SPX';

const SNAPSHOT_ENDPOINTS = Object.freeze({
  quote: '/v3/option/snapshot/quote',
  greeks: '/v3/option/snapshot/greeks/all',
  open_interest: '/v3/option/snapshot/open_interest'
});

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function normalizeBaseUrl(baseUrl = DEFAULT_THETADATA_BASE_URL) {
  return String(baseUrl || DEFAULT_THETADATA_BASE_URL).replace(/\/+$/, '');
}

function normalizeRight(right) {
  const raw = String(right ?? '').trim().toLowerCase();
  if (raw === 'c' || raw === 'call') return 'C';
  if (raw === 'p' || raw === 'put') return 'P';
  return String(right ?? '').trim().toUpperCase() || null;
}

function normalizeRightParam(right) {
  const normalized = normalizeRight(right);
  if (normalized === 'C') return 'call';
  if (normalized === 'P') return 'put';
  return 'both';
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatStrike(strike) {
  if (strike === '*' || strike === undefined || strike === null || strike === '') {
    return '*';
  }
  const parsed = parseNumber(strike);
  return parsed == null ? String(strike) : parsed.toFixed(2);
}

function computeMid(bid, ask, mark, last) {
  const parsedBid = parseNumber(bid);
  const parsedAsk = parseNumber(ask);
  if (parsedBid != null && parsedAsk != null) {
    return Number(((parsedBid + parsedAsk) / 2).toFixed(4));
  }

  const parsedMark = parseNumber(mark);
  if (parsedMark != null) {
    return parsedMark;
  }

  const parsedLast = parseNumber(last);
  return parsedLast != null ? parsedLast : null;
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.response)) {
    return payload.response;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  return [];
}

function summarizePayload(payload) {
  if (typeof payload === 'string') {
    return payload.slice(0, 400);
  }
  try {
    return JSON.stringify(payload).slice(0, 400);
  } catch {
    return String(payload).slice(0, 400);
  }
}

function looksLikePermissionError(summary) {
  const text = String(summary || '').toLowerCase();
  return (
    text.includes('permission') ||
    text.includes('subscription') ||
    text.includes('not entitled') ||
    text.includes('requires standard') ||
    text.includes('unauthorized')
  );
}

export class ThetaLocalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ThetaLocalError';
    this.status = details.status ?? null;
    this.kind = details.kind ?? 'request_failed';
    this.path = details.path ?? null;
    this.url = details.url ?? null;
    this.body = details.body ?? null;
  }
}

export function buildThetaUrl(pathname, params = {}, baseUrl = DEFAULT_THETADATA_BASE_URL) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.has('format')) {
    url.searchParams.set('format', 'json');
  }
  return url;
}

async function parseThetaResponse(response, pathname, url) {
  const raw = await response.text();
  let payload = raw;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }

  if (!response.ok) {
    const summary = summarizePayload(payload);
    throw new ThetaLocalError(
      `ThetaData request failed for ${pathname} with status ${response.status}: ${summary}`,
      {
        status: response.status,
        kind: looksLikePermissionError(summary) ? 'permission' : 'request_failed',
        path: pathname,
        url: String(url),
        body: payload
      }
    );
  }

  const summary = summarizePayload(payload);
  if (looksLikePermissionError(summary)) {
    throw new ThetaLocalError(`ThetaData permission issue for ${pathname}: ${summary}`, {
      status: response.status,
      kind: 'permission',
      path: pathname,
      url: String(url),
      body: payload
    });
  }

  return payload;
}

export async function thetaFetch({
  path,
  params = {},
  baseUrl = DEFAULT_THETADATA_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const url = buildThetaUrl(path, params, baseUrl);
  const abort = createAbortSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: abort.signal
    });
    return await parseThetaResponse(response, path, url);
  } catch (error) {
    if (error instanceof ThetaLocalError) {
      throw error;
    }
    if (error?.name === 'AbortError') {
      throw new ThetaLocalError(`ThetaData request timed out for ${path}.`, {
        kind: 'timeout',
        path,
        url: String(url)
      });
    }
    throw new ThetaLocalError(`ThetaData request failed for ${path}: ${error.message}`, {
      kind: 'network',
      path,
      url: String(url)
    });
  } finally {
    abort.clear();
  }
}

export async function thetaCheckTerminal(baseUrl = DEFAULT_THETADATA_BASE_URL) {
  const url = new URL(normalizeBaseUrl(baseUrl));
  const abort = createAbortSignal(3000);
  try {
    const response = await fetch(url, { method: 'GET', signal: abort.signal });
    return {
      reachable: true,
      status: response.status
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error: error.message
    };
  } finally {
    abort.clear();
  }
}

export async function thetaFetchIndexPrice(symbol, options = {}) {
  const payload = await thetaFetch({
    path: '/v3/index/snapshot/price',
    params: {
      symbol,
      format: 'json'
    },
    ...options
  });
  const rows = extractRows(payload);
  return rows[0] ?? null;
}

export async function thetaFetchExpirations({
  symbol = DEFAULT_SYMBOL,
  baseUrl = DEFAULT_THETADATA_BASE_URL
} = {}) {
  const payload = await thetaFetch({
    path: '/v3/option/list/expirations',
    params: {
      symbol,
      format: 'json'
    },
    baseUrl
  });
  return extractRows(payload)
    .map((row) => row?.expiration || row?.date || null)
    .filter(Boolean)
    .sort();
}

function normalizeContractKey(expiration, strike, right) {
  return `${expiration}|${formatStrike(strike)}|${normalizeRight(right)}`;
}

function normalizeQuoteRow(row) {
  const bid = parseNumber(row?.bid);
  const ask = parseNumber(row?.ask);
  const mark = parseNumber(row?.mark ?? row?.mid);
  const last = parseNumber(row?.last ?? row?.price);

  return {
    symbol: row?.symbol ?? DEFAULT_SYMBOL,
    expiration: row?.expiration ?? null,
    strike: parseNumber(row?.strike),
    right: normalizeRight(row?.right),
    timestamp: row?.timestamp ?? null,
    bid,
    ask,
    mark,
    last,
    mid: computeMid(bid, ask, mark, last),
    volume: parseNumber(row?.volume),
    quote_source: 'quote'
  };
}

function normalizeGreeksRow(row) {
  const bid = parseNumber(row?.bid);
  const ask = parseNumber(row?.ask);
  const mark = parseNumber(row?.mark ?? row?.mid);
  const last = parseNumber(row?.last ?? row?.price);

  return {
    symbol: row?.symbol ?? DEFAULT_SYMBOL,
    expiration: row?.expiration ?? null,
    strike: parseNumber(row?.strike),
    right: normalizeRight(row?.right),
    timestamp: row?.timestamp ?? null,
    bid,
    ask,
    mark,
    last,
    mid: computeMid(bid, ask, mark, last),
    delta: parseNumber(row?.delta),
    gamma: parseNumber(row?.gamma),
    theta: parseNumber(row?.theta),
    vega: parseNumber(row?.vega),
    rho: parseNumber(row?.rho),
    iv: parseNumber(row?.implied_vol ?? row?.iv),
    underlying_price: parseNumber(row?.underlying_price),
    vanna: parseNumber(row?.vanna),
    charm: parseNumber(row?.charm),
    greeks_source: 'greeks'
  };
}

function normalizeOpenInterestRow(row) {
  return {
    symbol: row?.symbol ?? DEFAULT_SYMBOL,
    expiration: row?.expiration ?? null,
    strike: parseNumber(row?.strike),
    right: normalizeRight(row?.right),
    timestamp: row?.timestamp ?? null,
    open_interest: parseNumber(row?.open_interest),
    oi_source: 'open_interest'
  };
}

function mergeContractRows(...collections) {
  const map = new Map();

  for (const collection of collections) {
    for (const row of collection) {
      const key = normalizeContractKey(row.expiration, row.strike, row.right);
      const previous = map.get(key) ?? {
        symbol: row.symbol ?? DEFAULT_SYMBOL,
        expiration: row.expiration ?? null,
        strike: row.strike ?? null,
        right: row.right ?? null
      };
      const next = {
        ...previous,
        ...row
      };
      next.mid = computeMid(next.bid, next.ask, next.mark, next.last);
      map.set(key, next);
    }
  }

  return Array.from(map.values()).sort((left, right) => {
    if ((left.strike ?? 0) !== (right.strike ?? 0)) {
      return (left.strike ?? 0) - (right.strike ?? 0);
    }
    return String(left.right || '').localeCompare(String(right.right || ''));
  });
}

async function fetchSnapshotRows(kind, {
  symbol = DEFAULT_SYMBOL,
  expiration,
  strike = '*',
  right = 'both',
  baseUrl = DEFAULT_THETADATA_BASE_URL
}) {
  const payload = await thetaFetch({
    path: SNAPSHOT_ENDPOINTS[kind],
    params: {
      symbol,
      expiration,
      strike: formatStrike(strike),
      right: normalizeRightParam(right),
      format: 'json'
    },
    baseUrl
  });
  const rows = extractRows(payload);
  if (kind === 'quote') {
    return rows.map(normalizeQuoteRow);
  }
  if (kind === 'greeks') {
    return rows.map(normalizeGreeksRow);
  }
  return rows.map(normalizeOpenInterestRow);
}

function statusFromSettled(result, rowCount) {
  if (result.status === 'fulfilled' && rowCount > 0) {
    return 'pass';
  }
  if (result.status === 'fulfilled') {
    return 'partial';
  }
  if (result.reason?.kind === 'permission') {
    return 'partial';
  }
  return 'fail';
}

export async function thetaFetchOptionChainByExp(expiration, {
  symbol = DEFAULT_SYMBOL,
  baseUrl = DEFAULT_THETADATA_BASE_URL
} = {}) {
  const [quoteResult, greeksResult, openInterestResult] = await Promise.allSettled([
    fetchSnapshotRows('quote', { symbol, expiration, baseUrl }),
    fetchSnapshotRows('greeks', { symbol, expiration, baseUrl }),
    fetchSnapshotRows('open_interest', { symbol, expiration, baseUrl })
  ]);

  const quoteRows = quoteResult.status === 'fulfilled' ? quoteResult.value : [];
  const greeksRows = greeksResult.status === 'fulfilled' ? greeksResult.value : [];
  const openInterestRows = openInterestResult.status === 'fulfilled' ? openInterestResult.value : [];
  const contracts = mergeContractRows(quoteRows, greeksRows, openInterestRows);
  const warnings = [
    quoteResult.status === 'rejected' ? quoteResult.reason.message : null,
    greeksResult.status === 'rejected' ? greeksResult.reason.message : null,
    openInterestResult.status === 'rejected' ? openInterestResult.reason.message : null
  ].filter(Boolean);

  return {
    expiration,
    contracts,
    warnings,
    endpoint_status: {
      bid_ask: statusFromSettled(quoteResult, quoteRows.length),
      greeks: statusFromSettled(greeksResult, greeksRows.length),
      open_interest: statusFromSettled(openInterestResult, openInterestRows.length),
      option_chain: contracts.length > 0 ? 'pass' : warnings.length > 0 ? 'partial' : 'fail',
      option_detail: contracts.length > 0 ? 'pass' : 'fail',
      iv: contracts.some((item) => item.iv != null) ? 'pass' : greeksResult.status === 'fulfilled' ? 'partial' : 'fail'
    }
  };
}

export async function thetaFetchOptionDetail(expiration, strike, right, {
  symbol = DEFAULT_SYMBOL,
  baseUrl = DEFAULT_THETADATA_BASE_URL
} = {}) {
  const chain = await thetaFetchOptionChainByExp(expiration, {
    symbol,
    baseUrl
  });
  const detail = chain.contracts.find((item) =>
    item.expiration === expiration &&
    item.strike === parseNumber(strike) &&
    item.right === normalizeRight(right)
  );
  return detail ?? null;
}

export async function thetaFetchGreeks(expiration, strike, right, {
  symbol = DEFAULT_SYMBOL,
  baseUrl = DEFAULT_THETADATA_BASE_URL
} = {}) {
  const detail = await thetaFetchOptionDetail(expiration, strike, right, {
    symbol,
    baseUrl
  });
  if (!detail) {
    return null;
  }
  return {
    delta: detail.delta,
    gamma: detail.gamma,
    iv: detail.iv,
    vanna: detail.vanna,
    charm: detail.charm,
    underlying_price: detail.underlying_price,
    timestamp: detail.timestamp
  };
}

export async function thetaFetchATMStraddle(expiration, externalSpot, {
  symbol = DEFAULT_SYMBOL,
  baseUrl = DEFAULT_THETADATA_BASE_URL
} = {}) {
  const chain = await thetaFetchOptionChainByExp(expiration, { symbol, baseUrl });
  const spot = parseNumber(externalSpot);
  if (spot == null) {
    return {
      spot: null,
      atm_strike: null,
      call: null,
      put: null,
      straddle_mid: null
    };
  }

  const calls = chain.contracts.filter((item) => item.right === 'C');
  const puts = chain.contracts.filter((item) => item.right === 'P');
  const strikes = Array.from(
    new Set(chain.contracts.map((item) => item.strike).filter((value) => value != null))
  );
  const atmStrike = strikes.sort((left, right) => Math.abs(left - spot) - Math.abs(right - spot))[0] ?? null;
  const call = calls.find((item) => item.strike === atmStrike) ?? null;
  const put = puts.find((item) => item.strike === atmStrike) ?? null;

  return {
    spot,
    atm_strike: atmStrike,
    call,
    put,
    straddle_mid:
      call?.mid != null && put?.mid != null
        ? Number((call.mid + put.mid).toFixed(4))
        : null
  };
}

export async function thetaFetchOptionChainSample(expiration, limit = 5, {
  symbol = DEFAULT_SYMBOL,
  baseUrl = DEFAULT_THETADATA_BASE_URL
} = {}) {
  const chain = await thetaFetchOptionChainByExp(expiration, { symbol, baseUrl });
  return chain.contracts.slice(0, Math.max(1, limit));
}

export const THETADATA_BASE_URL = DEFAULT_THETADATA_BASE_URL;
