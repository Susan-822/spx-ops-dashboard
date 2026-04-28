function n(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildControlSide({
  spot_price = null,
  flow_conflict = {},
  darkpool_gravity = {},
  wall_zone_panel = {},
  dealer_wall_map = {},
  sentiment = {},
  volatility_state = {},
  price_trigger = {}
} = {}) {
  let bull = 0;
  let bear = 0;
  let confidence = 50;
  const evidence = [];
  const conflicts = [];

  if (flow_conflict.flow_state === 'bearish_hits') {
    bear += 25;
    evidence.push('有资金连续买 Put，说明有人押下跌或买保护。');
  }
  if (flow_conflict.flow_state === 'bullish_hits') {
    bull += 25;
    evidence.push('有资金连续买 Call，说明有人押上涨。');
  }
  confidence -= 15;
  evidence.push('但还没确认是不是 0DTE 纯单腿，所以不能当作强控盘。');

  if (darkpool_gravity.zone_side === 'lower' && n(darkpool_gravity.distance_pct) != null && darkpool_gravity.distance_pct <= 0.5) {
    bull += 20;
    evidence.push(`下方 ${Math.round(darkpool_gravity.mapped_spx ?? 7150)} 附近有大成交区，价格靠近这里可能有人接盘。`);
    bull += 10;
    bear += 10;
    conflicts.push('空头资金在压，但下方承接区太近，追空容易被反弹打回来。');
  }
  if (darkpool_gravity.zone_side === 'upper' && n(darkpool_gravity.distance_pct) != null && darkpool_gravity.distance_pct <= 0.5) {
    bear += 20;
    evidence.push('上方有大成交区，价格靠近这里可能遇到卖压。');
  }

  const spot = n(spot_price);
  if (dealer_wall_map.gamma_flip != null || dealer_wall_map.call_wall != null || dealer_wall_map.put_wall != null) {
    if (spot != null && dealer_wall_map.gamma_flip != null && spot > dealer_wall_map.gamma_flip) {
      bull += 10;
      evidence.push('价格在做市商分界线上方，偏震荡支撑环境。');
    } else if (spot != null && dealer_wall_map.gamma_flip != null) {
      bear += 10;
      evidence.push('价格在做市商分界线下方，偏放波加速环境。');
    }
    if (dealer_wall_map.distance_to_call_wall_pct != null && Math.abs(dealer_wall_map.distance_to_call_wall_pct) <= 0.5) {
      bear += 15;
      evidence.push('价格接近上方压力墙，多头容易受压。');
    }
    if (dealer_wall_map.distance_to_put_wall_pct != null && Math.abs(dealer_wall_map.distance_to_put_wall_pct) <= 0.5) {
      bull += 15;
      evidence.push('价格接近下方支撑墙，空头容易受阻。');
    }
  } else {
    confidence -= 10;
    evidence.push('做市商墙位还没生成，所以控盘判断降级，只能作为参考。');
  }

  if (n(sentiment.net_put_premium) != null && n(sentiment.net_call_premium) != null && sentiment.net_put_premium > sentiment.net_call_premium) {
    bear += 5;
    evidence.push('全市场情绪轻微防守。');
  }

  if (volatility_state.vscore == null) {
    confidence -= 5;
    evidence.push('波动率还没算出 Vscore，暂时不能判断期权贵不贵。');
  }

  const diff = bull - bear;
  let side = 'MIXED';
  let sideCn = '多空拉扯，空头在试探，下方 7150 有多头防守。';
  if (confidence < 35) {
    side = 'UNKNOWN';
    sideCn = '数据不足，只能观察。';
  } else if (diff >= 25) {
    side = 'BULL_CONTROL';
    sideCn = '多头控盘。';
  } else if (diff <= -25) {
    side = 'BEAR_CONTROL';
    sideCn = '空头控盘。';
  } else if (bull > bear && diff < 25) {
    side = 'BULL_DEFENSE';
    sideCn = '多头防守。';
  } else if (bear > bull && Math.abs(diff) < 25) {
    side = 'BEAR_PRESSURE';
    sideCn = '空头压制。';
  }
  if (darkpool_gravity.state === 'lower_brake_zone' && flow_conflict.flow_state === 'bearish_hits') {
    side = 'MIXED';
    sideCn = '多空拉扯，空头在试探，下方 7150 有多头防守。';
  }

  return {
    side,
    side_cn: sideCn,
    bull_score: bull,
    bear_score: bear,
    confidence: Math.max(0, Math.min(100, confidence)),
    regime_cn: sideCn,
    evidence_cn: evidence,
    conflict_cn: conflicts,
    action_cn: '禁止追 Put；等 7150 附近反应。站稳再看 Call，跌破再重新评估 Put。'
  };
}
