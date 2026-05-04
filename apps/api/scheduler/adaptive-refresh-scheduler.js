/**
 * adaptive-refresh-scheduler.js
 *
 * Self-adjusting UW API refresh scheduler with two speed modes:
 *
 *  NORMAL mode  — conservative intervals to stay within daily quota
 *  TURBO  mode  — accelerated intervals when price is near a key level
 *
 * Key-level triggers (switch to TURBO):
 *  - spot within ±5 of ATM
 *  - spot within ±10 of near_call_wall or near_put_wall
 *  - spot within ±10 of bull_trigger or bear_trigger
 *  - net_premium acceleration (|Δ5m| > 50 M)
 *  - put_call_ratio spike (Δ > 0.3 in 30 s)
 *  - darkpool large print (single level premium > $20 M)
 *
 * Quota protection:
 *  - Track daily_requests_used / remaining / rpm from UW response headers
 *  - > 80% daily quota  → THROTTLE mode (2× normal intervals)
 *  - > 90% daily quota  → MINIMAL mode (only spot + flow + net-prem)
 *  - Endpoint failure   → exponential backoff (2s → 4s → 8s … max 300s)
 *
 * All endpoints carry:
 *  fetched_at     — ISO timestamp of last successful fetch
 *  age_seconds    — seconds since fetched_at
 *  status         — 'live' | 'stale' | 'missing' | 'error'
 *
 * Usage:
 *   import { AdaptiveRefreshScheduler } from './adaptive-refresh-scheduler.js';
 *   const scheduler = new AdaptiveRefreshScheduler({ onRefresh, onQuotaUpdate });
 *   scheduler.start();
 *   scheduler.updatePriceContext({ spot, atm, near_call_wall, near_put_wall, ... });
 *   scheduler.stop();
 */

// ─── US market hours gate ────────────────────────────────────────────────────
/**
 * Returns true if current UTC time falls within the active trading window:
 *   Monday–Friday, 09:00–14:00 US Eastern Time.
 *
 * 09:00 ET start: captures pre-open flow + first 30 min before regular open.
 * 14:00 ET end:   covers the most active trading hours; user typically
 *                 stops trading by 14:00 ET.
 *
 * EDT (summer, UTC-4): 13:00–18:00 UTC
 * EST (winter, UTC-5): 14:00–19:00 UTC
 *
 * We use a simple UTC-offset approach:
 *   - 2nd Sunday in March → 1st Sunday in November: EDT (UTC-4)
 *   - Otherwise: EST (UTC-5)
 */
function isUsMarketHours() {
  const now   = new Date();
  const dow   = now.getUTCDay();          // 0=Sun … 6=Sat
  if (dow === 0 || dow === 6) return false; // weekend

  // Determine whether we are in EDT or EST
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;    // 1-12

  // DST start: 2nd Sunday in March at 02:00 EST = 07:00 UTC
  const dstStart = (() => {
    const d = new Date(Date.UTC(year, 2, 1));          // March 1
    const firstSun = (7 - d.getUTCDay()) % 7;         // days to first Sunday
    return new Date(Date.UTC(year, 2, 1 + firstSun + 7, 7)); // +7 days = 2nd Sunday 07:00 UTC
  })();

  // DST end: 1st Sunday in November at 02:00 EDT = 06:00 UTC
  const dstEnd = (() => {
    const d = new Date(Date.UTC(year, 10, 1));         // November 1
    const firstSun = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 10, 1 + firstSun, 6)); // 1st Sunday 06:00 UTC
  })();

  const isEDT = now >= dstStart && now < dstEnd;
  const offsetHours = isEDT ? 4 : 5;    // UTC-4 (EDT) or UTC-5 (EST)

  // Convert UTC to ET minutes-of-day
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const etMinutes  = ((utcMinutes - offsetHours * 60) + 1440) % 1440;

  // Active window: 09:00–14:00 ET
  return etMinutes >= 9 * 60 && etMinutes < 14 * 60;
}

