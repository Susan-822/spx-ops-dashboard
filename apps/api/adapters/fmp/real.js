const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const FMP_CALENDAR_URL = 'https://financialmodelingprep.com/stable/economic-calendar';
const FMP_QUOTE_SHORT_URL = 'https://financialmodelingprep.com/stable/quote-short';
const FMP_QUOTE_URL = 'https://financialmodelingprep.com/stable/quote';
const FMP_INTRADAY_URL = 'https://financialmodelingprep.com/stable/historical-chart/1min';
const FMP_LEGACY_QUOTE_SHORT_URL = 'https://financialmodelingprep.com/api/v3/quote-short';
const FMP_LEGACY_QUOTE_URL = 'https://financialmodelingprep.com/api/v3/quote';
const FMP_LEGACY_INTRADAY_URL = 'https://financialmodelingprep.com/api/v3/historical-chart/1min';
const FMP_EVENT_ERROR_NOTE = 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。';
const FMP_EVENT_ERROR_MESSAGE = 'FMP 数据异常，事件风险不可确认。';
const FMP_PRICE_ERROR_MESSAGE = 'FMP SPX price unavailable';
const FMP_SYMBOL = '^GSPC';

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeImpact(value) {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('high') || text.includes('3')) {
    return 'high';
  }
  if (text.includes('medium') || text.includes('med') || text.includes('2')) {
    return 'medium';
  }
  return 'low';
}

function normalizeEventTitle(item) {
  return item.event || item.name || item.title || item.indicator || '宏观事件';
}

function normalizeCountryCode(item) {
  return String(item.country || item.countryCode || item.currency || '').trim().toUpperCase();
}

function parseEventTimestamp(item) {
  const rawDate = item.date || item.releaseDate || item.datetime || item.eventDate || item.publishedDate;
  const parsed = Date.parse(rawDate);
  return Number.isNaN(parsed) ? null : parsed;
}

function isRelevantForSpx(item) {
  const countryCode = normalizeCountryCode(item);
  if (!countryCode) {
    return true;
  }
  return countryCode.includes('US') || countryCode.includes('USD');
}

function describeTiming(minutesUntil) {
  if (minutesUntil <= 0) {
    return '正在进入公布窗口';
  }
  if (minutesUntil < 60) {
    return `约 ${minutesUntil} 分钟后`;
  }
  const hours = Math.round((minutesUntil / 60) * 10) / 10;
  return `约 ${hours} 小时后`;
}

function getApiKey() {
  return process.env.FMP_API_KEY || '';
}

