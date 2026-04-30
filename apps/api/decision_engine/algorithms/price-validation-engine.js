/**
 * Price Validation Engine — Dynamic Price Verification for Reflection Logic
 *
 * 基于价格历史缓冲区，识别以下四种关键矛盾场景：
 *
 * 1. CALL_CAPPED (Call 被压)
 *    Net Premium 正（资金偏多）但价格不涨 → 做市商在用 Call 吸收买盘，上方有强阻力
 *    触发条件：net_premium > +$30M AND price_delta_5m < +1pt
 *
 * 2. PUT_SQUEEZED (Put 被绞)
 *    Put/Call 高（空头情绪极端）但价格不跌 → 空头被绞杀，可能触发 Gamma Squeeze
 *    触发条件：put_call_ratio > 1.5 AND price_delta_5m > -1pt
 *
 * 3. ABSORPTION_FAILED (暗盘承接失败)
 *    暗盘大量成交（承接信号）但价格继续下跌 → 承接力度不足，下行风险未解除
 *    触发条件：darkpool_levels >= 2 AND price_delta_5m < -3pt
 *
 * 4. BOTTOM_ABSORPTION (底部承接)
 *    暗盘大量成交 + 价格不跌（甚至微涨）→ 机构在底部吸筹，反弹概率高
 *    触发条件：darkpool_levels >= 2 AND price_delta_5m >= -1pt
 *
 * 附加场景：
 * 5. POSITIVE_GAMMA_PIN (正 Gamma 磁吸)
 *    正 Gamma 环境 + 现价在 ATM ±5pt 内 → 禁做 0DTE，价格将被钉住
 *
 * 6. FLOW_DIVERGENCE (资金背离)
 *    Net Premium 方向与价格趋势相反 → 警告，当前趋势可能是假突破
 */

/**
 * @param {Object} params
 * @param {Object} params.priceHistory    — from getPriceHistory()
 * @param {Object} params.flowFactors     — from uw_factors.flow_factors
 * @param {Object} params.darkpoolFactors — from uw_factors.darkpool_factors
 * @param {Object} params.gammaRegime     — from gamma_regime_engine output
 * @param {Object} params.atmEngine       — from atm_engine output
 * @returns {Object} price_validation result
 */
