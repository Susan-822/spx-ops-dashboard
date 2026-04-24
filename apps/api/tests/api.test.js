import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.TRADINGVIEW_WEBHOOK_SECRET = '000d3b57-e521-479c-addd-cc672dec00be';

const { createServer } = await import('../server.js');
const { clearTradingViewSnapshot } = await import('../storage/tradingview-snapshot.js');
const { getCurrentSignal } = await import('../decision_engine/current-signal.js');
const { buildAlertMessage } = await import('../alerts/build-alert-message.js');

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
    assert.equal(Boolean(json.radar_summary), true);
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

test('FMP high-risk event updates event_context and keeps source_status.fmp real', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('positive_gamma_income_watch', {
    fmp: {
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
  });

  assert.equal(signal.event_context.event_risk, 'high');
  assert.match(signal.event_context.event_note, /FMP 检测到/);
  assert.equal(signal.recommended_action, 'wait');

  const fmpStatus = signal.source_status.find((item) => item.source === 'fmp');
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
      fetchImpl: async () => {
        throw new Error('network unavailable');
      }
    }
  });

  assert.equal(signal.schema_version, '0.4.0');
  assert.equal(signal.event_context.event_risk, 'medium');
  assert.equal(signal.event_context.event_note, 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。');
  assert.equal(signal.event_context.no_short_vol_window, true);
  assert.equal(signal.event_context.trade_permission_adjustment, 'downgrade');

  const fmpStatus = signal.source_status.find((item) => item.source === 'fmp');
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
  });

  assert.equal(signal.event_context.event_risk, 'medium');
  assert.equal(signal.event_context.event_note, 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。');
  assert.equal(signal.event_context.no_short_vol_window, true);
  assert.equal(signal.event_context.trade_permission_adjustment, 'downgrade');

  const fmpStatus = signal.source_status.find((item) => item.source === 'fmp');
  assert.ok(fmpStatus);
  assert.equal(fmpStatus.state, 'delayed');
  assert.equal(fmpStatus.stale, true);
  assert.equal(fmpStatus.message, 'FMP 数据异常，事件风险不可确认。');

  delete process.env.FMP_API_KEY;
});

test('buildAlertMessage renders Chinese premarket warning for FMP risk gate', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('positive_gamma_income_watch', {
    fmp: {
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
  });

  const message = buildAlertMessage({
    signal,
    body: { session: 'premarket' }
  });

  assert.match(message, /状态：盘前提醒/);
  assert.match(message, /动作：先等待/);
  assert.match(message, /原因：FMP 检测到/);
  assert.match(message, /不要提前铁鹰/);

  delete process.env.FMP_API_KEY;
});

test('buildAlertMessage renders Chinese intraday reminder from current signal', async () => {
  delete process.env.FMP_API_KEY;
  const signal = await getCurrentSignal('breakout_pullback_pending');
  const message = buildAlertMessage({
    signal,
    body: { session: 'intraday' }
  });

  assert.match(message, /状态：盘中提醒/);
  assert.match(message, /动作：等回踩不破关键位，再考虑偏多/);
  assert.match(message, /触发：SPX/);
  assert.match(message, /作废：回踩跌破 put_wall/);
});

test('buildAlertMessage renders dedicated Chinese FMP exception warning', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('breakout_pullback_pending', {
    fmp: {
      fetchImpl: async () => {
        throw new Error('network unavailable');
      }
    }
  });

  const message = buildAlertMessage({
    signal,
    body: { session: 'intraday' }
  });

  assert.match(message, /【SPX 指挥台｜事件风险】/);
  assert.match(message, /状态：FMP 异常/);
  assert.match(message, /事件：无法确认/);
  assert.match(message, /动作：降低交易权限，不提前铁鹰，不裸卖波/);
  assert.match(message, /影响：事件风险不可确认/);
  assert.match(message, /禁做：不要把未知事件窗口当成安全区间/);
  assert.match(message, /原因：FMP 数据异常或过期/);

  delete process.env.FMP_API_KEY;
});
