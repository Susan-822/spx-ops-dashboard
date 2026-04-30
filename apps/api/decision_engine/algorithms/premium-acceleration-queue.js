/**
 * premium-acceleration-queue.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side time-series queue for Net Premium acceleration computation.
 *
 * Architecture decision: ALL acceleration math runs on the server.
 * The frontend only receives the pre-computed acceleration_label and
 * is_accelerating flag. This prevents browser-side computation pressure.
 *
 * Queue design:
 *   - Stores snapshots of net_premium at each poll interval
 *   - Computes 15-minute window delta: current_sum - T-15min_sum
 *   - Outputs acceleration_label in format "+$X.XB/15min" or "-$X.XM/15min"
 *   - Detects acceleration: delta > 20% of previous window
 *
 * Usage:
 *   const queue = new PremiumAccelerationQueue();
 *   queue.push({ net_premium, call_premium, put_premium, ts });
 *   const result = queue.compute();
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
const MAX_ENTRIES = 200;           // ~200 entries at 5s poll = ~16 min of data

class PremiumAccelerationQueue {
  constructor() {
    this._queue = [];
    this._lastAcceleration = null;
  }

  /**
   * Push a new premium snapshot into the queue.
   * @param {object} snapshot - { net_premium, call_premium, put_premium, ts? }
   */
  push(snapshot) {
    if (snapshot == null) return;
    const { net_premium, call_premium, put_premium } = snapshot;
    if (net_premium == null || !Number.isFinite(net_premium)) return;

    const entry = {
      net_premium: Number(net_premium),
      call_premium: call_premium != null ? Number(call_premium) : null,
      put_premium:  put_premium  != null ? Number(put_premium)  : null,
      ts: snapshot.ts || Date.now()
    };

    this._queue.push(entry);

    // Trim to max size
    if (this._queue.length > MAX_ENTRIES) {
      this._queue.shift();
    }
  }

  /**
   * Compute the 15-minute acceleration.
   * @returns {object} acceleration result
   */
  compute() {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    if (this._queue.length < 2) {
      return this._buildResult(null, null, null, 'building');
    }

    // Get the most recent entry
    const latest = this._queue[this._queue.length - 1];

    // Find the entry closest to T-15min
    const t15Entry = this._findEntryNear(windowStart);

    if (t15Entry == null) {
      return this._buildResult(null, latest.net_premium, null, 'insufficient');
    }

    // Compute delta
    const delta = latest.net_premium - t15Entry.net_premium;
    const deltaCall = (latest.call_premium != null && t15Entry.call_premium != null)
      ? latest.call_premium - t15Entry.call_premium : null;
    const deltaPut = (latest.put_premium != null && t15Entry.put_premium != null)
      ? latest.put_premium - t15Entry.put_premium : null;

    // Detect acceleration: compare current 15min delta to previous 15min delta
    const prevWindowStart = windowStart - WINDOW_MS;
    const prevEntry = this._findEntryNear(prevWindowStart);
    let prevDelta = null;
    let isAccelerating = false;
    let accelerationRatio = null;

    if (prevEntry != null) {
      prevDelta = t15Entry.net_premium - prevEntry.net_premium;
      if (prevDelta !== 0 && Number.isFinite(prevDelta)) {
        accelerationRatio = delta / Math.abs(prevDelta);
        // Accelerating if current window > 20% more than previous window (same direction)
        isAccelerating = Math.abs(accelerationRatio) > 1.2 && Math.sign(delta) === Math.sign(prevDelta);
      }
    }

    const result = this._buildResult(delta, latest.net_premium, prevDelta, 'ready');
    result.is_accelerating = isAccelerating;
    result.acceleration_ratio = accelerationRatio != null ? Number(accelerationRatio.toFixed(2)) : null;
    result.delta_call = deltaCall;
    result.delta_put  = deltaPut;
    result.direction  = delta > 0 ? 'bullish' : delta < 0 ? 'bearish' : 'flat';
    result.t15_net_premium = t15Entry.net_premium;
    result.queue_size = this._queue.length;
    result.window_actual_ms = latest.ts - t15Entry.ts;

    this._lastAcceleration = result;
    return result;
  }

  /**
   * Find the queue entry closest to a target timestamp.
   */
  _findEntryNear(targetTs) {
    if (this._queue.length === 0) return null;
    let best = null;
    let bestDiff = Infinity;
    for (const entry of this._queue) {
      const diff = Math.abs(entry.ts - targetTs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = entry;
      }
    }
    // Only return if within 5 minutes of target (avoid stale data)
    if (bestDiff > 5 * 60 * 1000) return null;
    return best;
  }

  /**
   * Build the standardized acceleration result object.
   */
  _buildResult(delta, currentNetPrem, prevDelta, status) {
    const label = this._formatDelta(delta);
    const prevLabel = this._formatDelta(prevDelta);

    return {
      status,                    // 'ready' | 'building' | 'insufficient'
      delta,                     // raw delta in dollars
      delta_label: label,        // "+$1.6B/15min"
      acceleration_label: label, // alias for frontend
      prev_delta: prevDelta,
      prev_delta_label: prevLabel,
      current_net_premium: currentNetPrem,
      is_accelerating: false,    // overridden in compute() when ready
      direction: delta != null ? (delta > 0 ? 'bullish' : delta < 0 ? 'bearish' : 'flat') : 'flat',
      _computed_at: new Date().toISOString()
    };
  }

  /**
   * Format a dollar delta into human-readable string.
   * e.g. 1_600_000_000 → "+$1.6B/15min"
   */
  _formatDelta(delta) {
    if (delta == null || !Number.isFinite(delta)) return '--';
    const sign = delta >= 0 ? '+' : '';
    const abs = Math.abs(delta);
    if (abs >= 1_000_000_000) {
      return `${sign}$${(delta / 1_000_000_000).toFixed(1)}B/15min`;
    } else if (abs >= 1_000_000) {
      return `${sign}$${(delta / 1_000_000).toFixed(0)}M/15min`;
    } else if (abs >= 1_000) {
      return `${sign}$${(delta / 1_000).toFixed(0)}K/15min`;
    }
    return `${sign}$${delta.toFixed(0)}/15min`;
  }

  /**
   * Get current queue stats for debugging.
   */
  stats() {
    return {
      queue_size: this._queue.length,
      oldest_ts: this._queue.length > 0 ? new Date(this._queue[0].ts).toISOString() : null,
      newest_ts: this._queue.length > 0 ? new Date(this._queue[this._queue.length - 1].ts).toISOString() : null,
      last_acceleration: this._lastAcceleration
    };
  }
}

// ── Singleton instance shared across the process ──────────────────────────────
const globalQueue = new PremiumAccelerationQueue();

export { PremiumAccelerationQueue, globalQueue };
