import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

process.env.NODE_ENV = 'test';
process.env.TRADINGVIEW_WEBHOOK_SECRET = '000d3b57-e521-479c-addd-cc672dec00be';
process.env.STATE_STORE = 'memory';
process.env.THETA_INGEST_SECRET = 'local-theta-secret';

const { createServer } = await import('../server.js');
const { clearTradingViewSnapshot, updateTradingViewSnapshot } = await import('../storage/tradingview-snapshot.js');
const {
  clearThetaSnapshot,
  describeThetaSnapshotStore,
  getThetaSnapshot,
  resetThetaSnapshotStoreForTests,
  writeThetaSnapshot
} = await import('../storage/theta-snapshot.js');
const { getCurrentSignal } = await import('../decision_engine/current-signal.js');
const { buildAlertMessage } = await import('../alerts/build-alert-message.js');
const { resetTvSnapshotStoreForTests } = await import('../state/tvSnapshotStore.js');
const { clearUwApiSnapshot, writeUwApiSnapshot } = await import('../storage/uwSnapshotStore.js');
const { fetchUwApiSnapshot, UW_API_ENDPOINTS } = await import('../providers/uw-api-provider.js');
const {
  buildDealerConclusionEngine,
  calculateThetaDealerSummary,
  deriveThetaExecutionConstraint,
  mapThetaSnapshotToSourceStatus
} = await import('../decision_engine/dealer-conclusion-engine.js');
const { evaluateDataCoherence } = await import('../decision_engine/data-coherence-engine.js');

const EXPECTED_ACTIONS = {
  negative_gamma_wait_pullback: 'wait',
  positive_gamma_income_watch: 'income_ok',
  flip_conflict_wait: 'wait',
  theta_stale_no_trade: 'no_trade',
  fmp_event_no_short_vol: 'wait',
  uw_call_strong_unconfirmed: 'wait',
  breakout_pullback_pending: 'long_on_pullback'
};

const ALLOWED_MARKET_STATES = new Set([
  'positive_gamma_grind',
  'negative_gamma_expand',
  'flip_chop',
  'event_risk',
  'unknown'
]);

const ALLOWED_GAMMA_REGIMES = new Set(['positive', 'negative', 'critical', 'unknown']);
const ALLOWED_ACTIONS = new Set(['wait', 'long_on_pullback', 'short_on_retest', 'income_ok', 'no_trade']);
const ALLOWED_SOURCE_STATES = new Set(['real', 'mock', 'delayed', 'degraded', 'down', 'unavailable', 'error']);
const REQUIRED_STRATEGIES = ['单腿', '看涨价差', '看跌价差', '铁鹰', '观望'];

function hasUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some((item) => hasUndefined(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasUndefined(item));
  return false;
}

function sampleUwRaw(overrides = {}) {
  return {
    greek_exposure: { data: [{ gex: 180000000, dex: 30000000, vanna: 9000000, charm: 5000000, zero_gamma: 5298 }] },
    greek_exposure_strike: { data: [{ strike: 5340, call_gex: 120000000, gex: 120000000 }, { strike: 5280, put_gex: -90000000, gex: -90000000 }] },
    greek_exposure_expiry: { data: [{ expiry: '2026-04-27', gex: 180000000 }] },
    spot_gex_strike_expiry: { data: [{ strike: 5340, expiry: '2026-04-27', gex: 120000000 }] },
    spot_gex: { data: [{ strike: 5340, call_gex: 120000000, gex: 120000000 }, { strike: 5280, put_gex: -90000000, gex: -90000000 }] },
    options_flow: { data: [{ is_call: true, is_sweep: true, premium: 900000 }, { is_call: true, premium: 700000 }] },
    flow_recent: { data: [{ is_call: true, premium: 500000 }] },
    net_prem_ticks: { data: [{ call_premium: 1000000, put_premium: 200000 }] },
    flow_per_expiry: { data: [{ expiry: '2026-04-27', net_premium: 800000 }] },
    flow_per_strike: { data: [{ strike: 5340, net_premium: 800000 }] },
    flow_per_strike_intraday: { data: [{ strike: 5340, net_premium: 400000 }] },
    darkpool_recent: { data: [{ price: 525, premium: 50000000, side: 'support' }] },
    darkpool: { data: [{ price: 525, premium: 50000000, side: 'support', off_lit_ratio: 0.42 }] },
    stock_price_levels: { data: [{ price: 525, premium: 50000000, side: 'support' }] },
    volatility: { data: [{ iv_rank: 98, iv_percentile: 94, iv_change_5m: 0.2, realized_volatility: 30, atm_iv: 0.22 }] },
    interpolated_iv: { data: [{ atm_iv: 0.22 }] },
    iv_rank: { data: [{ iv_rank: 98, iv_percentile: 94 }] },
    realized_volatility: { data: [{ realized_volatility: 30 }] },
    term_structure: { data: [{ expiry: '2026-04-27', iv: 0.22 }] },
    market_tide: { data: [{ call_flow: 1500000, put_flow: 300000, net_flow: 1200000 }] },
    top_net_impact: { data: [{ net_flow: 1200000 }] },
    net_flow_expiry: { data: [{ net_flow: 1200000 }] },
    total_options_volume: { data: [{ call_flow: 1500000, put_flow: 300000 }] },
    sector_tide: { data: [{ net_flow: 500000 }] },
    etf_tide: { data: [{ net_flow: 700000 }] },
    volume_oi: { data: [{ expiry: '2026-04-27', call_volume: 100000, put_volume: 40000 }] },
    max_pain: { data: [{ max_pain: 5310 }] },
    oi_by_expiry: { data: [{ expiry: '2026-04-27', open_interest: 400000 }] },
    option_price_levels: { data: [{ strike: 5340, volume: 120000 }] },
    oi_by_strike: { data: [{ strike: 5310, open_interest: 400000 }] },
    options_volume: { data: [{ strike: 5340, option_type: 'call', volume: 120000 }, { strike: 5280, option_type: 'put', volume: 90000 }] },
    ohlc: { data: [{ close: 5310, volume: 1500000 }] },
    technical_vwap: { data: [{ value: 5300 }] },
    technical_atr: { data: [{ value: 22 }] },
    technical_ema: { data: [{ value: 5295 }] },
    technical_bbands: { data: [{ bb_width: 0.02 }] },
    technical_rsi: { data: [{ value: 61 }] },
    technical_macd: { data: [{ value: 2 }] },
    ...overrides
  };
}

function uwApiResponseForUrl(url, raw = sampleUwRaw()) {
  const entries = [
    ['greek-exposure/strike', raw.greek_exposure_strike],
    ['greek-exposure/expiry', raw.greek_exposure_expiry],
    ['greek-exposure', raw.greek_exposure],
    ['spot-exposures/strike-expiry', raw.spot_gex_strike_expiry],
    ['spot-exposures/strike', raw.spot_gex],
    ['flow-recent', raw.flow_recent],
    ['flow-alerts', raw.options_flow],
    ['net-prem-ticks', raw.net_prem_ticks],
    ['flow-per-expiry', raw.flow_per_expiry],
    ['flow-per-strike-intraday', raw.flow_per_strike_intraday],
    ['flow-per-strike', raw.flow_per_strike],
    ['darkpool/recent', raw.darkpool_recent],
    ['darkpool', raw.darkpool],
    ['stock-volume-price-levels', raw.stock_price_levels],
    ['volatility/stats', raw.volatility],
    ['interpolated-iv', raw.interpolated_iv],
    ['iv-rank', raw.iv_rank],
    ['volatility/realized', raw.realized_volatility],
    ['volatility/term-structure', raw.term_structure],
    ['market-tide', raw.market_tide],
    ['top-net-impact', raw.top_net_impact],
    ['net-flow/expiry', raw.net_flow_expiry],
    ['total-options-volume', raw.total_options_volume],
    ['sector-tide', raw.sector_tide],
    ['etf-tide', raw.etf_tide],
    ['volume-oi-expiry', raw.volume_oi],
    ['max-pain', raw.max_pain],
    ['oi-per-expiry', raw.oi_by_expiry],
    ['option/stock-price-levels', raw.option_price_levels],
    ['oi-per-strike', raw.oi_by_strike],
    ['options-volume', raw.options_volume],
    ['ohlc/1m', raw.ohlc],
    ['technical-indicator/VWAP', raw.technical_vwap],
    ['technical-indicator/ATR', raw.technical_atr],
    ['technical-indicator/EMA', raw.technical_ema],
    ['technical-indicator/BBANDS', raw.technical_bbands],
    ['technical-indicator/RSI', raw.technical_rsi],
    ['technical-indicator/MACD', raw.technical_macd]
  ];
  const match = entries.find(([needle]) => url.includes(needle));
  return {
    ok: Boolean(match),
    status: match ? 200 : 404,
    statusText: match ? 'OK' : 'Not Found',
    headers: new Headers({ 'x-ratelimit-remaining': '999' }),
    async json() {
      return match ? match[1] : { error: 'not found' };
    }
  };
}