function buildFmpUrl(baseUrl, extraParams = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('symbol', FMP_SYMBOL);
  url.searchParams.set('apikey', getApiKey());
  for (const [key, value] of Object.entries(extraParams)) {
    if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function buildFmpSymbolUrl(baseUrl, extraParams = {}) {
  const url = new URL(`${baseUrl}/${encodeURIComponent(FMP_SYMBOL)}`);
  url.searchParams.set('apikey', getApiKey());
  for (const [key, value] of Object.entries(extraParams)) {
    if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function fetchJson(url, fetchImpl, timeoutMs = 6000) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  return {
    response,
    payload: response.ok ? await response.json() : null
  };
}

function asArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizePriceQuote(item) {
  const price = firstNumber(item?.price, item?.last, item?.close);
  if (!Number.isFinite(price)) {
    return null;
  }

  return {
    symbol: item?.symbol || FMP_SYMBOL,
    price,
    day_change: firstNumber(item?.change),
    day_change_percent: firstNumber(item?.changesPercentage, item?.changePercent),
    last_updated: firstNonEmpty(item?.timestamp, item?.lastUpdatedAt, item?.updatedAt)
  };
}

function normalizeIntradayPrice(items = []) {
  const latest = items
    .map((item) => ({
      time: item?.date || item?.datetime || item?.timestamp,
      close: firstNumber(item?.close, item?.price)
    }))
    .filter((item) => Number.isFinite(item.close) && item.time)
    .sort((left, right) => Date.parse(right.time) - Date.parse(left.time))[0];

  if (!latest) {
    return null;
  }

  return {
    symbol: FMP_SYMBOL,
    price: latest.close,
    day_change: null,
    day_change_percent: null,
    last_updated: latest.time
  };
}

function buildPriceStatus({
  configured,
  available,
  is_mock,
  state,
  stale,
  fetch_mode,
  message,
  received_at,
  last_updated,
  latency_ms,
  price,
  day_change,
  day_change_percent
}) {
  return {
    source: 'fmp_price',
    configured,
    available,
    is_mock,
    state,
    stale,
    fetch_mode,
    message,
    received_at,
    last_updated,
    data_timestamp: last_updated,
    latency_ms,
    price,
    day_change,
    day_change_percent
  };
}

function classifyFmpRisk(events, nowMs) {
  const relevantEvents = events
    .filter(isRelevantForSpx)
    .map((item) => {
      const timestamp = parseEventTimestamp(item);
      if (!timestamp) {
        return null;
      }
      const impact = normalizeImpact(item.impact || item.importance || item.impactScore);
      if (impact === 'low') {
        return null;
      }
      const minutesUntil = Math.round((timestamp - nowMs) / MINUTE);
      return {
        title: normalizeEventTitle(item),
        timestamp,
        impact,
        minutesUntil
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);

  const highRiskEvent = relevantEvents.find((item) => item.impact === 'high' && item.minutesUntil >= -30 && item.minutesUntil <= 3 * 60);
  if (highRiskEvent) {
    return {
      event_risk: 'high',
      fmp_signal: 'event_risk_high',
      event_note: `FMP 检测到 ${describeTiming(highRiskEvent.minutesUntil)} 的高影响事件 ${highRiskEvent.title}，先关闭卖波动率并保持等待。`,
      highlighted_event: highRiskEvent
    };
  }

  const mediumRiskEvent = relevantEvents.find((item) => item.impact === 'high' && item.minutesUntil > 3 * 60 && item.minutesUntil <= 24 * 60);
  if (mediumRiskEvent) {
    return {
      event_risk: 'medium',
      fmp_signal: 'event_watch',
      event_note: `FMP 提醒 ${describeTiming(mediumRiskEvent.minutesUntil)} 将有高影响事件 ${mediumRiskEvent.title}，盘前先降低卖波动率预期。`,
      highlighted_event: mediumRiskEvent
    };
  }

  return {
    event_risk: 'low',
    fmp_signal: 'clear',
    event_note: '',
    highlighted_event: null
  };
}

export async function fetchFmpReal({
  fetchImpl = fetch,
  now = new Date(),
  receivedAt = new Date().toISOString(),
  forceLastUpdated = null
} = {}) {
  return fetchFmpEventRisk({
    fetchImpl,
    now,
    receivedAt,
    forceLastUpdated
  });
}

export async function fetchFmpEventRisk({
  fetchImpl = fetch,
  now = new Date(),
  receivedAt = new Date().toISOString(),
  forceLastUpdated = null
} = {}) {
  const configured = Boolean(process.env.FMP_API_KEY);
  if (!configured) {
    return {
      source: 'fmp_event',
      configured: false,
      available: false,
      is_mock: false,
      fetch_mode: 'low_frequency_poll',
      message: FMP_EVENT_ERROR_MESSAGE,
      event_risk: 'medium',
      fmp_signal: 'event_risk_unknown',
      event_note: FMP_EVENT_ERROR_NOTE,
      trade_permission_adjustment: 'downgrade',
      no_short_vol_window: true
    };
  }

  const startMs = Date.now();
  const from = formatUtcDate(now);
  const to = formatUtcDate(new Date(now.getTime() + 2 * 24 * HOUR));
  const url = buildFmpUrl(FMP_CALENDAR_URL, { from, to });

  try {
    const { response, payload } = await fetchJson(url, fetchImpl);

    if (!response.ok) {
      return {
        source: 'fmp_event',
        configured: true,
        available: false,
        is_mock: false,
        fetch_mode: 'low_frequency_poll',
        message: FMP_EVENT_ERROR_MESSAGE,
        event_risk: 'medium',
        fmp_signal: 'event_risk_unknown',
        event_note: FMP_EVENT_ERROR_NOTE,
        trade_permission_adjustment: 'downgrade',
        no_short_vol_window: true
      };
    }

    const items = asArray(payload);
    const risk = classifyFmpRisk(items, now.getTime());
    const latencyMs = Math.max(0, Date.now() - startMs);
    const lastUpdated = forceLastUpdated || receivedAt;

    return {
      source: 'fmp_event',
      configured: true,
      available: true,
      is_mock: false,
      fetch_mode: 'low_frequency_poll',
      message: risk.event_risk === 'low'
        ? 'FMP 当前未检测到近端高影响事件。'
        : risk.event_note,
      last_updated: lastUpdated,
      data_timestamp: lastUpdated,
      received_at: receivedAt,
      latency_ms: latencyMs,
      ...risk
    };
  } catch (error) {
    return {
      source: 'fmp_event',
      configured: true,
      available: false,
      is_mock: false,
      fetch_mode: 'low_frequency_poll',
      message: FMP_EVENT_ERROR_MESSAGE,
      event_risk: 'medium',
      fmp_signal: 'event_risk_unknown',
      event_note: FMP_EVENT_ERROR_NOTE,
      trade_permission_adjustment: 'downgrade',
      no_short_vol_window: true
    };
  }
}

export async function fetchFmpPrice({
  fetchImpl = fetch,
  quoteShortFetchImpl = fetchImpl,
  quoteFetchImpl = fetchImpl,
  historicalFetchImpl = fetchImpl,
  receivedAt = new Date().toISOString(),
  forceLastUpdated = null
} = {}) {
  const configured = Boolean(getApiKey());
  if (!configured) {
    return buildPriceStatus({
      configured: false,
      available: false,
      is_mock: false,
      state: 'degraded',
      stale: true,
      fetch_mode: 'low_frequency_poll',
      message: FMP_PRICE_ERROR_MESSAGE,
      received_at: receivedAt,
      last_updated: forceLastUpdated || receivedAt,
      latency_ms: 0,
      price: null,
      day_change: null,
      day_change_percent: null
    });
  }

  const startMs = Date.now();

  try {
    const shortUrl = buildFmpUrl(FMP_QUOTE_SHORT_URL);
    const shortResult = await fetchJson(shortUrl, quoteShortFetchImpl);
    if (shortResult.response.ok) {
      const shortQuote = normalizePriceQuote(asArray(shortResult.payload)[0]);
      if (shortQuote) {
        const lastUpdated = forceLastUpdated || shortQuote.last_updated || receivedAt;
        return buildPriceStatus({
          configured: true,
          available: true,
          is_mock: false,
          state: 'real',
          stale: false,
          fetch_mode: 'quote_short_poll',
          message: 'FMP SPX price real',
          received_at: receivedAt,
          last_updated: lastUpdated,
          latency_ms: Math.max(0, Date.now() - startMs),
          price: shortQuote.price,
          day_change: shortQuote.day_change,
          day_change_percent: shortQuote.day_change_percent
        });
      }
    }

    const quoteUrl = buildFmpUrl(FMP_QUOTE_URL);
    const quoteResult = await fetchJson(quoteUrl, quoteFetchImpl);
    if (quoteResult.response.ok) {
      const quote = normalizePriceQuote(asArray(quoteResult.payload)[0]);
      if (quote) {
        const lastUpdated = forceLastUpdated || quote.last_updated || receivedAt;
        return buildPriceStatus({
          configured: true,
          available: true,
          is_mock: false,
          state: 'real',
          stale: false,
          fetch_mode: 'quote_poll',
          message: 'FMP SPX price real',
          received_at: receivedAt,
          last_updated: lastUpdated,
          latency_ms: Math.max(0, Date.now() - startMs),
          price: quote.price,
          day_change: quote.day_change,
          day_change_percent: quote.day_change_percent
        });
      }
    }

    const legacyShortResult = await fetchJson(buildFmpSymbolUrl(FMP_LEGACY_QUOTE_SHORT_URL), quoteShortFetchImpl);
    if (legacyShortResult.response.ok) {
      const legacyShortQuote = normalizePriceQuote(asArray(legacyShortResult.payload)[0]);
      if (legacyShortQuote) {
        const lastUpdated = forceLastUpdated || legacyShortQuote.last_updated || receivedAt;
        return buildPriceStatus({
          configured: true,
          available: true,
          is_mock: false,
          state: 'real',
          stale: false,
          fetch_mode: 'quote_short_legacy_poll',
          message: 'FMP SPX price real',
          received_at: receivedAt,
          last_updated: lastUpdated,
          latency_ms: Math.max(0, Date.now() - startMs),
          price: legacyShortQuote.price,
          day_change: legacyShortQuote.day_change,
          day_change_percent: legacyShortQuote.day_change_percent
        });
      }
    }

    const legacyQuoteResult = await fetchJson(buildFmpSymbolUrl(FMP_LEGACY_QUOTE_URL), quoteFetchImpl);
    if (legacyQuoteResult.response.ok) {
      const legacyQuote = normalizePriceQuote(asArray(legacyQuoteResult.payload)[0]);
      if (legacyQuote) {
        const lastUpdated = forceLastUpdated || legacyQuote.last_updated || receivedAt;
        return buildPriceStatus({
          configured: true,
          available: true,
          is_mock: false,
          state: 'real',
          stale: false,
          fetch_mode: 'quote_legacy_poll',
          message: 'FMP SPX price real',
          received_at: receivedAt,
          last_updated: lastUpdated,
          latency_ms: Math.max(0, Date.now() - startMs),
          price: legacyQuote.price,
          day_change: legacyQuote.day_change,
          day_change_percent: legacyQuote.day_change_percent
        });
      }
    }

    const intradayUrl = buildFmpUrl(FMP_INTRADAY_URL);
    const intradayResult = await fetchJson(intradayUrl, historicalFetchImpl, 8000);
    if (intradayResult.response.ok) {
      const intradayQuote = normalizeIntradayPrice(asArray(intradayResult.payload));
      if (intradayQuote) {
        const lastUpdated = forceLastUpdated || intradayQuote.last_updated || receivedAt;
        return buildPriceStatus({
          configured: true,
          available: true,
          is_mock: false,
          state: 'real',
          stale: false,
          fetch_mode: 'intraday_backup_poll',
          message: 'FMP SPX price real',
          received_at: receivedAt,
          last_updated: lastUpdated,
          latency_ms: Math.max(0, Date.now() - startMs),
          price: intradayQuote.price,
          day_change: intradayQuote.day_change,
          day_change_percent: intradayQuote.day_change_percent
        });
      }
    }

    const legacyIntradayResult = await fetchJson(buildFmpSymbolUrl(FMP_LEGACY_INTRADAY_URL), historicalFetchImpl, 8000);
    if (legacyIntradayResult.response.ok) {
      const legacyIntradayQuote = normalizeIntradayPrice(asArray(legacyIntradayResult.payload));
      if (legacyIntradayQuote) {
        const lastUpdated = forceLastUpdated || legacyIntradayQuote.last_updated || receivedAt;
        return buildPriceStatus({
          configured: true,
          available: true,
          is_mock: false,
          state: 'real',
          stale: false,
          fetch_mode: 'intraday_legacy_poll',
          message: 'FMP SPX price real',
          received_at: receivedAt,
          last_updated: lastUpdated,
          latency_ms: Math.max(0, Date.now() - startMs),
          price: legacyIntradayQuote.price,
          day_change: legacyIntradayQuote.day_change,
          day_change_percent: legacyIntradayQuote.day_change_percent
        });
      }
    }

    return buildPriceStatus({
      configured: true,
      available: false,
      is_mock: false,
      state: 'degraded',
      stale: true,
      fetch_mode: 'low_frequency_poll',
      message: FMP_PRICE_ERROR_MESSAGE,
      received_at: receivedAt,
      last_updated: forceLastUpdated || receivedAt,
      latency_ms: Math.max(0, Date.now() - startMs),
      price: null,
      day_change: null,
      day_change_percent: null
    });
  } catch {
    return buildPriceStatus({
      configured: true,
      available: false,
      is_mock: false,
      state: 'degraded',
      stale: true,
      fetch_mode: 'low_frequency_poll',
      message: FMP_PRICE_ERROR_MESSAGE,
      received_at: receivedAt,
      last_updated: forceLastUpdated || receivedAt,
      latency_ms: Math.max(0, Date.now() - startMs),
      price: null,
      day_change: null,
      day_change_percent: null
    });
  }
}
