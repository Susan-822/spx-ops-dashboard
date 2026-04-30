function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tierForPremium(premium = 0) {
  if (premium >= 1000000) return ['major_wall', 'Major Wall 候选', 'high_confidence_reference'];
  if (premium >= 500000) return ['watch_zone', '观察区', 'medium_confidence_reference'];
  if (premium >= 100000) return ['footprint', '零星脚印', 'low_confidence_reference'];
  return ['none', '无有效脚印', 'unusable'];
}

export function buildDarkpoolGravity({ darkpool = {}, spot_price = null } = {}) {
  const spot = numberOrNull(spot_price ?? darkpool.current_spx);
  const largest = darkpool.largest_print || {};
  const sourcePrice = numberOrNull(largest.price);
  const premium = numberOrNull(largest.premium) ?? 0;
  const [baseTier, baseTierCn, usable] = tierForPremium(premium);
  const cluster = (darkpool.price_bins || []).find((bin) => Number(bin.total_premium) >= 3000000);
  const tier = cluster ? 'cluster_wall' : baseTier;
  const tierCn = cluster ? '聚合墙位候选' : baseTierCn;
  const mapped = (largest.ticker || darkpool.source_ticker || 'SPY') === 'SPY' && sourcePrice != null ? sourcePrice * 10 : sourcePrice;
  const distancePct = spot != null && mapped != null ? Math.abs(spot - mapped) / spot * 100 : null;
  const zoneSide = spot != null && mapped != null ? mapped < spot ? 'lower' : mapped > spot ? 'upper' : 'at_spot' : 'unknown';
  const near = distancePct != null && distancePct <= 0.5;
  const state = near && zoneSide === 'lower'
    ? 'lower_brake_zone'
    : near && zoneSide === 'upper'
      ? 'upper_brake_zone'
      : tier;

  const summary_cn = state === 'lower_brake_zone'
    ? `下方 ${Math.round(mapped)} 附近有暗池减速区，距离现价很近。`
    : state === 'upper_brake_zone'
      ? '上方有暗池压力减速区。'
      : tier === 'footprint'
        ? '有 SPY 暗池零星脚印，可作为低置信参考。'
        : tier === 'watch_zone'
          ? '暗池观察区，值得盯。'
          : tier === 'major_wall' || tier === 'cluster_wall'
            ? '强支撑 / 压力候选，但仍需聚合确认。'
            : '暂无可用暗池减速区。';
  const action_cn = state === 'lower_brake_zone'
    ? '禁止在减速区上方追空；价格回踩后观察是否吸收反弹。'
    : state === 'upper_brake_zone'
      ? '禁止追多，等突破或回落。'
      : tier === 'none'
        ? '暗池暂不参与操作判断。'
        : '低置信减速区，只用于禁止追单，不用于直接开仓。';

  return {
    source_ticker: largest.ticker || darkpool.source_ticker || 'SPY',
    source_price: sourcePrice,
    // P0 SAFETY: mapped_spx is a DARKPOOL REFERENCE LEVEL only.
    // It is SPY darkpool price x10 and MUST NOT be used as SPX live_price / current_price.
    // Downstream engines must use price_contract.live_price for all spot-price logic.
    mapped_spx: mapped,
    is_reference_only: true,
    premium,
    tier,
    tier_cn: tierCn,
    confidence: usable,
    distance_pct: distancePct,
    zone_side: zoneSide,
    state,
    summary_cn,
    action_cn,
    can_define_hard_wall: false
  };
}
