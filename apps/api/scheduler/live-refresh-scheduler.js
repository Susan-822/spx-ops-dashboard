/**
 * live-refresh-scheduler.js
 *
 * Multi-source background scheduler with adaptive UW refresh.
 *
 * Architecture:
 *  - FMP price / event jobs run on fixed intervals (unchanged)
 *  - UW refresh is now driven by AdaptiveRefreshScheduler:
 *      NORMAL  mode: conservative intervals (10s–300s per endpoint)
 *      TURBO   mode: accelerated when near key levels (5s–120s)
 *      THROTTLE mode: 2× normal when quota > 80%
 *      MINIMAL  mode: only spot+flow+net-prem when quota > 90%
 *  - After each UW refresh, price context is extracted from the snapshot
 *    and fed back into the scheduler to detect key-level transitions
 *  - Quota state (daily_requests_used / remaining / rpm) is tracked from
 *    UW response headers and exposed via getLiveRefreshLog()
 *
 * Safety rules:
 *  - Every job is wrapped in try/catch; a failure never crashes the server
 *  - Timers use .unref() so they don't prevent clean exit in tests
 */

import { getFmpSnapshot } from '../adapters/fmp/index.js';
import { refreshUwProvider } from '../state/uwProvider.js';
import { writeThetaSnapshot } from '../storage/theta-snapshot.js';
import { pushSpotPrice, getPriceHistory } from '../state/price-history-buffer.js';
import {
  createAdaptiveScheduler,
  getAdaptiveScheduler,
} from './adaptive-refresh-scheduler.js';
import { detectAbStateChange } from '../state/ab-state-watcher.js';
import { sendAbTelegramAlerts } from '../alerts/telegram-ab-alert.js';
import { getCurrentSignal } from '../decision_engine/current-signal.js';
import { maybeSendPreMarketSnapshot } from '../alerts/pre-market-snapshot.js';

// ─── ET time helper (for warmup window detection) ────────────────────────────
function _etMinutesNow() {
  const now = new Date();
  const year = now.getUTCFullYear();
  // DST start: 2nd Sunday of March at 02:00 ET
  const dstStart = (() => {
    const d = new Date(Date.UTC(year, 2, 1));
    const firstSun = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 2, 1 + firstSun + 7, 7));
  })();
  // DST end: 1st Sunday of November at 02:00 ET
  const dstEnd = (() => {
    const d = new Date(Date.UTC(year, 10, 1));
    const firstSun = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 10, 1 + firstSun, 6));
  })();
  const offsetH = (now >= dstStart && now < dstEnd) ? 4 : 5;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utcMin - offsetH * 60) + 1440) % 1440;
}

// ─── Fixed intervals for non-UW jobs (milliseconds) ──────────────────────────
const FIXED_INTERVALS = {
  fmp_price:  60_000,   // FMP SPX spot price  – every 60 s
  fmp_event: 120_000,   // FMP economic calendar – every 2 min
  theta:      30_000,   // Theta stale-guard – every 30 s
};

// ─── In-memory refresh log ────────────────────────────────────────────────────
const refreshLog = {
  fmp_price: { name: 'fmp_price', last_run_at: null, last_status: 'waiting', message: '等待首次刷新。' },
  fmp_event: { name: 'fmp_event', last_run_at: null, last_status: 'waiting', message: '等待首次刷新。' },
  uw:        { name: 'uw',        last_run_at: null, last_status: 'waiting', message: '等待首次刷新。' },
  theta:     { name: 'theta',     last_run_at: null, last_status: 'waiting', message: '等待首次刷新。' },
};

// ─── Quota state (updated from UW response headers) ──────────────────────────
let _quotaState = {
  daily_limit:         250,
  daily_requests_used: 0,
  remaining:           250,
  rpm:                 null,
  rpm_limit:           null,
  usage_pct:           0,
  last_updated_at:     null,
};

// ─── Adaptive scheduler mode state ───────────────────────────────────────────
let _schedulerMode = 'normal';
let _schedulerTurboReason = null;

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

/**
 * Extract price context from a UW snapshot for the adaptive scheduler.
 * Reads the normalized output to get spot, atm, walls, flow metrics.
 */
