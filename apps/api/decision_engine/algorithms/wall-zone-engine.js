import { buildDealerWallMap } from './dealer-wall-engine.js';

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pct(value) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(3));
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function mappedPrice(row = {}) {
  const price = numberOrNull(row.price ?? row.center_price);
  if (price == null) return null;
  const ticker = row.ticker || row.source_ticker || 'SPY';
  return ticker === 'SPY' ? price * 10 : price;
}

function tierFromPremium(premium = 0) {
  if (premium >= 10000000) return ['major_cluster_wall', '强聚合成交区', 'high'];
  if (premium >= 3000000) return ['cluster_wall', '聚合大成交区', 'high'];
  if (premium >= 1000000) return ['major_wall', '大成交墙候选', 'high'];
  if (premium >= 500000) return ['watch_zone', '观察区', 'medium'];
  if (premium >= 100000) return ['footprint', '零星脚印', 'low'];
  return ['none', '无有效暗池区', 'none'];
}

function buildDarkpoolZone({ darkpool = {}, spot_price = null, now = new Date() } = {}) {
  const spot = numberOrNull(spot_price ?? darkpool.current_spx);
  const trades = rows(darkpool.trades).length ? rows(darkpool.trades) : rows(darkpool.largest_print?.price != null ? [darkpool.largest_print] : []);
  const lambda = Math.log(2) / 120;
  const bins = new Map();
  for (const trade of trades) {
    const mapped = mappedPrice(trade);
    const premium = numberOrNull(trade.premium) ?? 0;
    if (mapped == null || premium < 100000) continue;
    const ageMinutes = trade.executed_at ? Math.max(0, (new Date(now).getTime() - new Date(trade.executed_at).getTime()) / 60000) : 0;
    const decayedPremium = premium * Math.exp(-lambda * ageMinutes);
    const center = Math.round(mapped / 5) * 5;
    const current = bins.get(center) || {
      center_price: center,
      price_low: center - 2.5,
      price_high: center + 2.5,
      cluster_premium: 0,
      cluster_count: 0,
      raw_premium: 0
    };
    current.cluster_premium += decayedPremium;
    current.raw_premium += premium;
    current.cluster_count += 1;
    bins.set(center, current);
  }
  const levels = [...bins.values()]
    .map((bin) => {
      const [tier, tier_cn, confidence] = tierFromPremium(bin.cluster_premium);
      const distance = spot != null ? Math.abs(spot - bin.center_price) / spot * 100 : null;
      const zoneSide = spot != null ? bin.center_price < spot ? 'below' : bin.center_price > spot ? 'above' : 'at_spot' : 'unknown';
      return {
        ...bin,
        cluster_premium: Math.round(bin.cluster_premium),
        gscore: bin.cluster_premium / Math.max(bin.price_high - bin.price_low, 1),
        tier,
        tier_cn,
        distance_pct: pct(distance),
        zone_side: zoneSide,
        confidence,
        summary_cn: tier === 'footprint'
          ? `${Math.round(bin.center_price)} 附近有暗池脚印，只能低置信观察，不是正式支撑。`
          : `${Math.round(bin.center_price)} 附近有${tier_cn}，价格靠近时不适合追 Put，要观察是否承接。`,
        action_cn: '价格靠近该区域时，不追单，先看是否承接。'
      };
    })
    .sort((a, b) => (a.distance_pct ?? 999) - (b.distance_pct ?? 999));
  const nearest = levels[0] || null;
  return {
    levels,
    nearest_zone: nearest,
    summary_cn: nearest
      ? nearest.summary_cn
      : '暂时没有足够暗池数据形成观察区。',
    action_cn: nearest
      ? '价格靠近暗池观察区时，不追 Put，先看是否承接。'
      : '暗池暂时只做背景。'
  };
}

export function buildWallZonePanel({ dealer = {}, darkpool = {}, spot_price = null } = {}) {
  const gexWall = buildDealerWallMap({ dealer, spot_price });
  const darkpoolZone = buildDarkpoolZone({ darkpool, spot_price });
  const levels = darkpoolZone.levels || [];
  const nearestUpper = levels.find((level) => level.zone_side === 'above') || null;
  const nearestLower = levels.find((level) => level.zone_side === 'below') || null;
  const hasGex = gexWall.call_wall != null || gexWall.put_wall != null || gexWall.gamma_flip != null;
  return {
    gex_wall: hasGex ? {
      source: 'spot_gex',
      confidence: gexWall.confidence,
      call_wall: gexWall.call_wall,
      put_wall: gexWall.put_wall,
      gamma_flip: gexWall.gamma_flip,
      distance_to_call_wall_pct: gexWall.distance_to_call_wall_pct,
      distance_to_put_wall_pct: gexWall.distance_to_put_wall_pct,
      distance_to_flip_pct: gexWall.distance_to_flip_pct,
      regime_cn: gexWall.regime_cn,
      usable_for_trade: false,
      summary_cn: gexWall.summary_cn,
      action_cn: gexWall.action_cn,
      missing_cn: ''
    } : {
      source: 'none',
      confidence: 'none',
      call_wall: null,
      put_wall: null,
      gamma_flip: null,
      usable_for_trade: false,
      summary_cn: '做市商墙位还没生成。',
      missing_cn: 'UW 近价 Spot GEX 没返回可用 strike；fallback 也没有足够字段。',
      action_cn: '不能用 Gamma 判断上方压力、下方支撑和趋势加速区。'
    },
    darkpool_zone: darkpoolZone,
    nearest_upper_zone: nearestUpper,
    nearest_lower_zone: nearestLower,
    summary_cn: hasGex
      ? `${gexWall.summary_cn} ${darkpoolZone.summary_cn}`
      : `GEX 墙位暂时不能用；暗池显示 ${Math.round(darkpoolZone.nearest_zone?.center_price ?? darkpool.mapped_spx ?? 7150)} 附近有大成交观察区。`,
    action_cn: hasGex
      ? `${gexWall.action_cn} ${darkpoolZone.action_cn}`
      : `不能用 Gamma 墙做目标位；但价格靠近 ${Math.round(darkpoolZone.nearest_zone?.center_price ?? darkpool.mapped_spx ?? 7150)} 时，不追 Put，先看是否承接。`
  };
}
