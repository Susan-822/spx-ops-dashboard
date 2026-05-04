/**
 * pre-market-snapshot.js
 *
 * Fires a Telegram snapshot message at 09:25 ET (5 min before regular open).
 * Summarises the key GEX levels, pre-market flow direction, dark pool prints,
 * and opening bias derived from the latest UW data snapshot.
 *
 * Triggered by live-refresh-scheduler.js once per trading day at 09:25 ET.
 * Idempotent: a per-date flag prevents duplicate sends on server restart.
 *
 * Usage:
 *   import { maybeSendPreMarketSnapshot } from './pre-market-snapshot.js';
 *   // Call this every minute from the scheduler; it self-gates on time + date.
 *   await maybeSendPreMarketSnapshot(getCurrentSignal);
 */

import { sendTelegramReal } from '../adapters/telegram/real.js';

// ─── Per-day dedup guard ──────────────────────────────────────────────────────
let _lastSentDate = null;   // 'YYYY-MM-DD' in ET

/**
 * Returns the current date string in ET (YYYY-MM-DD).
 */
function _etDateString() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const dstStart = (() => {
    const d = new Date(Date.UTC(year, 2, 1));
    const fs = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 2, 1 + fs + 7, 7));
  })();
  const dstEnd = (() => {
    const d = new Date(Date.UTC(year, 10, 1));
    const fs = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 10, 1 + fs, 6));
  })();
  const offsetHours = (now >= dstStart && now < dstEnd) ? 4 : 5;
  const etMs = now.getTime() - offsetHours * 3600 * 1000;
  const et = new Date(etMs);
  const mm = String(et.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(et.getUTCDate()).padStart(2, '0');
  return `${et.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Returns ET minutes-of-day for the current time.
 */
function _etMinutesNow() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const dstStart = (() => {
    const d = new Date(Date.UTC(year, 2, 1));
    const fs = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 2, 1 + fs + 7, 7));
  })();
  const dstEnd = (() => {
    const d = new Date(Date.UTC(year, 10, 1));
    const fs = (7 - d.getUTCDay()) % 7;
    return new Date(Date.UTC(year, 10, 1 + fs, 6));
  })();
  const offsetHours = (now >= dstStart && now < dstEnd) ? 4 : 5;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return ((utcMin - offsetHours * 60) + 1440) % 1440;
}

// ─── Message builder ──────────────────────────────────────────────────────────

/**
 * Builds the pre-market snapshot Telegram message from a signal object.
 * @param {object} signal  — output of getCurrentSignal()
 * @returns {string}
 */
export function buildPreMarketSnapshotMessage(signal) {
  const gex      = signal?.gex_engine        ?? {};
  const flow     = signal?.flow_engine        ?? {};
  const dp       = signal?.darkpool_engine    ?? {};
  const ab       = signal?.ab_order_engine    ?? {};
  const iv       = signal?.iv_engine          ?? {};
  const spot     = signal?.spot               ?? '--';

  // GEX levels
  const callWall  = gex.near_call_wall  ?? gex.call_wall  ?? '--';
  const putWall   = gex.near_put_wall   ?? gex.put_wall   ?? '--';
  const atm       = gex.atm             ?? '--';
  const gammaFlip = gex.gamma_flip      ?? '--';
  const gammaEnv  = gex.gamma_env       ?? '--';

  // Flow
  const netPrem5m  = flow.net_premium_5m  != null ? `${flow.net_premium_5m > 0 ? '+' : ''}$${(flow.net_premium_5m / 1e6).toFixed(1)}M` : '--';
  const pcRatio    = flow.put_call_ratio  != null ? flow.put_call_ratio.toFixed(2) : '--';
  const flowBias   = flow.bias_label      ?? (flow.net_premium_5m > 0 ? '偏多' : flow.net_premium_5m < 0 ? '偏空' : '中性');

  // Dark pool
  const dpLevels = Array.isArray(dp.levels) && dp.levels.length > 0
    ? dp.levels.slice(0, 3).map(l => `  ${l.price} @ $${(l.premium / 1e6).toFixed(1)}M`).join('\n')
    : '  暗盘数据待接入';

  // A/B order
  const aStatus   = ab.a_order?.status   ?? 'blocked';
  const aDir      = ab.a_order?.direction ?? '--';
  const aContract = ab.a_order?.contract  ?? '--';
  const bContract = ab.b_order?.contract  ?? '--';

  // Opening bias
  let openBias = '等待开盘确认';
  if (spot !== '--' && callWall !== '--' && putWall !== '--') {
    const s = parseFloat(spot);
    const cw = parseFloat(callWall);
    const pw = parseFloat(putWall);
    if (s > cw) openBias = `突破 Call Wall ${callWall}，多头强势`;
    else if (s < pw) openBias = `跌破 Put Wall ${putWall}，空头主导`;
    else openBias = `在 ${putWall}–${callWall} 区间内，方向待确认`;
  }

  // IV
  const ivRank = iv.iv_rank != null ? iv.iv_rank.toFixed(0) : '--';
  const iv30   = iv.iv30    != null ? (iv.iv30 * 100).toFixed(1) + '%' : '--';

  // ET time string
  const now = new Date();
  const etMs = now.getTime() - (_etMinutesNow() < 0 ? 0 : 0); // already computed
  const etHour = Math.floor(_etMinutesNow() / 60);
  const etMin  = String(_etMinutesNow() % 60).padStart(2, '0');
  const timeStr = `${etHour}:${etMin} ET`;

  return [
    `📊 SPX 盘前快照 | 09:25 ET`,
    ``,
    `📍 GEX 基准`,
    `  Call Wall: ${callWall}  |  Put Wall: ${putWall}  |  ATM: ${atm}`,
    `  Gamma 环境: ${gammaEnv}  |  Gamma Flip: ${gammaFlip}`,
    ``,
    `💰 盘前 Flow`,
    `  Net Premium (5m): ${netPrem5m}（${flowBias}）`,
    `  P/C 比: ${pcRatio}`,
    ``,
    `🌑 暗盘承接`,
    dpLevels,
    ``,
    `🎯 A/B 单预案`,
    `  A单: ${aDir} ${aContract}（${aStatus}）`,
    `  B单备选: ${bContract}`,
    ``,
    `⚡ 开盘偏向`,
    `  ${openBias}`,
    ``,
    `📈 波动率`,
    `  IV Rank: ${ivRank}  |  IV30: ${iv30}`,
    ``,
    `⏰ 开盘冲刺模式将于 09:30 激活（15s 刷新）`,
    `时间: ${timeStr}`,
  ].join('\n');
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Call this every ~60s from the scheduler.
 * Sends the snapshot only once per trading day, at 09:25–09:29 ET.
 *
 * @param {Function} getCurrentSignal  — async () => signal object
 */
export async function maybeSendPreMarketSnapshot(getCurrentSignal) {
  if (process.env.TELEGRAM_ENABLED !== 'true') return;

  const dow = new Date().getUTCDay();
  if (dow === 0 || dow === 6) return;  // weekend

  const etMin = _etMinutesNow();
  // Fire window: 09:25–09:29 ET (5 min before open)
  const windowStart = 9 * 60 + 25;  // 565
  const windowEnd   = 9 * 60 + 30;  // 570

  if (etMin < windowStart || etMin >= windowEnd) return;

  // Dedup: only once per calendar day (ET)
  const todayET = _etDateString();
  if (_lastSentDate === todayET) return;
  _lastSentDate = todayET;

  try {
    const signal = await getCurrentSignal();
    const text   = buildPreMarketSnapshotMessage(signal);
    await sendTelegramReal(text);
    console.log(`[pre-market-snapshot] Sent snapshot for ${todayET}`);
  } catch (err) {
    // Reset flag so it can retry next minute if something failed
    _lastSentDate = null;
    console.error('[pre-market-snapshot] Failed to send snapshot:', err.message);
  }
}
