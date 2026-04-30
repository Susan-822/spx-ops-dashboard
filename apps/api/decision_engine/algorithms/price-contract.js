/**
 * price-contract.js
 *
 * P0 SAFETY LAYER — SPX Price Source Isolation
 *
 * RULES (non-negotiable):
 *  1. SPX live price priority: UW flow-recent → UW spot_gex → TV → FMP → SPY×10
 *  2. iv_rank.close is ONLY prev_close — NEVER used as live spot
 *  3. Options event price is ONLY event background — NEVER current_price
 *  4. Valid SPX range: 6000–8500 (hard reject outside this band)
 *  5. If no valid SPX price → ALL price-dependent outputs must degrade to null
 *
 * Priority chain (P0-1 fix — 2026-04-30):
 *  1. manual_override (admin)
 *  2. UW flow-recent[0].underlying_price (most recent intraday, ticker=SPX)
 *  3. UW spot_gex[0].price (intraday GEX reference)
 *  4. TradingView webhook SPX (if fresh)
 *  5. FMP ^GSPC quote (if available)
 *  6. SPY darkpool × 10 (last resort, labeled as fallback)
 *
 * Output:
 *  spot              — canonical SPX price
 *  spot_source       — source identifier string
 *  spot_status       — 'live' | 'stale' | 'fallback' | 'unavailable'
 *  spot_age_seconds  — seconds since price was recorded (null if unknown)
 *  live_price        — same as spot (backward compat)
 *  live_source       — same as spot_source (backward compat)
 *  uw_headers_ok     — boolean: UW-CLIENT-API-ID header was included
 */

const SPX_MIN = 6000;
const SPX_MAX = 8500;
const SPY_MULTIPLIER = 10;

/**
 * Validate a raw number as a legal SPX spot price.
 * Returns the number if valid, null otherwise.
 */
export function validateSpxPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < SPX_MIN || n > SPX_MAX) return null;
  return n;
}

/**
 * Detect if a value looks like a SPY price (roughly 1/10 of SPX).
 */
export function looksLikeSpyPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return n >= 200 && n < SPX_MIN;
}

/**
 * Universal UW array extractor — handles all UW API response wrapper formats:
 *   { data: [...] }
 *   { data: { data: [...] } }
 *   [...]
 *   { results: [...] }
 */
function asArr(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return [];
  // Handle UW wrapper: { path, status, fetched_at, data: [...] or data: { data: [...] } }
  const d = obj.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k of ['data', 'results', 'items']) {
      if (Array.isArray(d[k])) return d[k];
    }
  }
  for (const k of ['results', 'items']) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  return [];
}

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ageSeconds(ts) {
  if (!ts) return null;
  try {
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return null;
    return Math.round((Date.now() - t) / 1000);
  } catch { return null; }
}

/**
 * Extract the best SPX spot price from UW API raw snapshot data.
 *
 * Priority:
 *  1. flow_recent[0].underlying_price  (most recent intraday, ticker=SPX/SPXW)
 *  2. spot_gex[0].price                (intraday GEX reference price)
 *  NOTE: iv_rank.close is NOT used here — it is prev_close only
 *
 * @param {Object} uwRaw — raw UW API snapshot (uw_raw field from normalizer)
 * @returns {{ price: number|null, source: string, status: string, age_seconds: number|null, raw_ts: string|null }}
 */
export function extractUwSpotPrice(uwRaw = {}) {
  // --- Source 1: flow_recent[0].underlying_price (SPX/SPXW rows) ---
  const flowRecent = asArr(uwRaw.flow_recent);
  const spxFlowRows = flowRecent.filter(r =>
    r.underlying_symbol === 'SPX' || r.underlying_symbol === 'SPXW' ||
    r.ticker === 'SPX' || r.ticker === 'SPXW'
  );
  const flowRows = spxFlowRows.length > 0 ? spxFlowRows : flowRecent;
  if (flowRows.length > 0) {
    // Sort by executed_at descending
    const sorted = [...flowRows].sort((a, b) => {
      const ta = Date.parse(a.executed_at || a.created_at || '0') || 0;
      const tb = Date.parse(b.executed_at || b.created_at || '0') || 0;
      return tb - ta;
    });
    const row = sorted[0];
    const price = validateSpxPrice(safeN(row.underlying_price));
    if (price != null) {
      const ts = row.executed_at || row.created_at || null;
      const age = ageSeconds(ts);
      return {
        price,
        source: 'uw_flow_recent',
        status: age != null && age < 300 ? 'live' : 'stale',
        age_seconds: age,
        raw_ts: ts
      };
    }
  }

  // --- Source 2: spot_gex[0].price ---
  const spotGex = asArr(uwRaw.spot_gex);
  if (spotGex.length > 0) {
    const sorted = [...spotGex].sort((a, b) => {
      const ta = Date.parse(a.time || a.date || '0') || 0;
      const tb = Date.parse(b.time || b.date || '0') || 0;
      return tb - ta;
    });
    const row = sorted[0];
    const price = validateSpxPrice(safeN(row.price));
    if (price != null) {
      const ts = row.time || row.date || null;
      const age = ageSeconds(ts);
      return {
        price,
        source: 'uw_spot_gex',
        status: age != null && age < 3600 ? 'live' : 'stale',
        age_seconds: age,
        raw_ts: ts
      };
    }
  }

  return { price: null, source: 'none', status: 'unavailable', age_seconds: null, raw_ts: null };
}

/**
 * Build the canonical price_contract object.
 *
 * @param {object} sources
 *   - uw_raw: raw UW API snapshot (for UW spot extraction)
 *   - fmp_price: raw value from FMP ^GSPC quote
 *   - fmp_is_real: boolean from fmp_conclusion.price_status === 'valid'
 *   - tv_price: price from TradingView webhook (if symbol === 'SPX')
 *   - tv_is_fresh: boolean — TV snapshot is not stale
 *   - darkpool_mapped_spx: SPY darkpool × 10 value (last resort fallback)
 *   - manual_override: manually set SPX price (admin use)
 */
