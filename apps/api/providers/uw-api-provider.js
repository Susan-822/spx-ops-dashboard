import { normalizeUwApiSnapshot } from '../normalizer/uw-api-normalizer.js';
import {
  getUwApiSnapshotStoreConfig,
  readUwApiSnapshot,
  writeUwApiSnapshot
} from '../storage/uwSnapshotStore.js';

export const UW_API_ENDPOINTS = Object.freeze({
  greek_exposure: { category: 'dealer_gex', requestedPath: '/api/stock/{ticker}/greek-exposure', path: '/api/stock/{ticker}/greek-exposure', ttlSeconds: 60, core: true },
  greek_exposure_strike: { category: 'dealer_gex', requestedPath: '/api/stock/{ticker}/greek-exposure/strike', path: '/api/stock/{ticker}/greek-exposure/strike', ttlSeconds: 60, core: true },
  greek_exposure_expiry: { category: 'dealer_gex', requestedPath: '/api/stock/{ticker}/greek-exposure/expiry', path: '/api/stock/{ticker}/greek-exposure/expiry', ttlSeconds: 60, core: false },
  spot_gex: { category: 'dealer_gex', requestedPath: '/api/stock/{ticker}/spot-exposures/strike', path: '/api/stock/{ticker}/spot-exposures/strike', ttlSeconds: 60, core: true },
  spot_gex_strike_expiry: { category: 'dealer_gex', requestedPath: '/api/stock/{ticker}/spot-exposures/strike-expiry', path: '/api/stock/{ticker}/spot-exposures/expiry-strike', ttlSeconds: 60, core: false },

  flow_recent: { category: 'flow', requestedPath: '/api/stock/{ticker}/flow-recent', path: '/api/stock/{ticker}/flow-recent', ttlSeconds: 45, core: false },
  options_flow: { category: 'flow', requestedPath: '/api/option-trades/flow-alerts', path: '/api/option-trades/flow-alerts', ttlSeconds: 45, core: true },
  net_prem_ticks: { category: 'flow', requestedPath: '/api/stock/{ticker}/net-prem-ticks', path: '/api/stock/{ticker}/net-prem-ticks', ttlSeconds: 45, core: false },
  flow_per_expiry: { category: 'flow', requestedPath: '/api/stock/{ticker}/flow-per-expiry', path: '/api/stock/{ticker}/flow-per-expiry', ttlSeconds: 60, core: false },
  flow_per_strike: { category: 'flow', requestedPath: '/api/stock/{ticker}/flow-per-strike', path: '/api/stock/{ticker}/flow-per-strike', ttlSeconds: 60, core: false },
  flow_per_strike_intraday: { category: 'flow', requestedPath: '/api/stock/{ticker}/flow-per-strike-intraday', path: '/api/stock/{ticker}/flow-per-strike-intraday', ttlSeconds: 60, core: false },

  darkpool_recent: { category: 'darkpool', requestedPath: '/api/darkpool/recent', path: '/api/darkpool/recent', ttlSeconds: 120, core: false },
  darkpool_spy: { category: 'darkpool', requestedPath: '/api/darkpool/{ticker}', path: '/api/darkpool/{ticker}', ttlSeconds: 120, core: false, ticker: 'SPY' },
  darkpool_spx: { category: 'darkpool', requestedPath: '/api/darkpool/{ticker}', path: '/api/darkpool/{ticker}', ttlSeconds: 120, core: false, ticker: 'SPX' },
  darkpool_qqq: { category: 'darkpool', requestedPath: '/api/darkpool/{ticker}', path: '/api/darkpool/{ticker}', ttlSeconds: 120, core: false, ticker: 'QQQ' },
  darkpool_iwm: { category: 'darkpool', requestedPath: '/api/darkpool/{ticker}', path: '/api/darkpool/{ticker}', ttlSeconds: 120, core: false, ticker: 'IWM' },
  stock_price_levels: { category: 'darkpool', requestedPath: '/api/stock/{ticker}/stock-volume-price-levels', path: '/api/stock/{ticker}/stock-volume-price-levels', ttlSeconds: 120, core: false, ticker: 'SPY' },

  market_tide: { category: 'sentiment', requestedPath: '/api/market/market-tide', path: '/api/market/market-tide', ttlSeconds: 60, core: false },
  top_net_impact: { category: 'sentiment', requestedPath: '/api/market/top-net-impact', path: '/api/market/top-net-impact', ttlSeconds: 60, core: false },
  net_flow_expiry: { category: 'sentiment', requestedPath: '/api/market/net-flow-expiry', path: '/api/net-flow/expiry', ttlSeconds: 60, core: false },
  total_options_volume: { category: 'sentiment', requestedPath: '/api/market/total-options-volume', path: '/api/market/total-options-volume', ttlSeconds: 60, core: false },
  sector_tide: { category: 'sentiment', requestedPath: '/api/market/sector-tide', path: '/api/market/{sector}/sector-tide', ttlSeconds: 60, core: false, sector: 'Technology' },
  etf_tide: { category: 'sentiment', requestedPath: '/api/market/etf-tide', path: '/api/market/{ticker}/etf-tide', ttlSeconds: 60, core: false, ticker: 'SPY' },

  interpolated_iv: { category: 'volatility', requestedPath: '/api/stock/{ticker}/interpolated-iv', path: '/api/stock/{ticker}/interpolated-iv', ttlSeconds: 120, core: false },
  iv_rank: { category: 'volatility', requestedPath: '/api/stock/{ticker}/iv-rank', path: '/api/stock/{ticker}/iv-rank', ttlSeconds: 120, core: false },
  realized_volatility: { category: 'volatility', requestedPath: '/api/stock/{ticker}/realized-volatility', path: '/api/stock/{ticker}/volatility/realized', ttlSeconds: 120, core: false },
  volatility: { category: 'volatility', requestedPath: '/api/stock/{ticker}/volatility-statistics', path: '/api/stock/{ticker}/volatility/stats', ttlSeconds: 120, core: false },
  term_structure: { category: 'volatility', requestedPath: '/api/stock/{ticker}/iv-term-structure', path: '/api/stock/{ticker}/volatility/term-structure', ttlSeconds: 120, core: false },

  technical_vwap: { category: 'technical', requestedPath: '/api/stock/{ticker}/technical-indicator/{function}', path: '/api/stock/{ticker}/technical-indicator/{function}', ttlSeconds: 120, core: false, function: 'VWAP' },
  technical_atr: { category: 'technical', requestedPath: '/api/stock/{ticker}/technical-indicator/{function}', path: '/api/stock/{ticker}/technical-indicator/{function}', ttlSeconds: 120, core: false, function: 'ATR' },
  technical_ema: { category: 'technical', requestedPath: '/api/stock/{ticker}/technical-indicator/{function}', path: '/api/stock/{ticker}/technical-indicator/{function}', ttlSeconds: 120, core: false, function: 'EMA' },
  technical_bbands: { category: 'technical', requestedPath: '/api/stock/{ticker}/technical-indicator/{function}', path: '/api/stock/{ticker}/technical-indicator/{function}', ttlSeconds: 120, core: false, function: 'BBANDS' },
  technical_rsi: { category: 'technical', requestedPath: '/api/stock/{ticker}/technical-indicator/{function}', path: '/api/stock/{ticker}/technical-indicator/{function}', ttlSeconds: 120, core: false, function: 'RSI' },
  technical_macd: { category: 'technical', requestedPath: '/api/stock/{ticker}/technical-indicator/{function}', path: '/api/stock/{ticker}/technical-indicator/{function}', ttlSeconds: 120, core: false, function: 'MACD' },
  ohlc: { category: 'technical', requestedPath: '/api/stock/{ticker}/ohlc', path: '/api/stock/{ticker}/ohlc/{candle_size}', ttlSeconds: 60, core: false, candle_size: '1m' },
  options_volume: { category: 'technical', requestedPath: '/api/stock/{ticker}/options-volume', path: '/api/stock/{ticker}/options-volume', ttlSeconds: 180, core: false },
  oi_by_strike: { category: 'technical', requestedPath: '/api/stock/{ticker}/oi-per-strike', path: '/api/stock/{ticker}/oi-per-strike', ttlSeconds: 180, core: false },
  oi_by_expiry: { category: 'technical', requestedPath: '/api/stock/{ticker}/oi-per-expiry', path: '/api/stock/{ticker}/oi-per-expiry', ttlSeconds: 180, core: false },
  max_pain: { category: 'technical', requestedPath: '/api/stock/{ticker}/max-pain', path: '/api/stock/{ticker}/max-pain', ttlSeconds: 180, core: false },
  option_price_levels: { category: 'technical', requestedPath: '/api/stock/{ticker}/option-price-levels', path: '/api/stock/{ticker}/option/stock-price-levels', ttlSeconds: 180, core: false },
  volume_oi: { category: 'technical', requestedPath: '/api/stock/{ticker}/volume-oi-expiry', path: '/api/stock/{ticker}/option/volume-oi-expiry', ttlSeconds: 180, core: false }
});