function extractPriceContext(snapshot) {
  if (!snapshot) return {};
  try {
    const norm = snapshot.normalized;
    if (!norm) return {};

    // snapshot.normalized = { uw_raw: {...}, uw_factors: { flow_factors, dealer_factors, darkpool_factors, ... } }
    const uwFactors = norm.uw_factors || {};
    const flow    = uwFactors.flow_factors    || {};
    const dealer  = uwFactors.dealer_factors  || {};
    const dark    = uwFactors.darkpool_factors || {};

    // Spot price from uw_raw.flow_recent[0].underlying_price
    // flow_recent is stored as { path, status, fetched_at, data: [...] } wrapper
    const uwRawCtx = norm.uw_raw || {};
    const _fr = uwRawCtx.flow_recent;
    const flowRecentCtx = Array.isArray(_fr) ? _fr
      : Array.isArray(_fr?.data?.data) ? _fr.data.data
      : Array.isArray(_fr?.data) ? _fr.data
      : [];
    let spot = null;
    for (const row of flowRecentCtx) {
      const p = Number(row?.underlying_price);
      if (Number.isFinite(p) && p >= 3000 && p <= 12000) { spot = p; break; }
    }

    // ATM from conclusion
    const conclusion = norm.conclusion || {};
    const atm = conclusion.atm ?? null;

    // Walls from dealer
    const near_call_wall = dealer.near_call_wall ?? null;
    const near_put_wall  = dealer.near_put_wall  ?? null;
    const bull_trigger   = dealer.near_call_wall ?? null;  // same as near_call_wall
    const bear_trigger   = dealer.near_put_wall  ?? null;  // same as near_put_wall

    // Net premium (in raw dollars, not millions)
    const net_premium = flow.net_premium ?? null;

    // P/C ratio
    const put_call_ratio = flow.put_call_ratio ?? null;

    // Darkpool max level premium
    const levels = dark.levels || [];
    let darkpool_max_level_premium = null;
    for (const lv of levels) {
      const prem = lv.premium ?? 0;
      if (darkpool_max_level_premium === null || prem > darkpool_max_level_premium) {
        darkpool_max_level_premium = prem;
      }
    }

    return {
      spot,
      atm,
      near_call_wall,
      near_put_wall,
      bull_trigger,
      bear_trigger,
      net_premium,
      put_call_ratio,
      darkpool_max_level_premium,
    };
  } catch {
    return {};
  }
}

// ─── UW per-endpoint refresh callback ────────────────────────────────────────
/**
 * Called by AdaptiveRefreshScheduler for each endpoint.
 * We run a full UW snapshot refresh (which internally uses TTL cache,
 * so only stale endpoints are actually fetched).
 * This is intentional: we let uw-api-provider's TTL logic decide
 * which endpoints need a real HTTP request.
 */
async function runUwEndpointRefresh(endpointName) {
  const mode = String(process.env.UW_PROVIDER_MODE || '').toLowerCase();
  if (mode !== 'api') return;
  if (!process.env.UW_API_KEY) return;

  // Pass current spot price so spot_gex requests use min/max_strike filtering
  // (±15% band around current SPX price for precise GEX wall calculation)
  const priceHistory = getPriceHistory();
  const currentSpot = priceHistory.spot_now ?? null;

  // Override the TTL for this specific endpoint to force a refresh
  // by passing a hint via options (uw-api-provider will check ttlSeconds)
  const snapshot = await refreshUwProvider({
    forceEndpoint: endpointName,  // hint — provider may ignore if not supported
    currentSpot,
  });

  if (!snapshot) return;

  // Update quota from rate_limit in provider
  const rl = snapshot?.provider?.rate_limit;
  if (rl) {
    const scheduler = getAdaptiveScheduler();
    if (scheduler) {
      scheduler.updateQuota({
        daily_limit: rl.daily_limit,
        remaining:   rl.remaining,
        rpm:         rl.per_minute_limit,
      });
    }
  }

  // Extract spot price and push to price history buffer
  // snapshot.normalized.uw_raw stores raw endpoint responses as wrapper objects:
  //   { path, status, fetched_at, data: [...] }  (UW API format)
  // Use the same asArray-style unwrapping as uw-api-normalizer.js
  function _unwrapArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    const d = value.data;
    if (d !== undefined) {
      if (Array.isArray(d?.data)) return d.data;
      if (Array.isArray(d)) return d;
    }
    return [];
  }
  const norm = snapshot?.normalized;
  const uwRaw = norm?.uw_raw || {};
  const flowRecentRows = _unwrapArray(uwRaw.flow_recent);
  let spot = null;
  for (const row of flowRecentRows) {
    const p = Number(row?.underlying_price);
    if (Number.isFinite(p) && p >= 3000 && p <= 12000) { spot = p; break; }
  }
  // Fallback: spot_gex rows
  if (spot == null) {
    const spotGexRows = _unwrapArray(uwRaw.spot_gex);
    for (const row of spotGexRows) {
      const p = Number(row?.price);
      if (Number.isFinite(p) && p >= 3000 && p <= 12000) { spot = p; break; }
    }
  }
  if (typeof spot === 'number' && spot > 0) {
    pushSpotPrice(spot);
  }

  // Update price context in adaptive scheduler
  const ctx = extractPriceContext(snapshot);
  const scheduler = getAdaptiveScheduler();
  if (scheduler && Object.keys(ctx).length > 0) {
    scheduler.updatePriceContext(ctx);
  }

  const status = snapshot?.provider?.status || 'unknown';
  const ok = ['live', 'partial'].includes(status);
  markRefresh(
    'uw',
    ok ? 'ok' : 'degraded',
    `UW [${endpointName}] refresh: status=${status}, mode=${_schedulerMode}`
  );

  // ── A/B 单状态变化检测 → Telegram 告警 ─────────────────────────────────────
  // Fire-and-forget: run after UW snapshot is refreshed, non-blocking.
  // getCurrentSignal() recomputes the full signal pipeline (including ab_order_engine).
  // Only runs when TELEGRAM_ENABLED=true to avoid unnecessary computation.
  queueMicrotask(async () => {
    try {
      const telegramEnabled =
        String(process.env.TELEGRAM_ENABLED || '').toLowerCase() === 'true';
      if (!telegramEnabled) return;

      const signal = await getCurrentSignal();
      const ab = signal?.ab_order_engine;
      if (!ab) return;

      const events = detectAbStateChange(ab);
      if (events.length === 0) return;

      const result = await sendAbTelegramAlerts(events);
      if (result.sent > 0) {
        console.log(
          `[scheduler] A/B alert sent: ${result.sent} sent, ` +
          `${result.skipped} skipped, ${result.errors} errors`
        );
      }
    } catch (err) {
      // Never crash the scheduler — log and continue
      console.error('[scheduler] ab-state-watcher error:', err.message);
    }
  });
}