// ─── Market phase detection ───────────────────────────────────────────────────
/**
 * Returns the current market phase based on ET time:
 *   'sprint'  — 09:00–09:45 ET: opening sprint, highest frequency
 *   'main'    — 09:45–13:30 ET: main session, balanced frequency
 *   'closing' — 13:30–14:00 ET: closing sprint, elevated frequency
 *   'closed'  — outside window: no fetching
 *
 * Quota budget (09:00–14:00 ET, 5h total):
 *   Sprint  (45 min):  ~490 req
 *   Main   (225 min): ~1185 req
 *   Closing (30 min):  ~227 req
 *   TOTAL: ~1,902 req/day — 87.3% buffer vs 15,000 daily limit
 */
function getMarketPhase() {
  const now  = new Date();
  const dow  = now.getUTCDay();
  if (dow === 0 || dow === 6) return 'closed';

  const year = now.getUTCFullYear();
  const dstStart = (() => {
    const d = new Date(Date.UTC(year, 2, 1));
    const firstSun = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 2, 1 + firstSun + 7, 7));
  })();
  const dstEnd = (() => {
    const d = new Date(Date.UTC(year, 10, 1));
    const firstSun = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 10, 1 + firstSun, 6));
  })();
  const isEDT = now >= dstStart && now < dstEnd;
  const offsetHours = isEDT ? 4 : 5;

  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const etMinutes  = ((utcMinutes - offsetHours * 60) + 1440) % 1440;

  if (etMinutes >= 9 * 60      && etMinutes < 9 * 60 + 45)  return 'sprint';   // 09:00–09:45
  if (etMinutes >= 9 * 60 + 45 && etMinutes < 13 * 60 + 30) return 'main';     // 09:45–13:30
  if (etMinutes >= 13 * 60 + 30 && etMinutes < 14 * 60)     return 'closing';  // 13:30–14:00
  return 'closed';
}

// ─── Interval tables (milliseconds) ──────────────────────────────────────────
/**
 * SPRINT intervals — 09:00–09:45 ET (45 min = 2,700s)
 * Highest frequency: capture opening flow, GEX shifts, first-candle direction.
 * Budget: ~490 req
 */
export const SPRINT_INTERVALS = Object.freeze({
  flow_recent:            15_000,   //  15 s — 180 req
  net_prem_ticks:         20_000,   //  20 s — 135 req
  market_tide:            30_000,   //  30 s —  90 req
  options_volume:         60_000,   //  60 s —  45 req
  darkpool_spy:          120_000,   // 120 s —  22 req
  greek_exposure_strike: 300_000,   // 300 s —   9 req
  interpolated_iv:       600_000,   // 600 s —   4 req
  iv_rank:               600_000,   // 600 s —   4 req
  // SPRINT TOTAL: ~490 req
});

/**
 * MAIN intervals — 09:45–13:30 ET (225 min = 13,500s)
 * Balanced frequency: sustain data freshness through core trading hours.
 * Budget: ~1,185 req
 */
export const NORMAL_INTERVALS = Object.freeze({
  flow_recent:            30_000,   //  30 s — 450 req
  net_prem_ticks:         45_000,   //  45 s — 300 req
  market_tide:            60_000,   //  60 s — 225 req
  options_volume:        120_000,   // 120 s — 112 req
  darkpool_spy:          300_000,   // 300 s —  45 req
  greek_exposure_strike: 600_000,   // 600 s —  22 req
  interpolated_iv:       900_000,   // 900 s —  15 req
  iv_rank:               900_000,   // 900 s —  15 req
  // MAIN TOTAL: ~1,185 req
});

/**
 * CLOSING intervals — 13:30–14:00 ET (30 min = 1,800s)
 * Elevated frequency: capture end-of-session flow and final positioning.
 * Budget: ~227 req
 */
export const CLOSING_INTERVALS = Object.freeze({
  flow_recent:            20_000,   //  20 s —  90 req
  net_prem_ticks:         30_000,   //  30 s —  60 req
  market_tide:            45_000,   //  45 s —  40 req
  options_volume:         90_000,   //  90 s —  20 req
  darkpool_spy:          180_000,   // 180 s —  10 req
  greek_exposure_strike: 600_000,   // 600 s —   3 req
  interpolated_iv:       900_000,   // 900 s —   2 req
  iv_rank:               900_000,   // 900 s —   2 req
  // CLOSING TOTAL: ~227 req
});

