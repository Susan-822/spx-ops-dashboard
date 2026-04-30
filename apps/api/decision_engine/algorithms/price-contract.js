/**
 * price-contract.js
 *
 * P0 SAFETY LAYER — SPX Price Source Isolation
 *
 * RULES (non-negotiable):
 *  1. SPX live price ONLY from: FMP ^GSPC quote / TradingView webhook SPX / manual override
 *  2. SPY darkpool × 10 is ONLY a darkpool reference level — NEVER current_price
 *  3. Options event price is ONLY event background — NEVER current_price
 *  4. Valid SPX range: 6000–8500 (hard reject outside this band)
 *  5. If no valid SPX price → ALL price-dependent outputs must degrade to null
 *
 * This module is the single source of truth for what constitutes a "legal" SPX price.
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
 * Used to block SPY prices from being used as SPX spot.
 */
export function looksLikeSpyPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  // SPY trades ~500–850 range; anything in 200–900 that is NOT valid SPX is suspect
  return n >= 200 && n < SPX_MIN;
}

/**
 * Build the canonical price_contract object.
 *
 * @param {object} sources
 *   - fmp_price: raw value from FMP ^GSPC quote
 *   - fmp_is_real: boolean from fmp_conclusion.price_status === 'valid'
 *   - tv_price: price from TradingView webhook (if symbol === 'SPX')
 *   - tv_is_fresh: boolean — TV snapshot is not stale
 *   - darkpool_mapped_spx: SPY darkpool × 10 value (reference only)
 *   - manual_override: manually set SPX price (admin use)
 */
export function buildPriceContract({
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

  // 2. FMP real-time SPX quote
  const fmpValid = fmp_is_real ? validateSpxPrice(fmp_price) : null;

  // 3. TradingView webhook (only if fresh and symbol is SPX)
  const tvValid = tv_is_fresh ? validateSpxPrice(tv_price) : null;

  // --- Resolve live_price ---
  let live_price = null;
  let live_source = 'none';

  if (manualValid != null) {
    live_price = manualValid;
    live_source = 'manual_override';
  } else if (fmpValid != null) {
    live_price = fmpValid;
    live_source = 'fmp';
  } else if (tvValid != null) {
    live_price = tvValid;
    live_source = 'tradingview';
  }

  // --- Darkpool reference (NEVER used as live_price) ---
  const darkpool_reference = validateSpxPrice(darkpool_mapped_spx);

  // --- Contamination check ---
  // Detect if someone tried to pass a SPY price as SPX
  const fmp_contaminated = fmp_price != null && looksLikeSpyPrice(fmp_price);
  const tv_contaminated = tv_price != null && looksLikeSpyPrice(tv_price);
  const contamination_detected = fmp_contaminated || tv_contaminated;

  // --- Status ---
  const has_live_price = live_price != null;
  const is_degraded = !has_live_price;

  return {
    // The ONE canonical SPX live price for all downstream engines
    live_price,
    live_source,

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
    degradation_reason: is_degraded
      ? contamination_detected
        ? 'SPX 价格源污染（疑似混入 SPY 价格），已拒绝。所有价格触发逻辑已降级。'
        : 'SPX 实时价格未接入。所有价格触发逻辑已降级，不显示距离或接近提示。'
      : null,

    // ATM calculation (nearest 5-point strike)
    atm_5: live_price != null ? Math.round(live_price / 5) * 5 : null,
    atm_10: live_price != null ? Math.round(live_price / 10) * 10 : null,

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
