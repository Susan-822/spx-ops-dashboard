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

// ─── Shared DST helper ───────────────────────────────────────────────────────
/**
 * Returns ET offset in hours (4 for EDT, 5 for EST) for the given Date.
 * DST: 2nd Sunday in March 07:00 UTC → 1st Sunday in November 06:00 UTC.
 */
function _etOffset(now) {
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
  return (now >= dstStart && now < dstEnd) ? 4 : 5;
}

/**
 * Returns ET minutes-of-day (0–1439) for the given Date.
 */
function _etMinutes(now) {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utcMin - _etOffset(now) * 60) + 1440) % 1440;
}

// ─── US market hours gate ────────────────────────────────────────────────────
/**
 * Returns true if current time falls within ANY active fetch window:
 *   Mon–Fri, 06:40–16:00 ET (covers all 6 phases).
 * Used as a fast outer gate before getMarketPhase() is called.
 */
function isUsMarketHours() {
  const now = new Date();
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const etMin = _etMinutes(now);
  // 06:40 = 400 min, 16:00 = 960 min
  return etMin >= 6 * 60 + 40 && etMin < 16 * 60;
}

// ─── Market phase detection (6-phase) ────────────────────────────────────────────
/**
 * Returns the current market phase based on ET time (6-phase model):
 *
 *   Phase          ET window         Beijing (EDT)   Purpose
 *   oi_burst       06:40–07:00       18:40–19:00     OCC OI update, GEX baseline
 *   trf_burst      07:55–08:35       19:55–20:35     FINRA TRF dark pool flood
 *   open_sprint    09:30–10:30       21:30–22:30     Opening hour, max frequency
 *   midday         10:30–14:30       22:30–02:30+    Lunch lull, conserve quota
 *   closing        14:30–16:00       02:30–04:00+    0DTE Gamma squeeze window
 *   closed         all other times   —               Zero API calls
 *
 * Quota budget (all active phases, per day):
 *   oi_burst   (20 min):   ~14 req  (GEX/IV only)
 *   trf_burst  (40 min):  ~120 req  (flow + darkpool only)
 *   open_sprint(60 min):  ~714 req  (all endpoints, high freq)
 *   midday    (240 min):  ~344 req  (all endpoints, low freq)
 *   closing    (90 min):  ~606 req  (flow + darkpool + GEX elevated)
 *   snapshot   (1 shot):    ~8 req  (09:25 pre-market snapshot)
 *   TOTAL: ~1,806 req/day — 88% buffer vs 15,000 daily limit
 *
 * Note: 09:25 snapshot is fired by live-refresh-scheduler, not this function.
 */
export function getMarketPhase() {
  const now = new Date();
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return 'closed';
  const etMin = _etMinutes(now);

  if (etMin >= 6 * 60 + 40  && etMin < 7 * 60)           return 'oi_burst';    // 06:40–07:00
  if (etMin >= 7 * 60 + 55  && etMin < 8 * 60 + 35)      return 'trf_burst';   // 07:55–08:35
  if (etMin >= 9 * 60 + 30  && etMin < 10 * 60 + 30)     return 'open_sprint'; // 09:30–10:30
  if (etMin >= 10 * 60 + 30 && etMin < 14 * 60 + 30)     return 'midday';      // 10:30–14:30
  if (etMin >= 14 * 60 + 30 && etMin < 16 * 60)          return 'closing';     // 14:30–16:00
  return 'closed';
}

// ─── Interval tables (milliseconds) ──────────────────────────────────────────
/**
 * OI_BURST intervals — 06:40–07:00 ET (20 min = 1,200s)
 * Only GEX/IV endpoints: capture OCC overnight OI update for GEX baseline.
 * All other endpoints: null (skip).
 * Budget: ~14 req
 */
export const OI_BURST_INTERVALS = Object.freeze({
  flow_recent:            null,      // skip — no flow data pre-market
  net_prem_ticks:         null,      // skip
  market_tide:            null,      // skip
  options_volume:         null,      // skip
  darkpool_spy:           null,      // skip
  greek_exposure_strike: 120_000,   // 120 s — 10 req  ← GEX baseline
  interpolated_iv:       600_000,   // 600 s —  2 req  ← IV baseline
  iv_rank:               600_000,   // 600 s —  2 req
  // OI_BURST TOTAL: ~14 req
});

/**
 * TRF_BURST intervals — 07:55–08:35 ET (40 min = 2,400s)
 * Only flow + darkpool: capture FINRA TRF institutional dark pool prints.
 * Budget: ~120 req
 */
export const TRF_BURST_INTERVALS = Object.freeze({
  flow_recent:            30_000,   //  30 s —  80 req  ← early flow direction
  net_prem_ticks:         null,      // skip
  market_tide:            null,      // skip
  options_volume:         null,      // skip
  darkpool_spy:           60_000,   //  60 s —  40 req  ← TRF dark pool
  greek_exposure_strike:  null,      // skip
  interpolated_iv:        null,      // skip
  iv_rank:                null,      // skip
  // TRF_BURST TOTAL: ~120 req
});

