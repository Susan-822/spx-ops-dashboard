/**
 * ab-state-watcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * A/B 单状态变化检测器
 *
 * 职责：
 *   - 记录上一次 ab_order_engine 的输出快照
 *   - 每次 UW 数据刷新后，比较新旧状态
 *   - 检测到以下变化时，返回变化事件供 Telegram 告警使用：
 *       1. status 变化（blocked → ready / waiting → ready / ready → blocked）
 *       2. direction 变化（多头 → 空头 / 空头 → 多头）
 *       3. plan_a 或 plan_b 的 instrument 变化（品种换了）
 *       4. 置信度从低 → 高（execution_confidence 跨越 60 阈值）
 *
 * 不依赖 TradingView，纯 UW 数据驱动。
 */

// ─── Internal state store ─────────────────────────────────────────────────────

/** @type {{ snapshot: object|null, timestamp: string|null }} */
let _lastState = {
  snapshot: null,
  timestamp: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v) {
  return v != null ? String(v) : '';
}

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract a compact "fingerprint" from ab_order_engine output for comparison.
 * Only fields that are meaningful for Telegram alerts are included.
 */
function extractFingerprint(ab) {
  if (!ab || typeof ab !== 'object') return null;
  return {
    status:      safeStr(ab.status),
    plan_a_dir:  safeStr(ab.plan_a?.direction),
    plan_a_inst: safeStr(ab.plan_a?.instrument),
    plan_a_entry:safeStr(ab.plan_a?.entry),
    plan_b_dir:  safeStr(ab.plan_b?.direction),
    plan_b_inst: safeStr(ab.plan_b?.instrument),
    confidence:  safeN(ab.execution_confidence) ?? 0,
  };
}

/**
 * Determine if confidence crossed the "actionable" threshold (60).
 */
function confidenceCrossedThreshold(oldConf, newConf) {
  const THRESHOLD = 60;
  return oldConf < THRESHOLD && newConf >= THRESHOLD;
}

// ─── Change event types ───────────────────────────────────────────────────────

/**
 * @typedef {Object} AbChangeEvent
 * @property {string} event_type  - 'status_ready' | 'status_blocked' | 'direction_flip' | 'confidence_up' | 'instrument_change'
 * @property {string} severity    - 'high' | 'medium' | 'low'
 * @property {object} prev        - previous fingerprint
 * @property {object} curr        - current fingerprint
 * @property {object} ab          - full ab_order_engine output (for message building)
 * @property {string} detected_at - ISO timestamp
 */

// ─── Core detection function ──────────────────────────────────────────────────

/**
 * Compare new ab_order_engine output against the stored snapshot.
 * Returns an array of change events (empty if nothing changed).
 *
 * @param {object} newAb - ab_order_engine output from current signal
 * @param {object} [opts]
 * @param {boolean} [opts.force] - force emit even if no change (for testing)
 * @returns {AbChangeEvent[]}
 */
export function detectAbStateChange(newAb, opts = {}) {
  const events = [];
  const now = new Date().toISOString();

  const curr = extractFingerprint(newAb);
  if (!curr) return events;

  const prev = _lastState.snapshot ? extractFingerprint(_lastState.snapshot) : null;

  // ── First run: no previous state, store and return empty ──────────────────
  if (!prev) {
    _lastState = { snapshot: newAb, timestamp: now };
    return events;
  }

  // ── 1. Status change: blocked/waiting → ready ─────────────────────────────
  if (prev.status !== 'ready' && curr.status === 'ready') {
    events.push({
      event_type:   'status_ready',
      severity:     'high',
      prev,
      curr,
      ab:           newAb,
      detected_at:  now,
    });
  }

  // ── 2. Status change: ready → blocked ─────────────────────────────────────
  if (prev.status === 'ready' && curr.status === 'blocked') {
    events.push({
      event_type:   'status_blocked',
      severity:     'medium',
      prev,
      curr,
      ab:           newAb,
      detected_at:  now,
    });
  }

  // ── 3. Direction flip (only when status is ready) ─────────────────────────
  if (
    curr.status === 'ready' &&
    prev.plan_a_dir &&
    curr.plan_a_dir &&
    prev.plan_a_dir !== curr.plan_a_dir
  ) {
    events.push({
      event_type:   'direction_flip',
      severity:     'high',
      prev,
      curr,
      ab:           newAb,
      detected_at:  now,
    });
  }

  // ── 4. Confidence crossed actionable threshold ────────────────────────────
  if (confidenceCrossedThreshold(prev.confidence, curr.confidence)) {
    events.push({
      event_type:   'confidence_up',
      severity:     'medium',
      prev,
      curr,
      ab:           newAb,
      detected_at:  now,
    });
  }

  // ── 5. Instrument change (plan switched to a different product) ───────────
  if (
    curr.status === 'ready' &&
    prev.plan_a_inst &&
    curr.plan_a_inst &&
    prev.plan_a_inst !== curr.plan_a_inst
  ) {
    events.push({
      event_type:   'instrument_change',
      severity:     'low',
      prev,
      curr,
      ab:           newAb,
      detected_at:  now,
    });
  }

  // ── Force emit (for testing) ──────────────────────────────────────────────
  if (opts.force && events.length === 0) {
    events.push({
      event_type:   'force_emit',
      severity:     'low',
      prev,
      curr,
      ab:           newAb,
      detected_at:  now,
    });
  }

  // ── Update stored snapshot ────────────────────────────────────────────────
  _lastState = { snapshot: newAb, timestamp: now };

  return events;
}

// ─── State accessors ──────────────────────────────────────────────────────────

/** Get the last stored ab_order_engine snapshot (for debugging). */
export function getLastAbState() {
  return { ..._lastState };
}

/** Reset state (used in tests). */
export function resetAbStateWatcher() {
  _lastState = { snapshot: null, timestamp: null };
}
