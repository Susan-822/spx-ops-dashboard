import { getUwSourceStatus, readUwSnapshot } from './uwSnapshotStore.js';

const PROVIDER_MODES = new Set(['dom', 'api', 'manual', 'unavailable']);
const PROVIDER_STATUSES = new Set(['live', 'partial', 'stale', 'unavailable', 'error']);

function normalizeMode(value, snapshot) {
  const requested = String(value || '').toLowerCase();
  if (PROVIDER_MODES.has(requested)) {
    return requested;
  }

  if (!snapshot) {
    return 'unavailable';
  }

  const source = String(snapshot.source || '').toLowerCase();
  if (source.includes('dom')) return 'dom';
  if (source.includes('api')) return 'api';
  if (source.includes('manual')) return 'manual';
  return 'manual';
}

function normalizeStatus(value) {
  const requested = String(value || '').toLowerCase();
  return PROVIDER_STATUSES.has(requested) ? requested : 'unavailable';
}

function ageSeconds(lastUpdate, now = new Date()) {
  if (!lastUpdate) {
    return null;
  }
  const parsed = new Date(lastUpdate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.max(0, Math.floor((new Date(now).getTime() - parsed.getTime()) / 1000));
}

export function buildUwProvider(snapshot, sourceStatus, options = {}) {
  const status = sourceStatus?.stale === true
    ? 'stale'
    : normalizeStatus(snapshot?.status || sourceStatus?.state);
  const lastUpdate = snapshot?.last_update || sourceStatus?.last_update || null;
  const mode = status === 'unavailable' || status === 'error'
    ? 'unavailable'
    : normalizeMode(snapshot?.provider_mode || snapshot?.provider?.mode || snapshot?.mode, snapshot);

  return {
    mode,
    status,
    last_update: lastUpdate,
    age_seconds: ageSeconds(lastUpdate, options.now),
    is_mock: snapshot?.is_mock === true
  };
}

export async function readUwProvider(options = {}) {
  const snapshot = await readUwSnapshot(options);
  const sourceStatus = getUwSourceStatus(snapshot, options);
  return {
    snapshot,
    sourceStatus,
    provider: buildUwProvider(snapshot, sourceStatus, options)
  };
}