/**
 * OPEN_SPRINT intervals — 09:30–10:30 ET (60 min = 3,600s)
 * All endpoints, highest frequency: capture opening flow and GEX shifts.
 * Budget: ~714 req
 */
export const SPRINT_INTERVALS = Object.freeze({
  flow_recent:            15_000,   //  15 s — 240 req
  net_prem_ticks:         20_000,   //  20 s — 180 req
  market_tide:            30_000,   //  30 s — 120 req
  options_volume:         60_000,   //  60 s —  60 req
  darkpool_spy:           60_000,   //  60 s —  60 req
  greek_exposure_strike: 120_000,   // 120 s —  30 req
  interpolated_iv:       300_000,   // 300 s —  12 req
  iv_rank:               300_000,   // 300 s —  12 req
  // OPEN_SPRINT TOTAL: ~714 req
});

/**
 * MIDDAY intervals — 10:30–14:30 ET (240 min = 14,400s)
 * All endpoints, low frequency: conserve quota during lunch lull.
 * Budget: ~344 req
 */
export const NORMAL_INTERVALS = Object.freeze({
  flow_recent:           120_000,   // 120 s — 120 req
  net_prem_ticks:        180_000,   // 180 s —  80 req
  market_tide:           300_000,   // 300 s —  48 req
  options_volume:        600_000,   // 600 s —  24 req
  darkpool_spy:          600_000,   // 600 s —  24 req
  greek_exposure_strike: 900_000,   // 900 s —  16 req
  interpolated_iv:       900_000,   // 900 s —  16 req
  iv_rank:               900_000,   // 900 s —  16 req
  // MIDDAY TOTAL: ~344 req
});

/**
 * CLOSING intervals — 14:30–16:00 ET (90 min = 5,400s)
 * Flow + darkpool + GEX elevated: capture 0DTE Gamma squeeze window.
 * Budget: ~606 req
 */
export const CLOSING_INTERVALS = Object.freeze({
  flow_recent:            30_000,   //  30 s — 180 req
  net_prem_ticks:         45_000,   //  45 s — 120 req
  market_tide:            60_000,   //  60 s —  90 req
  options_volume:        120_000,   // 120 s —  45 req
  darkpool_spy:           60_000,   //  60 s —  90 req
  greek_exposure_strike: 120_000,   // 120 s —  45 req
  interpolated_iv:       300_000,   // 300 s —  18 req
  iv_rank:               300_000,   // 300 s —  18 req
  // CLOSING TOTAL: ~606 req
});

/**
 * Turbo mode intervals — activated when near key levels (any phase)
 */
export const TURBO_INTERVALS = Object.freeze({
  flow_recent:            15_000,   //  15 s — max speed near key level
  net_prem_ticks:         20_000,   //  20 s
  market_tide:            30_000,   //  30 s
  options_volume:         60_000,   //  60 s
  darkpool_spy:           30_000,   //  30 s — darkpool elevated near key
  greek_exposure_strike:  60_000,   //  60 s
  interpolated_iv:       300_000,   // 300 s
  iv_rank:               300_000,   // 300 s
  // TURBO: used as minimum floor, not absolute override
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
    // Phase-aware base interval (6-phase model)
    const phase = getMarketPhase();
    let baseInterval;
    switch (phase) {
      case 'oi_burst':    baseInterval = OI_BURST_INTERVALS[name];    break; // null = skip
      case 'trf_burst':   baseInterval = TRF_BURST_INTERVALS[name];   break; // null = skip
      case 'open_sprint': baseInterval = SPRINT_INTERVALS[name]  ?? NORMAL_INTERVALS[name]; break;
      case 'closing':     baseInterval = CLOSING_INTERVALS[name] ?? NORMAL_INTERVALS[name]; break;
      case 'midday':      baseInterval = NORMAL_INTERVALS[name];      break;
      default:            return null;  // 'closed' — zero API calls
    }

    // null means this endpoint is intentionally skipped in this phase
    if (baseInterval == null) return null;

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
    // ── Market-hours gate (6-phase) ────────────────────────────────────────────────────────
    // 6-phase intervals (all phases, ~1,806 req/day, 88% buffer vs 15,000 limit):
    //   oi_burst    06:40–07:00: GEX/IV only,          ~14 req
    //   trf_burst   07:55–08:35: flow+darkpool only,  ~120 req
    //   open_sprint 09:30–10:30: all endpoints 15s,   ~714 req
    //   midday      10:30–14:30: all endpoints 120s,  ~344 req
    //   closing     14:30–16:00: flow+dark+GEX 30s,   ~606 req
    //   closed      all other:   zero API calls
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
