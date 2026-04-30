/**
 * live-refresh-scheduler.js
 *
 * Upgraded from a tick-only mock to a real multi-source background scheduler.
 * Each job runs on its own interval, fetches live data, persists it, and logs
 * the outcome so the rest of the system can read fresh snapshots from the store.
 *
 * Safety rules:
 *  - Every job is wrapped in a try/catch; a failure in one job never crashes the server.
 *  - Jobs use .unref() so they do not prevent Node.js from exiting cleanly in tests.
 *  - Intervals are conservative to stay within free-tier API rate limits.
 */

import { getFmpSnapshot } from '../adapters/fmp/index.js';
import { refreshUwProvider } from '../state/uwProvider.js';
import { writeThetaSnapshot } from '../storage/theta-snapshot.js';

// ─── Refresh intervals (milliseconds) ────────────────────────────────────────
const REFRESH_INTERVALS = {
  fmp_price:   60_000,   // FMP SPX spot price  – every 60 s
  fmp_event:  120_000,   // FMP economic calendar – every 2 min
  uw:          60_000,   // UW API snapshot (flow, dealer, darkpool, vol) – every 60 s
  theta:       30_000,   // Theta ingest health-check / stale guard – every 30 s
};

// ─── In-memory refresh log (read by /sources/status) ─────────────────────────
const refreshLog = Object.fromEntries(
  Object.keys(REFRESH_INTERVALS).map((name) => [
    name,
    {
      name,
      last_run_at: null,
      last_status: 'waiting',
      message: '等待首次刷新。',
    },
  ])
);

let started = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function markRefresh(name, status = 'ok', message = '') {
  refreshLog[name] = {
    name,
    last_run_at: new Date().toISOString(),
    last_status: status,
    message: message || `${name} refresh ok`,
  };
}

function markError(name, error) {
  refreshLog[name] = {
    name,
    last_run_at: new Date().toISOString(),
    last_status: 'error',
    message: error?.message || String(error),
  };
}

// ─── Individual job implementations ──────────────────────────────────────────

/**
 * FMP Price job
 * Fetches the latest SPX spot price from FMP and the result is automatically
 * cached inside getFmpSnapshot → createFmpPriceFailureFallback / priceSnapshot.
 * The snapshot is read later by current-signal.js via getFmpSnapshot().
 */
async function runFmpPriceJob() {
  try {
    const { price } = await getFmpSnapshot({ price: {} });
    const ok = price?.available === true && price?.price != null;
    markRefresh(
      'fmp_price',
      ok ? 'ok' : 'degraded',
      ok
        ? `FMP price ok: ${price.price} (${price.fetch_mode})`
        : `FMP price unavailable: ${price?.message || 'no price'}`
    );
  } catch (error) {
    markError('fmp_price', error);
  }
}

/**
 * FMP Event Risk job
 * Fetches the economic calendar and caches event risk state.
 */
async function runFmpEventJob() {
  try {
    const { event } = await getFmpSnapshot({ event: {} });
    const ok = event?.available === true;
    markRefresh(
      'fmp_event',
      ok ? 'ok' : 'degraded',
      ok
        ? `FMP event ok: risk=${event.event_risk} (${event.fmp_signal})`
        : `FMP event unavailable: ${event?.message || 'no event data'}`
    );
  } catch (error) {
    markError('fmp_event', error);
  }
}

/**
 * UW job
 * Calls refreshUwProvider() which fetches all configured UW API endpoints
 * and writes the result to the UW API snapshot store.
 * Only runs when UW_PROVIDER_MODE=api and UW_API_KEY is set.
 */
async function runUwJob() {
  const mode = String(process.env.UW_PROVIDER_MODE || '').toLowerCase();
  if (mode !== 'api') {
    markRefresh('uw', 'skipped', `UW_PROVIDER_MODE=${mode || 'unset'}, skipping API refresh.`);
    return;
  }
  if (!process.env.UW_API_KEY) {
    markRefresh('uw', 'skipped', 'UW_API_KEY not configured, skipping refresh.');
    return;
  }
  try {
    const snapshot = await refreshUwProvider();
    const status = snapshot?.provider?.status || 'unknown';
    markRefresh(
      'uw',
      ['live', 'partial'].includes(status) ? 'ok' : 'degraded',
      `UW refresh: provider.status=${status}, endpoints_ok=${snapshot?.provider?.endpoints_ok?.length ?? 0}`
    );
  } catch (error) {
    markError('uw', error);
  }
}

/**
 * Theta stale-guard job
 * ThetaData is push-based (external script pushes via /ingest/theta).
 * This job does NOT pull from ThetaData directly; instead it reads the
 * current snapshot and marks it stale if the last push is too old.
 * This ensures the rest of the system always sees an accurate freshness state.
 */
async function runThetaStaleGuardJob() {
  try {
    const { getThetaSnapshot } = await import('../storage/theta-snapshot.js');
    const snapshot = await getThetaSnapshot();
    if (!snapshot) {
      markRefresh('theta', 'waiting', 'Theta: no snapshot yet – waiting for push via /ingest/theta.');
      return;
    }
    const staleThresholdMs = Number(process.env.THETA_STALE_SECONDS || 90) * 1000;
    const lastUpdate = snapshot.received_at || snapshot.last_update;
    const ageMs = lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : Infinity;
    const isStale = ageMs > staleThresholdMs;
    markRefresh(
      'theta',
      isStale ? 'stale' : 'ok',
      isStale
        ? `Theta stale: last push ${Math.round(ageMs / 1000)}s ago (threshold ${staleThresholdMs / 1000}s).`
        : `Theta ok: last push ${Math.round(ageMs / 1000)}s ago, status=${snapshot.status}.`
    );
  } catch (error) {
    markError('theta', error);
  }
}

// ─── Scheduler boot ───────────────────────────────────────────────────────────

export function startLiveRefreshScheduler() {
  if (started) return;
  started = true;

  // Run each job immediately on start, then on the configured interval.
  const jobs = [
    { name: 'fmp_price', fn: runFmpPriceJob,       interval: REFRESH_INTERVALS.fmp_price },
    { name: 'fmp_event', fn: runFmpEventJob,        interval: REFRESH_INTERVALS.fmp_event },
    { name: 'uw',        fn: runUwJob,              interval: REFRESH_INTERVALS.uw },
    { name: 'theta',     fn: runThetaStaleGuardJob, interval: REFRESH_INTERVALS.theta },
  ];

  for (const job of jobs) {
    // Fire immediately (non-blocking)
    job.fn().catch((error) => markError(job.name, error));

    // Then repeat on interval
    setInterval(() => {
      job.fn().catch((error) => markError(job.name, error));
    }, job.interval).unref?.();
  }

  console.log('[scheduler] live-refresh-scheduler started with real data jobs.');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function getLiveRefreshLog() {
  return Object.values(refreshLog);
}

export function getLiveRefreshIntervals() {
  return { ...REFRESH_INTERVALS };
}