function startServer() {
  clearTradingViewSnapshot();
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function resetTvStateEnv(overrides = {}) {
  delete process.env.REDIS_URL;
  delete process.env.TV_SNAPSHOT_FILE;
  delete process.env.TV_SNAPSHOT_TTL_SECONDS;
  delete process.env.TV_SNAPSHOT_STALE_SECONDS;
  process.env.STATE_STORE = 'memory';
  Object.assign(process.env, overrides);
  await clearTradingViewSnapshot();
  await resetTvSnapshotStoreForTests();
}

async function resetThetaStateEnv(overrides = {}) {
  delete process.env.THETA_REDIS_URL;
  delete process.env.THETA_SNAPSHOT_FILE;
  delete process.env.THETA_SNAPSHOT_TTL_SECONDS;
  delete process.env.THETA_SNAPSHOT_STALE_SECONDS;
  delete process.env.THETA_TEST_SPOT;
  delete process.env.THETA_TEST_EXPIRATION;
  delete process.env.MARKET_SNAPSHOT_PRICE;
  delete process.env.UW_INGEST_SECRET;
  delete process.env.FMP_API_KEY;
  process.env.THETA_STATE_STORE = 'memory';
  Object.assign(process.env, overrides);
  await resetThetaSnapshotStoreForTests();
  await clearThetaSnapshot();
}

async function resetUwApiStateEnv(overrides = {}) {
  delete process.env.UW_PROVIDER_MODE;
  delete process.env.UW_API_KEY;
  delete process.env.UW_API_BASE_URL;
  delete process.env.UW_STALE_SECONDS;
  delete process.env.UW_POLL_INTERVAL_SECONDS;
  delete process.env.UW_API_STATE_STORE;
  process.env.UW_API_STATE_STORE = 'memory';
  Object.assign(process.env, overrides);
  await clearUwApiSnapshot();
}

function sampleThetaPayload(overrides = {}) {
  return {
    secret: process.env.THETA_INGEST_SECRET,
    source: 'thetadata_terminal',
    status: 'live',
    last_update: new Date().toISOString(),
    ticker: 'SPX',
    spot_source: 'fmp',
    spot: 5310,
    test_expiration: '2026-04-24',
    dealer: {
      net_gex: 150000000,
      call_gex: 190000000,
      put_gex: -40000000,
      gamma_regime: 'positive',
      dealer_behavior: 'pin',
      least_resistance_path: 'range',
      call_wall: 5340,
      put_wall: 5280,
      max_pain: 5310,
      zero_gamma: 5298,
      expected_move_upper: 5348,
      expected_move_lower: 5272,
      vanna_charm_bias: 'bullish'
    },
    quality: {
      data_quality: 'live',
      missing_fields: [],
      warnings: [],
      calculation_scope: 'single_expiry_test',
      raw_rows_sent: false
    },
    ...overrides
  };
}

async function seedDefaultThetaLiveSnapshot() {
  await writeThetaSnapshot(sampleThetaPayload({ secret: undefined }));
}

test('GET /signals/current returns required protocol fields for dashboard and radar', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current`);
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.equal(typeof json.data_timestamp, 'string');
    assert.equal(typeof json.received_at, 'string');
    assert.equal(typeof json.latency_ms, 'number');
    assert.equal(Array.isArray(json.stale_reason), true);
    assert.equal(Array.isArray(json.source_status), true);
    assert.equal(['mock_scenario', 'live_fallback'].includes(json.fetch_mode), true);
    assert.equal(typeof json.is_mock, 'boolean');
    assert.equal(ALLOWED_MARKET_STATES.has(json.market_state), true);
    assert.equal(ALLOWED_GAMMA_REGIMES.has(json.gamma_regime), true);
    assert.equal(ALLOWED_ACTIONS.has(json.recommended_action), true);
    assert.equal(Array.isArray(json.conflict.conflict_points), true);
    assert.equal(Boolean(json.radar_summary), true);
    assert.equal(Boolean(json.theta), true);
    assert.equal(Boolean(json.dealer_conclusion), true);
    assert.equal(Boolean(json.execution_constraints?.theta), true);
    assert.equal(Boolean(json.command_inputs?.dealer?.dealer_conclusion), true);
    assert.equal(Boolean(json.projection?.dealer_summary), true);
  } finally {
    server.close();
  }
});

test('POST /ingest/theta rejects missing secret', async () => {
  await resetThetaStateEnv();
  const { server, baseUrl } = await startServer();

  try {
    const payload = sampleThetaPayload();
    delete payload.secret;
    const response = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal([401, 403].includes(response.status), true);
  } finally {
    server.close();
  }
});

test('POST /ingest/theta rejects wrong secret', async () => {
  await resetThetaStateEnv();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleThetaPayload({ secret: 'wrong' }))
    });

    assert.equal([401, 403].includes(response.status), true);
  } finally {
    server.close();
  }
});

test('POST /ingest/theta accepts curated summary and reflects it in current signal', async () => {
  await resetThetaStateEnv();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleThetaPayload())
    });

    assert.equal(response.status, 202);

    const signalResponse = await fetch(`${baseUrl}/signals/current?scenario=breakout_pullback_pending`);
    const signal = await signalResponse.json();

    assert.equal(signal.theta.status, 'live');
    assert.equal(signal.dealer_conclusion.status, 'live');
    assert.equal(signal.execution_constraints.theta.executable, true);
    assert.equal(signal.command_inputs.dealer.dealer_conclusion.call_wall, 5340);
    assert.equal(signal.command_inputs.external_spot.source, 'unavailable');
    assert.equal(signal.command_inputs.external_spot.spot, null);
  } finally {
    server.close();
  }
});

test('POST /ingest/theta rejects raw option chain tables', async () => {
  await resetThetaStateEnv();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleThetaPayload({
        option_chain: [{ strike: 5300, right: 'C' }]
      }))
    });

    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('POST /ingest/theta rejects raw greeks tables and forbidden auth fields', async () => {
  await resetThetaStateEnv();
  const { server, baseUrl } = await startServer();

  try {
    const greeksResponse = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleThetaPayload({
        raw_greeks: [{ strike: 5300, gamma: 0.01 }]
      }))
    });
    assert.equal(greeksResponse.status, 400);

    const authResponse = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleThetaPayload({
        authorization: 'Bearer secret'
      }))
    });
    assert.equal(authResponse.status, 400);
  } finally {
    server.close();
  }
});

test('POST /ingest/theta keeps null dealer levels null for partial python summaries', async () => {
  await resetThetaStateEnv({ DATA_PUSH_API_KEY: 'local-push-key' });
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/ingest/theta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'local-push-key'
      },
      body: JSON.stringify(sampleThetaPayload({
        secret: undefined,
        source: 'thetadata_python',
        status: 'partial',
        dealer: {
          ...sampleThetaPayload().dealer,
          net_gex: null,
          gamma_regime: 'unknown',
          zero_gamma: null
        },
        quality: {
          data_quality: 'partial',
          missing_fields: ['gamma', 'net_gex', 'zero_gamma'],
          warnings: ['walls_from_oi_fallback'],
          calculation_scope: 'single_expiry_test',
          raw_rows_sent: false
        }
      }))
    });

    assert.equal(response.status, 202);

    const snapshot = await getThetaSnapshot();
    assert.equal(snapshot.dealer.net_gex, null);
    assert.equal(snapshot.dealer.zero_gamma, null);
  } finally {
    server.close();
  }
});

test('thetaSnapshotStore supports memory and file modes with stale handling', async () => {
  await resetThetaStateEnv({ THETA_STATE_STORE: 'memory' });

  const memorySnapshot = await writeThetaSnapshot(sampleThetaPayload({ secret: undefined }));
  assert.equal(memorySnapshot.status, 'live');

  const memoryMeta = await describeThetaSnapshotStore();
  assert.equal(memoryMeta.mode, 'memory');

  const filePath = path.join(os.tmpdir(), `theta-snapshot-${Date.now()}.json`);
  await resetThetaStateEnv({
    THETA_STATE_STORE: 'file',
    THETA_SNAPSHOT_FILE: filePath.replace('/tmp/', '/var/tmp/'),
    THETA_SNAPSHOT_STALE_SECONDS: '1'
  });

  await writeThetaSnapshot(sampleThetaPayload({
    secret: undefined,
    last_update: new Date(Date.now() - 5 * 1000).toISOString()
  }));

  const fileSnapshot = await getThetaSnapshot();
  const fileMeta = await describeThetaSnapshotStore();
  assert.equal(fileMeta.mode, 'file');
  assert.equal(fileSnapshot.status, 'stale');
  assert.equal(fileSnapshot.stale, true);
});

test('dealer conclusion handles unavailable partial live and mock states safely', async () => {
  const unavailable = buildDealerConclusionEngine({
    thetaSnapshot: { status: 'unavailable' }
  });
  assert.equal(unavailable.status, 'unavailable');

  const partial = buildDealerConclusionEngine({
    thetaSnapshot: sampleThetaPayload({
      secret: undefined,
      status: 'partial',
      spot: null
    })
  });
  assert.equal(partial.status, 'partial');

  const live = buildDealerConclusionEngine({
    thetaSnapshot: sampleThetaPayload({ secret: undefined }),
    externalSpot: 5310
  });
  assert.equal(live.status, 'live');
  assert.equal(live.gamma_regime, 'positive');

  const mock = buildDealerConclusionEngine({
    thetaSnapshot: sampleThetaPayload({
      secret: undefined,
      status: 'mock'
    })
  });
  assert.equal(mock.status, 'mock');
  assert.equal(deriveThetaExecutionConstraint(mock).executable, false);
  assert.equal(mapThetaSnapshotToSourceStatus({ status: 'mock' }).state, 'mock');
});

test('theta dealer algorithm computes expected move and key levels or leaves them null', async () => {
  const summary = calculateThetaDealerSummary({
    status: 'live',
    spot_source: 'fmp',
    spot: 5305,
    test_expiration: '2026-04-24',
    contracts: [
      { strike: 5300, right: 'C', bid: 18, ask: 20, gamma: 0.01, open_interest: 1000, iv: 0.22, volume: 50 },
      { strike: 5300, right: 'P', bid: 17, ask: 19, gamma: 0.012, open_interest: 1200, iv: 0.25, volume: 60 },
      { strike: 5320, right: 'C', bid: 9, ask: 10, gamma: 0.02, open_interest: 1500, iv: 0.21, volume: 30 },
      { strike: 5280, right: 'P', bid: 8, ask: 9, gamma: 0.018, open_interest: 1800, iv: 0.24, volume: 35 }
    ]
  });

  assert.equal(summary.status, 'live');
  assert.equal(summary.test_expiration, '2026-04-24');
  assert.equal(typeof summary.dealer.net_gex, 'number');
  assert.equal(typeof summary.dealer.expected_move_upper, 'number');
  assert.equal(typeof summary.dealer.expected_move_lower, 'number');
  assert.equal(summary.dealer.call_wall !== null, true);
  assert.equal(summary.dealer.put_wall !== null, true);
});

test('all 7 scenarios return safe non-executable outputs and radar-supporting fields', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    for (const [scenario, expectedAction] of Object.entries(EXPECTED_ACTIONS)) {
      if (scenario === 'theta_stale_no_trade') {
        await writeThetaSnapshot(sampleThetaPayload({
          secret: undefined,
          status: 'live',
          last_update: new Date(Date.now() - 10 * 60 * 1000).toISOString()
        }));
      } else {
        await seedDefaultThetaLiveSnapshot();
      }
      const response = await fetch(`${baseUrl}/signals/current?scenario=${scenario}`);
      assert.equal(response.status, 200);
      const json = await response.json();

      assert.equal(json.scenario, scenario);
      assert.equal(json.engines.data_coherence.scenario_mode, true);
      assert.equal(json.engines.data_coherence.executable, false);
      assert.equal(['wait', 'no_trade'].includes(json.recommended_action), true);
      assert.equal(ALLOWED_MARKET_STATES.has(json.market_state), true);
      assert.equal(ALLOWED_GAMMA_REGIMES.has(json.gamma_regime), true);
      assert.equal(ALLOWED_ACTIONS.has(json.recommended_action), true);
      assert.equal(Array.isArray(json.conflict.conflict_points), true);
      assert.equal(Array.isArray(json.strategy_cards), true);
      assert.equal(json.strategy_cards.length, 5);
      assert.equal(Boolean(json.radar_summary), true);
    }
  } finally {
    server.close();
  }
});

test('strategy cards expose exactly the required five strategy names', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=breakout_pullback_pending`);
    const json = await response.json();
    const names = json.strategy_cards.map((card) => card.strategy_name);
    assert.deepEqual(names, REQUIRED_STRATEGIES);
  } finally {
    server.close();
  }
});

