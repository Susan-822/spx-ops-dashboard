const QUERY_GROUPS = [
  'SPX SPY S&P 500 market today',
  'Federal Reserve Powell CPI PCE Treasury yields today',
  'VIX volatility market today',
  'NVDA AAPL MSFT TSLA Nasdaq news today',
  'earnings today tomorrow premarket after hours mega cap',
  'geopolitical oil risk market today'
];

function textOf(item = {}) {
  return [item.title, item.description, item.extra_snippets?.join(' ')].filter(Boolean).join(' ');
}

function includesAny(text = '', words = []) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

export function buildNewsRadar({ items = [], last_updated = null, stale = false, missing = [] } = {}) {
  const text = items.map(textOf).join(' ');
  const high = includesAny(text, ['FOMC', 'Powell', 'CPI', 'PCE', 'Treasury yield shock', 'VIX spike', 'war', 'oil shock']);
  const medium = !high && includesAny(text, ['Federal Reserve', 'earnings', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'Treasury yields']);
  const newsRisk = high ? 'high' : medium ? 'medium' : 'low';
  return {
    status: stale ? 'stale' : items.length ? 'live' : 'unavailable',
    last_updated,
    freshness: 'pd',
    news_risk: newsRisk,
    news_risk_cn: high ? '高' : medium ? '中' : '低',
    macro_event_cn: includesAny(text, ['Federal Reserve', 'Powell', 'CPI', 'PCE', 'Treasury']) ? '有宏观或利率相关风险，需要提高警惕。' : '暂未看到明确 Fed / CPI / PCE / 债券收益率风险。',
    earnings_event_cn: includesAny(text, ['earnings', 'premarket', 'after hours']) ? '有重要财报线索，注意盘中或盘后波动。' : '暂未看到会直接冲击指数的重要财报。',
    mega_cap_cn: includesAny(text, ['NVDA', 'AAPL', 'MSFT', 'TSLA']) ? '科技权重股有新闻，需要观察是否拖盘或托盘。' : '暂未看到科技权重股主导盘面的明显新闻。',
    geopolitics_cn: includesAny(text, ['geopolitical', 'war', 'oil']) ? '有地缘或油价风险线索。' : '暂未看到明确地缘或油价冲击。',
    market_theme_cn: items[0]?.title ? `当前新闻主线：${items[0].title}` : '新闻雷达等待可用结果。',
    operation_impact_cn: high ? '新闻风险偏高，不做无计划追单。' : '新闻只做背景，不直接开仓。',
    top_items: items.slice(0, 5).map((item) => ({ title: item.title, url: item.url, source: item.source })),
    missing_cn: missing.length ? missing : items.length ? [] : ['Brave 新闻雷达没有可用结果。']
  };
}

export async function fetchBraveNewsRadar({ apiKey = process.env.BRAVE_API_KEY, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  if (!apiKey) {
    return buildNewsRadar({ last_updated: now.toISOString(), stale: true, missing: ['未配置 Brave API key。'] });
  }
  const collected = [];
  for (const q of QUERY_GROUPS) {
    const url = new URL('https://api.search.brave.com/res/v1/news/search');
    url.searchParams.set('q', q);
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
    if (!response.ok) throw new Error(`Brave news search failed ${response.status}`);
    const body = await response.json();
    collected.push(...(body.results || []));
  }
  return buildNewsRadar({ items: collected, last_updated: now.toISOString() });
}

export function braveNewsSchedule() {
  return {
    timezone: 'America/New_York',
    triggers_cn: [
      '每个美股交易日 09:00 ET 运行一次。',
      '09:30 ET 到 16:00 ET 每 30 分钟运行一次。',
      '16:10 ET 盘后运行一次，用来看次日风险。'
    ],
    failure_policy_cn: '如果 API 失败，保留上一轮结果但标记 stale，不能让操作层 ready。'
  };
}
