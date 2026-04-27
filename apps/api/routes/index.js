import { getCurrentSignal } from '../decision_engine/current-signal.js';
import { getScenarioNames } from '../decision_engine/mock-scenarios.js';
import { createSchedulerState } from '../scheduler/index.js';
import { createStorageState } from '../storage/index.js';
import {
  getAcceptedTradingViewEvents,
  updateTradingViewSnapshot
} from '../storage/tradingview-snapshot.js';
import { sendTelegramTestMessage } from '../adapters/telegram/index.js';
import { getRecentLogs } from '../logs/index.js';
import { buildAlertMessage } from '../alerts/build-alert-message.js';
import {
  buildTradePlanTelegramMessage,
  buildTelegramDedupeKey,
  determineTelegramLevel,
  getTelegramAlertMeta
} from '../alerts/telegram-plan-alert.js';
import {
  isTelegramAlertDuplicate,
  markTelegramAlertSent
} from '../state/telegramAlertDedupeStore.js';
import { writeThetaSnapshot } from '../storage/theta-snapshot.js';
import { sendJson, readJsonBody, secureCompare } from './helpers.js';
import { ingestUwSummary } from '../../../integrations/unusual-whales/ingest/uw-ingest.js';
import { writeUwSnapshot } from '../state/uwSnapshotStore.js';
import { refreshUwProvider } from '../state/uwProvider.js';

function getBuildMetadata() {
  return {
    build_sha: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || 'unknown',
    git_commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || 'unknown'
  };
}

const MAX_THETA_INGEST_BYTES = 64 * 1024;

function hasForbiddenThetaFields(payload) {
  const keys = Object.keys(payload || {});
  return keys.some((key) => ['cookie', 'token', 'authorization'].includes(String(key).toLowerCase()));
}

function hasRejectedRawTables(payload) {
  return (
    Array.isArray(payload?.option_chain)
    || Array.isArray(payload?.raw_option_chain)
    || Array.isArray(payload?.greeks)
    || Array.isArray(payload?.raw_greeks)
    || Array.isArray(payload?.contracts)
    || Array.isArray(payload?.rows)
  );
}

function hasPayloadTooLarge(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8') > MAX_THETA_INGEST_BYTES;
  } catch {
    return true;
  }
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidThetaIngestAuth(req, body) {
  const expectedHeaderKey = process.env.DATA_PUSH_API_KEY || '';
  const providedHeaderKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
  if (expectedHeaderKey && secureCompare(providedHeaderKey, expectedHeaderKey)) {
    return true;
  }

  const expectedBodySecret = process.env.THETA_INGEST_SECRET || '';
  const providedBodySecret = typeof body.secret === 'string' ? body.secret : '';
  if (expectedBodySecret && secureCompare(providedBodySecret, expectedBodySecret)) {
    return true;
  }

  return false;
}

function normalizeThetaDealerPayload(body = {}) {
  const dealer = body.dealer && typeof body.dealer === 'object' ? body.dealer : {};
  const quality = body.quality && typeof body.quality === 'object' ? body.quality : {};
  const missingFields = Array.isArray(quality.missing_fields) ? quality.missing_fields : [];
  const warnings = Array.isArray(quality.warnings) ? quality.warnings : [];

  return {
    secret: undefined,
    source: typeof body.source === 'string' ? body.source : 'thetadata_terminal',
    status: typeof body.status === 'string' ? body.status : 'unavailable',
    last_update: typeof body.last_update === 'string' ? body.last_update : new Date().toISOString(),
    ticker: typeof body.ticker === 'string' ? body.ticker : 'SPX',
    spot_source: typeof body.spot_source === 'string' ? body.spot_source : 'unavailable',
    spot: finiteNumberOrNull(body.spot),
    test_expiration: typeof body.test_expiration === 'string' ? body.test_expiration : null,
    dealer: {
      net_gex: finiteNumberOrNull(dealer.net_gex),
      call_gex: finiteNumberOrNull(dealer.call_gex),
      put_gex: finiteNumberOrNull(dealer.put_gex),
      gamma_regime: typeof dealer.gamma_regime === 'string' ? dealer.gamma_regime : 'unknown',
      dealer_behavior: typeof dealer.dealer_behavior === 'string' ? dealer.dealer_behavior : 'unknown',
      least_resistance_path: typeof dealer.least_resistance_path === 'string' ? dealer.least_resistance_path : 'unknown',
      call_wall: finiteNumberOrNull(dealer.call_wall),
      put_wall: finiteNumberOrNull(dealer.put_wall),
      max_pain: finiteNumberOrNull(dealer.max_pain),
      zero_gamma: finiteNumberOrNull(dealer.zero_gamma),
      expected_move_upper: finiteNumberOrNull(dealer.expected_move_upper),
      expected_move_lower: finiteNumberOrNull(dealer.expected_move_lower),
      vanna_charm_bias: typeof dealer.vanna_charm_bias === 'string' ? dealer.vanna_charm_bias : 'unknown'
    },
    quality: {
      data_quality: typeof quality.data_quality === 'string' ? quality.data_quality : 'unavailable',
      missing_fields: missingFields,
      warnings,
      calculation_scope: typeof quality.calculation_scope === 'string' ? quality.calculation_scope : 'single_expiry_test',
      raw_rows_sent: false
    }
  };
}

