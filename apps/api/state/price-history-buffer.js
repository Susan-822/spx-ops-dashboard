/**
 * Price History Buffer — Server-side SPX spot price time-series queue
 *
 * 维护一个服务器内存中的 SPX 现价历史队列，提供以下时间窗口的快照：
 *   spot_now    — 最新现价
 *   spot_1m     — 1 分钟前
 *   spot_3m     — 3 分钟前
 *   spot_5m     — 5 分钟前
 *   spot_15m    — 15 分钟前
 *
 * 这是动态价格验证（Call 被压 / Put 被绞 / 暗盘承接失败 / 底部承接）的数据基础。
 * 所有计算在服务器端完成，前端只接收已计算好的结论。
 */

const MAX_ENTRIES = 300;   // 约 25 分钟 @ 5s 间隔
const WINDOWS = {
  '1m':  60 * 1000,
  '3m':  3 * 60 * 1000,
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000
};

// In-memory circular buffer: [{ts: number, price: number}]
let _buffer = [];

/**
 * Push a new spot price into the buffer.
 * Called by the live-refresh-scheduler every FMP poll cycle (~2s).
 */
export function pushSpotPrice(price) {
  const ts = Date.now();
  const p = typeof price === 'number' && Number.isFinite(price) ? price : null;
  if (p == null) return;

  _buffer.push({ ts, price: p });

  // Trim to max entries
  if (_buffer.length > MAX_ENTRIES) {
    _buffer = _buffer.slice(_buffer.length - MAX_ENTRIES);
  }
}

/**
 * Get the closest price to (now - windowMs), or null if not enough history.
 */
function getPriceAtWindow(windowMs) {
  if (_buffer.length === 0) return null;
  const targetTs = Date.now() - windowMs;
  // Find the entry closest to targetTs
  let closest = null;
  let minDiff = Infinity;
  for (const entry of _buffer) {
    const diff = Math.abs(entry.ts - targetTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = entry;
    }
  }
  // Only return if within 2x the window (avoid stale data)
  if (closest && minDiff < windowMs * 2) return closest.price;
  return null;
}

/**
 * Get the full price history snapshot for the decision engine.
 *
 * @returns {Object} {
 *   spot_now, spot_1m, spot_3m, spot_5m, spot_15m,
 *   delta_1m, delta_3m, delta_5m, delta_15m,
 *   trend_1m, trend_5m, trend_15m,
 *   buffer_size, oldest_ts, newest_ts
 * }
 */
export function getPriceHistory() {
  const now = _buffer.length > 0 ? _buffer[_buffer.length - 1].price : null;

  const prices = {};
  for (const [key, ms] of Object.entries(WINDOWS)) {
    prices[`spot_${key}`] = getPriceAtWindow(ms);
  }

  // Deltas (positive = price rose, negative = price fell)
  const delta1m  = now != null && prices.spot_1m  != null ? Number((now - prices.spot_1m).toFixed(2))  : null;
  const delta3m  = now != null && prices.spot_3m  != null ? Number((now - prices.spot_3m).toFixed(2))  : null;
  const delta5m  = now != null && prices.spot_5m  != null ? Number((now - prices.spot_5m).toFixed(2))  : null;
  const delta15m = now != null && prices.spot_15m != null ? Number((now - prices.spot_15m).toFixed(2)) : null;

  // Trend labels
  function trendLabel(delta) {
    if (delta == null) return 'unknown';
    if (delta > 2)  return 'rising';
    if (delta < -2) return 'falling';
    return 'flat';
  }

  return {
    spot_now:   now,
    spot_1m:    prices.spot_1m,
    spot_3m:    prices.spot_3m,
    spot_5m:    prices.spot_5m,
    spot_15m:   prices.spot_15m,
    delta_1m:   delta1m,
    delta_3m:   delta3m,
    delta_5m:   delta5m,
    delta_15m:  delta15m,
    trend_1m:   trendLabel(delta1m),
    trend_5m:   trendLabel(delta5m),
    trend_15m:  trendLabel(delta15m),
    buffer_size: _buffer.length,
    oldest_ts:  _buffer.length > 0 ? _buffer[0].ts : null,
    newest_ts:  _buffer.length > 0 ? _buffer[_buffer.length - 1].ts : null
  };
}

/**
 * Check if the buffer has enough history for a given window.
 */
export function hasHistory(windowKey = '5m') {
  const ms = WINDOWS[windowKey];
  if (!ms || _buffer.length < 2) return false;
  const oldest = _buffer[0].ts;
  return (Date.now() - oldest) >= ms;
}

/**
 * Reset the buffer (for testing).
 */
export function resetBuffer() {
  _buffer = [];
}

export default { pushSpotPrice, getPriceHistory, hasHistory, resetBuffer };