const UW_ENDPOINT_GROUPS = Object.freeze({
  dealer_gex: [
    '/api/stock/{ticker}/spot-exposures/strike',
    '/api/stock/{ticker}/greek-exposure',
    '/api/stock/{ticker}/greek-exposure/strike',
    '/api/stock/{ticker}/greek-exposure/expiry',
    '/api/stock/{ticker}/spot-exposures/strike-expiry'
  ],
  flow: [
    '/api/stock/{ticker}/flow-recent',
    '/api/option-trades/flow-alerts',
    '/api/stock/{ticker}/net-prem-ticks',
    '/api/stock/{ticker}/flow-per-expiry',
    '/api/stock/{ticker}/flow-per-strike',
    '/api/stock/{ticker}/flow-per-strike-intraday'
  ],
  darkpool: [
    '/api/darkpool/recent',
    '/api/darkpool/{ticker}',
    '/api/stock/{ticker}/stock-volume-price-levels'
  ],
  sentiment: [
    '/api/market/market-tide',
    '/api/market/top-net-impact',
    '/api/market/net-flow-expiry',
    '/api/market/total-options-volume',
    '/api/market/sector-tide',
    '/api/market/etf-tide'
  ],
  volatility: [
    '/api/stock/{ticker}/interpolated-iv',
    '/api/stock/{ticker}/iv-rank',
    '/api/stock/{ticker}/realized-volatility',
    '/api/stock/{ticker}/volatility-statistics',
    '/api/stock/{ticker}/iv-term-structure'
  ],
  technical: [
    '/api/stock/{ticker}/technical-indicator/{function}',
    '/api/stock/{ticker}/ohlc',
    '/api/stock/{ticker}/options-volume',
    '/api/stock/{ticker}/oi-per-strike',
    '/api/stock/{ticker}/oi-per-expiry',
    '/api/stock/{ticker}/max-pain',
    '/api/stock/{ticker}/option-price-levels',
    '/api/stock/{ticker}/volume-oi-expiry'
  ]
});

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUwApiConfig() {
  return {
    mode: String(process.env.UW_PROVIDER_MODE || 'unavailable').toLowerCase(),
    apiKey: process.env.UW_API_KEY || '',
    baseUrl: (process.env.UW_API_BASE_URL || 'https://api.unusualwhales.com').replace(/\/+$/, ''),
    staleSeconds: positiveInt(process.env.UW_STALE_SECONDS, 300),
    pollIntervalSeconds: positiveInt(process.env.UW_POLL_INTERVAL_SECONDS, 60),
    ticker: process.env.UW_TICKER || 'SPX'
  };
}

