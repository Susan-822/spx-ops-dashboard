import { fetchUwApiSnapshot } from '../providers/uw-api-provider.js';
import { readUwApiSnapshot, writeUwApiSnapshot } from '../storage/uwSnapshotStore.js';
import { getUwSourceStatus, readUwSnapshot } from './uwSnapshotStore.js';

const PROVIDER_MODES = new Set(['api', 'dom', 'manual', 'unavailable']);
const PROVIDER_STATUSES = new Set(['live', 'partial', 'stale', 'unavailable', 'error']);

function normalizeProviderStatus(value) {
  const status = String(value || 'unavailable').toLowerCase();
  return PROVIDER_STATUSES.has(status) ? status : 'unavailable';
}

function ageSeconds(lastUpdate, now = new Date()) {
  if (!lastUpdate) return null;
  const parsed = new Date(lastUpdate);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((new Date(now).getTime() - parsed.getTime()) / 1000));
}

function unavailableProvider(reason = 'UW API key 未配置。') {
  return {
    mode: 'unavailable',
    status: 'unavailable',
    last_update: null,
    age_seconds: null,
    is_mock: false,
    endpoints_ok: [],
    endpoints_failed: [],
    rate_limit: {
      daily_limit: null,
      per_minute_limit: null,
      remaining: null
    },
    plain_chinese: reason
  };
}

export function buildUwProvider(snapshot, sourceStatus, options = {}) {
  const configuredMode = String(process.env.UW_PROVIDER_MODE || '').toLowerCase();
  if (configuredMode === 'api' || snapshot?.provider?.mode === 'api') {
    const provider = snapshot?.provider || {};
    const lastUpdate = snapshot?.last_update || provider.last_update || null;
    const computedAge = ageSeconds(lastUpdate, options.now);
    return {
      mode: 'api',
      status: normalizeProviderStatus(provider.status || (snapshot?.stale ? 'stale' : snapshot?.status)),
      last_update: lastUpdate,
      age_seconds: provider.age_seconds ?? computedAge,
      is_mock: provider.is_mock === true,
      endpoints_ok: Array.isArray(provider.endpoints_ok) ? provider.endpoints_ok : [],
      endpoints_failed: Array.isArray(provider.endpoints_failed) ? provider.endpoints_failed : [],
      endpoint_coverage: provider.endpoint_coverage || snapshot?.endpoint_coverage || {},
      rate_limit: {
        daily_limit: provider.rate_limit?.daily_limit ?? null,
        per_minute_limit: provider.rate_limit?.per_minute_limit ?? null,
        remaining: provider.rate_limit?.remaining ?? null
      },
      plain_chinese: provider.plain_chinese || 'UW API provider 已连接。'
    };
  }

  const mode = PROVIDER_MODES.has(configuredMode) ? configuredMode : snapshot ? 'manual' : 'unavailable';
  const status = normalizeProviderStatus(snapshot?.status || sourceStatus?.state);
  const lastUpdate = snapshot?.last_update || sourceStatus?.last_update || null;
  return {
    ...unavailableProvider(status === 'unavailable' ? 'UW 数据不可用。' : 'UW 手动/DOM 快照可读。'),
    mode: status === 'unavailable' ? 'unavailable' : mode,
    status,
    last_update: lastUpdate,
    age_seconds: ageSeconds(lastUpdate, options.now),
    is_mock: snapshot?.is_mock === true
  };
}

export async function refreshUwProvider(options = {}) {
  const snapshot = await fetchUwApiSnapshot(options);
  await writeUwApiSnapshot(snapshot);
  return snapshot;
}

export async function readUwProvider(options = {}) {
  if (String(process.env.UW_PROVIDER_MODE || '').toLowerCase() === 'api') {
    let apiSnapshot = await readUwApiSnapshot(options);
    if (!apiSnapshot || apiSnapshot.provider?.status === 'stale') {
      const refreshed = await fetchUwApiSnapshot(options);
      if (refreshed?.provider?.status !== 'error' || !apiSnapshot) {
        apiSnapshot = refreshed;
      }
    }
    return {
      snapshot: apiSnapshot,
      sourceStatus: {
        state: apiSnapshot?.provider?.status || 'unavailable',
        stale: apiSnapshot?.provider?.status === 'stale',
        last_update: apiSnapshot?.last_update || null,
        message: apiSnapshot?.provider?.plain_chinese || 'UW API snapshot unavailable'
      },
      provider: buildUwProvider(apiSnapshot, null, options)
    };
  }

  const snapshot = await readUwSnapshot(options);
  const sourceStatus = getUwSourceStatus(snapshot, options);
  return {
    snapshot,
    sourceStatus,
    provider: buildUwProvider(snapshot, sourceStatus, options)
  };
}

export { readUwApiSnapshot, writeUwApiSnapshot };
export { getUwProviderMetadata } from '../providers/uw-api-provider.js';
