/**
 * darkpool-behavior-engine.js  — L2.5 Dark Pool Behavior Engine
 *
 * Consumes UW /api/darkpool/SPY data (via uw_factors.darkpool_factors) and:
 *   1. Maps SPY prices → SPX coordinates (×10)
 *   2. Clusters prints into support/resistance zones
 *   3. Classifies behavior relative to current SPX spot:
 *      - 'support'    (承接): Large prints below spot → institutional buying floor
 *      - 'resistance' (派发): Large prints above spot → institutional distribution ceiling
 *      - 'breakout'   (突破): Spot just crossed above a major print cluster
 *      - 'breakdown'  (破位): Spot just crossed below a major print cluster
 *      - 'unknown'    : Insufficient data
 *   4. Outputs the most actionable single conclusion for A/B order integration
 *
 * SAFETY: mapped_spx values are REFERENCE LEVELS ONLY.
 *         They MUST NOT be used as SPX live_price / current_price.
 */

const SPY_TO_SPX_MULTIPLIER = 10;
const MIN_PREMIUM_THRESHOLD = 1_000_000; // $1M minimum print size
const CLUSTER_RADIUS_PTS    = 5;          // SPX points — prints within ±5 pts are same cluster
const BREAKOUT_WINDOW_PTS   = 8;          // SPX points — how close spot must be to a cluster to trigger breakout/breakdown

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v, d = 0) {
  if (v == null) return '--';
  return Number(v.toFixed(d)).toString();
}

/**
 * Convert a SPY price to SPX coordinate
 * @param {number} spyPrice
 * @param {string} ticker - 'SPY' | 'SPX'
 * @returns {number|null}
 */
function toSpxCoord(spyPrice, ticker = 'SPY') {
  const p = safeN(spyPrice);
  if (p == null) return null;
  return ticker === 'SPY' ? p * SPY_TO_SPX_MULTIPLIER : p;
}

/**
 * Cluster nearby prints into zones
 * @param {Array<{spx_level: number, premium: number, side: string|null}>} prints
 * @returns {Array<{center: number, total_premium: number, count: number, side: string|null}>}
 */
function clusterPrints(prints) {
  const sorted = [...prints].sort((a, b) => a.spx_level - b.spx_level);
  const clusters = [];
  for (const print of sorted) {
    const existing = clusters.find(c => Math.abs(c.center - print.spx_level) <= CLUSTER_RADIUS_PTS);
    if (existing) {
      // Weighted average center
      const totalPrem = existing.total_premium + print.premium;
      existing.center = (existing.center * existing.total_premium + print.spx_level * print.premium) / totalPrem;
      existing.total_premium = totalPrem;
      existing.count += 1;
      // Dominant side
      if (print.side && print.side !== existing.side) existing.side = 'mixed';
    } else {
      clusters.push({
        center: print.spx_level,
        total_premium: print.premium,
        count: 1,
        side: print.side || null
      });
    }
  }
  return clusters.sort((a, b) => b.total_premium - a.total_premium);
}

/**
 * Classify behavior of a cluster relative to spot
 */
function classifyCluster(cluster, spot) {
  if (spot == null) return 'unknown';
  const diff = cluster.center - spot;
  const absDiff = Math.abs(diff);

  // Breakout: spot just moved above cluster (cluster is now just below spot)
  if (diff < 0 && absDiff <= BREAKOUT_WINDOW_PTS) return 'breakout';
  // Breakdown: spot just moved below cluster (cluster is now just above spot)
  if (diff > 0 && absDiff <= BREAKOUT_WINDOW_PTS) return 'breakdown';
  // Support: significant cluster below spot
  if (diff < 0 && absDiff > BREAKOUT_WINDOW_PTS) return 'support';
  // Resistance: significant cluster above spot
  if (diff > 0 && absDiff > BREAKOUT_WINDOW_PTS) return 'resistance';
  return 'unknown';
}

const BEHAVIOR_CN = {
  support:    '承接',
  resistance: '派发',
  breakout:   '突破',
  breakdown:  '破位',
  unknown:    '数据不足'
};

const BEHAVIOR_DESCRIPTION = {
  support:    '机构大单在现价下方承接，提供支撑',
  resistance: '机构大单在现价上方派发，形成压力',
  breakout:   '现价刚突破暗盘大成交区，动能确认',
  breakdown:  '现价刚跌破暗盘大成交区，破位警告',
  unknown:    '暗盘数据不足，无法判断行为'
};

/**
 * Main dark pool behavior engine
 *
 * @param {object} params
 * @param {object} params.darkpool_factors - from uwApi.uw_factors.darkpool_factors
 * @param {object} params.raw_darkpool_spy - from uwApi.raw.darkpool_spy (raw rows)
 * @param {number|null} params.spot_price - current SPX spot price
 * @returns {object} darkpool_conclusion
 */
