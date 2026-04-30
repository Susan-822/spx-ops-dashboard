/**
 * telegram-ab-alert.js
 * ─────────────────────────────────────────────────────────────────────────────
 * A/B 单专用 Telegram 消息格式化器
 *
 * 职责：
 *   - 接收 AbChangeEvent（来自 ab-state-watcher.js）
 *   - 生成适合 Telegram 的中文消息文本
 *   - 调用 Telegram adapter 发送消息
 *   - 利用现有 dedupeStore 防止重复告警（5分钟窗口）
 *
 * 消息格式示例：
 *   🟢 A单放行｜LONG CALL
 *   SPX 7152 站稳 7150 第一触发线
 *   Call Flow 5m+15m 双窗口偏多
 *   进场：7150–7155 附近
 *   目标一：7160  目标二：7165
 *   止损：跌破 7135
 *   可信度：72/100
 *   时间：14:32 ET
 */

import { sendTelegramReal } from '../adapters/telegram/real.js';
import {
  isTelegramAlertDuplicate,
  markTelegramAlertSent,
  getTelegramAlertDedupeKey,
} from '../state/telegramAlertDedupeStore.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v, fallback = '--') {
  return v != null && String(v).trim() !== '' ? String(v) : fallback;
}

function safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v, decimals = 0) {
  const n = safeN(v);
  return n != null ? n.toFixed(decimals) : '--';
}

/** Format ET time from ISO string */
function fmtEtTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' ET';
  } catch {
    return '--';
  }
}

// ─── Direction labels ─────────────────────────────────────────────────────────

const DIRECTION_EMOJI = {
  BULLISH:  '🟢',
  BEARISH:  '🔴',
  NEUTRAL:  '⚪',
  blocked:  '⛔',
};

function dirEmoji(dir) {
  return DIRECTION_EMOJI[String(dir).toUpperCase()] ?? '⚪';
}

function dirCn(dir) {
  const d = String(dir).toUpperCase();
  if (d === 'BULLISH') return '多头';
  if (d === 'BEARISH') return '空头';
  return '观望';
}

// ─── Message builders ─────────────────────────────────────────────────────────

/**
 * Build message for status_ready event (A/B 单放行)
 */
function buildReadyMessage(event) {
  const ab = event.ab || {};
  const planA = ab.plan_a || {};
  const planB = ab.plan_b || {};
  const spot  = safeN(ab.spot_price);
  const conf  = safeN(ab.execution_confidence) ?? 0;
  const time  = fmtEtTime(event.detected_at);

  const lines = [];

  // ── Header ────────────────────────────────────────────────────────────────
  const dir   = planA.direction || 'NEUTRAL';
  const inst  = safeStr(planA.instrument, 'SPX 0DTE');
  lines.push(`${dirEmoji(dir)} A单放行｜${inst}`);
  lines.push('');

  // ── Price context ─────────────────────────────────────────────────────────
  if (spot) {
    lines.push(`SPX 现价：${fmt(spot, 1)}`);
  }
  if (planA.entry) {
    lines.push(`进场区间：${safeStr(planA.entry)}`);
  }

  // ── Execution plan ────────────────────────────────────────────────────────
  if (planA.tp1 || planA.tp2) {
    const targets = [planA.tp1, planA.tp2].filter(Boolean).map(v => fmt(v)).join(' / ');
    lines.push(`目标：${targets}`);
  }
  if (planA.stop_loss) {
    lines.push(`止损：${safeStr(planA.stop_loss)}`);
  }
  if (planA.invalidation) {
    lines.push(`失效：${safeStr(planA.invalidation)}`);
  }

  // ── B plan (if exists) ────────────────────────────────────────────────────
  if (planB && planB.direction && planB.instrument) {
    lines.push('');
    lines.push(`📋 B单备选：${safeStr(planB.instrument)} (${dirCn(planB.direction)})`);
    if (planB.entry) lines.push(`   进场：${safeStr(planB.entry)}`);
  }

  // ── Confidence + time ─────────────────────────────────────────────────────
  lines.push('');
  const confLabel = conf >= 70 ? '高｜可执行' : conf >= 50 ? '中｜小仓等确认' : '低｜只观察';
  lines.push(`可信度：${conf}/100  ${confLabel}`);
  lines.push(`时间：${time}`);

  // ── Forbidden reminder ────────────────────────────────────────────────────
  if (planA.forbidden) {
    lines.push(`⚠️ 禁做：${safeStr(planA.forbidden)}`);
  }

  return lines.join('\n');
}

/**
 * Build message for status_blocked event (A/B 单失效)
 */
function buildBlockedMessage(event) {
  const ab   = event.ab || {};
  const spot = safeN(ab.spot_price);
  const time = fmtEtTime(event.detected_at);
  const reason = safeStr(ab.blocked_reason || ab.headline, '条件不满足');

  const lines = [
    `⛔ A/B单失效｜LOCKED`,
    '',
    spot ? `SPX 现价：${fmt(spot, 1)}` : '',
    `原因：${reason}`,
    '',
    `时间：${time}`,
    `建议：等待新的触发条件形成。`,
  ].filter(v => v !== '');

  return lines.join('\n');
}

/**
 * Build message for direction_flip event (方向翻转)
 */
