const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const FMP_CALENDAR_URL = 'https://financialmodelingprep.com/stable/economic-calendar';
const FMP_ERROR_NOTE = 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。';
const FMP_ERROR_MESSAGE = 'FMP 数据异常，事件风险不可确认。';

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
  const configured = Boolean(process.env.FMP_API_KEY);
  if (!configured) {
    return {
      source: 'fmp',
      configured: false,
      available: false,
      is_mock: false,
      fetch_mode: 'low_frequency_poll',
      message: FMP_ERROR_MESSAGE,
      event_risk: 'medium',
      fmp_signal: 'event_risk_unknown',
      event_note: FMP_ERROR_NOTE,
      trade_permission_adjustment: 'downgrade',
      no_short_vol_window: true
    };
  }

  const startMs = Date.now();
  const from = formatUtcDate(now);
  const to = formatUtcDate(new Date(now.getTime() + 2 * 24 * HOUR));
  const url = new URL(FMP_CALENDAR_URL);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('apikey', process.env.FMP_API_KEY);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
      return {
        source: 'fmp',
        configured: true,
        available: false,
        is_mock: false,
        fetch_mode: 'low_frequency_poll',
        message: FMP_ERROR_MESSAGE,
        event_risk: 'medium',
        fmp_signal: 'event_risk_unknown',
        event_note: FMP_ERROR_NOTE,
        trade_permission_adjustment: 'downgrade',
        no_short_vol_window: true
      };
    }

    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const risk = classifyFmpRisk(items, now.getTime());
    const latencyMs = Math.max(0, Date.now() - startMs);
    const lastUpdated = forceLastUpdated || receivedAt;

    return {
      source: 'fmp',
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
      source: 'fmp',
      configured: true,
      available: false,
      is_mock: false,
      fetch_mode: 'low_frequency_poll',
      message: FMP_ERROR_MESSAGE,
      event_risk: 'medium',
      fmp_signal: 'event_risk_unknown',
      event_note: FMP_ERROR_NOTE,
      trade_permission_adjustment: 'downgrade',
      no_short_vol_window: true
    };
  }
}
