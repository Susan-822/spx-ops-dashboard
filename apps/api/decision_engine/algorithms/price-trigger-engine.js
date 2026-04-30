/**
 * price-trigger-engine.js
 *
 * P0 SAFETY: spot_price (current_price) and key_level are STRICTLY ISOLATED.
 *
 * Rules:
 *  - spot_price MUST come from price_contract.live_price (FMP/TV/manual override only)
 *  - key_level comes from darkpool_gravity.mapped_spx (reference only) or wall_zone_panel
 *  - If no valid spot_price → ALL distance/trigger outputs are null, state = 'no_live_price'
 *  - darkpool_gravity.mapped_spx is NEVER used as spot_price
 */

import { validateSpxPrice } from './price-contract.js';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function pct(value) {
  return value == null ? null : Number(value.toFixed(3));
}

function closeValue(item) {
  return numberOrNull(typeof item === 'number' ? item : item?.close ?? item?.price);
}

export function buildPriceTrigger({
  spot_price = null,
  last_price_series = [],
  internal_price_series = [],
  darkpool_gravity = {},
  wall_zone_panel = {},
  flow_conflict = {},
  operation_layer = {}
} = {}) {
  // P0: Validate spot_price through price_contract — reject SPY prices, out-of-range, etc.
  const spot = validateSpxPrice(spot_price);

  // key_level is a REFERENCE LEVEL (wall/zone), NOT a live price.
  // It may come from darkpool_gravity.mapped_spx (SPY×10 reference) or wall_zone_panel.
  // This is intentional and correct — it's used as a target level, not as current price.
  const keyLevel = numberOrNull(
    darkpool_gravity.mapped_spx ?? wall_zone_panel.darkpool_zone?.nearest_zone?.center_price
  );

  const series = (last_price_series.length ? last_price_series : internal_price_series)
    .map(closeValue)
    .filter((value) => value != null);

  const distancePct = spot != null && keyLevel != null
    ? Math.abs(spot - keyLevel) / spot * 100
    : null;

  const approachZone = 0.5;
  const touchZone = 0.15;
  const breakBuffer = 0.10;
  const reclaimBuffer = 0.10;
  const levelText = keyLevel == null ? '关键观察位' : String(Number(keyLevel.toFixed(2)));

  const base = {
    key_level: keyLevel,
    // P0: current_price is ALWAYS the validated SPX live price, never a reference level
    current_price: spot,
    distance_pct: pct(distancePct),
    bullish_condition_cn: `${levelText} 附近站稳并反弹，Put Flow 不再继续增强，再观察 Call 候选。`,
    bearish_condition_cn: `${levelText} 放量跌破并回抽不过，再重新评估 Put 候选。`,
    no_trade_condition_cn: `${levelText} 附近来回乱磨，或者没有入场、止损、TP，不做。`,
    data_needed_cn: series.length
      ? ''
      : `当前只有现价，没有1分钟价格序列，所以只能判断是否接近${levelText}，不能判断站稳或跌破。`,
    confidence: series.length ? 'medium' : 'low'
  };

  // P0: If no valid SPX live price, degrade ALL trigger outputs
  if (spot == null) {
    return {
      ...base,
      state: 'no_live_price',
      state_cn: 'SPX 实时价格未接入，无法计算价格触发',
      next_action_cn: 'SPX 实时价格未接入。不显示距离、不显示"已接近"，不下单。',
      degraded: true
    };
  }

  if (keyLevel == null || distancePct == null) {
    return {
      ...base,
      state: 'waiting_approach',
      state_cn: '还没拿到完整价格触发条件',
      next_action_cn: '继续等关键观察位和实时价格，不提前下单。'
    };
  }

  if (series.length >= 10) {
    const recent = series.slice(-10);
    let crosses = 0;
    for (let i = 1; i < recent.length; i += 1) {
      if ((recent[i - 1] - keyLevel) * (recent[i] - keyLevel) < 0) crosses += 1;
    }
    const range = Math.max(...recent) - Math.min(...recent);
    if (crosses >= 3 || range / keyLevel * 100 <= touchZone) {
      return {
        ...base,
        state: 'chop_wait',
        state_cn: `${levelText} 附近乱磨`,
        next_action_cn: '不做，等方向出来。'
      };
    }
  }

  if (series.length >= 3) {
    const recent3 = series.slice(-3);
    const touched = series.some((price) => Math.abs(price - keyLevel) / keyLevel * 100 <= touchZone);
    const closesAbove = recent3.filter((price) => price > keyLevel * (1 + reclaimBuffer / 100)).length;
    const putStillStrong = flow_conflict.flow_state === 'bearish_hits' && flow_conflict.flow_wall_state !== 'stalling';
    if (touched && spot > keyLevel * (1 + reclaimBuffer / 100) && closesAbove >= 2 && !putStillStrong) {
      return {
        ...base,
        state: 'bullish_watch',
        state_cn: `${levelText} 附近出现承接，观察 Call 候选`,
        next_action_cn: '只观察 Call 候选，等操作层确认，不直接开仓。'
      };
    }
  }

  if (series.length >= 2) {
    const recent2 = series.slice(-2);
    const closesBelow = recent2.every((price) => price < keyLevel * (1 - breakBuffer / 100));
    if (closesBelow && flow_conflict.flow_state === 'bearish_hits' && flow_conflict.flow_wall_state !== 'stalling') {
      return {
        ...base,
        state: 'bearish_watch',
        state_cn: `${levelText} 被跌破，重新评估 Put 候选`,
        next_action_cn: '等操作卡确认，不提前追空。'
      };
    }
  }

  if (distancePct > approachZone) {
    return {
      ...base,
      state: 'waiting_approach',
      state_cn: '还没到关键观察位',
      next_action_cn: `继续等价格靠近 ${levelText}，不提前下单。`
    };
  }

  return {
    ...base,
    state: 'watch_reaction',
    state_cn: `已接近 ${levelText}，观察反应`,
    next_action_cn: '不追 Put，先看这里有没有承接。'
  };
}
