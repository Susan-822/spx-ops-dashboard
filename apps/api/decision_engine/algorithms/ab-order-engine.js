/**
 * ab-order-engine.js
 *
 * A/B Order Generation Engine
 *
 * Generates two execution plans (Plan A and Plan B) based on:
 *  - Gamma regime (positive/negative)
 *  - Flow behavior (put_effective/put_squeezed/call_effective/call_capped/mixed)
 *  - ATM position and key levels
 *  - Execution confidence score
 *
 * Output format:
 *  - plan_a: Primary plan (higher probability scenario)
 *  - plan_b: Contingency plan (alternative scenario)
 *  - Both include: direction, instrument, entry, stop, tp1, tp2, invalid, rationale
 *
 * SAFETY: No orders generated if execution_confidence < 40 or price data is degraded
 */

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, decimals = 0) {
  if (value == null) return '--';
  return Number(value.toFixed(decimals)).toString();
}

/**
 * Build a Bull Put Spread plan
 */
function buildBullPutSpread({ spot, put_wall, atm, gamma_flip, expiry = '0DTE' }) {
  if (spot == null || put_wall == null) return null;
  const sellStrike = put_wall - 5;
  const buyStrike = put_wall - 15;
  const entry = `卖出 ${fmt(sellStrike)} Put / 买入 ${fmt(buyStrike)} Put (${expiry})`;
  const stop = `现价跌破 ${fmt(put_wall - 5)}`;
  const tp1 = `权利金收回 50%`;
  const tp2 = `权利金收回 80% 或到期`;
  const invalid = `现价有效跌破 ${fmt(put_wall)}`;
  return { entry, stop, tp1, tp2, invalid, sell_strike: sellStrike, buy_strike: buyStrike };
}

/**
 * Build a Bear Call Spread plan
 */
function buildBearCallSpread({ spot, call_wall, atm, expiry = '0DTE' }) {
  if (spot == null || call_wall == null) return null;
  const sellStrike = call_wall + 5;
  const buyStrike = call_wall + 15;
  const entry = `卖出 ${fmt(sellStrike)} Call / 买入 ${fmt(buyStrike)} Call (${expiry})`;
  const stop = `现价突破 ${fmt(call_wall + 5)}`;
  const tp1 = `权利金收回 50%`;
  const tp2 = `权利金收回 80% 或到期`;
  const invalid = `现价有效突破 ${fmt(call_wall)}`;
  return { entry, stop, tp1, tp2, invalid, sell_strike: sellStrike, buy_strike: buyStrike };
}

/**
 * Build a Long Call plan
 */
function buildLongCall({ spot, atm, call_wall, gamma_flip, expiry = '0DTE' }) {
  if (spot == null || atm == null) return null;
  const strike = atm + 5;
  const entry = `买入 ${fmt(strike)} Call (${expiry})，等价格站稳 ${fmt(gamma_flip ?? atm)} 后入场`;
  const stop = `现价跌破 ${fmt(gamma_flip ?? (atm - 10))}`;
  const tp1 = `${fmt(call_wall != null ? call_wall - 5 : atm + 15)}`;
  const tp2 = `${fmt(call_wall ?? atm + 25)}`;
  const invalid = `现价跌破 ${fmt(gamma_flip ?? (atm - 15))} 或 Put Flow 重新增强`;
  return { entry, stop, tp1, tp2, invalid, strike };
}

/**
 * Build a Long Put plan
 */
function buildLongPut({ spot, atm, put_wall, gamma_flip, expiry = '0DTE' }) {
  if (spot == null || atm == null) return null;
  const strike = atm - 5;
  const entry = `买入 ${fmt(strike)} Put (${expiry})，等价格确认跌破 ${fmt(gamma_flip ?? atm)} 后入场`;
  const stop = `现价收复 ${fmt(gamma_flip ?? (atm + 10))}`;
  const tp1 = `${fmt(put_wall != null ? put_wall + 5 : atm - 15)}`;
  const tp2 = `${fmt(put_wall ?? atm - 25)}`;
  const invalid = `现价收复 ${fmt(gamma_flip ?? (atm + 15))} 或 Call Flow 转强`;
  return { entry, stop, tp1, tp2, invalid, strike };
}

