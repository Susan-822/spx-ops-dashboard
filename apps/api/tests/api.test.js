import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { createServer } = await import('../server.js');

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
const ALLOWED_SOURCE_STATES = new Set(['real', 'mock', 'delayed', 'degraded', 'down']);
const REQUIRED_STRATEGIES = ['单腿', '看涨价差', '看跌价差', '铁鹰', '观望'];

function startServer() {
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

test('GET /signals/current returns required protocol fields for dashboard and radar', async () => {
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
    assert.equal(json.fetch_mode, 'mock_scenario');
    assert.equal(json.is_mock, true);
    assert.equal(ALLOWED_MARKET_STATES.has(json.market_state), true);
    assert.equal(ALLOWED_GAMMA_REGIMES.has(json.gamma_regime), true);
    assert.equal(ALLOWED_ACTIONS.has(json.recommended_action), true);
    assert.equal(Array.isArray(json.conflict.conflict_points), true);
    assert.equal(typeof json.plain_language.market_status, 'string');
    assert.equal(typeof json.plain_language.dealer_behavior, 'string');
    assert.equal(typeof json.plain_language.user_action, 'string');
    assert.equal(typeof json.plain_language.avoid, 'string');
    assert.equal(typeof json.plain_language.invalidation, 'string');
    assert.equal(typeof json.market_snapshot.distance_to_flip, 'number');
    assert.equal(typeof json.market_snapshot.distance_to_call_wall, 'number');
    assert.equal(typeof json.market_snapshot.distance_to_put_wall, 'number');
    assert.equal(typeof json.market_snapshot.spot_position, 'string');
    assert.equal(Boolean(json.radar_summary), true);
    assert.equal(typeof json.radar_summary.order_flow.explanation, 'string');
    assert.equal(typeof json.radar_summary.dealer.explanation, 'string');
    assert.equal(typeof json.radar_summary.dark_pool.explanation, 'string');
    assert.equal(typeof json.radar_summary.plan_alignment.effect_on_action, 'string');
  } finally {
    server.close();
  }
});

test('all 7 scenarios return expected actions and radar-supporting fields', async () => {
  const { server, baseUrl } = await startServer();

  try {
    for (const [scenario, expectedAction] of Object.entries(EXPECTED_ACTIONS)) {
      const response = await fetch(`${baseUrl}/signals/current?scenario=${scenario}`);
      assert.equal(response.status, 200);
      const json = await response.json();

      assert.equal(json.scenario, scenario);
      assert.equal(json.recommended_action, expectedAction);
      assert.equal(ALLOWED_MARKET_STATES.has(json.market_state), true);
      assert.equal(ALLOWED_GAMMA_REGIMES.has(json.gamma_regime), true);
      assert.equal(ALLOWED_ACTIONS.has(json.recommended_action), true);
      assert.equal(Array.isArray(json.conflict.conflict_points), true);
      assert.equal(Array.isArray(json.strategy_cards), true);
      assert.equal(json.strategy_cards.length, 5);
      assert.equal(typeof json.plain_language.user_action, 'string');
      assert.equal(Boolean(json.radar_summary), true);
      assert.equal(typeof json.radar_summary.plan_alignment.status, 'string');
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
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/sources/status?scenario=uw_call_strong_unconfirmed`);
    const json = await response.json();
    assert.equal(Array.isArray(json.items), true);
    assert.equal(Boolean(json.scheduler), true);

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
  const { server, baseUrl } = await startServer();

  try {
    const dashboard = await fetch(`${baseUrl}/`);
    const radar = await fetch(`${baseUrl}/radar?scenario=breakout_pullback_pending`);
    assert.equal(dashboard.status, 200);
    assert.equal(radar.status, 200);

    const dashboardHtml = await dashboard.text();
    const radarHtml = await radar.text();
    assert.equal(dashboardHtml.includes('/app.js'), true);
    assert.equal(radarHtml.includes('/app.js'), true);

    const signalResponse = await fetch(`${baseUrl}/signals/current?scenario=breakout_pullback_pending`);
    const signalJson = await signalResponse.json();
    assert.equal(Boolean(signalJson.radar_summary), true);
  } finally {
    server.close();
  }
});

test('health endpoint still exposes all seven scenarios', async () => {
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