function ageSeconds(lastUpdate, now = new Date()) {
  if (!lastUpdate) return null;
  const parsed = new Date(lastUpdate);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((new Date(now).getTime() - parsed.getTime()) / 1000));
}

function endpointPath(definition, config) {
  const ticker = definition.ticker || config.ticker;
  return definition.path
    .replace('{ticker}', encodeURIComponent(ticker))
    .replace('{function}', encodeURIComponent(definition.function || ''));
}

function endpointUrl(definition, config) {
  const url = new URL(`${config.baseUrl}${endpointPath(definition, config)}`);
  if (definition.path === '/api/option-trades/flow-alerts') {
    url.searchParams.set('ticker_symbol', config.ticker);
    url.searchParams.set('limit', '100');
  } else if (definition.path === '/api/darkpool/recent') {
    url.searchParams.set('limit', '100');
  } else if (definition.path.includes('/darkpool/')) {
    url.searchParams.set('limit', '100');
  } else if (definition.path.includes('/options-volume')) {
    url.searchParams.set('limit', '100');
  } else if (definition.path.includes('/flow-recent')) {
    url.searchParams.set('limit', '100');
  } else if (definition.path.includes('/technical-indicator/')) {
    url.searchParams.set('interval', definition.interval || '5min');
    url.searchParams.set('time_period', definition.timePeriod || '14');
    url.searchParams.set('series_type', definition.seriesType || 'close');
  } else if (definition.path.includes('/ohlc')) {
    url.searchParams.set('limit', '100');
  }
  return url;
}

