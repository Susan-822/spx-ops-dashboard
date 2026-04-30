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

// ─── Interval tables (milliseconds) ──────────────────────────────────────────

/**
 * Normal mode intervals — conservative, stays well within 250 req/day
 * Total daily requests (rough estimate at normal mode):
 *   flow_recent:           86400/10  = 8640  (but UW caches, effective ~960)
 *   net_prem_ticks:        86400/20  = 4320  → ~480
 *   market_tide:           86400/30  = 2880  → ~320
 *   options_volume:        86400/60  = 1440  → ~160
 *   darkpool_spy:          86400/120 = 720   → ~80
 *   greek_exposure_strike: 86400/300 = 288   → ~32
 *   interpolated_iv:       86400/300 = 288   → ~32
 *   iv_rank:               86400/300 = 288   → ~32
 * Total per-endpoint requests per trading day (6.5h = 23400s):
 *   flow_recent:           23400/10  = 2340
 *   net_prem_ticks:        23400/20  = 1170
 *   market_tide:           23400/30  = 780
 *   options_volume:        23400/60  = 390
 *   darkpool_spy:          23400/120 = 195
 *   greek_exposure_strike: 23400/300 = 78
 *   interpolated_iv:       23400/300 = 78
 *   iv_rank:               23400/300 = 78
 * Total: ~5109 per trading day — but TTL cache in uw-api-provider means
 * actual HTTP requests are far fewer (only when TTL expires).
 * With TTL matching interval, effective requests ≈ interval-based count.
 * NOTE: Free plan = 250/day. We rely on TTL cache to avoid exceeding this.
 * Intervals are set to match TTL so each endpoint fetches at most once per interval.
 */
export const NORMAL_INTERVALS = Object.freeze({
  flow_recent:            60_000,   //  60 s — UW spot + flow  (1440/day)
  net_prem_ticks:         90_000,   //  90 s — net premium     ( 960/day)
  market_tide:           120_000,   // 120 s — market tide     ( 720/day)
  options_volume:        300_000,   // 300 s — P/C volume      ( 288/day)
  darkpool_spy:          600_000,   // 600 s — dark pool SPY   ( 144/day)
  greek_exposure_strike: 900_000,   // 900 s — GEX by strike   (  96/day)
  interpolated_iv:       900_000,   // 900 s — IV              (  96/day)
  iv_rank:               900_000,   // 900 s — IV rank         (  96/day)
  // TOTAL ~3840 req/day — well within 15,000 daily limit (74% buffer)
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
    switch (this._mode) {
      case 'turbo':    return TURBO_INTERVALS[name]    ?? NORMAL_INTERVALS[name];
      case 'throttle': return THROTTLE_INTERVALS[name] ?? NORMAL_INTERVALS[name] * 2;
      case 'minimal':  return MINIMAL_ENDPOINTS.has(name)
        ? THROTTLE_INTERVALS[name] ?? NORMAL_INTERVALS[name] * 2
        : null;  // null = don't schedule in minimal mode
      default:         return NORMAL_INTERVALS[name];
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
