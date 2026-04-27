import { normalizeUwApiSnapshot } from '../normalizer/uw-api-normalizer.js';
import {
  getUwApiSnapshotStoreConfig,
  readUwApiSnapshot,
  writeUwApiSnapshot
} from '../storage/uwSnapshotStore.js';

export const UW_API_ENDPOINTS = Object.freeze({
  greek_exposure: { path: '/api/stock/{ticker}/greek-exposure', ttlSeconds: 60, core: true },
  spot_gex: { path: '/api/stock/{ticker}/spot-exposures/strike', ttlSeconds: 60, core: true },
  options_flow: { path: '/api/option-trades/flow-alerts', ttlSeconds: 45, core: true },
  darkpool: { path: '/api/darkpool/{ticker}', ttlSeconds: 120, core: false, ticker: 'SPY' },
  volatility: { path: '/api/stock/{ticker}/volatility/stats', ttlSeconds: 120, core: false },
  market_tide: { path: '/api/market/market-tide', ttlSeconds: 60, core: false },
  volume_oi: { path: '/api/stock/{ticker}/option/volume-oi-expiry', ttlSeconds: 180, core: false },
  max_pain: { path: '/api/stock/{ticker}/max-pain', ttlSeconds: 180, core: false },
  oi_by_strike: { path: '/api/stock/{ticker}/oi-per-strike', ttlSeconds: 180, core: false },
  options_volume: { path: '/api/stock/{ticker}/options-volume', ttlSeconds: 180, core: false }
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
  return definition.path.replace('{ticker}', encodeURIComponent(ticker));
}

function endpointUrl(definition, config) {
  const url = new URL(`${config.baseUrl}${endpointPath(definition, config)}`);
  if (definition.path === '/api/option-trades/flow-alerts') {
    url.searchParams.set('ticker_symbol', config.ticker);
    url.searchParams.set('limit', '100');
  } else if (definition.path.includes('/darkpool/')) {
    url.searchParams.set('limit', '100');
  } else if (definition.path.includes('/options-volume')) {
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

function providerStatus(okNames, failedNames, coreNames) {
  if (okNames.length === 0 && failedNames.length > 0) return 'error';
  if (coreNames.every((name) => okNames.includes(name))) return 'live';
  if (okNames.length > 0) return 'partial';
  return 'unavailable';
}

export async function fetchUwApiSnapshot(options = {}) {
  const config = { ...getUwApiConfig(), ...(options.config || {}) };
  const now = options.now ? new Date(options.now) : new Date();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const previous = await readUwApiSnapshot({ now, staleSeconds: config.staleSeconds });

  if (config.mode !== 'api' || !config.apiKey) {
    return {
      ...(previous || {}),
      provider: buildUnavailableProvider('UW API key 未配置，UW 不得主导交易。'),
      last_update: previous?.last_update || null,
      raw: previous?.raw || {},
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
          path: definition.path,
          status: response.status,
          message: body?.message || body?.error || response.statusText || 'UW API request failed'
        });
        continue;
      }
      raw[name] = {
        path: definition.path,
        status: response.status,
        fetched_at: now.toISOString(),
        data: body
      };
      endpointsOk.push(name);
    } catch (error) {
      endpointsFailed.push({
        name,
        path: definition.path,
        status: 'error',
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
