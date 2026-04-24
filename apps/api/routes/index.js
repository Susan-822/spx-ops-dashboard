import { getCurrentSignal } from '../decision_engine/current-signal.js';
import { getTelegramSnapshot } from '../adapters/telegram/index.js';
import { createSchedulerState } from '../scheduler/index.js';
import { createStorageState } from '../storage/index.js';
import { getRecentLogs } from '../logs/index.js';
import { sendJson, readJsonBody } from './helpers.js';

export async function handleApiRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'spx-ops-dashboard-api',
      is_mock: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/sources/status') {
    const signal = await getCurrentSignal();
    return sendJson(res, 200, {
      items: signal.source_status,
      is_mock: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/signals/current') {
    const signal = await getCurrentSignal();
    return sendJson(res, 200, signal);
  }

  if (req.method === 'GET' && url.pathname === '/gamma/summary') {
    const signal = await getCurrentSignal();
    return sendJson(res, 200, {
      ...signal.gamma_summary,
      is_mock: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const signal = await getCurrentSignal();
    return sendJson(res, 200, {
      items: signal.events,
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
      is_mock: true
    });
  }

  if (req.method === 'POST' && url.pathname === '/uw/upload-screenshot') {
    const body = await readJsonBody(req);
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      message: 'Screenshot upload skeleton accepted without processing.',
      received: body,
      is_mock: true
    });
  }

  if (req.method === 'POST' && url.pathname === '/uw/dom-read') {
    const body = await readJsonBody(req);
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      message: 'UW DOM read skeleton accepted without browser automation.',
      received: body,
      is_mock: true
    });
  }

  if (req.method === 'POST' && url.pathname === '/alerts/test') {
    const body = await readJsonBody(req);
    const telegram = await getTelegramSnapshot();
    return sendJson(res, 202, {
      accepted: true,
      path: url.pathname,
      channel: telegram,
      received: body,
      is_mock: true
    });
  }

  return false;
}