function buildTelegramTestText(body = {}) {
  return [
    '【SPX 指挥台】',
    '状态：测试',
    '动作：这是一条 Telegram 云端测试提醒',
    '触发：Render 后端',
    '作废：无',
    '禁做：无',
    '原因：验证 Telegram 通知通道'
  ].join('\n');
}

export async function handleApiRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const scenario = url.searchParams.get('scenario');

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'spx-ops-dashboard-api',
      mode: 'mock-master-engine',
      available_scenarios: getScenarioNames(),
      is_mock: true,
      ...getBuildMetadata()
    });
  }

  if (req.method === 'GET' && url.pathname === '/sources/status') {
    const signal = await getCurrentSignal(scenario);
    return sendJson(res, 200, {
      items: signal.source_status,
      stale_flags: signal.stale_flags,
      stale_reason: signal.stale_reason,
      scheduler: createSchedulerState(),
      scenario: signal.scenario,
      is_mock: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/signals/current') {
    const signal = await getCurrentSignal(scenario);
    return sendJson(res, 200, {
      ...signal,
      ...getBuildMetadata()
    });
  }

  if (req.method === 'POST' && url.pathname === '/uw/refresh') {
    try {
      const snapshot = await refreshUwProvider();
      return sendJson(res, 202, {
        accepted: true,
        uw_provider: snapshot.provider,
        is_mock: false
      });
    } catch (error) {
      return sendJson(res, 502, {
        accepted: false,
        message: error.message,
        is_mock: false
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/ingest/theta') {
    const body = await readJsonBody(req);
    if (!isValidThetaIngestAuth(req, body)) {
      return sendJson(res, 401, {
        accepted: false,
        message: 'Invalid theta ingest credentials.',
        is_mock: false
      });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, {
        accepted: false,
        message: 'Theta payload must be a JSON object.',
        is_mock: false
      });
    }

    if (hasForbiddenThetaFields(body)) {
      return sendJson(res, 400, {
        accepted: false,
        message: 'Forbidden theta payload fields detected.',
        is_mock: false
      });
    }

    if (hasRejectedRawTables(body)) {
      return sendJson(res, 400, {
        accepted: false,
        message: 'Raw option chain or greeks tables are not accepted.',
        is_mock: false
      });
    }

    if (hasPayloadTooLarge(body)) {
      return sendJson(res, 413, {
        accepted: false,
        message: 'Theta payload too large.',
        is_mock: false
      });
    }

    const normalizedPayload = normalizeThetaDealerPayload(body);
    await writeThetaSnapshot({
      ...normalizedPayload,
      received_at: new Date().toISOString()
    });

    return sendJson(res, 202, {
      accepted: true,
      message: 'Theta dealer summary accepted.',
      is_mock: false
    });
  }

  if (req.method === 'GET' && url.pathname === '/gamma/summary') {
    const signal = await getCurrentSignal(scenario);
    return sendJson(res, 200, {
      scenario: signal.scenario,
      gamma_regime: signal.gamma_regime,
      market_state: signal.market_state,
      market_snapshot: signal.market_snapshot,
      is_mock: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const signal = await getCurrentSignal(scenario);
    return sendJson(res, 200, {
      items: [
        {
          id: `scenario-${signal.scenario}`,
          type: 'scenario',
          title: signal.scenario,
          details: signal.event_context.event_note,
          is_mock: true,
          created_at: signal.timestamp
        }
      ],
      scheduler: createSchedulerState(),
      storage: await createStorageState(),
      is_mock: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/logs/recent') {
    return sendJson(res, 200, {
      items: getRecentLogs(),
      is_mock: true
    });
  }

  if (req.method === 'POST' && url.pathname === '/webhook/tradingview') {
    const body = await readJsonBody(req);
    const expectedSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET || '';
    const providedSecret = typeof body.secret === 'string' ? body.secret : '';

    if (!secureCompare(providedSecret, expectedSecret)) {
      return sendJson(res, 401, {
        accepted: false,
        message: 'Invalid TradingView webhook secret.',
        is_mock: true
      });
    }

    const acceptedEvents = getAcceptedTradingViewEvents();
    if (typeof body.event_type !== 'string' || !acceptedEvents.includes(body.event_type)) {
      return sendJson(res, 400, {
        accepted: false,
        message: 'Unsupported TradingView event_type.',
        accepted_event_types: acceptedEvents,
        is_mock: true
      });
    }

    await updateTradingViewSnapshot({
      source: 'tradingview',
      symbol: typeof body.symbol === 'string' ? body.symbol : 'SPX',
      timeframe: typeof body.timeframe === 'string' ? body.timeframe : '1m',
      event_type: body.event_type,
      price: typeof body.price === 'number' ? body.price : Number(body.price),
      trigger_time: typeof body.trigger_time === 'string' ? body.trigger_time : new Date().toISOString(),
      invalidation_level:
        typeof body.invalidation_level === 'number'
          ? body.invalidation_level
          : typeof body.level === 'number'
            ? body.level
            : Number(body.invalidation_level ?? body.level),
      level: body.level,
      side: typeof body.side === 'string' ? body.side : 'neutral'
    });

    // Fire-and-forget Telegram notification so the webhook stays fast.
    queueMicrotask(async () => {
      try {
        const signal = await getCurrentSignal(scenario);
        const meta = getTelegramAlertMeta({ signal });
        if (meta.level === 'L1') {
          return;
        }

        if (meta.dedupeKey && isTelegramAlertDuplicate(meta.dedupeKey)) {
          return;
        }

        const alertText = buildTradePlanTelegramMessage({ signal });
        await sendTelegramTestMessage(alertText);
        if (meta.dedupeKey) {
          markTelegramAlertSent(meta.dedupeKey);
        }
      } catch (error) {
        console.error('TradingView webhook Telegram notify failed:', error.message);
      }
    });

    return sendJson(res, 202, {
      accepted: true,
      message: 'TradingView event accepted.',
      is_mock: false
    });
  }

  if (req.method === 'POST' && url.pathname === '/ingest/uw') {
    const body = await readJsonBody(req);
    const expectedSecret = process.env.UW_INGEST_SECRET || '';
    const providedSecret = typeof body.secret === 'string' ? body.secret : '';

    if (!expectedSecret || !secureCompare(providedSecret, expectedSecret)) {
      return sendJson(res, 401, {
        accepted: false,
        message: 'Invalid UW ingest secret.',
        is_mock: true
      });
    }

    try {
      const result = await ingestUwSummary({
        secret: providedSecret,
        payload: body,
        store: {
          async set(snapshot) {
            return writeUwSnapshot(snapshot);
          }
        }
      });

      return sendJson(res, result.status ?? 202, {
        accepted: true,
        message: 'UW curated summary accepted.',
        is_mock: false
      });
    } catch (error) {
      return sendJson(res, 400, {
        accepted: false,
        message: error.message,
        is_mock: true
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/telegram/test') {
    const body = await readJsonBody(req);
    try {
      const result = await sendTelegramTestMessage(buildTelegramTestText(body));
      return sendJson(res, result.is_mock ? 503 : 200, {
        accepted: !result.is_mock,
        message: result.message,
        is_mock: result.is_mock
      });
    } catch (error) {
      return sendJson(res, 502, {
        accepted: false,
        message: error.message,
        is_mock: false
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/alerts/test') {
    const body = await readJsonBody(req);
    try {
      const session =
        typeof body.session === 'string'
          ? body.session
          : typeof url.searchParams.get('session') === 'string'
            ? url.searchParams.get('session')
            : 'intraday';
      const signal = await getCurrentSignal(scenario);
      const alertText = buildAlertMessage({
        signal,
        body: {
          ...body,
          session
        }
      });
      const result = await sendTelegramTestMessage(alertText);
      return sendJson(res, result.is_mock ? 503 : 202, {
        accepted: !result.is_mock,
        message: result.message,
        is_mock: result.is_mock,
        session,
        scenario: signal.scenario
      });
    } catch (error) {
      return sendJson(res, 502, {
        accepted: false,
        message: error.message,
        is_mock: false
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/uw/upload-screenshot') {
    const body = await readJsonBody(req);
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      message: 'UW manual screenshot upload is scaffolded as the third-priority fallback path.',
      received: body,
      is_mock: true
    });
  }

  if (req.method === 'POST' && url.pathname === '/uw/dom-read') {
    const body = await readJsonBody(req);
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      message: 'UW DOM reading is the first-priority design path, but still mock-only in this phase.',
      received: body,
      is_mock: true
    });
  }

  return false;
}

export { resetTelegramAlertDedupeStoreForTests } from '../state/telegramAlertDedupeStore.js';
