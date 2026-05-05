/**
 * flow-recent-queue.js
 *
 * flow_recent 逐笔数据内存队列
 * ─────────────────────────────────────────────────────────────────────────────
 * 解决问题：
 *   UW API /api/stock/SPX/flow-recent 每次只返回最新 50 条（约 35 秒窗口）。
 *   调度器每 30 秒拉取一次，相邻两次拉取有 ~5 秒重叠（约 7 条重复）。
 *   需要将逐笔数据持续追加到内存队列，建立连续的 15 分钟高频数据流。
 *
 * 设计方案：
 *   1. 去重（Deduplication）：
 *      每条 flow_recent 记录有唯一的 `id`（UUID）。
 *      维护一个 Set<id> 滑动窗口，保留最近 MAX_AGE_MS 内的 id。
 *      追加时跳过已见过的 id，彻底消除重叠重复。
 *
 *   2. 断点恢复（Gap Recovery）：
 *      服务重启或 API 短暂失败后，下次拉取的 50 条数据会自动覆盖断点期间。
 *      由于 UW API 返回的是"最新 50 条"，只要断点时长 < 35 秒，数据无缝衔接。
 *      断点 > 35 秒时，队列会有时间缺口，但 microstructure-validation-engine
 *      会通过 coverage_seconds 检测到数据稀疏，自动降级为 NEUTRAL。
 *
 *   3. 队列容量：
 *      保留最近 MAX_AGE_MS（默认 15 分钟）的数据。
 *      15min × 60s / 0.7s/条 ≈ 1286 条上限，内存占用 ~640KB。
 *
 *   4. 每日重置：
 *      市场收盘后（16:00 ET）自动清空队列，避免昨日数据污染今日判断。
 */

'use strict';

const DEFAULT_MAX_AGE_MS  = 15 * 60 * 1000;  // 保留 15 分钟数据
const DEFAULT_MAX_SIZE    = 2000;             // 硬上限（防止内存泄漏）
const SEEN_ID_TTL_MS      = 20 * 60 * 1000;  // id 去重窗口 20 分钟

export class FlowRecentQueue {
  /**
   * @param {object} [options]
   * @param {number} [options.maxAgeMs=900000]  - 保留数据的最大年龄（毫秒）
   * @param {number} [options.maxSize=2000]     - 队列最大条数
   */
  constructor({ maxAgeMs = DEFAULT_MAX_AGE_MS, maxSize = DEFAULT_MAX_SIZE } = {}) {
    this._maxAgeMs = maxAgeMs;
    this._maxSize  = maxSize;

    /** @type {Array<object>} 按 executed_at 升序排列的逐笔数据 */
    this._queue = [];

    /** @type {Map<string, number>} id → 首次见到的时间戳（用于 TTL 去重） */
    this._seenIds = new Map();

    /** 统计信息 */
    this._stats = {
      total_appended:  0,
      total_skipped:   0,
      total_evicted:   0,
      last_append_at:  null,
      last_reset_at:   null,
    };
  }

  // ─── 公共 API ──────────────────────────────────────────────────────────────

  /**
   * 追加一批新的 flow_recent 数据（来自 UW API 的最新 50 条）。
   *
   * 流程：
   * 1. 按 executed_at 排序（UW API 返回顺序不保证）
   * 2. 跳过已见过的 id（去重）
   * 3. 追加新条目到队列
   * 4. 清理过期数据（> maxAgeMs）
   * 5. 清理过期的 seenIds（> SEEN_ID_TTL_MS）
   *
   * @param {Array<object>} newTicks - UW API 返回的 flow_recent 数组
   * @returns {{ appended: number, skipped: number }} 本次追加统计
   */
  append(newTicks) {
    if (!Array.isArray(newTicks) || newTicks.length === 0) {
      return { appended: 0, skipped: 0 };
    }

    const now = Date.now();

    // 按时间升序排列（最早的先处理）
    const sorted = [...newTicks].sort((a, b) => {
      const ta = new Date(a.executed_at || a.created_at || 0).getTime();
      const tb = new Date(b.executed_at || b.created_at || 0).getTime();
      return ta - tb;
    });

    let appended = 0;
    let skipped  = 0;

    for (const tick of sorted) {
      const id = tick.id || tick.flow_alert_id;

      // 去重：跳过已见过的 id
      if (id && this._seenIds.has(id)) {
        skipped++;
        continue;
      }

      // 时间过滤：跳过过期数据
      const ts = new Date(tick.executed_at || tick.created_at || 0).getTime();
      if (ts > 0 && now - ts > this._maxAgeMs) {
        skipped++;
        continue;
      }

      // 追加到队列
      this._queue.push({
        ...tick,
        _ts: ts > 0 ? ts : now,  // 内部时间戳缓存
      });

      // 记录 id（带 TTL）
      if (id) {
        this._seenIds.set(id, now);
      }

      appended++;
    }

    this._stats.total_appended += appended;
    this._stats.total_skipped  += skipped;
    this._stats.last_append_at  = new Date(now).toISOString();

    // 清理过期数据
    this._evict(now);

    return { appended, skipped };
  }