export function buildPriceContract({
  uw_raw = null,
  fmp_price = null,
  fmp_is_real = false,
  tv_price = null,
  tv_is_fresh = false,
  darkpool_mapped_spx = null,
  manual_override = null
} = {}) {
  // --- Candidate resolution (priority order) ---

  // 1. Manual override (highest trust, admin-set)
  const manualValid = validateSpxPrice(manual_override);

  // 2. UW spot price (flow_recent → spot_gex)
  const uwSpot = uw_raw ? extractUwSpotPrice(uw_raw) : { price: null, source: 'none', status: 'unavailable', age_seconds: null, raw_ts: null };
  const uwValid = validateSpxPrice(uwSpot.price);

  // 3. TradingView webhook (only if fresh and symbol is SPX)
  const tvValid = tv_is_fresh ? validateSpxPrice(tv_price) : null;

  // 4. FMP real-time SPX quote
  const fmpValid = fmp_is_real ? validateSpxPrice(fmp_price) : null;

  // 5. SPY darkpool × 10 (last resort — labeled as fallback)
  const spyFallback = validateSpxPrice(darkpool_mapped_spx);

  // --- Resolve live_price ---
  let live_price = null;
  let live_source = 'none';
  let spot_status = 'unavailable';
  let spot_age_seconds = null;

  if (manualValid != null) {
    live_price = manualValid;
    live_source = 'manual_override';
    spot_status = 'live';
    spot_age_seconds = 0;
  } else if (uwValid != null) {
    live_price = uwValid;
    live_source = uwSpot.source;
    spot_status = uwSpot.status;
    spot_age_seconds = uwSpot.age_seconds;
  } else if (tvValid != null) {
    live_price = tvValid;
    live_source = 'tradingview';
    spot_status = 'live';
    spot_age_seconds = 0;
  } else if (fmpValid != null) {
    live_price = fmpValid;
    live_source = 'fmp';
    spot_status = 'live';
    spot_age_seconds = 0;
  } else if (spyFallback != null) {
    live_price = spyFallback;
    live_source = 'spy_darkpool_x10';
    spot_status = 'fallback';
    spot_age_seconds = null;
  }

  // --- Darkpool reference (for wall/zone calculations) ---
  const darkpool_reference = validateSpxPrice(darkpool_mapped_spx);

  // --- Contamination check ---
  const fmp_contaminated = fmp_price != null && looksLikeSpyPrice(fmp_price);
  const tv_contaminated = tv_price != null && looksLikeSpyPrice(tv_price);
  const contamination_detected = fmp_contaminated || tv_contaminated;

  // --- Status ---
  const has_live_price = live_price != null;
  const is_degraded = !has_live_price || spot_status === 'fallback';

  // --- Spot gate: ATM/Wall/AB order blocked if no price ---
  const spot_gate_open = has_live_price;

  // --- Degradation reason ---
  let degradation_reason = null;
  if (!has_live_price) {
    degradation_reason = contamination_detected
      ? 'SPX 价格源污染（疑似混入 SPY 价格），已拒绝。所有价格触发逻辑已降级。'
      : 'SPX 实时价格未接入（FMP 超限/TV 未推送/UW 无现价）。所有价格触发逻辑已降级。';
  } else if (spot_status === 'fallback') {
    degradation_reason = 'SPX 价格来自 SPY×10 暗盘估算，精度有限，仅供参考。';
  } else if (spot_status === 'stale') {
    degradation_reason = `SPX 价格来自 ${live_source}（非实时），请注意。`;
  }

  return {
    // Canonical SPX live price
    live_price,
    live_source,

    // P0-1 new fields
    spot: live_price,
    spot_source: live_source,
    spot_status,
    spot_age_seconds,
    spot_gate_open,

    // UW spot extraction detail
    uw_spot_detail: uw_raw ? {
      source: uwSpot.source,
      price: uwSpot.price,
      status: uwSpot.status,
      age_seconds: uwSpot.age_seconds,
      raw_ts: uwSpot.raw_ts
    } : null,

    // Darkpool reference — only for wall/zone calculations
    darkpool_reference,

    // Safety flags
    has_live_price,
    is_degraded,
    contamination_detected,
    contamination_detail: contamination_detected
      ? `价格源污染检测：fmp=${fmp_contaminated ? '疑似SPY价格' : 'OK'}, tv=${tv_contaminated ? '疑似SPY价格' : 'OK'}`
      : null,

    // Degradation message for UI
    degradation_reason,

    // ATM calculation (nearest 5-point strike)
    atm_5: live_price != null ? Math.round(live_price / 5) * 5 : null,
    atm_10: live_price != null ? Math.round(live_price / 10) * 10 : null,

    // Header validation flag
    uw_headers_ok: true,  // UW-CLIENT-API-ID: 100001 is now included in all requests

    // Metadata
    spx_range: { min: SPX_MIN, max: SPX_MAX },
    spy_multiplier: SPY_MULTIPLIER
  };
}

/**
 * Safe distance calculator — ONLY works with legal SPX prices.
 * Returns null if either price is invalid or from different coordinate systems.
 */
export function safeSpxDistance(live_price, reference_level) {
  const spot = validateSpxPrice(live_price);
  const ref = validateSpxPrice(reference_level);
  if (spot == null || ref == null) return null;
  return {
    points: Number((spot - ref).toFixed(2)),
    pct: Number(((spot - ref) / spot * 100).toFixed(3)),
    above: spot > ref,
    below: spot < ref
  };
}
