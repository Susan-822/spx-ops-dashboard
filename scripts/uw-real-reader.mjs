import fs from 'node:fs/promises';

const DEFAULT_TIMEOUT_MS = 15000;

const PAGE_SPECS = Object.freeze({
  flow: {
    url: 'https://unusualwhales.com/flow/overview',
    selectors: [
      '[data-testid="market-tide"]',
      '[data-testid="options-flow-overview"]',
      'main'
    ]
  },
  darkpool: {
    url: 'https://unusualwhales.com/dark-pool-flow',
    selectors: [
      '[data-testid="dark-pool-flow"]',
      '[data-testid="off-exchange-flow"]',
      'main'
    ]
  },
  volatility: {
    url: 'https://unusualwhales.com/stock/SPX/volatility',
    selectors: [
      '[data-testid="volatility-overview"]',
      '[data-testid="term-structure"]',
      'main'
    ]
  },
  marketTide: {
    url: 'https://unusualwhales.com/flow/overview',
    selectors: [
      '[data-testid="market-tide"]',
      '[data-testid="market-sentiment"]',
      'main'
    ]
  },
  dealer: {
    url: 'https://unusualwhales.com/stock/SPX/greek-exposure',
    selectors: [
      '[data-testid="greek-exposure"]',
      '[data-testid="zero-gamma"]',
      'main'
    ]
  }
});

function sanitizeSnippet(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function mapFlowBias(snippet) {
  const lower = snippet.toLowerCase();
  if (!lower) return 'unavailable';
  if (lower.includes('bullish')) return 'bullish';
  if (lower.includes('bearish')) return 'bearish';
  if (lower.includes('mixed')) return 'mixed';
  return 'unavailable';
}

function mapInstitutionalEntry(snippet) {
  const lower = snippet.toLowerCase();
  if (!lower) return 'unavailable';
  if (lower.includes('bombing')) return 'bombing';
  if (lower.includes('building')) return 'building';
  if (lower.includes('institutional')) return 'none';
  return 'unavailable';
}

function mapDarkpoolBias(snippet) {
  const lower = snippet.toLowerCase();
  if (!lower) return 'unavailable';
  if (lower.includes('support')) return 'support';
  if (lower.includes('resistance')) return 'resistance';
  if (lower.includes('neutral')) return 'neutral';
  return 'unavailable';
}

function mapVolatilityLight(snippet) {
  const lower = snippet.toLowerCase();
  if (!lower) return 'unavailable';
  if (lower.includes('green')) return 'green';
  if (lower.includes('yellow')) return 'yellow';
  if (lower.includes('red')) return 'red';
  if (lower.includes('iv rank') || lower.includes('implied volatility')) return 'unavailable';
  return 'unavailable';
}

function mapMarketTide(snippet) {
  const lower = snippet.toLowerCase();
  if (!lower) return 'unavailable';
  if (lower.includes('risk on') || lower.includes('risk-on')) return 'risk_on';
  if (lower.includes('risk off') || lower.includes('risk-off')) return 'risk_off';
  if (lower.includes('mixed')) return 'mixed';
  return 'unavailable';
}

function mapDealerCrosscheck(snippet) {
  const lower = snippet.toLowerCase();
  if (!lower) return 'unavailable';
  if (lower.includes('confirm')) return 'confirm';
  if (lower.includes('conflict')) return 'conflict';
  if (lower.includes('gex') || lower.includes('zero gamma')) return 'unavailable';
  return 'unavailable';
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    const body = await response.text();
    return {
      url,
      ok: response.ok,
      status: response.status,
      body
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readRealUwSummary() {
  const [flowPage, darkpoolPage, volatilityPage, marketTidePage, dealerPage] = await Promise.all([
    fetchPage(PAGE_SPECS.flow.url),
    fetchPage(PAGE_SPECS.darkpool.url),
    fetchPage(PAGE_SPECS.volatility.url),
    fetchPage(PAGE_SPECS.marketTide.url),
    fetchPage(PAGE_SPECS.dealer.url)
  ]);

  const pages = {
    flow: flowPage,
    darkpool: darkpoolPage,
    volatility: volatilityPage,
    market_tide: marketTidePage,
    dealer: dealerPage
  };

  const snippets = Object.fromEntries(
    Object.entries(pages).map(([key, value]) => [key, sanitizeSnippet(value.body)])
  );

  const summary = {
    source: 'unusual_whales_dom_reader',
    status: 'partial',
    last_update: new Date().toISOString(),
    flow: {
      flow_bias: mapFlowBias(snippets.flow),
      institutional_entry: mapInstitutionalEntry(snippets.flow)
    },
    darkpool: {
      darkpool_bias: mapDarkpoolBias(snippets.darkpool)
    },
    volatility: {
      volatility_light: mapVolatilityLight(snippets.volatility)
    },
    sentiment: {
      market_tide: mapMarketTide(snippets.market_tide)
    },
    dealer_crosscheck: {
      state: mapDealerCrosscheck(snippets.dealer)
    },
    quality: {
      data_quality: 'partial',
      missing_fields: [],
      warnings: []
    }
  };

  for (const [field, value] of Object.entries({
    flow_bias: summary.flow.flow_bias,
    institutional_entry: summary.flow.institutional_entry,
    darkpool_bias: summary.darkpool.darkpool_bias,
    volatility_light: summary.volatility.volatility_light,
    market_tide: summary.sentiment.market_tide,
    dealer_crosscheck: summary.dealer_crosscheck.state
  })) {
    if (value === 'unavailable') {
      summary.quality.missing_fields.push(field);
    }
  }

  if (summary.quality.missing_fields.length === 0) {
    summary.status = 'live';
    summary.quality.data_quality = 'live';
  } else {
    summary.status = 'partial';
    summary.quality.data_quality = 'partial';
    summary.quality.warnings.push('reader_access_limited_or_login_required');
  }

  return {
    reader_source: 'uw_dom_reader',
    pages: Object.fromEntries(
      Object.entries(pages).map(([key, value]) => [
        key,
        {
          url: value.url,
          status: value.status,
          ok: value.ok,
          selectors: PAGE_SPECS[key === 'market_tide' ? 'marketTide' : key === 'dealer' ? 'dealer' : key].selectors
        }
      ])
    ),
    sanitized_curated_payload: summary
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await readRealUwSummary();
  const outputPath = process.argv[2];
  if (outputPath) {
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

export { readRealUwSummary };