test('sources status exposes required source fields for footer strip', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/sources/status?scenario=uw_call_strong_unconfirmed`);
    const json = await response.json();
    assert.equal(Array.isArray(json.items), true);

    for (const item of json.items) {
      assert.equal(ALLOWED_SOURCE_STATES.has(item.state), true);
      assert.equal(typeof item.source, 'string');
      assert.equal(typeof item.configured, 'boolean');
      assert.equal(typeof item.available, 'boolean');
      assert.equal(typeof item.is_mock, 'boolean');
      assert.equal(typeof item.fetch_mode, 'string');
      assert.equal(typeof item.last_updated, 'string');
      assert.equal(typeof item.data_timestamp, 'string');
      assert.equal(typeof item.received_at, 'string');
      assert.equal(typeof item.latency_ms, 'number');
      assert.equal(typeof item.stale, 'boolean');
      assert.equal(typeof item.stale_reason, 'string');
      assert.equal(typeof item.message, 'string');
    }
  } finally {
    server.close();
  }
});

test('frontend serves only dashboard and radar routes as user-visible pages', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const dashboard = await fetch(`${baseUrl}/`);
    const radar = await fetch(`${baseUrl}/radar?scenario=breakout_pullback_pending`);
    assert.equal(dashboard.status, 200);
    assert.equal(radar.status, 200);
  } finally {
    server.close();
  }
});

test('tradingview webhook returns 401 when secret is invalid', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/webhook/tradingview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: 'wrong-secret',
        source: 'tradingview',
        symbol: 'SPX',
        timeframe: '1m',
        event_type: 'breakout_confirmed',
        price: '5300',
        trigger_time: new Date().toISOString(),
        level: '5300',
        side: 'bullish'
      })
    });

    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test('tradingview webhook returns 400 when event_type is not allowed', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/webhook/tradingview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TRADINGVIEW_WEBHOOK_SECRET,
        source: 'tradingview',
        symbol: 'SPX',
        timeframe: '1m',
        event_type: 'random_event',
        price: '5300',
        trigger_time: new Date().toISOString(),
        level: '5300',
        side: 'bullish'
      })
    });

    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('tradingview webhook returns 202 and updates snapshot on accepted event', async () => {
  await resetTvStateEnv();
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const triggerTime = new Date().toISOString();
    const webhookResponse = await fetch(`${baseUrl}/webhook/tradingview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TRADINGVIEW_WEBHOOK_SECRET,
        source: 'tradingview',
        symbol: 'SPX',
        timeframe: '1m',
        event_type: 'breakout_confirmed',
        price: '5300',
        trigger_time: triggerTime,
        level: '5300',
        side: 'bullish'
      })
    });

    assert.equal(webhookResponse.status, 202);

    const signalResponse = await fetch(`${baseUrl}/signals/current`);
    const signalJson = await signalResponse.json();
    assert.equal(signalJson.tv_structure_event, 'breakout_confirmed_pullback_ready');
    assert.equal(signalJson.last_updated.tradingview, triggerTime);
    assert.equal(signalJson.signals.price_confirmation, 'confirmed');
    assert.match(signalJson.plain_language.market_status, /TradingView|价格|回踩|突破|结构/);
    assert.equal(
      signalJson.notes.some((note) => note.includes('最近 TV 事件：breakout_confirmed。')),
      true
    );
  } finally {
    server.close();
  }
});

