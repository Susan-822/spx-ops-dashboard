function numberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rvolLevel(rvol) {
  if (rvol == null) return 'unavailable';
  if (rvol < 0.8) return 'low';
  if (rvol < 1.2) return 'normal';
  if (rvol < 1.5) return 'warming';
  if (rvol < 2) return 'active';
  return 'impulse';
}

function directionFromSnapshot(snapshot = {}) {
  const close = numberOrNull(snapshot.close);
  const open = numberOrNull(snapshot.open);
  const direction = snapshot.volume_direction || snapshot.direction;
  if (['up', 'down', 'mixed'].includes(direction)) return direction;
  if (close != null && open != null && close > open) return 'up';
  if (close != null && open != null && close < open) return 'down';
  return 'unclear';
}

export function normalizeExternalSpot({
  source = 'unavailable',
  price = null,
  spot: spotValue = null,
  last_updated = null,
  is_real = false,
  status = null
} = {}) {
  const spot = numberOrNull(price ?? spotValue);
  return {
    spot,
    source: spot == null ? 'unavailable' : source || 'unavailable',
    is_real: is_real === true,
    status: is_real === true ? 'real' : spot == null ? 'unavailable' : status || 'mock',
    last_updated,
    coherent: true
  };
}

export function buildVolumePressure({ normalized = {}, tvSentinel = {} } = {}) {
  const snapshot = normalized.tradingview_snapshot || {};
  const direct = numberOrNull(snapshot.volume_ratio ?? snapshot.rvol);
  const current = numberOrNull(snapshot.current_volume);
  const average = numberOrNull(snapshot.avg_volume ?? snapshot.average_volume);
  const rvol = direct ?? (current != null && average > 0 ? current / average : null);
  const status = rvol == null ? 'unavailable' : 'live';
  const level = rvolLevel(rvol);
  const direction = directionFromSnapshot(snapshot);
  return {
    status,
    rvol,
    level,
    direction,
    plain_chinese:
      status === 'unavailable'
        ? '量比不可用，不能用推动强度放行。'
        : level === 'impulse'
          ? '量比强推动，禁止逆势抢反向。'
          : level === 'active'
            ? '量比主动推动，等待价格哨兵匹配。'
            : level === 'warming'
              ? '量比开始升温，等待结构确认。'
              : tvSentinel?.triggered
                ? '价格哨兵触发，但量比未形成强推动。'
                : '量比未形成主动推动。'
  };
}