function parseRateLimit(headers) {
  const get = (name) => headers?.get?.(name) ?? null;
  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    daily_limit: toNumber(get('x-ratelimit-limit-day') ?? get('x-rate-limit-limit-day')),
    per_minute_limit: toNumber(get('x-ratelimit-limit-minute') ?? get('x-rate-limit-limit-minute')),
    remaining: toNumber(get('x-ratelimit-remaining') ?? get('x-rate-limit-remaining'))
  };
}

function endpointResultStatus(item) {
  if (item.status === 'unauthorized' || item.status === 401 || item.status === 403) return 'unauthorized';
  if (item.status === 'not_found' || item.status === 404) return 'not_found';
  if (item.status === 'unsupported') return 'unsupported';
  return 'failed';
}

function buildEndpointCoverage(okNames = [], failedItems = []) {
  const okSet = new Set((okNames || []).map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean));
  const failedByName = new Map(failedItems.map((item) => [item.name, item]));
  return Object.entries(UW_ENDPOINT_GROUPS).reduce((acc, [group, required]) => {
    const ok = [];
    const failed = [];
    const missing = [];
    for (const name of required) {
      const definition = UW_API_ENDPOINTS[name];
      const endpoint = definition?.requestedPath || definition?.path || name;
      if (okSet.has(name)) {
        ok.push(endpoint);
      } else if (failedByName.has(name)) {
        const failedItem = failedByName.get(name);
        failed.push({
          endpoint,
          status: endpointResultStatus(failedItem),
          reason: failedItem.message || String(failedItem.status || 'failed')
        });
      } else {
        missing.push(endpoint);
      }
    }
    acc[group] = {
      required: required.map((name) => UW_API_ENDPOINTS[name]?.requestedPath || UW_API_ENDPOINTS[name]?.path || name),
      ok,
      failed,
      missing
    };
    return acc;
  }, {});
}

function providerFromSnapshot(snapshot, config, now = new Date()) {
  const provider = snapshot?.provider || {};
  const lastUpdate = provider.last_update || snapshot?.last_update || null;
  const age = ageSeconds(lastUpdate, now);
  const stale = age != null && age > config.staleSeconds;
  const status = stale && ['live', 'partial'].includes(provider.status)
    ? 'stale'
    : provider.status || 'unavailable';
  return {
    mode: provider.mode || (config.mode === 'api' ? 'api' : 'unavailable'),
    status,
    last_update: lastUpdate,
    age_seconds: age,
    is_mock: false,
    endpoints_ok: provider.endpoints_ok || [],
    endpoints_failed: provider.endpoints_failed || [],
    endpoint_coverage: provider.endpoint_coverage || provider.coverage || buildEndpointCoverage(provider.endpoints_ok || [], provider.endpoints_failed || []),
    rate_limit: provider.rate_limit || {
      daily_limit: null,
      per_minute_limit: null,
      remaining: null
    },
    plain_chinese: provider.plain_chinese || 'UW API 快照来自缓存。'
  };
}

function buildUnavailableProvider(reason = '未配置 UW API Key。') {
  return {
    mode: 'unavailable',
    status: 'unavailable',
    last_update: null,
    age_seconds: null,
    is_mock: false,
    endpoints_ok: [],
    endpoints_failed: [],
    endpoint_coverage: buildEndpointCoverage([], []),
    rate_limit: { daily_limit: null, per_minute_limit: null, remaining: null },
    plain_chinese: reason
  };
}