test('TradingView snapshot persists in file mode across store reset and is still readable', async () => {
  const filePath = path.join(os.tmpdir(), `tv-snapshot-${Date.now()}.json`);
  await resetTvStateEnv({
    STATE_STORE: 'file',
    TV_SNAPSHOT_FILE: filePath,
    TV_SNAPSHOT_TTL_SECONDS: '21600',
    TV_SNAPSHOT_STALE_SECONDS: '900'
  });
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();

  const { server, baseUrl } = await startServer();

  try {
    const triggerTime = new Date().toISOString();
    const webhookResponse = await fetch(`${baseUrl}/webhook/tradingview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TRADINGVIEW_WEBHOOK_SECRET,
        source: 'tradingview',
        symbol: 'SPX',
        timeframe: '3m',
        event_type: 'breakdown_confirmed',
        price: 5291.5,
        trigger_time: triggerTime,
        invalidation_level: 5305.25,
        side: 'bearish'
      })
    });

    assert.equal(webhookResponse.status, 202);

    const firstSignal = await fetch(`${baseUrl}/signals/current`);
    const firstJson = await firstSignal.json();
    assert.equal(firstJson.tv_structure_event, 'breakdown_confirmed');
    assert.equal(firstJson.signals.tv_signal, 'short_breakdown_watch');
    assert.equal(firstJson.signals.price_confirmation, 'confirmed');

    const tradingviewStatus = firstJson.source_status.find((item) => item.source === 'tradingview');
    assert.ok(tradingviewStatus);
    assert.equal(tradingviewStatus.state, 'real');
    assert.equal(tradingviewStatus.stale, false);

    await resetTvSnapshotStoreForTests();

    const secondSignal = await fetch(`${baseUrl}/signals/current`);
    const secondJson = await secondSignal.json();
    assert.equal(secondJson.tv_structure_event, 'breakdown_confirmed');
    assert.equal(secondJson.signals.tv_signal, 'short_breakdown_watch');
    assert.equal(secondJson.signals.price_confirmation, 'confirmed');
    assert.equal(
      secondJson.notes.some((note) => note.includes('最近 TV 事件：breakdown_confirmed。')),
      true
    );
  } finally {
    server.close();
  }
});

test('stale TradingView snapshot remains visible but is marked stale in source status', async () => {
  const filePath = path.join(os.tmpdir(), `tv-snapshot-stale-${Date.now()}.json`);
  await resetTvStateEnv({
    STATE_STORE: 'file',
    TV_SNAPSHOT_FILE: filePath,
    TV_SNAPSHOT_TTL_SECONDS: '21600',
    TV_SNAPSHOT_STALE_SECONDS: '900'
  });
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();

  const { server, baseUrl } = await startServer();

  try {
    const staleTriggerTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const webhookResponse = await fetch(`${baseUrl}/webhook/tradingview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TRADINGVIEW_WEBHOOK_SECRET,
        source: 'tradingview',
        symbol: 'SPX',
        timeframe: '1m',
        event_type: 'pullback_holding',
        price: 5310,
        trigger_time: staleTriggerTime,
        invalidation_level: 5298,
        side: 'bullish'
      })
    });

    assert.equal(webhookResponse.status, 202);

    const signalResponse = await fetch(`${baseUrl}/signals/current`);
    const signalJson = await signalResponse.json();

    assert.equal(signalJson.tv_structure_event, 'breakout_confirmed_pullback_ready');
    assert.equal(signalJson.signals.tv_signal, 'B_long_candidate');

    const tradingviewStatus = signalJson.source_status.find((item) => item.source === 'tradingview');
    assert.ok(tradingviewStatus);
    assert.equal(tradingviewStatus.stale, true);
    assert.equal(tradingviewStatus.state, 'delayed');
    assert.match(tradingviewStatus.message, /stale|陈旧|最近一次 TV 事件/i);
    assert.equal(
      signalJson.notes.some((note) => note.includes('最近 TV 事件：pullback_holding。')),
      true
    );
  } finally {
    server.close();
  }
});