  /**
   * 获取最近 windowMs 内的所有 tick（用于 microstructure-validation-engine）。
   *
   * @param {number} [windowMs] - 窗口大小（毫秒），默认使用 maxAgeMs
   * @returns {Array<object>}
   */
  getWindow(windowMs) {
    const ms = windowMs ?? this._maxAgeMs;
    const cutoff = Date.now() - ms;
    return this._queue.filter(t => t._ts >= cutoff);
  }

  /**
   * 获取队列中所有数据（用于调试）。
   * @returns {Array<object>}
   */
  getAll() {
    return [...this._queue];
  }

  /**
   * 获取队列大小。
   * @returns {number}
   */
  get size() {
    return this._queue.length;
  }

  /**
   * 获取最新一条数据的时间戳（用于检测数据新鲜度）。
   * @returns {number | null}
   */
  get latestTs() {
    if (this._queue.length === 0) return null;
    return this._queue[this._queue.length - 1]._ts;
  }

  /**
   * 获取队列覆盖的时间范围（秒）。
   * @returns {number}
   */
  get coverageSeconds() {
    if (this._queue.length < 2) return 0;
    const oldest = this._queue[0]._ts;
    const newest = this._queue[this._queue.length - 1]._ts;
    return (newest - oldest) / 1000;
  }

  /**
   * 每日重置：清空队列和 seenIds。
   * 应在市场收盘后（16:00 ET）调用。
   */
  reset() {
    const evicted = this._queue.length;
    this._queue    = [];
    this._seenIds  = new Map();
    this._stats.total_evicted += evicted;
    this._stats.last_reset_at  = new Date().toISOString();
  }

  /**
   * 获取统计信息（用于 /signals/current 的 diagnostics）。
   * @returns {object}
   */
  getStats() {
    return {
      queue_size:      this._queue.length,
      coverage_seconds: Math.round(this.coverageSeconds),
      latest_ts:       this.latestTs ? new Date(this.latestTs).toISOString() : null,
      seen_ids_count:  this._seenIds.size,
      ...this._stats,
    };
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 清理过期数据和过期的 seenIds。
   * @param {number} now - 当前时间戳
   */
  _evict(now) {
    const cutoff = now - this._maxAgeMs;

    // 清理过期队列条目（队列按时间升序，从头部删除）
    let evictCount = 0;
    while (this._queue.length > 0 && this._queue[0]._ts < cutoff) {
      this._queue.shift();
      evictCount++;
    }

    // 硬上限保护（防止极端情况下内存泄漏）
    if (this._queue.length > this._maxSize) {
      const excess = this._queue.length - this._maxSize;
      this._queue.splice(0, excess);
      evictCount += excess;
    }

    this._stats.total_evicted += evictCount;

    // 清理过期的 seenIds（TTL = 20 分钟）
    const idCutoff = now - SEEN_ID_TTL_MS;
    for (const [id, ts] of this._seenIds) {
      if (ts < idCutoff) {
        this._seenIds.delete(id);
      }
    }
  }
}

/**
 * 全局单例（整个进程共享一个队列实例）。
 * 调度器每次拉取后调用 globalFlowRecentQueue.append(newTicks)。
 */
export const globalFlowRecentQueue = new FlowRecentQueue();