export function buildDarkpoolBehaviorEngine({
  darkpool_factors = {},
  raw_darkpool_spy = null,
  spot_price = null
} = {}) {
  const spot = safeN(spot_price);

  // ── Parse raw prints ───────────────────────────────────────────────────────
  // Priority: raw_darkpool_spy rows → darkpool_factors.large_levels
  let rawPrints = [];

  if (raw_darkpool_spy) {
    const rows = Array.isArray(raw_darkpool_spy?.data?.data)
      ? raw_darkpool_spy.data.data
      : Array.isArray(raw_darkpool_spy?.data)
        ? raw_darkpool_spy.data
        : Array.isArray(raw_darkpool_spy)
          ? raw_darkpool_spy
          : [];
    rawPrints = rows
      .map(row => {
        const rawPrice = safeN(row.price ?? row.level ?? row.executed_price ?? row.trade_price);
        const ticker   = (row.ticker || row.symbol || 'SPY').toUpperCase();
        const spxLevel = toSpxCoord(rawPrice, ticker);
        const premium  = safeN(row.premium ?? row.notional ?? row.size ?? row.volume);
        return { spx_level: spxLevel, premium: premium ?? 0, side: row.side ?? row.sentiment ?? null };
      })
      .filter(p => p.spx_level != null && p.premium >= MIN_PREMIUM_THRESHOLD);
  }

  // Fallback to normalized large_levels
  if (rawPrints.length === 0 && Array.isArray(darkpool_factors.large_levels)) {
    rawPrints = darkpool_factors.large_levels
      .map(item => {
        const rawPrice = safeN(item.price ?? item.level);
        // large_levels prices may already be SPX or SPY — use heuristic
        // SPX is ~5000–7000, SPY is ~500–700
        const spxLevel = rawPrice != null && rawPrice < 1000
          ? rawPrice * SPY_TO_SPX_MULTIPLIER
          : rawPrice;
        const premium = safeN(item.premium ?? item.notional ?? item.volume) ?? 0;
        return { spx_level: spxLevel, premium, side: item.side ?? null };
      })
      .filter(p => p.spx_level != null && p.premium >= MIN_PREMIUM_THRESHOLD);
  }

  // ── Insufficient data ──────────────────────────────────────────────────────
  if (rawPrints.length === 0 || spot == null) {
    return {
      behavior: 'unknown',
      behavior_cn: BEHAVIOR_CN.unknown,
      behavior_description: BEHAVIOR_DESCRIPTION.unknown,
      spx_level: null,
      tier: 'none',
      total_premium_millions: null,
      clusters: [],
      support_level: darkpool_factors.nearest_support != null
        ? toSpxCoord(darkpool_factors.nearest_support, 'SPY')
        : null,
      resistance_level: darkpool_factors.nearest_resistance != null
        ? toSpxCoord(darkpool_factors.nearest_resistance, 'SPY')
        : null,
      data_quality: 'insufficient',
      _note: 'SPY darkpool prints not available or spot price missing'
    };
  }

  // ── Cluster prints ─────────────────────────────────────────────────────────
  const clusters = clusterPrints(rawPrints);

  // ── Find the most actionable cluster ──────────────────────────────────────
  // Priority: breakout/breakdown (closest to spot) > support/resistance (largest premium)
  let primaryCluster = null;
  let primaryBehavior = 'unknown';

  // First pass: look for breakout/breakdown (highest urgency)
  for (const cluster of clusters) {
    const behavior = classifyCluster(cluster, spot);
    if (behavior === 'breakout' || behavior === 'breakdown') {
      primaryCluster  = cluster;
      primaryBehavior = behavior;
      break;
    }
  }

  // Second pass: largest premium support/resistance
  if (primaryCluster == null) {
    for (const cluster of clusters) {
      const behavior = classifyCluster(cluster, spot);
      if (behavior === 'support' || behavior === 'resistance') {
        primaryCluster  = cluster;
        primaryBehavior = behavior;
        break;
      }
    }
  }

  if (primaryCluster == null) {
    primaryBehavior = 'unknown';
  }

  // ── Tier classification (by total premium) ─────────────────────────────────
  const premM = primaryCluster ? primaryCluster.total_premium / 1_000_000 : 0;
  const tier = premM >= 50 ? 'tier1'      // $50M+ — institutional conviction
             : premM >= 20 ? 'tier2'      // $20M–$50M — notable
             : premM >= 5  ? 'tier3'      // $5M–$20M — moderate
             : 'none';

  // ── Support / resistance levels from all clusters ─────────────────────────
  const supportClusters    = clusters.filter(c => classifyCluster(c, spot) === 'support');
  const resistanceClusters = clusters.filter(c => classifyCluster(c, spot) === 'resistance');
  const supportLevel       = supportClusters[0]?.center ?? null;
  const resistanceLevel    = resistanceClusters[0]?.center ?? null;

  return {
    behavior:             primaryBehavior,
    behavior_cn:          BEHAVIOR_CN[primaryBehavior] ?? BEHAVIOR_CN.unknown,
    behavior_description: BEHAVIOR_DESCRIPTION[primaryBehavior] ?? BEHAVIOR_DESCRIPTION.unknown,
    spx_level:            primaryCluster ? Number(primaryCluster.center.toFixed(1)) : null,
    tier,
    total_premium_millions: primaryCluster
      ? Number((primaryCluster.total_premium / 1_000_000).toFixed(1))
      : null,
    support_level:     supportLevel    != null ? Number(supportLevel.toFixed(1))    : null,
    resistance_level:  resistanceLevel != null ? Number(resistanceLevel.toFixed(1)) : null,
    clusters: clusters.slice(0, 5).map(c => ({
      spx_level:             Number(c.center.toFixed(1)),
      total_premium_millions: Number((c.total_premium / 1_000_000).toFixed(1)),
      count:                 c.count,
      behavior:              classifyCluster(c, spot),
      behavior_cn:           BEHAVIOR_CN[classifyCluster(c, spot)] ?? '未知'
    })),
    data_quality: rawPrints.length >= 10 ? 'good' : rawPrints.length >= 3 ? 'partial' : 'sparse',
    print_count:  rawPrints.length,
    _note: `SPY×10 mapping applied. Reference levels only — NOT live_price.`
  };
}
