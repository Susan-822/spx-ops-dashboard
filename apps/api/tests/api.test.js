import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.TRADINGVIEW_WEBHOOK_SECRET = '000d3b57-e521-479c-addd-cc672dec00be';
process.env.STATE_STORE = 'memory';

const { createServer } = await import('../server.js');
const { clearTradingViewSnapshot } = await import('../storage/tradingview-snapshot.js');
const { getCurrentSignal } = await import('../decision_engine/current-signal.js');
const { buildAlertMessage } = await import('../alerts/build-alert-message.js');
const { resetTvSnapshotStoreForTests } = await import('../state/tvSnapshotStore.js');
const {
  getTelegramAlertDedupeKey,
  shouldBypassTelegramDedupe,
  markTelegramAlertSent,
  isTelegramAlertDuplicate,
  resetTelegramAlertDedupeStoreForTests
} = await import('../state/telegramAlertDedupeStore.js');

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
  await resetTvStateEnv();
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

test('FMP price success replaces mock spot with real SPX price', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('breakout_pullback_pending', {
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

  const fmpPriceStatus = signal.source_status.find((item) => item.source === 'fmp_price');
  assert.ok(fmpPriceStatus);
  assert.equal(fmpPriceStatus.state, 'real');
  assert.equal(fmpPriceStatus.is_mock, false);
  assert.equal(fmpPriceStatus.stale, false);
  assert.equal(fmpPriceStatus.message, 'FMP SPX price real');

  delete process.env.FMP_API_KEY;
});

test('FMP price failure clears spot instead of falling back to mock price', async () => {
  process.env.FMP_API_KEY = 'test-key';

  const signal = await getCurrentSignal('breakout_pullback_pending', {
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

test('buildAlertMessage renders Chinese intraday reminder from current signal', async () => {
  delete process.env.FMP_API_KEY;
  const signal = await getCurrentSignal('breakout_pullback_pending');
  const message = buildAlertMessage({
    signal,
    body: { session: 'intraday' }
  });

  assert.match(message, /【SPX 指挥台｜A多准备】/);
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

test('command environment can allow setups while TV sentinel still blocks execution', async () => {
  const signal = await getCurrentSignal('uw_call_strong_unconfirmed');

  assert.equal(signal.recommended_action, 'wait');
  assert.equal(signal.engines.command_environment.allowed, true);
  assert.equal(signal.engines.allowed_setups.single_leg.allowed, true);
  assert.equal(signal.engines.allowed_setups.vertical.allowed, true);
  assert.equal(signal.engines.allowed_setups.iron_condor.allowed, false);
  assert.equal(signal.engines.tv_sentinel.triggered, false);
  assert.equal(signal.engines.trade_plan.triggered_by_tv, false);
});

test('TV sentinel only upgrades to directional plan when command environment allows it', async () => {
  const signal = await getCurrentSignal('breakout_pullback_pending');

  assert.equal(signal.engines.command_environment.allowed, true);
  assert.equal(signal.engines.allowed_setups.single_leg.allowed, true);
  assert.equal(signal.engines.allowed_setups.vertical.allowed, true);
  assert.equal(signal.engines.tv_sentinel.triggered, true);
  assert.equal(signal.engines.tv_sentinel.direction, 'bullish');
  assert.equal(signal.engines.trade_plan.plan_family, 'A');
  assert.equal(signal.recommended_action, 'long_on_pullback');
});

test('telegram dedupe bypasses structure invalidated, stale, and data_mixed alerts', async () => {
  assert.equal(shouldBypassTelegramDedupe({ event_type: 'structure_invalidated' }), true);
  assert.equal(shouldBypassTelegramDedupe({ event_type: 'stale' }), true);
  assert.equal(shouldBypassTelegramDedupe({ event_type: 'data_mixed' }), true);
});

test('telegram dedupe bypasses direction reversal and status transition alerts', async () => {
  assert.equal(shouldBypassTelegramDedupe({ event_type: 'breakout_confirmed', direction_changed: true }), true);
  assert.equal(shouldBypassTelegramDedupe({ event_type: 'breakout_confirmed', status_changed: true }), true);
});

test('telegram dedupe blocks ordinary repeated alerts within five minutes', async () => {
  resetTelegramAlertDedupeStoreForTests();
  const key = getTelegramAlertDedupeKey(['SPX', '3m', 'breakout_confirmed', 'bullish', 'A_breakout', 'ready']);
  assert.equal(isTelegramAlertDuplicate(key), false);
  markTelegramAlertSent(key);
  assert.equal(isTelegramAlertDuplicate(key), true);
});
