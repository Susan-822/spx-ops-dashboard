/**
 * volatility-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches VIX (from FMP), computes IV30 and HV20 from SPX price history,
 * and produces a Vscore (0–100) for option cost assessment.
 *
 * Outputs:
 *   vix          — CBOE VIX index value
 *   iv30         — 30-day implied volatility (from UW or FMP)
 *   hv20         — 20-day historical realized volatility (computed from SPX closes)
 *   vscore       — composite volatility score 0–100
 *   regime       — 'low' | 'normal' | 'elevated' | 'high' | 'extreme' | 'unknown'
 *   iv_hv_ratio  — IV30 / HV20 (>1.3 = expensive, <0.8 = cheap)
 *   option_cost  — 'expensive' | 'fair' | 'cheap' | 'unknown'
 */

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY  = process.env.FMP_API_KEY || '';

// ── In-memory price history for HV20 computation ─────────────────────────────
const _priceHistory = [];
const HV_WINDOW = 20;

function pushPrice(price) {
  if (price == null || !Number.isFinite(price)) return;
  _priceHistory.push({ price, ts: Date.now() });
  // Keep only last 30 entries (enough for HV20 + buffer)
  if (_priceHistory.length > 35) _priceHistory.shift();
}

function computeHV20() {
  if (_priceHistory.length < HV_WINDOW + 1) return null;
  const recent = _priceHistory.slice(-HV_WINDOW - 1);
  const logReturns = [];
  for (let i = 1; i < recent.length; i++) {
    const r = Math.log(recent[i].price / recent[i - 1].price);
    logReturns.push(r);
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
  // Annualize: sqrt(252) * daily_std * 100 for percentage
  return Math.sqrt(variance * 252) * 100;
}

// ── FMP VIX fetch ─────────────────────────────────────────────────────────────
async function fetchVix() {
  if (!FMP_KEY) return null;
  try {
    const url = `${FMP_BASE}/quote/%5EVIX?apikey=${FMP_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0] && data[0].price != null) {
      return Number(data[0].price);
    }
    return null;
  } catch {
    return null;
  }
}

// ── FMP IV30 fetch (from SPX options chain summary if available) ──────────────
// FMP doesn't directly expose IV30 for SPX, so we approximate from VIX
// A more accurate source would be UW's iv30 field if available
function approximateIV30FromVix(vix) {
  if (vix == null) return null;
  // VIX ≈ 30-day ATM IV for SPX (by definition), convert from annualized % to decimal
  return vix; // VIX is already in percentage terms matching IV30
}

// ── Vscore computation ────────────────────────────────────────────────────────
function computeVscore(vix, iv30, hv20) {
  if (vix == null) return null;

  // Component 1: VIX absolute level (0-40 maps to 0-80)
  const vixScore = Math.min(80, (vix / 40) * 80);

  // Component 2: IV/HV ratio premium (if available)
  let ivHvScore = 0;
  if (iv30 != null && hv20 != null && hv20 > 0) {
    const ratio = iv30 / hv20;
    // ratio > 1.5 = very expensive (+20), ratio < 0.7 = very cheap (-10)
    ivHvScore = Math.max(-10, Math.min(20, (ratio - 1) * 40));
  }

  return Math.round(Math.min(100, Math.max(0, vixScore + ivHvScore)));
}

// ── Regime classification ─────────────────────────────────────────────────────
function classifyRegime(vix) {
  if (vix == null) return 'unknown';
  if (vix < 12)  return 'low';
  if (vix < 20)  return 'normal';
  if (vix < 30)  return 'elevated';
  if (vix < 40)  return 'high';
  return 'extreme';
}

// ── Main engine function ──────────────────────────────────────────────────────
async function runVolatilityEngine(snapshot = {}) {
  // Accept UW iv30 if available
  const uwIv30 = snapshot.uw_iv30 || snapshot.iv30 || null;

  // Fetch VIX
  const vix = await fetchVix();

  // Push current SPX price to history for HV computation
  const spotPrice = snapshot.spot_price || snapshot.fmp_price || null;
  if (spotPrice != null) pushPrice(spotPrice);

  // Compute HV20
  const hv20 = computeHV20();

  // IV30: prefer UW data, fallback to VIX approximation
  const iv30 = uwIv30 != null ? uwIv30 : approximateIV30FromVix(vix);

  // IV/HV ratio
  const ivHvRatio = (iv30 != null && hv20 != null && hv20 > 0)
    ? Number((iv30 / hv20).toFixed(2))
    : null;

  // Option cost assessment
  let optionCost = 'unknown';
  if (ivHvRatio != null) {
    if (ivHvRatio > 1.3)     optionCost = 'expensive';
    else if (ivHvRatio < 0.8) optionCost = 'cheap';
    else                       optionCost = 'fair';
  }

  // Vscore
  const vscore = computeVscore(vix, iv30, hv20);

  // Regime
  const regime = classifyRegime(vix);

  return {
    vix,
    iv30,
    hv20: hv20 != null ? Number(hv20.toFixed(1)) : null,
    vscore,
    regime,
    iv_hv_ratio: ivHvRatio,
    option_cost: optionCost,
    option_cost_cn: {
      expensive: '期权偏贵 — 卖权策略占优',
      fair:      '期权定价合理',
      cheap:     '期权偏便宜 — 买权策略占优',
      unknown:   '数据待接入'
    }[optionCost] || '数据待接入',
    hv_sample_count: _priceHistory.length,
    _computed_at: new Date().toISOString()
  };
}

export { runVolatilityEngine, pushPrice };