export function buildPriceValidationEngine({
  priceHistory = {},
  flowFactors = {},
  darkpoolFactors = {},
  gammaRegime = {},
  atmEngine = {}
} = {}) {

  const {
    spot_now,
    delta_1m,
    delta_3m,
    delta_5m,
    delta_15m,
    trend_1m,
    trend_5m,
    trend_15m,
    buffer_size = 0
  } = priceHistory;

  const netPremium = flowFactors.net_premium_5m ?? null;
  const putCallRatio = flowFactors.put_call_ratio ?? null;
  const callPremium = flowFactors.call_premium_5m ?? null;
  const putPremium = flowFactors.put_premium_5m ?? null;
  const dpLevelsCount = Array.isArray(darkpoolFactors.levels) ? darkpoolFactors.levels.length : 0;
  const dpNearestSupport = darkpoolFactors.nearest_support ?? null;

  const gammaRegimeType = gammaRegime.regime ?? 'unknown';
  const atmStrike = atmEngine.atm_strike ?? null;
  const pinRisk = atmEngine.pin_risk ?? 0;

  // Minimum history required for dynamic validation
  const hasEnoughHistory = buffer_size >= 10;

  // ── Scene 1: CALL_CAPPED ──────────────────────────────────────────────────
  // Net Premium positive (bullish flow) but price NOT rising
  let callCapped = false;
  let callCappedConfidence = 0;
  let callCappedEvidence = [];

  if (hasEnoughHistory && netPremium != null && delta_5m != null) {
    const flowBullish = netPremium > 30_000_000;  // > $30M net call premium
    const priceNotRising = delta_5m < 1.0;         // < +1pt in 5min
    if (flowBullish && priceNotRising) {
      callCapped = true;
      callCappedConfidence = Math.min(100, Math.round(
        (netPremium / 100_000_000) * 40 +   // Premium magnitude
        (Math.abs(delta_5m) < 0.5 ? 30 : 15) +  // Price flatness
        (delta_15m != null && delta_15m < 2 ? 20 : 0) +  // 15m confirmation
        10  // Base
      ));
      callCappedEvidence = [
        `Net Premium +$${(netPremium / 1_000_000).toFixed(1)}M (bullish)`,
        `Price Δ5m: ${delta_5m > 0 ? '+' : ''}${delta_5m?.toFixed(2)}pt (not rising)`,
        delta_15m != null ? `Price Δ15m: ${delta_15m > 0 ? '+' : ''}${delta_15m?.toFixed(2)}pt` : null
      ].filter(Boolean);
    }
  }

  // ── Scene 2: PUT_SQUEEZED ─────────────────────────────────────────────────
  // P/C ratio high (extreme bearish sentiment) but price NOT falling
  let putSqueezed = false;
  let putSqueezedConfidence = 0;
  let putSqueezedEvidence = [];

  if (hasEnoughHistory && putCallRatio != null && delta_5m != null) {
    const extremeBearishSentiment = putCallRatio > 1.5;
    const priceNotFalling = delta_5m > -1.0;  // Not falling more than 1pt
    if (extremeBearishSentiment && priceNotFalling) {
      putSqueezed = true;
      putSqueezedConfidence = Math.min(100, Math.round(
        (putCallRatio - 1.5) * 40 +   // How extreme the P/C is above 1.5
        (priceNotFalling && delta_5m > 0 ? 30 : 15) +  // Price actually rising = stronger signal
        (delta_1m != null && delta_1m > 0 ? 20 : 0) +  // 1m confirmation
        10  // Base
      ));
      putSqueezedEvidence = [
        `P/C Ratio: ${putCallRatio.toFixed(2)} (extreme bearish)`,
        `Price Δ5m: ${delta_5m > 0 ? '+' : ''}${delta_5m?.toFixed(2)}pt (not falling)`,
        delta_1m != null ? `Price Δ1m: ${delta_1m > 0 ? '+' : ''}${delta_1m?.toFixed(2)}pt` : null
      ].filter(Boolean);
    }
  }

  // ── Scene 3: ABSORPTION_FAILED ────────────────────────────────────────────
  // Darkpool activity (absorption signal) but price CONTINUES falling
  let absorptionFailed = false;
  let absorptionFailedConfidence = 0;
  let absorptionFailedEvidence = [];

  if (hasEnoughHistory && dpLevelsCount >= 2 && delta_5m != null) {
    const priceStillFalling = delta_5m < -3.0;  // Falling > 3pt in 5min
    if (priceStillFalling) {
      absorptionFailed = true;
      absorptionFailedConfidence = Math.min(100, Math.round(
        Math.min(dpLevelsCount * 15, 40) +  // More DP levels = more evidence
        (Math.abs(delta_5m) > 5 ? 30 : 20) +  // Steeper fall = stronger signal
        (delta_15m != null && delta_15m < -5 ? 20 : 10) +  // 15m trend
        10  // Base
      ));
      absorptionFailedEvidence = [
        `Darkpool levels: ${dpLevelsCount} active clusters`,
        `Price Δ5m: ${delta_5m?.toFixed(2)}pt (still falling)`,
        dpNearestSupport ? `DP support at ${dpNearestSupport} breached` : null,
        delta_15m != null ? `Price Δ15m: ${delta_15m?.toFixed(2)}pt` : null
      ].filter(Boolean);
    }
  }

  // ── Scene 4: BOTTOM_ABSORPTION ────────────────────────────────────────────
  // Darkpool activity + price NOT falling (holding or recovering)
  let bottomAbsorption = false;
  let bottomAbsorptionConfidence = 0;
  let bottomAbsorptionEvidence = [];

  if (hasEnoughHistory && dpLevelsCount >= 2 && delta_5m != null) {
    const priceHolding = delta_5m >= -1.0;  // Not falling more than 1pt
    const priceRecovering = delta_5m > 0;
    if (priceHolding && !absorptionFailed) {
      bottomAbsorption = true;
      bottomAbsorptionConfidence = Math.min(100, Math.round(
        Math.min(dpLevelsCount * 15, 40) +  // More DP levels = stronger signal
        (priceRecovering ? 30 : 15) +  // Recovery = stronger
        (delta_15m != null && delta_15m >= -2 ? 20 : 10) +  // 15m trend
        10  // Base
      ));
      bottomAbsorptionEvidence = [
        `Darkpool levels: ${dpLevelsCount} active clusters`,
        `Price Δ5m: ${delta_5m > 0 ? '+' : ''}${delta_5m?.toFixed(2)}pt (holding)`,
        dpNearestSupport ? `DP support at ${dpNearestSupport} intact` : null,
        priceRecovering ? 'Price recovering from DP support' : 'Price stabilizing at DP support'
      ].filter(Boolean);
    }
  }

  // ── Scene 5: POSITIVE_GAMMA_PIN ───────────────────────────────────────────
  // Positive Gamma + price near ATM → pin risk, avoid 0DTE
  let positiveGammaPin = false;
  let positiveGammaPinEvidence = [];

  if (gammaRegimeType === 'positive_gamma' && pinRisk >= 60) {
    positiveGammaPin = true;
    positiveGammaPinEvidence = [
      `Gamma Regime: ${gammaRegimeType}`,
      `Pin Risk Score: ${pinRisk}/100`,
      atmStrike ? `ATM Strike: ${atmStrike}` : null,
      spot_now && atmStrike ? `Distance to ATM: ${Math.abs(spot_now - atmStrike).toFixed(1)}pt` : null
    ].filter(Boolean);
  }

  // ── Scene 6: FLOW_DIVERGENCE ──────────────────────────────────────────────
  // Net Premium direction ≠ price trend
  let flowDivergence = false;
  let flowDivergenceType = null;
  let flowDivergenceEvidence = [];

  if (hasEnoughHistory && netPremium != null && trend_5m !== 'unknown') {
    const flowBullish = netPremium > 10_000_000;
    const flowBearish = netPremium < -10_000_000;
    const priceFalling = trend_5m === 'falling';
    const priceRising = trend_5m === 'rising';

    if (flowBullish && priceFalling) {
      flowDivergence = true;
      flowDivergenceType = 'bullish_flow_bearish_price';
      flowDivergenceEvidence = [
        `Net Premium: +$${(netPremium / 1_000_000).toFixed(1)}M (bullish)`,
        `Price trend 5m: falling (${delta_5m?.toFixed(2)}pt)`,
        'Warning: Bullish flow not confirmed by price action'
      ];
    } else if (flowBearish && priceRising) {
      flowDivergence = true;
      flowDivergenceType = 'bearish_flow_bullish_price';
      flowDivergenceEvidence = [
        `Net Premium: -$${(Math.abs(netPremium) / 1_000_000).toFixed(1)}M (bearish)`,
        `Price trend 5m: rising (+${delta_5m?.toFixed(2)}pt)`,
        'Warning: Bearish flow not confirmed by price action'
      ];
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const activeScenes = [
    callCapped && 'call_capped',
    putSqueezed && 'put_squeezed',
    absorptionFailed && 'absorption_failed',
    bottomAbsorption && 'bottom_absorption',
    positiveGammaPin && 'positive_gamma_pin',
    flowDivergence && 'flow_divergence'
  ].filter(Boolean);

  // Dominant scene (highest confidence)
  const sceneConfidences = {
    call_capped: callCappedConfidence,
    put_squeezed: putSqueezedConfidence,
    absorption_failed: absorptionFailedConfidence,
    bottom_absorption: bottomAbsorptionConfidence,
    positive_gamma_pin: positiveGammaPin ? 80 : 0,
    flow_divergence: flowDivergence ? 70 : 0
  };
  const dominantScene = activeScenes.length > 0
    ? activeScenes.reduce((a, b) => (sceneConfidences[a] >= sceneConfidences[b] ? a : b))
    : null;

  // Overall alert level
  const alertLevel = activeScenes.length === 0 ? 'normal'
    : activeScenes.some(s => ['absorption_failed', 'positive_gamma_pin'].includes(s)) ? 'danger'
    : activeScenes.some(s => ['call_capped', 'put_squeezed'].includes(s)) ? 'warning'
    : 'info';

  return {
    has_enough_history: hasEnoughHistory,
    buffer_size,
    active_scenes: activeScenes,
    dominant_scene: dominantScene,
    alert_level: alertLevel,

    // Individual scene results
    call_capped: {
      detected: callCapped,
      confidence: callCappedConfidence,
      evidence: callCappedEvidence
    },
    put_squeezed: {
      detected: putSqueezed,
      confidence: putSqueezedConfidence,
      evidence: putSqueezedEvidence
    },
    absorption_failed: {
      detected: absorptionFailed,
      confidence: absorptionFailedConfidence,
      evidence: absorptionFailedEvidence
    },
    bottom_absorption: {
      detected: bottomAbsorption,
      confidence: bottomAbsorptionConfidence,
      evidence: bottomAbsorptionEvidence
    },
    positive_gamma_pin: {
      detected: positiveGammaPin,
      confidence: positiveGammaPin ? 80 : 0,
      evidence: positiveGammaPinEvidence
    },
    flow_divergence: {
      detected: flowDivergence,
      type: flowDivergenceType,
      confidence: flowDivergence ? 70 : 0,
      evidence: flowDivergenceEvidence
    },

    // Price context summary
    price_context: {
      spot_now,
      delta_1m,
      delta_5m,
      delta_15m,
      trend_1m,
      trend_5m,
      trend_15m
    }
  };
}
