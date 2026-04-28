import { buildNewsRadar, BRAVE_NEWS_QUERIES } from '../decision_engine/algorithms/news-radar.js';

function isTradingDayET(now = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short'
  }).format(now);
  return !['Sat', 'Sun'].includes(weekday);
}

function etMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour * 60 + minute;
}

export function shouldRunBraveNewsRadar(now = new Date()) {
  if (!isTradingDayET(now)) return false;
  const minutes = etMinutes(now);
  if (minutes === 9 * 60) return true;
  if (minutes === 16 * 60 + 10) return true;
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60 && (minutes - (9 * 60 + 30)) % 30 === 0;
}

export async function runBraveNewsRadarJob({ fetchImpl = globalThis.fetch, now = new Date(), previous = null } = {}) {
  const apiKey = process.env.BRAVE_API_KEY || '';
  if (!apiKey) {
    return buildNewsRadar({ previous, now, error: 'BRAVE_API_KEY not configured' });
  }
  const topItems = [];
  try {
    for (const query of BRAVE_NEWS_QUERIES) {
      const url = new URL('https://api.search.brave.com/res/v1/news/search');
      url.searchParams.set('q', query);
      url.searchParams.set('freshness', 'pd');
      url.searchParams.set('country', 'US');
      url.searchParams.set('search_lang', 'en');
      url.searchParams.set('extra_snippets', 'true');
      url.searchParams.set('count', '5');
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey
        }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || body?.error || response.statusText || 'Brave request failed');
      const results = Array.isArray(body.results) ? body.results : [];
      for (const item of results.slice(0, 5)) {
        topItems.push({
          query,
          title: item.title || '',
          description: item.description || item.extra_snippets?.join(' ') || '',
          url: item.url || '',
          age: item.age || '',
          published: item.page_age || item.published || ''
        });
      }
    }
    return buildNewsRadar({ items: topItems, now, previous });
  } catch (error) {
    return buildNewsRadar({ previous, now, error: error.message });
  }
}