/**
 * Turbo mode intervals — activated when near key levels
 */
export const TURBO_INTERVALS = Object.freeze({
  flow_recent:            20_000,   //  20 s — near key level (was 5s)
  net_prem_ticks:         30_000,   //  30 s (was 10s)
  market_tide:            45_000,   //  45 s (was 15s)
  options_volume:        120_000,   // 120 s (was 30s)
  darkpool_spy:          300_000,   // 300 s (was 60s)
  greek_exposure_strike: 600_000,   // 600 s (was 120s)
  interpolated_iv:       600_000,   // 600 s (was 120s)
  iv_rank:               900_000,   // 900 s (unchanged)
  // TURBO total ~6048 req/day — still within 15,000 limit
});

/**
 * Throttle mode (>80% quota) — 2× normal
 */
export const THROTTLE_INTERVALS = Object.freeze(
  Object.fromEntries(
    Object.entries(NORMAL_INTERVALS).map(([k, v]) => [k, v * 2])
  )
);

/**
 * Minimal mode (>90% quota) — only critical endpoints
 */
export const MINIMAL_ENDPOINTS = new Set([
  'flow_recent',
  'net_prem_ticks',
  'darkpool_spy',
]);

// ─── Stale thresholds (seconds) ───────────────────────────────────────────────
const STALE_THRESHOLDS = {
  flow_recent:           120,   // 2× normal interval
  net_prem_ticks:        180,
  market_tide:           240,
  options_volume:        600,
  darkpool_spy:         1200,
  greek_exposure_strike:1800,
  interpolated_iv:      1800,
  iv_rank:              1800,
};

// ─── Exponential backoff config ───────────────────────────────────────────────
const BACKOFF_BASE_MS   = 2_000;
const BACKOFF_MAX_MS    = 300_000;
const BACKOFF_MULTIPLIER = 2;

// ─── Key-level proximity thresholds ──────────────────────────────────────────
const ATM_PROXIMITY         = 5;    // ±5 pts from ATM
const WALL_PROXIMITY        = 10;   // ±10 pts from call/put wall
const TRIGGER_PROXIMITY     = 10;   // ±10 pts from bull/bear trigger
const NET_PREM_ACCEL_M      = 50;   // |Δ net_premium| > $50M in 30s
const PC_RATIO_SPIKE        = 0.3;  // Δ put_call_ratio > 0.3 in 30s
const DARKPOOL_LARGE_PRINT_M = 20;  // single level premium > $20M

// ─── Main class ───────────────────────────────────────────────────────────────