function mergeRateLimit(current, next) {
  return {
    daily_limit: next.daily_limit ?? current.daily_limit,
    per_minute_limit: next.per_minute_limit ?? current.per_minute_limit,
    remaining: next.remaining ?? current.remaining
  };
}

function failureStatus(status) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'unsupported';
  return 'failed';
}

function endpointCoverage(okNames = [], failedItems = []) {
  const failedByName = new Map(failedItems.map((item) => [item.name, item]));
  return Object.entries(UW_ENDPOINT_GROUPS).reduce((acc, [groupName, required]) => {
    const ok = required
      .filter((name) => okNames.includes(name))
      .map((name) => ({ endpoint: UW_API_ENDPOINTS[name].path, name, status: 'ok', reason: '' }));
    const failed = required
      .filter((name) => failedByName.has(name))
      .map((name) => {
        const item = failedByName.get(name);
        return {
          endpoint: UW_API_ENDPOINTS[name].path,
          name,
          status: failureStatus(item.status),
          reason: item.message || String(item.status || 'failed')
        };
      });
    const missing = required
      .filter((name) => !okNames.includes(name) && !failedByName.has(name))
      .map((name) => ({ endpoint: UW_API_ENDPOINTS[name].path, name, status: 'unsupported', reason: 'not attempted' }));
    acc[groupName] = {
      required: required.map((name) => UW_API_ENDPOINTS[name].path),
      ok,
      failed,
      missing
    };
    return acc;
  }, {});
}

function providerStatus(okNames, failedNames, coreNames) {
  if (okNames.length === 0 && failedNames.length > 0) return 'error';
  if (coreNames.every((name) => okNames.includes(name))) return 'live';
  if (okNames.length > 0) return 'partial';
  return 'unavailable';
}

function endpointFailureStatus(status) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'unsupported';
  return 'failed';
}

function endpointRecord(name, definition, status, reason = '') {
  return {
    name,
    endpoint: endpointPath(definition, { ticker: definition.ticker || 'SPX' }),
    status,
    reason
  };
}

export function buildUwEndpointCoverage(provider = {}) {
  const okNames = new Set(provider.endpoints_ok || []);
  const failedByName = new Map((provider.endpoints_failed || []).map((item) => [item.name, item]));
  const grouped = {};
  for (const group of ['dealer_gex', 'flow', 'darkpool', 'sentiment', 'volatility', 'technical']) {
    const entries = Object.entries(UW_API_ENDPOINTS).filter(([, definition]) => definition.group === group);
    grouped[group] = {
      required: entries.map(([name, definition]) => endpointRecord(name, definition, 'required')),
      ok: entries.filter(([name]) => okNames.has(name)).map(([name, definition]) => endpointRecord(name, definition, 'ok')),
      failed: entries.filter(([name]) => failedByName.has(name)).map(([name, definition]) => {
        const failed = failedByName.get(name);
        return endpointRecord(name, definition, endpointFailureStatus(Number(failed.status)), failed.message || String(failed.status || 'failed'));
      }),
      missing: entries.filter(([name]) => !okNames.has(name) && !failedByName.has(name)).map(([name, definition]) => endpointRecord(name, definition, 'unsupported', 'not attempted or cached missing'))
    };
  }
  return grouped;
}

