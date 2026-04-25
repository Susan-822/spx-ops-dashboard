const DEFAULT_WINDOW_SECONDS = 300;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDedupeWindowSeconds() {
  return parsePositiveInt(process.env.TELEGRAM_ALERT_DEDUPE_SECONDS, DEFAULT_WINDOW_SECONDS);
}

const dedupeMap = new Map();

function nowMs() {
  return Date.now();
}

function purgeExpired(windowMs) {
  const current = nowMs();
  for (const [key, expiresAt] of dedupeMap.entries()) {
    if (expiresAt <= current - windowMs) {
      dedupeMap.delete(key);
    }
  }
}

export function getTelegramAlertDedupeKey(parts = []) {
  return parts.map((part) => String(part ?? '')).join('|');
}

export function shouldBypassTelegramDedupe({ event_type, status_changed = false, direction_changed = false }) {
  return (
    event_type === 'structure_invalidated'
    || event_type === 'stale'
    || event_type === 'data_mixed'
    || status_changed
    || direction_changed
  );
}

export function markTelegramAlertSent(key) {
  const windowMs = getDedupeWindowSeconds() * 1000;
  purgeExpired(windowMs);
  dedupeMap.set(key, nowMs());
}

export function isTelegramAlertDuplicate(key) {
  const windowMs = getDedupeWindowSeconds() * 1000;
  purgeExpired(windowMs);
  const sentAt = dedupeMap.get(key);
  if (!sentAt) {
    return false;
  }
  return nowMs() - sentAt < windowMs;
}

export function resetTelegramAlertDedupeStoreForTests() {
  dedupeMap.clear();
}
