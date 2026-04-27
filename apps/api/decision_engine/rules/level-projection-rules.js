import { convertSpxToEs, convertSpxToMes, convertSpxToSpy } from '../level-converter.js';

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round(value, decimals = 2) {
  return value == null ? null : Number(value.toFixed(decimals));
}

function priceStatus(price = {}) {
  if (price.status === 'stale') return 'stale';
  return n(price.price) == null ? 'unavailable' : price.status || 'live';
}

function projectLevel(label, key, spx, prices, source = 'uw_spot_exposure', confidence = 'medium') {
  const spxLevel = n(spx);
  const spy = convertSpxToSpy(spxLevel, prices.spy.price, prices.spx.price);
  const es = convertSpxToEs(spxLevel, prices.es.price, prices.spx.price);
  return {
    label,
    type: key,
    spx: spxLevel,
    spy_equiv: round(spy),
    es_equiv: round(es),
    mes_equiv: round(convertSpxToMes(spxLevel, prices.es.price, prices.spx.price)),
    source,
    confidence,
    plain_chinese: spxLevel == null
      ? `${label} 不可投射。`
      : `SPX ${label} ${round(spxLevel)}，对应 ES ${es == null ? 'unavailable' : `约 ${round(es)}`}，SPY ${spy == null ? 'unavailable' : `约 ${round(spy)}`}。`
  };
}

function mapScalarLevels(spxLevels = {}, prices = {}) {
  return Object.fromEntries(
    [
      ['call_wall', 'Call Wall'],
      ['put_wall', 'Put Wall'],
      ['zero_gamma', 'Zero Gamma'],
      ['max_pain', 'Max Pain'],
      ['em_upper', 'EM Upper'],
      ['em_lower', 'EM Lower']
    ].map(([key, label]) => [key, projectLevel(label, key, spxLevels[key], prices)])
  );
}

function projectArray(items = [], prices = {}, defaultSource = 'uw_level') {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const spx = n(item.spx ?? item.strike ?? item.level ?? item.value);
    return projectLevel(
      item.label || item.type || `Level ${index + 1}`,
      item.type || item.label || `level_${index + 1}`,
      spx,
      prices,
      item.source || defaultSource,
      item.confidence || 'medium'
    );
  }).filter((item) => item.spx != null);
}

function statusFor(prices = {}, spxLevels = {}) {
  const spxPriceStatus = priceStatus(prices.spx);
  const spyStatus = priceStatus(prices.spy);
  const esStatus = priceStatus(prices.es);
  const hasWall = ['call_wall', 'put_wall', 'zero_gamma', 'max_pain', 'em_upper', 'em_lower']
    .some((key) => n(spxLevels[key]) != null);
  if (!hasWall || spxPriceStatus === 'unavailable') return 'unavailable';
  if ([spxPriceStatus, spyStatus, esStatus].includes('stale') || spxLevels.stale === true) return 'stale';
  if (spyStatus === 'unavailable' || esStatus === 'unavailable') return 'partial';
  return 'live';
}

export function buildCrossAssetProjection({ prices = {}, spxLevels = {}, targetInstrument = 'ES' } = {}) {
  const safePrices = {
    spx: { price: n(prices.spx?.price), source: prices.spx?.source || 'unavailable', status: priceStatus(prices.spx), age_seconds: prices.spx?.age_seconds ?? null },
    spy: { price: n(prices.spy?.price), source: prices.spy?.source || 'unavailable', status: priceStatus(prices.spy), age_seconds: prices.spy?.age_seconds ?? null },
    es: { price: n(prices.es?.price), source: prices.es?.source || 'unavailable', status: priceStatus(prices.es), age_seconds: prices.es?.age_seconds ?? null }
  };
  const scalar = mapScalarLevels(spxLevels, safePrices);
  const status = statusFor(safePrices, spxLevels);
  const spyRatio = safePrices.spy.price && safePrices.spx.price ? safePrices.spy.price / safePrices.spx.price : null;
  const esRatio = safePrices.es.price && safePrices.spx.price ? safePrices.es.price / safePrices.spx.price : null;
  const basisPoints = safePrices.es.price && safePrices.spx.price ? safePrices.es.price - safePrices.spx.price : null;
  const targetKey = String(targetInstrument || 'ES').toUpperCase() === 'SPY' ? 'spy_equiv' : String(targetInstrument || 'ES').toUpperCase() === 'SPX' ? 'spx' : 'es_equiv';

  return {
    status,
    target_instrument: String(targetInstrument || 'ES').toUpperCase(),
    prices: safePrices,
    basis: {
      spy_spx_ratio: round(spyRatio, 6),
      es_spx_ratio: round(esRatio, 6),
      es_spx_basis_points: round(basisPoints),
      basis_status: basisPoints == null ? 'unknown' : Math.abs(basisPoints) > 30 ? 'wide' : 'normal'
    },
    spx_levels: Object.fromEntries(Object.entries(scalar).map(([key, value]) => [key, value.spx])),
    spy_equivalent_levels: Object.fromEntries(Object.entries(scalar).map(([key, value]) => [key, value.spy_equiv])),
    es_equivalent_levels: Object.fromEntries(Object.entries(scalar).map(([key, value]) => [key, value.es_equiv])),
    projected_levels: Object.values(scalar),
    gex_pivots_projected: projectArray(spxLevels.gex_pivots, safePrices, 'uw_gex_pivot'),
    oi_walls_projected: projectArray(spxLevels.oi_walls, safePrices, 'uw_oi_wall'),
    volume_magnets_projected: projectArray(spxLevels.volume_magnets, safePrices, 'uw_volume_magnet'),
    nearest_dealer_wall: scalar.call_wall?.spx != null ? scalar.call_wall : scalar.put_wall,
    next_target_wall: scalar.call_wall?.spx != null ? scalar.call_wall : scalar.max_pain,
    target_key: targetKey,
    plain_chinese:
      status === 'unavailable'
        ? 'SPX 墙位或 SPX 现价不可用，无法做跨资产投射。'
        : status === 'partial'
          ? `${targetInstrument} 等效价部分不可用，只能参考 SPX 原始墙位。`
          : `跨资产投射 ${status}：Call Wall ES ${scalar.call_wall.es_equiv ?? 'unavailable'}，Put Wall ES ${scalar.put_wall.es_equiv ?? 'unavailable'}，Zero Gamma ES ${scalar.zero_gamma.es_equiv ?? 'unavailable'}。`
  };
}
