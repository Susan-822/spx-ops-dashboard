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

test('GET /signals/current returns required protocol fields for dashboard consumption', async () => {
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
  } finally {
    server.close();
  }
});

test('all 7 scenarios return expected actions and dashboard-ready fields', async () => {
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
      assert.equal(json.strategy_cards.length >= 5, true);
      assert.equal(typeof json.plain_language.user_action, 'string');
      assert.notEqual(json.plain_language.user_action.length, 0);
      assert.equal(typeof json.stale_flags, 'object');
      assert.equal(typeof json.conflict.conflict_level, 'string');
      assert.equal(typeof json.confidence_score, 'number');
      assert.equal(json.confidence_score <= 92, true);
      assert.equal(json.confidence_score >= 35, true);
    }
  } finally {
    server.close();
  }
});

test('strategy cards expose the required strategy set and fields', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=breakout_pullback_pending`);
    const json = await response.json();
    const names = json.strategy_cards.map((card) => card.strategy_name);

    for (const required of REQUIRED_STRATEGIES) {
      assert.equal(names.includes(required), true);
    }

    for (const card of json.strategy_cards) {
      assert.equal(typeof card.strategy_name, 'string');
      assert.equal(typeof card.suitable_when, 'string');
      assert.equal(typeof card.entry_condition, 'string');
      assert.equal(typeof card.target_zone, 'string');
      assert.equal(typeof card.invalidation, 'string');
      assert.equal(typeof card.avoid_when, 'string');
    }
  } finally {
    server.close();
  }
});

test('stale and event-risk rules map to approved avoid action enums', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const staleResponse = await fetch(`${baseUrl}/signals/current?scenario=theta_stale_no_trade`);
    const staleJson = await staleResponse.json();
    assert.equal(staleJson.recommended_action, 'no_trade');
    assert.equal(staleJson.avoid_actions.includes('trade_on_stale_data'), true);

    const eventResponse = await fetch(`${baseUrl}/signals/current?scenario=fmp_event_no_short_vol`);
    const eventJson = await eventResponse.json();
    assert.equal(eventJson.recommended_action, 'wait');
    assert.equal(eventJson.avoid_actions.includes('short_vol_before_event'), true);
    assert.equal(eventJson.avoid_actions.includes('early_iron_condor'), true);
    assert.equal(eventJson.avoid_actions.includes('naked_sell'), true);
  } finally {
    server.close();
  }
});

test('conflict output uses reason arrays instead of numeric points', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=flip_conflict_wait`);
    const json = await response.json();
    assert.equal(json.conflict.conflict_level, 'high');
    assert.equal(Array.isArray(json.conflict.conflict_points), true);
    assert.equal(json.conflict.conflict_points.length > 0, true);
    assert.equal(typeof json.conflict.conflict_points[0], 'string');
  } finally {
    server.close();
  }
});

test('sources status exposes refresh and state metadata for command center footer', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/sources/status?scenario=uw_call_strong_unconfirmed`);
    const json = await response.json();
    assert.equal(Array.isArray(json.items), true);
    assert.equal(Boolean(json.scheduler), true);
    assert.equal(Array.isArray(json.scheduler.jobs), true);
    assert.equal(json.items.length >= 7, true);

    for (const item of json.items) {
      assert.equal(ALLOWED_SOURCE_STATES.has(item.state), true);
      assert.equal(typeof item.fetch_mode, 'string');
      assert.equal(typeof item.latency_ms, 'number');
      assert.equal(typeof item.refresh_interval_ms, 'number');
      assert.equal(typeof item.stale_threshold_ms, 'number');
      assert.equal(typeof item.down_threshold_ms, 'number');
      assert.equal(Array.isArray(item.event_triggers), true);
    }

    const uwDom = json.items.find((item) => item.source === 'uw_dom');
    const uwScreenshot = json.items.find((item) => item.source === 'uw_screenshot');
    assert.equal(uwDom.state, 'degraded');
    assert.equal(uwScreenshot.state, 'mock');
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
