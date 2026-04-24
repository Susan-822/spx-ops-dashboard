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
import { sendJson, readJsonBody, secureCompare } from './helpers.js';

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

function buildTradingViewWebhookText(body = {}) {
  return [
    '【SPX 指挥台】',
    '状态：TradingView 触发',
    `动作：收到 ${body.event_type || 'unknown_event'} 结构信号`,
    `触发：${body.symbol || 'SPX'} ${body.timeframe || '1m'}`,
    `作废：若价格重新失守 ${body.level || body.price || '关键位'}，重新评估`,
    '禁做：不要直接追单，先看 /signals/current',
    '原因：验证 webhook → signals/current → Telegram 链路'
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
      is_mock: true
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
    return sendJson(res, 200, signal);
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
    sendTelegramTestMessage(buildTradingViewWebhookText(body)).catch((error) => {
      console.error('TradingView webhook Telegram notify failed:', error.message);
    });

    return sendJson(res, 202, {
      accepted: true,
      message: 'TradingView event accepted.',
      is_mock: false
    });
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