export class AdaptiveRefreshScheduler {
  /**
   * @param {object} opts
   *   onRefresh(endpointName: string): Promise<void>  — called to refresh one endpoint
   *   onQuotaUpdate(quotaState: object): void         — called when quota changes
   *   onModeChange(mode: string): void                — called when speed mode changes
   */
  constructor({ onRefresh, onQuotaUpdate, onModeChange } = {}) {
    this._onRefresh     = onRefresh     || (() => Promise.resolve());
    this._onQuotaUpdate = onQuotaUpdate || (() => {});
    this._onModeChange  = onModeChange  || (() => {});

    // Speed mode: 'normal' | 'turbo' | 'throttle' | 'minimal'
    this._mode = 'normal';

    // Per-endpoint state
    this._endpointState = {};
    for (const name of Object.keys(NORMAL_INTERVALS)) {
      this._endpointState[name] = {
        name,
        last_fetch_at:    null,   // ISO timestamp of last successful fetch
        last_attempt_at:  null,   // ISO timestamp of last attempt (success or fail)
        consecutive_fails: 0,
        backoff_until:    null,   // Date.now() ms — don't retry before this
        status:           'missing',  // 'live' | 'stale' | 'missing' | 'error'
        age_seconds:      null,
      };
    }

    // Quota tracking
    this._quota = {
      daily_limit:          250,   // UW free plan default
      daily_requests_used:  0,
      remaining:            250,
      rpm:                  null,
      rpm_limit:            null,
      last_updated_at:      null,
      usage_pct:            0,
    };

    // Price context for key-level detection
    this._priceContext = {
      spot:            null,
      atm:             null,
      near_call_wall:  null,
      near_put_wall:   null,
      bull_trigger:    null,
      bear_trigger:    null,
      net_premium:     null,
      net_premium_prev:null,
      net_premium_ts:  null,
      put_call_ratio:  null,
      pc_ratio_prev:   null,
      pc_ratio_ts:     null,
      darkpool_max_level_premium: null,
    };

    // Timer handles
    this._timers = {};
    this._started = false;
    this._turboReason = null;
    this._turboUntil  = null;   // ms — stay in turbo for at least 60s after trigger
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  start() {
    if (this._started) return;
    this._started = true;
    this._scheduleAll();
    console.log('[adaptive-scheduler] started in mode:', this._mode);
  }

  stop() {
    this._started = false;
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
    console.log('[adaptive-scheduler] stopped.');
  }

  /**
   * Update price context from the latest /signals/current output.
   * Called by live-refresh-scheduler after each UW refresh.
   */
  updatePriceContext(ctx = {}) {
    const prev = { ...this._priceContext };
    const now  = Date.now();

    // Update net_premium history
    if (ctx.net_premium != null && ctx.net_premium !== prev.net_premium) {
      this._priceContext.net_premium_prev = prev.net_premium;
      this._priceContext.net_premium_ts   = now;
    }
    // Update P/C ratio history
    if (ctx.put_call_ratio != null && ctx.put_call_ratio !== prev.put_call_ratio) {
      this._priceContext.pc_ratio_prev = prev.put_call_ratio;
      this._priceContext.pc_ratio_ts   = now;
    }

    Object.assign(this._priceContext, ctx);
    this._evaluateMode();
  }

  /**
   * Update quota state from UW response headers.
   * Called by uw-api-provider after each successful fetch.
   */
  updateQuota({ daily_limit, remaining, rpm, rpm_limit } = {}) {
    const now = new Date().toISOString();
    if (daily_limit != null) this._quota.daily_limit = daily_limit;
    if (remaining   != null) this._quota.remaining   = remaining;
    if (rpm         != null) this._quota.rpm         = rpm;
    if (rpm_limit   != null) this._quota.rpm_limit   = rpm_limit;

    const used = this._quota.daily_limit - this._quota.remaining;
    this._quota.daily_requests_used = Math.max(0, used);
    this._quota.usage_pct = this._quota.daily_limit > 0
      ? Math.round((used / this._quota.daily_limit) * 100)
      : 0;
    this._quota.last_updated_at = now;

    this._onQuotaUpdate({ ...this._quota });
    this._evaluateMode();
  }

  /**
   * Record a successful fetch for an endpoint.
   * Called by uw-api-provider after a successful HTTP response.
   */
  recordSuccess(name) {
    const state = this._endpointState[name];
    if (!state) return;
    const now = new Date().toISOString();
    state.last_fetch_at       = now;
    state.last_attempt_at     = now;
    state.consecutive_fails   = 0;
    state.backoff_until       = null;
    state.status              = 'live';
    state.age_seconds         = 0;
  }

  /**
   * Record a failed fetch for an endpoint (applies exponential backoff).
   */
  recordFailure(name, error = null) {
    const state = this._endpointState[name];
    if (!state) return;
    state.last_attempt_at   = new Date().toISOString();
    state.consecutive_fails += 1;
    state.status            = 'error';

    const backoffMs = Math.min(
      BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, state.consecutive_fails - 1),
      BACKOFF_MAX_MS
    );
    state.backoff_until = Date.now() + backoffMs;

    console.warn(
      `[adaptive-scheduler] ${name} failed (attempt ${state.consecutive_fails}),` +
      ` backoff ${backoffMs / 1000}s. Error: ${error?.message || error}`
    );
  }