/**
 * Main A/B Order Engine
 */
export function buildAbOrderEngine({
  spot_price = null,
  atm = null,
  gamma_flip = null,
  call_wall = null,
  put_wall = null,
  gamma_regime = 'unknown',
  flow_behavior = 'neutral',
  execution_confidence = 0,
  pin_risk = 0,
  expiry = '0DTE',
  degraded = false
} = {}) {
  const spot = safeNumber(spot_price);

  // Safety gate: no orders if degraded or low confidence
  if (degraded || spot == null || execution_confidence < 40) {
    return {
      status: 'blocked',
      status_cn: execution_confidence < 40
        ? `执行置信度不足 (${execution_confidence}/100)，不生成预案`
        : 'SPX 价格未接入，不生成预案',
      plan_a: null,
      plan_b: null,
      headline: '当前条件不满足执行预案生成要求。',
      blocked_reason: execution_confidence < 40
        ? `置信度 ${execution_confidence}/100 < 阈值 40`
        : 'SPX 价格数据降级',
      execution_confidence
    };
  }

  // High pin risk warning
  const pinWarning = pin_risk >= 70
    ? `⚠ ATM 吸附风险高 (${pin_risk}/100)，禁止在 ATM 附近买 0DTE 方向单`
    : null;

  let plan_a = null;
  let plan_b = null;
  let headline = '';
  let judgment = '';

  // ─── Scenario Matrix ─────────────────────────────────────────────────────

  // SCENARIO 1: Positive Gamma + Put Squeezed → Bottom Divergence
  if (gamma_regime === 'positive' && flow_behavior === 'put_squeezed') {
    judgment = '底部背离确立。Put Flow 被 Put Wall 吸收，正 Gamma 阻尼，做市商不跟空。';
    headline = `判定：底部背离确立。建议预案 A：现价未破 ${fmt(put_wall)} 前，拒绝做空，逢低构建 Bull Put Spread 或买入 Call。`;
    plan_a = {
      direction: 'BULLISH',
      direction_cn: '多头预案',
      instrument: 'Bull Put Spread',
      rationale: 'Put Flow 被吸收，正 Gamma 阻尼，下方有 Put Wall 支撑',
      ...buildBullPutSpread({ spot, put_wall, atm, gamma_flip, expiry }),
      condition: `现价站稳 ${fmt(put_wall)} 上方，Put Flow 不再增强`
    };
    plan_b = {
      direction: 'BULLISH',
      direction_cn: '多头预案 B',
      instrument: 'Long Call',
      rationale: '如 Put Wall 吸收反弹确认，追入 Call',
      ...buildLongCall({ spot, atm, call_wall, gamma_flip, expiry }),
      condition: `现价回踩 ${fmt(gamma_flip ?? put_wall)} 后站稳反弹`
    };
  }

  // SCENARIO 2: Negative Gamma + Put Effective → Bearish Momentum
  else if (gamma_regime === 'negative' && flow_behavior === 'put_effective') {
    judgment = '空头动能确认。负 Gamma 放波，Put Flow 有效，做市商被迫对冲加速下行。';
    headline = `判定：空头动能确认。建议预案 A：等价格确认跌破 ${fmt(gamma_flip)} 后，顺势买入 Put 或构建 Bear Put Spread。`;
    plan_a = {
      direction: 'BEARISH',
      direction_cn: '空头预案',
      instrument: 'Long Put',
      rationale: '负 Gamma 放波，Put Flow 有效，顺势追空',
      ...buildLongPut({ spot, atm, put_wall, gamma_flip, expiry }),
      condition: `现价确认跌破 ${fmt(gamma_flip)}，Put Flow 持续`
    };
    plan_b = {
      direction: 'BEARISH',
      direction_cn: '空头预案 B',
      instrument: 'Bear Call Spread',
      rationale: '如 Call Wall 压制确认，卖出 Call Spread',
      ...buildBearCallSpread({ spot, call_wall, atm, expiry }),
      condition: `现价反弹至 ${fmt(call_wall ?? (atm + 10))} 附近遇阻`
    };
  }

  // SCENARIO 3: Positive Gamma + Call Capped → Range-bound
  else if (gamma_regime === 'positive' && flow_behavior === 'call_capped') {
    judgment = '正 Gamma 震荡区，Call 被 Call Wall 压制，当前为双向卖权环境。';
    headline = `判定：震荡夹击区。建议预案 A：在 ${fmt(put_wall)} 至 ${fmt(call_wall)} 区间内卖出双向 Spread，收取权利金。`;
    plan_a = {
      direction: 'NEUTRAL',
      direction_cn: '中性预案',
      instrument: 'Bear Call Spread',
      rationale: 'Call Wall 压制，正 Gamma 阻尼，卖出上方 Call Spread',
      ...buildBearCallSpread({ spot, call_wall, atm, expiry }),
      condition: `现价接近 Call Wall ${fmt(call_wall)}`
    };
    plan_b = {
      direction: 'NEUTRAL',
      direction_cn: '中性预案 B',
      instrument: 'Bull Put Spread',
      rationale: 'Put Wall 支撑，正 Gamma 阻尼，卖出下方 Put Spread',
      ...buildBullPutSpread({ spot, put_wall, atm, gamma_flip, expiry }),
      condition: `现价接近 Put Wall ${fmt(put_wall)}`
    };
  }

  // SCENARIO 4: Negative Gamma + Call Effective → Bullish Breakout
  else if (gamma_regime === 'negative' && flow_behavior === 'call_effective') {
    judgment = '负 Gamma 放波，Call Flow 有效，突破 Call Wall 可能触发 Gamma Squeeze。';
    headline = `判定：多头突破预案。建议预案 A：等价格有效突破 ${fmt(call_wall)} 后，追入 Call 或 Bull Call Spread。`;
    plan_a = {
      direction: 'BULLISH',
      direction_cn: '多头突破预案',
      instrument: 'Long Call',
      rationale: '负 Gamma 放波，Call Flow 有效，突破 Call Wall 触发 Gamma Squeeze',
      ...buildLongCall({ spot, atm, call_wall, gamma_flip, expiry }),
      condition: `现价有效突破 ${fmt(call_wall)}，Call Flow 持续增强`
    };
    plan_b = {
      direction: 'BULLISH',
      direction_cn: '多头预案 B',
      instrument: 'Bull Call Spread',
      rationale: '控制成本，限制风险',
      entry: `买入 ${fmt(call_wall)} Call / 卖出 ${fmt((call_wall ?? 0) + 15)} Call (${expiry})`,
      stop: `现价跌回 ${fmt(call_wall ?? 0)}`,
      tp1: `${fmt((call_wall ?? 0) + 10)}`,
      tp2: `${fmt((call_wall ?? 0) + 20)}`,
      invalid: `现价跌破 ${fmt(gamma_flip ?? atm)}`,
      condition: `现价突破 ${fmt(call_wall)} 后回踩不破`
    };
  }

  // SCENARIO 5: Mixed or Transitional → Wait
  else {
    judgment = '当前 Gamma 环境或资金行为不明确，不生成方向性预案。';
    headline = '判定：等待确认。当前 Gamma 环境或资金行为不明确，不生成方向性预案。';
    plan_a = null;
    plan_b = null;
  }

  return {
    status: plan_a != null ? 'ready' : 'waiting',
    status_cn: plan_a != null ? '预案已生成' : '等待确认',
    headline,
    judgment,
    pin_warning: pinWarning,
    execution_confidence,
    plan_a: plan_a ? {
      ...plan_a,
      expiry,
      execution_confidence,
      do_not: [
        '不在没有入场、止损、TP 时下单',
        '不根据单一信号开仓',
        '不在 ATM 中轴区内追单'
      ]
    } : null,
    plan_b: plan_b ? {
      ...plan_b,
      expiry,
      execution_confidence,
      do_not: [
        '不在没有入场、止损、TP 时下单',
        '不根据单一信号开仓'
      ]
    } : null,
    scenario: `${gamma_regime}_${flow_behavior}`,
    gamma_regime,
    flow_behavior
  };
}
