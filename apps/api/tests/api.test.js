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
const { clearTradingViewSnapshot } = await import('../storage/tradingview-snapshot.js');
const {
  clearThetaSnapshot,
  describeThetaSnapshotStore,
  getThetaSnapshot,
  resetThetaSnapshotStoreForTests,
  writeThetaSnapshot
} = await import('../storage/theta-snapshot.js');
const {
  readUwSnapshot,
  writeUwSnapshot,
  clearUwSnapshot,
  resetUwSnapshotStoreForTests
} = await import('../state/uwSnapshotStore.js');
const { getCurrentSignal } = await import('../decision_engine/current-signal.js');
const { buildAlertMessage } = await import('../alerts/build-alert-message.js');
const { resetTvSnapshotStoreForTests } = await import('../state/tvSnapshotStore.js');
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
const ALLOWED_SOURCE_STATES = new Set(['real', 'mock', 'delayed', 'degraded', 'down', 'unavailable']);
const REQUIRED_STRATEGIES = ['单腿', '看涨价差', '看跌价差', '铁鹰', '观望'];

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
  delete process.env.MARKET_SNAPSHOT_PRICE;
  process.env.THETA_STATE_STORE = 'memory';
  Object.assign(process.env, overrides);
  await resetThetaSnapshotStoreForTests();
  await clearThetaSnapshot();
}

async function resetUwStateEnv(overrides = {}) {
  delete process.env.UW_INGEST_SECRET;
  delete process.env.UW_STATE_STORE;
  delete process.env.UW_SNAPSHOT_FILE;
  delete process.env.UW_SNAPSHOT_TTL_SECONDS;
  delete process.env.UW_SNAPSHOT_STALE_SECONDS;
  delete process.env.UW_REDIS_URL;
  Object.assign(process.env, overrides);
  await clearUwSnapshot();
  await resetUwSnapshotStoreForTests();
}

function buildUwPayload(statusOrOverrides = {}, maybeOverrides = {}) {
  const status = typeof statusOrOverrides === 'string'
    ? statusOrOverrides
    : statusOrOverrides?.status || 'partial';
  const overrides = typeof statusOrOverrides === 'string'
    ? maybeOverrides
    : statusOrOverrides;

  const base = {
    secret: process.env.UW_INGEST_SECRET || 'local-test-secret',
    source: 'unusual_whales',
    status,
    last_update: new Date().toISOString(),
    flow: {
      flow_bias: status === 'live' ? 'bullish' : 'unavailable',
      institutional_entry: status === 'live' ? 'building' : 'unavailable'
    },
    darkpool: {
      darkpool_bias: status === 'live' ? 'support' : 'unavailable'
    },
    volatility: {
      volatility_light: status === 'live' ? 'yellow' : 'unavailable'
    },
    sentiment: {
      market_tide: status === 'live' ? 'risk_on' : 'unavailable'
    },
    dealer_crosscheck: {
      state: status === 'live' ? 'confirm' : 'unavailable'
    },
    quality: {
      data_quality: status,
      missing_fields: status === 'live' ? [] : ['flow', 'darkpool', 'volatility', 'market_tide'],
      warnings: status === 'live' ? ['test_payload_not_real_market'] : ['market_closed_weekend_test']
    }
  };

  return {
    ...base,
    ...overrides,
    flow: {
      ...base.flow,
      ...(overrides.flow || {})
    },
    darkpool: {
      ...base.darkpool,
      ...(overrides.darkpool || {})
    },
    volatility: {
      ...base.volatility,
      ...(overrides.volatility || {})
    },
    sentiment: {
      ...base.sentiment,
      ...(overrides.sentiment || {})
    },
    dealer_crosscheck: {
      ...base.dealer_crosscheck,
      ...(overrides.dealer_crosscheck || {})
    },
    quality: {
      ...base.quality,
      ...(overrides.quality || {})
    }
  };
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
    assert.equal(signal.projection.dealer_summary.expected_move_upper, 5348);
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
  process.env.FMP_API_KEY = 'test-key';
  await resetThetaStateEnv();

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
  process.env.FMP_API_KEY = 'test-key';
  await resetThetaStateEnv();

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
  assert.match(message, /指挥部：/);
  assert.match(message, /哨兵：/);
  assert.match(message, /结论：/);
  assert.match(message, /策略：/);

  delete process.env.FMP_API_KEY;
});

test('buildAlertMessage renders Chinese intraday reminder from live current signal', async () => {
  delete process.env.FMP_API_KEY;
  await resetThetaStateEnv();
  await seedDefaultThetaLiveSnapshot();
  const signal = await getCurrentSignal(undefined);
  const message = buildAlertMessage({
    signal,
    body: { session: 'intraday' }
  });

  assert.match(message, /【SPX 指挥台｜/);
  assert.match(message, /指挥部：/);
  assert.match(message, /哨兵：/);
  assert.match(message, /进场：/);
  assert.match(message, /止损：/);
  assert.match(message, /失效：/);
  assert.match(message, /止盈：/);
  assert.match(message, /策略：/);
  assert.match(message, /数据：/);
  assert.match(message, /禁做：/);
});

test('buildAlertMessage renders dedicated Chinese FMP exception warning', async () => {
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
  assert.match(message, /指挥部：/);
  assert.match(message, /策略：/);
  assert.match(message, /禁做：/);

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
  const { updateTradingViewSnapshot } = await import('../storage/tradingview-snapshot.js');
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

test('partial UW snapshot exposes top-level UW contract without becoming ready', async () => {
  await resetUwStateEnv({
    UW_STATE_STORE: 'memory',
    UW_SNAPSHOT_STALE_SECONDS: '300'
  });

  await writeUwSnapshot({
    source: 'unusual_whales',
    status: 'partial',
    last_update: new Date().toISOString(),
    flow: {
      flow_bias: 'bullish',
      institutional_entry: 'unavailable'
    },
    darkpool: {
      darkpool_bias: 'unavailable'
    },
    volatility: {
      volatility_light: 'unavailable'
    },
    sentiment: {
      market_tide: 'risk_on'
    },
    dealer_crosscheck: {
      state: 'unavailable'
    },
    quality: {
      data_quality: 'partial',
      missing_fields: ['institutional_entry', 'darkpool_bias', 'volatility_light', 'dealer_crosscheck'],
      warnings: ['partial_contract_test']
    }
  });

  const signal = await getCurrentSignal(undefined);
  assert.equal(signal.uw.status, 'partial');
  assert.equal(signal.uw_conclusion.status, 'partial');
  assert.equal(signal.uw_conclusion.flow_bias, 'bullish');
  assert.equal(signal.uw_conclusion.market_tide, 'risk_on');
  assert.equal(signal.execution_constraints.uw.executable, false);
  assert.equal(signal.trade_plan.uw_ready, false);
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