// ─── Fixed job implementations ────────────────────────────────────────────────

async function runFmpPriceJob() {
  try {
    const { price } = await getFmpSnapshot({ price: {} });
    const ok = price?.available === true && price?.price != null;
    if (ok && typeof price.price === 'number') {
      pushSpotPrice(price.price);
    }
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

  // ── 1. Create adaptive scheduler for UW endpoints ──────────────────────────
  const adaptiveScheduler = createAdaptiveScheduler({
    onRefresh: runUwEndpointRefresh,

    onQuotaUpdate: (quota) => {
      _quotaState = { ..._quotaState, ...quota };
      markRefresh(
        'uw',
        quota.usage_pct >= 90 ? 'minimal' : quota.usage_pct >= 80 ? 'throttle' : 'ok',
        `UW quota: ${quota.daily_requests_used}/${quota.daily_limit} (${quota.usage_pct}%), ` +
        `remaining=${quota.remaining}, mode=${_schedulerMode}`
      );
    },

    onModeChange: ({ mode, prev_mode, reason }) => {
      _schedulerMode = mode;
      _schedulerTurboReason = reason;
      console.log(`[scheduler] UW mode: ${prev_mode} → ${mode}${reason ? ` — ${reason}` : ''}`);
      markRefresh(
        'uw',
        'ok',
        `UW scheduler mode changed: ${prev_mode} → ${mode}${reason ? ` (${reason})` : ''}`
      );
    },
  });

  adaptiveScheduler.start();

  // ── 1b. Cold-start warmup (08:30–09:30 ET = 20:30–21:30 BJ) ─────────────────
  // If the service starts/restarts during the pre-market window, immediately fire
  // a full UW refresh to populate the price history buffer so the homepage is
  // NOT locked when the market opens at 09:30 ET.
  const UW_WARMUP_ENDPOINTS = [
    'flow_recent', 'net_prem_ticks', 'market_tide', 'darkpool_spy',
    'greek_exposure_strike', 'interpolated_iv', 'iv_rank', 'options_volume',
  ];
  (async () => {
    const etMin = _etMinutesNow();
    const dow = new Date().getUTCDay();
    const isWeekday = dow >= 1 && dow <= 5;
    // Warmup window: 08:30–09:30 ET (510–570 min)
    const inWarmupWindow = etMin >= 8 * 60 + 30 && etMin < 9 * 60 + 30;
    // Also warmup if market is open (09:30–16:00 ET) and buffer is empty (cold restart)
    const inMarketHours = etMin >= 9 * 60 + 30 && etMin < 16 * 60;
    if (isWeekday && (inWarmupWindow || inMarketHours)) {
      console.log('[scheduler] Cold-start warmup: firing flow_recent to populate price buffer...');
      try {
        await runUwEndpointRefresh('flow_recent');
        // After flow_recent, check if we got a spot price; if buffer still empty,
        // seed it with 10 identical points so homepage unlocks immediately.
        const hist = getPriceHistory();
        if (hist.spot_now != null && hist.buffer_size < 10) {
          const seedPrice = hist.spot_now;
          const needed = 10 - hist.buffer_size;
          console.log(`[scheduler] Seeding price buffer with ${needed} points at ${seedPrice}`);
          for (let i = 0; i < needed; i++) pushSpotPrice(seedPrice);
        }
        console.log('[scheduler] Cold-start warmup complete. buffer_size:', getPriceHistory().buffer_size);
      } catch (e) {
        console.warn('[scheduler] warmup flow_recent failed:', e.message);
      }
      // Fire remaining endpoints in background (non-blocking)
      (async () => {
        for (const ep of UW_WARMUP_ENDPOINTS.filter(e => e !== 'flow_recent')) {
          try { await runUwEndpointRefresh(ep); }
          catch { /* ignore */ }
        }
      })().catch(() => {});
    }
  })().catch((e) => console.error('[scheduler] warmup error:', e.message));

  // Daily warmup scheduler: check every 60s, fire once per day at 08:30 ET
  let _warmupFiredDate = null;
  setInterval(() => {
    const now = new Date();
    const dow = now.getUTCDay();
    if (dow === 0 || dow === 6) return;
    const etMin = _etMinutesNow();
    if (etMin < 8 * 60 + 30 || etMin >= 8 * 60 + 35) return; // 08:30–08:34 ET window
    const todayET = now.toISOString().slice(0, 10);
    if (_warmupFiredDate === todayET) return;
    _warmupFiredDate = todayET;
    console.log('[scheduler] Daily 08:30 ET warmup: firing full UW refresh...');
    (async () => {
      for (const ep of UW_WARMUP_ENDPOINTS) {
        try { await runUwEndpointRefresh(ep); } catch { /* ignore */ }
      }
      console.log('[scheduler] Daily warmup complete.');
    })().catch(() => {});
  }, 60_000).unref?.();

  // ── 2. Fixed jobs (FMP, Theta) ──────────────────────────────────────────────────────────────────────────────────────
  const fixedJobs = [
    { name: 'fmp_price', fn: runFmpPriceJob,       interval: FIXED_INTERVALS.fmp_price },
    { name: 'fmp_event', fn: runFmpEventJob,        interval: FIXED_INTERVALS.fmp_event },
    { name: 'theta',     fn: runThetaStaleGuardJob, interval: FIXED_INTERVALS.theta },
  ];

  // ── 3. Pre-market snapshot (09:25 ET, once per day) ──────────────────────────────────────────────
  // Checks every 60 s; maybeSendPreMarketSnapshot() self-gates on time + date.
  setInterval(() => {
    maybeSendPreMarketSnapshot(getCurrentSignal).catch((err) => {
      console.error('[scheduler] pre-market-snapshot error:', err.message);
    });
  }, 60_000).unref?.();

  for (const job of fixedJobs) {
    job.fn().catch((error) => markError(job.name, error));
    setInterval(() => {
      job.fn().catch((error) => markError(job.name, error));
    }, job.interval).unref?.();
  }

  console.log('[scheduler] live-refresh-scheduler started with adaptive UW + fixed FMP/Theta jobs.');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function getLiveRefreshLog() {
  const base = Object.values(refreshLog);
  // Append adaptive scheduler state
  const scheduler = getAdaptiveScheduler();
  if (scheduler) {
    const state = scheduler.getState();
    return [
      ...base,
      {
        name: 'uw_adaptive',
        last_run_at: new Date().toISOString(),
        last_status: state.mode === 'minimal' ? 'minimal'
          : state.mode === 'throttle' ? 'throttle'
          : state.mode === 'turbo' ? 'turbo'
          : 'normal',
        message: `mode=${state.mode}${state.turbo_reason ? ` (${state.turbo_reason})` : ''}`,
        adaptive_state: state,
      }
    ];
  }
  return base;
}

export function getLiveRefreshIntervals() {
  return { ...FIXED_INTERVALS };
}

/**
 * Get the current quota state (for /health endpoint).
 */
export function getUwQuotaState() {
  return { ..._quotaState };
}

/**
 * Get the current adaptive scheduler mode (for /health endpoint).
 */
export function getAdaptiveSchedulerMode() {
  return {
    mode:         _schedulerMode,
    turbo_reason: _schedulerTurboReason,
    quota:        { ..._quotaState },
  };
}

/**
 * Manually update price context (called from signal computation pipeline
 * after /signals/current is computed, to feed back into the scheduler).
 */
export function updateSchedulerPriceContext(ctx = {}) {
  const scheduler = getAdaptiveScheduler();
  if (scheduler) scheduler.updatePriceContext(ctx);
}