function buildDirectionFlipMessage(event) {
  const ab   = event.ab || {};
  const planA = ab.plan_a || {};
  const spot  = safeN(ab.spot_price);
  const time  = fmtEtTime(event.detected_at);
  const prevDir = dirCn(event.prev.plan_a_dir);
  const currDir = dirCn(event.curr.plan_a_dir);

  const lines = [
    `🔄 方向翻转｜${prevDir} → ${currDir}`,
    '',
    spot ? `SPX 现价：${fmt(spot, 1)}` : '',
    `新方向：${dirEmoji(planA.direction)} ${safeStr(planA.instrument)}`,
    planA.entry ? `进场：${safeStr(planA.entry)}` : '',
    planA.tp1 ? `目标：${fmt(planA.tp1)} / ${fmt(planA.tp2)}` : '',
    planA.stop_loss ? `止损：${safeStr(planA.stop_loss)}` : '',
    '',
    `时间：${time}`,
    `⚠️ 旧方向预案已作废，请重新评估。`,
  ].filter(v => v !== '');

  return lines.join('\n');
}

/**
 * Build message for confidence_up event (置信度提升)
 */
function buildConfidenceUpMessage(event) {
  const ab   = event.ab || {};
  const planA = ab.plan_a || {};
  const conf  = safeN(ab.execution_confidence) ?? 0;
  const spot  = safeN(ab.spot_price);
  const time  = fmtEtTime(event.detected_at);

  const lines = [
    `📈 置信度提升｜${event.prev.confidence} → ${conf}/100`,
    '',
    spot ? `SPX 现价：${fmt(spot, 1)}` : '',
    planA.instrument ? `当前预案：${safeStr(planA.instrument)} (${dirCn(planA.direction)})` : '',
    planA.entry ? `进场：${safeStr(planA.entry)}` : '',
    '',
    `时间：${time}`,
    conf >= 70
      ? `✅ 置信度已达 ${conf}/100，可考虑小仓执行。`
      : `⚠️ 置信度 ${conf}/100，仍建议观察为主。`,
  ].filter(v => v !== '');

  return lines.join('\n');
}

/**
 * Route event to the correct message builder.
 */
function buildMessageFromEvent(event) {
  switch (event.event_type) {
    case 'status_ready':      return buildReadyMessage(event);
    case 'status_blocked':    return buildBlockedMessage(event);
    case 'direction_flip':    return buildDirectionFlipMessage(event);
    case 'confidence_up':     return buildConfidenceUpMessage(event);
    case 'instrument_change': return buildReadyMessage(event); // reuse ready format
    case 'force_emit':        return buildReadyMessage(event);
    default:
      return `[SPX OPS] A/B单状态变化：${event.event_type} (${event.detected_at})`;
  }
}

// ─── Dedupe key builder ───────────────────────────────────────────────────────

function buildDedupeKey(event) {
  const ab = event.ab || {};
  const planA = ab.plan_a || {};
  return getTelegramAlertDedupeKey([
    'ab_alert',
    event.event_type,
    planA.direction || 'neutral',
    planA.instrument || 'none',
    // Round confidence to nearest 10 to avoid flooding on tiny changes
    String(Math.floor((safeN(ab.execution_confidence) ?? 0) / 10) * 10),
  ]);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Process a list of AbChangeEvents and send Telegram alerts for each.
 * Respects deduplication window (default 5 minutes).
 *
 * @param {import('../state/ab-state-watcher.js').AbChangeEvent[]} events
 * @returns {Promise<{ sent: number, skipped: number, errors: number }>}
 */
export async function sendAbTelegramAlerts(events) {
  let sent = 0, skipped = 0, errors = 0;

  for (const event of events) {
    // Skip low-severity instrument_change to reduce noise
    if (event.event_type === 'instrument_change' && event.severity === 'low') {
      skipped++;
      continue;
    }

    const dedupeKey = buildDedupeKey(event);

    // Check deduplication (bypass for high-severity events)
    if (event.severity !== 'high' && isTelegramAlertDuplicate(dedupeKey)) {
      skipped++;
      continue;
    }

    const text = buildMessageFromEvent(event);

    try {
      await sendTelegramReal({ text });
      markTelegramAlertSent(dedupeKey);
      sent++;
    } catch (err) {
      console.error('[telegram-ab-alert] send error:', err.message);
      errors++;
    }
  }

  return { sent, skipped, errors };
}

/**
 * Build a test message (for /telegram/test endpoint).
 */
export function buildAbAlertTestMessage(ab = {}) {
  const mockEvent = {
    event_type:  'status_ready',
    severity:    'high',
    prev:        { status: 'waiting', plan_a_dir: '', confidence: 30 },
    curr:        { status: 'ready',   plan_a_dir: 'BULLISH', confidence: 72 },
    ab:          {
      status: 'ready',
      execution_confidence: 72,
      spot_price: ab.spot_price || 7152,
      plan_a: {
        direction:   'BULLISH',
        instrument:  'Long Call 7150 (0DTE)',
        entry:       '7150–7155 附近',
        tp1:         7160,
        tp2:         7165,
        stop_loss:   '跌破 7135，Call Flow 转负',
        invalidation:'跌破 7135',
        forbidden:   '7145 ATM 附近不要乱买',
      },
      plan_b: {
        direction:  'BEARISH',
        instrument: 'Short Put 7140 (0DTE)',
        entry:      '7140 附近',
      },
    },
    detected_at: new Date().toISOString(),
  };
  return buildMessageFromEvent(mockEvent);
}