export async function fetchUwApiSnapshot(options = {}) {
  const config = { ...getUwApiConfig(), ...(options.config || {}) };
  const now = options.now ? new Date(options.now) : new Date();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const previous = await readUwApiSnapshot({ now, staleSeconds: config.staleSeconds });

  if (config.mode !== 'api') {
    return {
      ...(previous || {}),
      provider: buildUnavailableProvider('UW provider 未启用。'),
      last_update: previous?.last_update || null,
      status: previous?.status || 'unavailable',
      raw: previous?.raw || {},
      endpoint_coverage: buildEndpointCoverage([], []),
      normalized: previous?.normalized || null
    };
  }

  if (!config.apiKey) {
    return {
      ...(previous || {}),
      provider: buildUnavailableProvider('UW API key 未配置，UW 不得主导交易。'),
      last_update: previous?.last_update || null,
      status: previous?.status || 'unavailable',
      raw: previous?.raw || {},
      endpoint_coverage: buildEndpointCoverage([], []),
      normalized: previous?.normalized || null
    };
  }

  const raw = { ...(previous?.raw || {}) };
  const endpointsOk = [];
  const endpointsFailed = [];
  let rateLimit = previous?.provider?.rate_limit || {
    daily_limit: null,
    per_minute_limit: null,
    remaining: null
  };

  for (const [name, definition] of Object.entries(UW_API_ENDPOINTS)) {
    const cached = previous?.raw?.[name];
    const cachedAge = ageSeconds(cached?.fetched_at || previous?.last_update, now);
    if (cached && cachedAge != null && cachedAge <= definition.ttlSeconds) {
      raw[name] = cached;
      endpointsOk.push(name);
      continue;
    }

    try {
      const response = await fetchImpl(endpointUrl(definition, config), {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/json'
        }
      });
      rateLimit = mergeRateLimit(rateLimit, parseRateLimit(response.headers));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        endpointsFailed.push({
          name,
          path: definition.requestedPath || definition.path,
          status: response.status === 401 || response.status === 403
            ? 'unauthorized'
            : response.status === 404
              ? 'not_found'
              : 'failed',
          http_status: response.status,
          category: definition.category,
          message: body?.message || body?.error || response.statusText || 'UW API request failed'
        });
        continue;
      }
      raw[name] = {
        path: definition.requestedPath || definition.path,
        status: response.status,
        fetched_at: now.toISOString(),
        data: body
      };
      endpointsOk.push(name);
    } catch (error) {
      endpointsFailed.push({
        name,
        path: definition.requestedPath || definition.path,
        status: 'failed',
        http_status: 'error',
        category: definition.category,
        message: error.message
      });
    }
  }

  const coreNames = Object.entries(UW_API_ENDPOINTS)
    .filter(([, definition]) => definition.core)
    .map(([name]) => name);
  const status = providerStatus(endpointsOk, endpointsFailed.map((item) => item.name), coreNames);
  const provider = {
    mode: 'api',
    status,
    last_update: endpointsOk.length > 0 ? now.toISOString() : previous?.last_update || null,
    age_seconds: endpointsOk.length > 0 ? 0 : ageSeconds(previous?.last_update, now),
    is_mock: false,
      endpoints_ok: endpointsOk,
    endpoints_failed: endpointsFailed,
    endpoint_coverage: buildEndpointCoverage(endpointsOk, endpointsFailed),
    rate_limit: rateLimit,
    plain_chinese:
      status === 'live'
        ? 'UW API 核心端点 live。'
        : status === 'partial'
          ? 'UW API 部分端点成功，只能降级参考。'
          : 'UW API 端点失败，保留最近缓存但不能主导交易。'
  };
  const snapshot = {
    source: 'unusual_whales_api',
    last_update: provider.last_update,
    status: provider.status,
    provider,
    endpoint_coverage: provider.endpoint_coverage,
    raw,
    normalized: normalizeUwApiSnapshot({ raw })
  };
  await writeUwApiSnapshot(snapshot);
  return snapshot;
}

export async function readUwProvider(options = {}) {
  const config = { ...getUwApiConfig(), ...(options.config || {}) };
  if (config.mode === 'api' && config.apiKey && options.refresh !== false) {
    const snapshot = await fetchUwApiSnapshot(options);
    return {
      snapshot,
      provider: providerFromSnapshot(snapshot, config, options.now)
    };
  }

  const snapshot = await readUwApiSnapshot({
    now: options.now,
    staleSeconds: config.staleSeconds
  });
  if (!snapshot) {
    return {
      snapshot: null,
      provider: buildUnavailableProvider(config.mode === 'api' ? 'UW API key 未配置。' : 'UW provider 未启用。')
    };
  }
  return {
    snapshot,
    provider: providerFromSnapshot(snapshot, config, options.now)
  };
}

export function getUwProviderMetadata() {
  return {
    endpoints: UW_API_ENDPOINTS,
    store: getUwApiSnapshotStoreConfig()
  };
}