  /**
   * Get a snapshot of the current scheduler state (for /health or /signals/current).
   */
  getState() {
    const endpointStatus = {};
    for (const [name, state] of Object.entries(this._endpointState)) {
      const age = state.last_fetch_at
        ? Math.round((Date.now() - new Date(state.last_fetch_at).getTime()) / 1000)
        : null;
      const staleThreshold = STALE_THRESHOLDS[name] ?? 300;
      let status = state.status;
      if (status === 'live' && age != null && age > staleThreshold) status = 'stale';
      if (status === 'live' && age == null) status = 'missing';
      endpointStatus[name] = {
        ...state,
        age_seconds:      age,
        status,
        interval_normal:  NORMAL_INTERVALS[name],
        interval_turbo:   TURBO_INTERVALS[name],
        interval_current: this._currentInterval(name),
      };
    }
    return {
      mode:         this._mode,
      turbo_reason: this._turboReason,
      turbo_until:  this._turboUntil ? new Date(this._turboUntil).toISOString() : null,
      quota:        { ...this._quota },
      endpoints:    endpointStatus,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _currentInterval(name) {
    // Phase-aware base interval
    const phase = getMarketPhase();
    let baseInterval;
    switch (phase) {
      case 'sprint':  baseInterval = SPRINT_INTERVALS[name]  ?? NORMAL_INTERVALS[name]; break;
      case 'closing': baseInterval = CLOSING_INTERVALS[name] ?? NORMAL_INTERVALS[name]; break;
      default:        baseInterval = NORMAL_INTERVALS[name]; break;  // 'main' or 'closed'
    }

    // Apply speed-mode multiplier on top of phase base
    switch (this._mode) {
      case 'turbo':    return Math.min(baseInterval, TURBO_INTERVALS[name] ?? baseInterval);
      case 'throttle': return baseInterval * 2;
      case 'minimal':  return MINIMAL_ENDPOINTS.has(name) ? baseInterval * 2 : null;
      default:         return baseInterval;
    }
  }

  _scheduleAll() {
    for (const name of Object.keys(NORMAL_INTERVALS)) {
      this._scheduleEndpoint(name, 0);  // fire immediately
    }
  }

  _scheduleEndpoint(name, delayMs) {
    if (!this._started) return;
    if (this._timers[name]) {
      clearTimeout(this._timers[name]);
      delete this._timers[name];
    }

    const interval = this._currentInterval(name);
    if (interval == null) return;  // minimal mode — skip non-critical endpoint

    this._timers[name] = setTimeout(async () => {
      await this._runEndpoint(name);
      this._scheduleEndpoint(name, this._currentInterval(name) ?? NORMAL_INTERVALS[name]);
    }, delayMs).unref?.();
  }

   async _runEndpoint(name) {
    if (!this._started) return;
    const state = this._endpointState[name];
    if (!state) return;
    // ── Market-hours gate ───────────────────────────────────────────────────────
    // Skip UW API calls outside active trading window (09:00–14:00 ET, Mon–Fri).
    // Phase-aware intervals:
    //   sprint  09:00–09:45: flow_recent=15s, ~490 req
    //   main    09:45–13:30: flow_recent=30s, ~1185 req
    //   closing 13:30–14:00: flow_recent=20s, ~227 req
    //   TOTAL: ~1,902 req/day (87.3% buffer vs 15,000 limit)
    // Allow override via env var UW_IGNORE_MARKET_HOURS=true for testing.
    const phase = getMarketPhase();
    if (phase === 'closed' && process.env.UW_IGNORE_MARKET_HOURS !== 'true') {
      // Silently skip — no log spam, no backoff penalty
      return;
    }

    // Respect backoff
    if (state.backoff_until && Date.now() < state.backoff_until) {
      const waitSec = Math.round((state.backoff_until - Date.now()) / 1000);
      console.log(`[adaptive-scheduler] ${name} in backoff, ${waitSec}s remaining`);
       return;
    }
    try {
      await this._onRefresh(name);
      this.recordSuccess(name);
    } catch (err) {
      this.recordFailure(name, err);
    }
  }

  _evaluateMode() {
    const prevMode = this._mode;
    const usagePct = this._quota.usage_pct;
    const now      = Date.now();

    // Quota-based mode (highest priority)
    if (usagePct >= 90) {
      this._setMode('minimal', 'quota > 90%');
      return;
    }
    if (usagePct >= 80) {
      this._setMode('throttle', 'quota > 80%');
      return;
    }

    // Check if still in turbo hold period
    if (this._turboUntil && now < this._turboUntil) {
      this._setMode('turbo', this._turboReason);
      return;
    }

    // Key-level detection
    const reason = this._detectKeyLevel();
    if (reason) {
      this._turboReason = reason;
      this._turboUntil  = now + 60_000;  // hold turbo for 60s minimum
      this._setMode('turbo', reason);
      return;
    }

    // Default: normal
    this._setMode('normal', null);
  }

  _detectKeyLevel() {
    const ctx = this._priceContext;
    const spot = ctx.spot;
    if (spot == null) return null;

    // 1. Near ATM
    if (ctx.atm != null && Math.abs(spot - ctx.atm) <= ATM_PROXIMITY) {
      return `spot ${spot} within ±${ATM_PROXIMITY} of ATM ${ctx.atm}`;
    }

    // 2. Near call wall
    if (ctx.near_call_wall != null && Math.abs(spot - ctx.near_call_wall) <= WALL_PROXIMITY) {
      return `spot ${spot} within ±${WALL_PROXIMITY} of call_wall ${ctx.near_call_wall}`;
    }

    // 3. Near put wall
    if (ctx.near_put_wall != null && Math.abs(spot - ctx.near_put_wall) <= WALL_PROXIMITY) {
      return `spot ${spot} within ±${WALL_PROXIMITY} of put_wall ${ctx.near_put_wall}`;
    }

    // 4. Near bull trigger
    if (ctx.bull_trigger != null && Math.abs(spot - ctx.bull_trigger) <= TRIGGER_PROXIMITY) {
      return `spot ${spot} within ±${TRIGGER_PROXIMITY} of bull_trigger ${ctx.bull_trigger}`;
    }

    // 5. Near bear trigger
    if (ctx.bear_trigger != null && Math.abs(spot - ctx.bear_trigger) <= TRIGGER_PROXIMITY) {
      return `spot ${spot} within ±${TRIGGER_PROXIMITY} of bear_trigger ${ctx.bear_trigger}`;
    }

    // 6. Net premium acceleration
    const now = Date.now();
    if (
      ctx.net_premium != null &&
      ctx.net_premium_prev != null &&
      ctx.net_premium_ts != null &&
      (now - ctx.net_premium_ts) <= 30_000
    ) {
      const deltaPremM = Math.abs(ctx.net_premium - ctx.net_premium_prev) / 1_000_000;
      if (deltaPremM > NET_PREM_ACCEL_M) {
        return `net_premium acceleration: Δ${deltaPremM.toFixed(0)}M in 30s`;
      }
    }

    // 7. P/C ratio spike
    if (
      ctx.put_call_ratio != null &&
      ctx.pc_ratio_prev  != null &&
      ctx.pc_ratio_ts    != null &&
      (now - ctx.pc_ratio_ts) <= 30_000
    ) {
      const deltaPC = Math.abs(ctx.put_call_ratio - ctx.pc_ratio_prev);
      if (deltaPC > PC_RATIO_SPIKE) {
        return `put_call_ratio spike: Δ${deltaPC.toFixed(2)} in 30s`;
      }
    }

    // 8. Darkpool large print
    if (ctx.darkpool_max_level_premium != null) {
      const premM = ctx.darkpool_max_level_premium / 1_000_000;
      if (premM > DARKPOOL_LARGE_PRINT_M) {
        return `darkpool large print: $${premM.toFixed(0)}M`;
      }
    }

    return null;
  }

  _setMode(newMode, reason) {
    if (newMode === this._mode) return;
    const prev = this._mode;
    this._mode = newMode;
    console.log(`[adaptive-scheduler] mode change: ${prev} → ${newMode}${reason ? ` (${reason})` : ''}`);
    this._onModeChange({ mode: newMode, prev_mode: prev, reason });

    // Reschedule all endpoints with new intervals
    if (this._started) {
      for (const name of Object.keys(NORMAL_INTERVALS)) {
        this._scheduleEndpoint(name, 0);
      }
    }
  }
}

// ─── Singleton instance ───────────────────────────────────────────────────────
// Shared across the app; live-refresh-scheduler.js uses this instance.

let _instance = null;

export function getAdaptiveScheduler() {
  return _instance;
}

export function createAdaptiveScheduler(opts) {
  _instance = new AdaptiveRefreshScheduler(opts);
  return _instance;
}