test('health endpoint still exposes all seven scenarios', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/health`);
    const json = await response.json();
    assert.equal(json.mode, 'mock-master-engine');
    assert.equal(Array.isArray(json.available_scenarios), true);
    assert.equal(json.available_scenarios.length, 7);
  } finally {
    server.close();
  }
});

test('FMP high-risk event updates event_context and keeps source_status.fmp real', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('positive_gamma_income_watch', {
    fmp: {
      event: {
        now: new Date('2026-04-24T12:00:00.000Z'),
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return [
              {
                date: '2026-04-24T13:30:00.000Z',
                country: 'US',
                event: 'Non-Farm Payrolls',
                impact: 'High'
              }
            ];
          }
        })
      }
    }
  });

  assert.equal(signal.event_context.event_risk, 'high');
  assert.match(signal.event_context.event_note, /FMP 检测到/);
  assert.equal(signal.recommended_action, 'wait');

  const fmpStatus = signal.source_status.find((item) => item.source === 'fmp_event');
  assert.ok(fmpStatus);
  assert.equal(fmpStatus.is_mock, false);
  assert.equal(fmpStatus.state, 'real');
  assert.equal(fmpStatus.fetch_mode, 'low_frequency_poll');

  delete process.env.FMP_API_KEY;
});

test('FMP fallback preserves schema but marks source_status.fmp degraded mock', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('breakout_pullback_pending', {
    fmp: {
      event: {
        fetchImpl: async () => {
          throw new Error('network unavailable');
        }
      }
    }
  });

  assert.equal(signal.schema_version, '0.4.0');
  assert.equal(signal.event_context.event_risk, 'medium');
  assert.equal(signal.event_context.event_note, 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。');
  assert.equal(signal.event_context.no_short_vol_window, true);
  assert.equal(signal.event_context.trade_permission_adjustment, 'downgrade');

  const fmpStatus = signal.source_status.find((item) => item.source === 'fmp_event');
  assert.ok(fmpStatus);
  assert.equal(fmpStatus.is_mock, true);
  assert.equal(fmpStatus.state, 'degraded');
  assert.equal(fmpStatus.configured, true);
  assert.equal(fmpStatus.message, 'FMP 数据异常，事件风险不可确认。');

  delete process.env.FMP_API_KEY;
});

test('FMP stale forces medium event risk and stale source status semantics', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('breakout_pullback_pending', {
    fmp: {
      event: {
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return [];
          }
        }),
        now: new Date('2026-04-24T14:00:00.000Z'),
        receivedAt: '2026-04-24T14:00:00.000Z',
        forceLastUpdated: '2026-04-24T13:45:00.000Z'
      }
    }
  });

  assert.equal(signal.event_context.event_risk, 'medium');
  assert.equal(signal.event_context.event_note, 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。');
  assert.equal(signal.event_context.no_short_vol_window, true);
  assert.equal(signal.event_context.trade_permission_adjustment, 'downgrade');

  const fmpStatus = signal.source_status.find((item) => item.source === 'fmp_event');
  assert.ok(fmpStatus);
  assert.equal(fmpStatus.state, 'delayed');
  assert.equal(fmpStatus.stale, true);
  assert.equal(fmpStatus.message, 'FMP 数据异常，事件风险不可确认。');

  delete process.env.FMP_API_KEY;
});

test('FMP price success provides real SPX price in live fallback mode', async () => {
  await resetThetaStateEnv();
  await resetTvStateEnv();
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal(undefined, {
    fmp: {
      event: {
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return [];
          }
        })
      },
      price: {
        quoteShortFetchImpl: async () => ({
          ok: true,
          async json() {
            return [
              {
                symbol: '^GSPC',
                price: 5342.25
              }
            ];
          }
        }),
        quoteFetchImpl: async () => {
          throw new Error('should not reach quote fallback');
        },
        historicalFetchImpl: async () => {
          throw new Error('should not reach historical fallback');
        }
      }
    }
  });

  assert.equal(signal.market_snapshot.spot, 5342.25);
  assert.equal(signal.market_snapshot.spot_source, 'fmp');
  assert.equal(signal.market_snapshot.spot_is_real, true);
  assert.equal(typeof signal.market_snapshot.spot_last_updated, 'string');
  assert.equal(signal.command_inputs.external_spot.source, 'fmp');
  assert.equal(signal.command_inputs.external_spot.spot, 5342.25);
  assert.equal(signal.command_inputs.external_spot.is_real, true);
  assert.equal(signal.command_inputs.external_spot.status, 'real');
  assert.equal(typeof signal.command_inputs.external_spot.last_updated, 'string');

  const fmpPriceStatus = signal.source_status.find((item) => item.source === 'fmp_price');
  assert.ok(fmpPriceStatus);
  assert.equal(fmpPriceStatus.state, 'real');
  assert.equal(fmpPriceStatus.is_mock, false);
  assert.equal(fmpPriceStatus.stale, false);
  assert.equal(fmpPriceStatus.message, 'FMP SPX price real');

  delete process.env.FMP_API_KEY;
});

test('FMP price failure leaves spot unavailable in live fallback mode', async () => {
  await resetThetaStateEnv();
  await resetTvStateEnv();
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal(undefined, {
    fmp: {
      event: {
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return [];
          }
        })
      },
      price: {
        quoteShortFetchImpl: async () => {
          throw new Error('price unavailable');
        },
        quoteFetchImpl: async () => {
          throw new Error('price unavailable');
        },
        historicalFetchImpl: async () => {
          throw new Error('price unavailable');
        }
      }
    }
  });

  assert.equal(signal.market_snapshot.spot, null);
  assert.equal(signal.market_snapshot.spot_is_real, false);
  assert.equal(signal.market_snapshot.spot_source, 'fmp');
  assert.equal(signal.command_inputs.external_spot.source, 'unavailable');
  assert.equal(signal.command_inputs.external_spot.spot, null);
  assert.equal(signal.command_inputs.external_spot.is_real, false);
  assert.equal(signal.command_inputs.external_spot.status, 'unavailable');

  const fmpPriceStatus = signal.source_status.find((item) => item.source === 'fmp_price');
  assert.ok(fmpPriceStatus);
  assert.equal(['degraded', 'down'].includes(fmpPriceStatus.state), true);
  assert.equal(fmpPriceStatus.message, 'FMP SPX price unavailable');

  delete process.env.FMP_API_KEY;
});

test('buildAlertMessage renders Chinese premarket warning for FMP risk gate', async () => {
  await resetUwApiStateEnv();
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('positive_gamma_income_watch', {
    fmp: {
      event: {
        now: new Date('2026-04-24T08:00:00.000Z'),
        receivedAt: '2026-04-24T08:00:00.000Z',
        forceLastUpdated: '2026-04-24T08:00:00.000Z',
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return [
              {
                date: '2026-04-24T10:00:00.000Z',
                country: 'US',
                event: 'CPI',
                impact: 'High'
              }
            ];
          }
        })
      }
    }
  });

  const message = buildAlertMessage({
    signal,
    body: { session: 'premarket' }
  });

  assert.match(message, /【SPX 指挥台｜/);
  assert.match(message, /状态：/);
  assert.match(message, /动作：/);
  assert.match(message, /原因：/);
  assert.match(message, /策略：/);

  delete process.env.FMP_API_KEY;
});

test('buildAlertMessage renders Chinese intraday reminder from live current signal', async () => {
  await resetUwApiStateEnv();
  delete process.env.FMP_API_KEY;
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const signal = await getCurrentSignal(undefined);
  const message = buildAlertMessage({
    signal,
    body: { session: 'intraday' }
  });

  assert.match(message, /【SPX 指挥台｜/);
  assert.match(message, /状态：/);
  assert.match(message, /动作：/);
  assert.match(message, /原因：/);
  assert.match(message, /失效条件：/);
  assert.match(message, /策略：/);
  assert.match(message, /数据：/);
});

test('buildAlertMessage renders dedicated Chinese FMP exception warning', async () => {
  await resetUwApiStateEnv();
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('breakout_pullback_pending', {
    fmp: {
      event: {
        fetchImpl: async () => {
          throw new Error('network unavailable');
        }
      }
    }
  });

  const message = buildAlertMessage({
    signal,
    body: { session: 'intraday' }
  });

  assert.match(message, /【SPX 指挥台｜/);
  assert.match(message, /状态：/);
  assert.match(message, /动作：/);
  assert.match(message, /原因：/);
  assert.match(message, /策略：/);

  delete process.env.FMP_API_KEY;
});

test('live mode keeps non-scenario safety semantics while TV sentinel still blocks execution', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const signal = await getCurrentSignal(undefined);

  assert.equal(signal.engines.data_coherence.scenario_mode, false);
  assert.equal(typeof signal.engines.command_environment.allowed, 'boolean');
  assert.equal(typeof signal.engines.allowed_setups.single_leg.allowed, 'boolean');
  assert.equal(typeof signal.engines.allowed_setups.vertical.allowed, 'boolean');
  assert.equal(signal.engines.tv_sentinel.triggered, false);
  assert.equal(signal.engines.trade_plan.triggered_by_tv, false);
});

test('live mode TV sentinel remains gated by command environment safety', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  await resetTvStateEnv();
  const triggerTime = new Date().toISOString();
  await updateTradingViewSnapshot({
    source: 'tradingview',
    symbol: 'SPX',
    timeframe: '1m',
    event_type: 'breakout_confirmed',
    price: 5310,
    trigger_time: triggerTime,
    level: 5298,
    side: 'bullish'
  });
  const signal = await getCurrentSignal(undefined);

  assert.equal(signal.engines.data_coherence.scenario_mode, false);
  assert.equal(signal.engines.tv_sentinel.triggered, true);
  assert.equal(signal.engines.tv_sentinel.direction, 'bullish');
  assert.equal(['blocked', 'waiting', 'ready'].includes(signal.engines.trade_plan.status), true);
  assert.equal(['wait', 'long_on_pullback', 'no_trade'].includes(signal.recommended_action), true);
});

test('UW API provider handles missing key 401 429 partial live and stale states', async () => {
  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api' });
  let snapshot = await fetchUwApiSnapshot({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(snapshot.provider.status, 'unavailable');
  assert.equal(snapshot.provider.mode, 'unavailable');

  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api', UW_API_KEY: 'bad-key' });
  snapshot = await fetchUwApiSnapshot({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      async json() { return { error: 'unauthorized' }; }
    })
  });
  assert.equal(snapshot.provider.status, 'error');
  assert.equal(snapshot.provider.endpoints_failed.every((item) => item.status === 'unauthorized' && item.http_status === 401), true);

  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api', UW_API_KEY: 'rate-limited' });
  snapshot = await fetchUwApiSnapshot({
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
      async json() { return { error: 'rate_limit' }; }
    })
  });
  assert.equal(snapshot.provider.status, 'error');
  assert.equal(snapshot.provider.endpoints_failed.every((item) => item.http_status === 429), true);
  assert.equal(snapshot.provider.rate_limit.remaining, 0);

  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api', UW_API_KEY: 'partial-key' });
  snapshot = await fetchUwApiSnapshot({
    fetchImpl: async (url) => {
      const ok = String(url).includes('/greek-exposure');
      return {
        ok,
        status: ok ? 200 : 500,
        statusText: ok ? 'OK' : 'Error',
        headers: new Headers(),
        async json() { return ok ? { data: [{ gex: 10, dex: 3 }] } : { error: 'failed' }; }
      };
    }
  });
  assert.equal(snapshot.provider.status, 'partial');
  assert.equal(snapshot.provider.endpoints_ok.includes('greek_exposure'), true);

  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api', UW_API_KEY: 'live-key' });
  snapshot = await fetchUwApiSnapshot({ fetchImpl: async (url) => uwApiResponseForUrl(String(url)) });
  assert.equal(snapshot.provider.status, 'live');
  assert.equal(snapshot.provider.endpoints_ok.includes('greek_exposure'), true);
  assert.equal(snapshot.provider.endpoints_ok.includes('spot_gex'), true);
  assert.equal(snapshot.provider.endpoints_ok.includes('options_flow'), true);
  assert.equal(snapshot.endpoint_coverage.dealer_gex.required.length > 0, true);
  assert.equal(snapshot.endpoint_coverage.flow.required.length > 0, true);
  assert.equal(snapshot.endpoint_coverage.darkpool.required.length > 0, true);
  assert.equal(snapshot.endpoint_coverage.sentiment.required.length > 0, true);
  assert.equal(snapshot.endpoint_coverage.volatility.required.length > 0, true);
  assert.equal(snapshot.endpoint_coverage.technical.required.length > 0, true);

  await writeUwApiSnapshot({
    ...snapshot,
    last_update: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    provider: {
      ...snapshot.provider,
      last_update: new Date(Date.now() - 10 * 60 * 1000).toISOString()
    }
  });
  const staleSignal = await getCurrentSignal(undefined);
  assert.equal(staleSignal.uw_provider.status, 'live');
  assert.equal(staleSignal.uw_provider.endpoints_ok.length > 0, true);
});

test('UW intelligence layer feeds command center permissions reflection and telegram', async () => {
  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api', UW_API_KEY: 'live-key', UW_STALE_SECONDS: '300' });
  await resetThetaStateEnv();
  await resetTvStateEnv();
  await seedDefaultThetaLiveSnapshot();
  await fetchUwApiSnapshot({ fetchImpl: async (url) => uwApiResponseForUrl(String(url)) });

  let signal = await getCurrentSignal(undefined);
  assert.equal(signal.uw_provider.status, 'live');
  assert.equal(signal.uw_endpoint_coverage.dealer_gex.required.length > 0, true);
  assert.equal(signal.uw_endpoint_coverage.flow.required.length > 0, true);
  assert.equal(Boolean(signal.health_matrix.state), true);
  assert.equal(Boolean(signal.flow_validation.action), true);
  assert.equal(Boolean(signal.technical_engine.trend_bias), true);
  assert.equal(Array.isArray(signal.allowed_setups), true);
  assert.equal(Array.isArray(signal.allowed_setups_reason), true);
  assert.equal(Array.isArray(signal.blocked_setups_reason), true);
  assert.equal(Boolean(signal.position_sizing_engine.plain_chinese), true);
  assert.equal(Boolean(signal.cross_asset_projection), true);
  assert.equal(signal.cross_asset_projection.status, 'partial');
  assert.equal(signal.cross_asset_projection.spx_levels.call_wall, 5340);
  assert.equal(signal.cross_asset_projection.es_equivalent_levels.call_wall, null);
  assert.equal(signal.tv_sentinel.status, 'waiting');
  assert.equal(signal.command_center.final_state !== 'actionable', true);
  assert.equal(signal.strategy_permissions.iron_condor.permission, 'block');
  assert.equal(signal.institutional_alert.state, 'building');
  assert.equal(signal.volatility_activation.light, 'green');
  assert.equal(signal.dealer_engine.status, 'live');
  assert.equal(['support', 'neutral'].includes(signal.darkpool_summary.bias), true);
  assert.equal(signal.market_sentiment.state, 'risk_on');
  assert.equal(Array.isArray(signal.reflection.why_this_conclusion), true);
  assert.equal(hasUndefined(signal), false);
  assert.equal(signal.uw_provider.is_mock, false);

  await updateTradingViewSnapshot({
    source: 'tradingview',
    symbol: 'SPX',
    timeframe: '1m',
    event_type: 'pullback_holding',
    price: 5310,
    external_spot: 5310,
    trigger_time: new Date().toISOString(),
    level: 5298,
    side: 'bullish',
    spy_price: 531,
    spy_last_updated: new Date().toISOString(),
    es_price: 5320,
    es_last_updated: new Date().toISOString()
  });
  signal = await getCurrentSignal(undefined);
  assert.equal(['live', 'partial'].includes(signal.cross_asset_projection.status), true);
  assert.equal(signal.cross_asset_projection.spy_equivalent_levels.call_wall, 534);
  assert.equal(signal.cross_asset_projection.es_equivalent_levels.call_wall, 5350.06);
  assert.match(signal.command_center.plain_chinese, /Zero Gamma|ES/);
  assert.match(signal.reflection.supporting_evidence.join(' '), /Zero Gamma|ES/);
  assert.match(buildAlertMessage({ signal }), /关键位：SPX Zero Gamma .* → ES/);

  await updateTradingViewSnapshot({
    source: 'tradingview',
    symbol: 'SPX',
    timeframe: '1m',
    event_type: 'breakout_confirmed',
    price: 5310,
    trigger_time: new Date().toISOString(),
    level: 5298,
    side: 'bullish'
  });
  signal = await getCurrentSignal(undefined);
  assert.equal(signal.tv_sentinel.triggered, true);
  assert.equal(signal.strategy_permissions.iron_condor.permission, 'block');
  assert.equal(['wait', 'block', 'allow'].includes(signal.strategy_permissions.single_leg.permission), true);

  await resetThetaStateEnv();
  signal = await getCurrentSignal(undefined);
  assert.match(signal.command_center.plain_chinese, /Theta unavailable|Dealer 主结论降级|禁做|等确认/);

  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  await resetTvStateEnv();
  await updateTradingViewSnapshot({
    source: 'tradingview',
    symbol: 'SPX',
    timeframe: '1m',
    event_type: 'breakdown_confirmed',
    price: 5310,
    trigger_time: new Date().toISOString(),
    level: 5298,
    side: 'bearish'
  });
  signal = await getCurrentSignal(undefined);
  assert.equal(signal.flow_price_divergence.action, 'wait');
  assert.equal(signal.command_center.final_state !== 'actionable', true);

  const message = buildAlertMessage({ signal });
  assert.match(message, /状态：/);
  assert.match(message, /动作：/);
  assert.match(message, /策略：/);
  assert.match(message, /入场：/);
  assert.match(message, /止损：/);
  assert.match(message, /目标：/);
  assert.match(message, /作废：/);
  assert.match(message, /仓位：/);
  assert.match(message, /数据：/);
  assert.doesNotMatch(message, /mock|假 flip|假价格|验证 webhook|先看 \/signals\/current/i);
});

test('cross asset projection maps SPX levels to SPY and ES and feeds outputs', async () => {
  await resetUwApiStateEnv({ UW_PROVIDER_MODE: 'api', UW_API_KEY: 'live-key', UW_STALE_SECONDS: '300' });
  await resetThetaStateEnv();
  await resetTvStateEnv();
  process.env.TARGET_INSTRUMENT = 'ES';
  await seedDefaultThetaLiveSnapshot();
  await fetchUwApiSnapshot({ fetchImpl: async (url) => uwApiResponseForUrl(String(url)) });
  await updateTradingViewSnapshot({
    source: 'tradingview',
    symbol: 'SPX',
    timeframe: '1m',
    event_type: 'pullback_holding',
    price: 5310,
    external_spot: 5310,
    spy_last_updated: new Date().toISOString(),
    es_last_updated: new Date().toISOString(),
    es_price: 5305,
    spy_price: 530,
    trigger_time: new Date().toISOString(),
    level: 5298,
    side: 'bullish'
  });

  const signal = await getCurrentSignal(undefined);
  assert.equal(signal.cross_asset_projection.status, 'live');
  assert.equal(signal.cross_asset_projection.spx_levels.call_wall, 5340);
  assert.equal(Number.isFinite(signal.cross_asset_projection.spy_equivalent_levels.call_wall), true);
  assert.equal(Number.isFinite(signal.cross_asset_projection.es_equivalent_levels.call_wall), true);
  assert.equal(Array.isArray(signal.cross_asset_projection.gex_pivots_projected), true);
  assert.equal(signal.trade_plan.target_instrument, 'ES');
  assert.match(signal.trade_plan.entry_zone.text, /ES/);
  assert.match(signal.command_center.plain_chinese, /Zero Gamma|ES/);
  assert.equal(signal.reflection.supporting_evidence.some((item) => /Zero Gamma|ES|SPY/.test(item)), true);
  const message = buildAlertMessage({ signal });
  assert.match(message, /关键位：/);
  assert.match(message, /ES/);
  assert.equal(hasUndefined(signal), false);

  await resetTvStateEnv();
  await updateTradingViewSnapshot({
    source: 'tradingview',
    symbol: 'SPX',
    timeframe: '1m',
    event_type: 'pullback_holding',
    price: 5310,
    trigger_time: new Date().toISOString(),
    level: 5298,
    side: 'bullish'
  });
  const partial = await getCurrentSignal(undefined);
  assert.equal(partial.cross_asset_projection.status, 'partial');
  assert.equal(partial.cross_asset_projection.es_equivalent_levels.call_wall, null);
  assert.doesNotMatch(partial.trade_plan.entry_zone.text, /^ES 回踩 \d/);

  await writeUwApiSnapshot({
    source: 'unusual_whales_api',
    last_update: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: 'live',
    provider: {
      mode: 'api',
      status: 'live',
      last_update: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      endpoints_ok: ['greek_exposure'],
      endpoints_failed: [],
      endpoint_coverage: {},
      is_mock: false,
      rate_limit: { daily_limit: null, per_minute_limit: null, remaining: null }
    },
    raw: {},
    normalized: null
  });
  const stale = await getCurrentSignal(undefined);
  assert.equal(['stale', 'partial'].includes(stale.cross_asset_projection.status), true);
  delete process.env.TARGET_INSTRUMENT;
});

test('coherence guard marks distant real spot vs gamma map as conflict and blocks targets', async () => {
  await resetThetaStateEnv();
  await writeThetaSnapshot(sampleThetaPayload({
    secret: undefined,
    spot_source: 'fmp',
    spot: 7165.08,
    dealer: {
      ...sampleThetaPayload().dealer,
      gamma_regime: 'negative',
      call_wall: 5320,
      put_wall: 5225,
      max_pain: 5275
    }
  }));

  const signal = await getCurrentSignal(undefined, {
    fmp: {
      event: {
        fetchImpl: async () => ({ ok: true, async json() { return []; } })
      },
      price: {
        quoteShortFetchImpl: async () => ({
          ok: true,
          async json() {
            return [{ symbol: '^GSPC', price: 7165.08 }];
          }
        }),
        quoteFetchImpl: async () => ({ ok: true, async json() { return []; } }),
        historicalFetchImpl: async () => ({ ok: true, async json() { return []; } })
      }
    }
  });

  assert.equal(signal.engines.data_coherence.data_mode, 'conflict');
  assert.equal(signal.engines.data_coherence.executable, false);
  assert.equal(signal.engines.data_coherence.trade_permission, 'no_trade');
  assert.equal(signal.command_inputs.external_spot.source, 'fmp');
  assert.equal(signal.command_inputs.external_spot.spot, 7165.08);
  assert.equal(signal.command_inputs.external_spot.is_real, true);
  assert.equal(signal.engines.trade_plan.entry_zone.text, '--');
  assert.equal(signal.engines.trade_plan.target_text, '--');
  assert.equal(signal.engines.trade_plan.invalidation_text, '--');
  assert.equal(signal.engines.trade_plan.stop_loss.text, '--');
  assert.equal(signal.engines.trade_plan.targets.every((item) => item.level == null), true);
  assert.equal(['--', '等待指挥部允许'].includes(signal.engines.trade_plan.invalidation.text), true);
  for (const card of signal.strategy_cards.filter((item) => ['单腿', '看涨价差', '看跌价差', '铁鹰'].includes(item.strategy_name))) {
    assert.equal(card.entry_condition, '--');
    assert.equal(card.target_zone, '--');
    assert.equal(card.invalidation, '--');
  }
});

test('coherence guard marks scenario mixed with real fmp price as mixed and clamps confidence', () => {
  const coherence = evaluateDataCoherence({
    scenario: 'breakout_pullback_pending',
    fetch_mode: 'mock_scenario',
    is_mock: true,
    scenario_mode: true,
    external_spot: 7165.08,
    external_spot_source: 'fmp',
    market_snapshot: {
      spot: 5318,
      spot_source: 'scenario',
      spot_is_real: false
    },
    dealer_conclusion: {
      status: 'mock',
      call_wall: 5342,
      put_wall: 5280,
      max_pain: 5310,
      expected_move_upper: 5348,
      expected_move_lower: 5272
    },
    theta: { status: 'mock' }
  });

  assert.equal(coherence.scenario_mode, true);
  assert.equal(['mixed', 'conflict'].includes(coherence.data_mode), true);
  assert.equal(coherence.executable, false);
  assert.equal(coherence.trade_permission, 'no_trade');
  assert.equal(coherence.confidence_cap <= 20, true);
});

test('scenario/mock trade plan remains fully blank-safe', async () => {
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const signal = await getCurrentSignal('negative_gamma_wait_pullback');

  assert.equal(signal.engines.data_coherence.scenario_mode, true);
  assert.equal(signal.trade_plan.entry_zone.text, '--');
  assert.equal(signal.trade_plan.target_text, '--');
  assert.equal(signal.trade_plan.invalidation_text, '--');
  assert.equal(signal.trade_plan.stop_loss.text, '--');
  assert.equal(signal.trade_plan.targets.every((item) => item.action === '--'), true);
  assert.equal(JSON.stringify(signal.trade_plan).includes('flip 5285'), false);
  assert.equal(JSON.stringify(signal.trade_plan).includes('5320'), false);
  assert.equal(JSON.stringify(signal.trade_plan).includes('5275'), false);
});

test('coherence guard blocks mock dealer plus real spot', () => {
  const coherence = evaluateDataCoherence({
    scenario: 'negative_gamma_wait_pullback',
    fetch_mode: 'mock_scenario',
    is_mock: true,
    market_snapshot: {
      spot: 7165.08,
      spot_source: 'fmp',
      spot_is_real: true
    },
    dealer_conclusion: {
      status: 'mock',
      call_wall: 5320,
      put_wall: 5225,
      max_pain: 5275,
      expected_move_upper: 5348,
      expected_move_lower: 5272
    },
    theta: { status: 'mock' }
  });

  assert.equal(coherence.data_mode, 'mixed');
  assert.equal(coherence.executable, false);
  assert.equal(coherence.trade_permission, 'no_trade');
});

test('coherent live theta data can remain executable', async () => {
  await resetThetaStateEnv();
  await writeThetaSnapshot(sampleThetaPayload({
    secret: undefined,
    spot_source: 'fmp',
    spot: 5310
  }));

  const signal = await getCurrentSignal(undefined, {
    fmp: {
      event: {
        fetchImpl: async () => ({ ok: true, async json() { return []; } })
      },
      price: {
        quoteShortFetchImpl: async () => ({
          ok: true,
          async json() {
            return [{ symbol: '^GSPC', price: 5310 }];
          }
        }),
        quoteFetchImpl: async () => ({ ok: true, async json() { return []; } }),
        historicalFetchImpl: async () => ({ ok: true, async json() { return []; } })
      }
    }
  });

  assert.equal(signal.engines.data_coherence.data_mode, 'live');
  assert.equal(signal.engines.data_coherence.executable, true);
});



test('live fallback with theta partial and uw unavailable hides mock projections', async () => {
  await resetUwApiStateEnv();
  await resetThetaStateEnv();
  await resetTvStateEnv();
  process.env.FMP_API_KEY = 'test-key';
  await writeThetaSnapshot(sampleThetaPayload({
    secret: undefined,
    source: 'thetadata_python',
    status: 'partial',
    spot_source: 'manual_test',
    spot: 7165.08,
    dealer: {
      net_gex: null,
      gamma_regime: 'unknown',
      dealer_behavior: 'unknown',
      least_resistance_path: 'unknown',
      call_wall: 7250,
      put_wall: 5650,
      max_pain: 7025,
      zero_gamma: null,
      expected_move_upper: 7204.13,
      expected_move_lower: 7126.03
    },
    quality: {
      data_quality: 'partial',
      missing_fields: ['gamma', 'net_gex', 'zero_gamma'],
      warnings: ['walls_from_oi_fallback'],
      calculation_scope: 'single_expiry_test',
      raw_rows_sent: false
    }
  }));

  const signal = await getCurrentSignal(undefined, {
    fmp: {
      event: {
        fetchImpl: async () => ({ ok: true, async json() { return []; } })
      },
      price: {
        quoteShortFetchImpl: async () => ({
          ok: true,
          async json() {
            return [{ symbol: '^GSPC', price: 7165.08 }];
          }
        }),
        quoteFetchImpl: async () => ({ ok: true, async json() { return []; } }),
        historicalFetchImpl: async () => ({ ok: true, async json() { return []; } })
      }
    }
  });

  assert.equal(signal.theta.status, 'partial');
  assert.equal(signal.dealer_conclusion.status, 'partial');
  assert.equal(signal.dealer_conclusion.zero_gamma, null);
  assert.equal(signal.execution_constraints.theta.executable, false);
  assert.equal(signal.command_inputs.external_spot.source, 'fmp');
  assert.equal(signal.command_inputs.external_spot.status, 'real');
  assert.equal(signal.command_inputs.external_spot.spot, 7165.08);
  assert.equal(signal.market_snapshot.flip_level, null);
  assert.equal(signal.market_snapshot.call_wall, null);
  assert.equal(signal.market_snapshot.put_wall, null);
  assert.equal(signal.market_snapshot.max_pain, null);
  assert.equal(signal.uw_conclusion.status, 'unavailable');
  assert.equal(signal.uw_context.flow_bias, 'unavailable');
  assert.equal(signal.uw_context.dark_pool_bias, 'unavailable');
  assert.equal(signal.uw_context.dealer_bias, 'unavailable');
  assert.equal(signal.volume_pressure.status, 'unavailable');
  assert.equal(signal.channel_shape.status, 'unavailable');
  assert.equal(signal.volatility_activation.state, 'inactive');
  assert.equal(signal.market_sentiment.state, 'unavailable');
  assert.equal(signal.institutional_entry_alert.status, 'unavailable');
  assert.equal(signal.uw_dealer_greeks.status, 'unavailable');
  assert.equal(signal.dealer_path.status, 'partial');
  assert.equal(signal.dealer_path.path, 'unknown');
  assert.equal(signal.data_sources.summary.health, 'red');
  assert.equal(signal.data_sources.summary.label, 'BLOCKED');
  assert.equal(signal.degradation.state, 'BLOCKED');
  assert.equal(signal.flow_price_divergence.action, 'wait');
  assert.equal(signal.trade_plan.position_sizing, '0仓');
  assert.equal(Array.isArray(signal.trade_plan.wait_conditions), true);
  assert.equal(signal.trade_plan.wait_conditions.length > 0, true);
  assert.equal(signal.trade_plan.ttl_minutes ?? null, null);
  assert.equal(signal.trade_plan.expired ?? false, false);
  assert.equal(signal.tv_sentinel.status, 'waiting');
  assert.equal(Array.isArray(signal.tv_sentinel.waiting_for || []), true);
  assert.equal(signal.tv_sentinel.expired ?? false, false);
  assert.equal(signal.command_environment.state, 'blocked');
  assert.match(signal.command_environment.reason, /ThetaData dealer partial|价格地图冲突/);
  assert.equal(signal.conflict_resolver.has_conflict, true);
  assert.equal(signal.conflict_resolver.action, 'block');
  assert.deepEqual(signal.conflict_resolver.conflicts, ['price_map_conflict']);
  assert.equal(signal.projection.one_line_instruction, '禁做 / 等确认');
  assert.match(signal.projection.s_level_summary, /【数据状态】/);
  assert.match(signal.projection.s_level_summary, /【交互判断】/);
  assert.match(signal.projection.s_level_summary, /【结论】/);
  assert.match(signal.projection.s_level_summary, /UW：unavailable/);
  assert.equal(signal.trade_plan.stop_loss.text, '--');
  assert.equal(JSON.stringify(signal).includes('flip 5285'), false);
  assert.equal(JSON.stringify(signal.market_snapshot).includes('5320'), false);
  assert.equal(JSON.stringify(signal.market_snapshot).includes('5225'), false);
  assert.equal(JSON.stringify(signal.market_snapshot).includes('5275'), false);
  delete process.env.FMP_API_KEY;
});

test('local env loader prefers Downloads bridge env over script env', async () => {
  const tmpDir = path.join(os.tmpdir(), `local-env-${Date.now()}`);
  const downloadsBridgeDir = path.join(tmpDir, 'Downloads', 'bridge');
  const scriptDir = path.join(tmpDir, 'scripts');
  await fs.mkdir(downloadsBridgeDir, { recursive: true });
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(path.join(downloadsBridgeDir, '.env'), 'CLOUD_URL=https://preferred.example\nDATA_PUSH_API_KEY=aaa\n');
  await fs.writeFile(path.join(scriptDir, '.env'), 'CLOUD_URL=https://fallback.example\nDATA_PUSH_API_KEY=bbb\n');

  const { loadLocalEnv } = await import('../../../scripts/local-env.mjs');
  const loaded = await loadLocalEnv({
    cwd: scriptDir,
    windowsDownloadsBridgeEnvPath: path.join(downloadsBridgeDir, '.env'),
    scriptEnvPath: path.join(scriptDir, '.env')
  });

  assert.equal(loaded.env_file_used, path.join(downloadsBridgeDir, '.env'));
  assert.equal(loaded.values.CLOUD_URL, 'https://preferred.example');
});
