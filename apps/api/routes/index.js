import { getCurrentSignal } from '../decision_engine/current-signal.js';
import { getScenarioNames } from '../decision_engine/mock-scenarios.js';
import { createSchedulerState } from '../scheduler/index.js';
import { createStorageState } from '../storage/index.js';
import { getRecentLogs } from '../logs/index.js';
import { sendJson, readJsonBody } from './helpers.js';

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
      storage: createStorageState(),
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
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      received: body,
      message: 'TradingView remains disconnected in mock closed-loop mode.',
      is_mock: true
    });
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

  if (req.method === 'POST' && url.pathname === '/alerts/test') {
    const body = await readJsonBody(req);
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      message: 'Telegram remains event-triggered only in mock mode.',
      received: body,
      is_mock: true
    });
  }

  return false;
}
