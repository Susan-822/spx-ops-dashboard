import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { createServer } = await import('../server.js');

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

test('GET /signals/current returns the default mock master-engine payload', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.is_mock, true);
    assert.equal(json.scenario, 'negative_gamma_wait_pullback');
    assert.ok(json.recommended_action);
    assert.ok(Array.isArray(json.strategy_cards));
    assert.ok(json.signals);
    assert.ok(json.weights);
    assert.ok(json.conflict);
    assert.ok(json.plain_language);
  } finally {
    server.close();
  }
});

test('negative gamma pullback scenario stays wait with moderated confidence', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=negative_gamma_wait_pullback`);
    const json = await response.json();
    assert.equal(json.recommended_action, 'wait');
    assert.ok(json.confidence_score < 65);
  } finally {
    server.close();
  }
});

test('theta stale scenario degrades to no_trade', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=theta_stale_no_trade`);
    const json = await response.json();
    assert.equal(json.stale_flags.theta, true);
    assert.equal(json.recommended_action, 'no_trade');
    assert.ok(json.avoid_actions.includes('income_ok'));
  } finally {
    server.close();
  }
});

test('high conflict scenario forces wait and conflict banner state', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=flip_conflict_wait`);
    const json = await response.json();
    assert.equal(json.conflict.conflict_level, 'high');
    assert.equal(json.recommended_action, 'wait');
    assert.equal(json.plain_language.user_action, '逻辑冲突，观望');
  } finally {
    server.close();
  }
});

test('event risk blocks short-vol income actions', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=fmp_event_no_short_vol`);
    const json = await response.json();
    assert.equal(json.event_context.event_risk, 'high');
    assert.equal(json.recommended_action, 'wait');
    assert.ok(json.avoid_actions.includes('income_ok'));
    assert.ok(json.avoid_actions.includes('iron_condor'));
    assert.ok(json.avoid_actions.includes('naked_sell'));
  } finally {
    server.close();
  }
});

test('UW bullish without TV confirmation stays wait', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=uw_call_strong_unconfirmed`);
    const json = await response.json();
    assert.equal(json.signals.uw_signal, 'bullish_flow');
    assert.equal(json.signals.price_confirmation, 'unconfirmed');
    assert.equal(json.recommended_action, 'wait');
  } finally {
    server.close();
  }
});

test('breakout pullback scenario allows long_on_pullback once confidence threshold is met', async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/signals/current?scenario=breakout_pullback_pending`);
    const json = await response.json();
    assert.equal(json.recommended_action, 'long_on_pullback');
    assert.ok(json.confidence_score >= 65);
  } finally {
    server.close();
  }
});

test('health endpoint exposes scenario list in mock master-engine mode', async () => {
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
