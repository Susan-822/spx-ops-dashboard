import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeNow(now) {
  return now instanceof Date ? now : new Date(now || Date.now());
}

function normalizeQuality(snapshot, stale) {
  const raw = snapshot?.quality || {};
  const dataQuality = String(raw.data_quality || snapshot?.status || 'unavailable').toLowerCase();

  return {
    data_quality: stale
      ? 'stale'
      : ['live', 'partial', 'stale', 'unavailable', 'error'].includes(dataQuality)
        ? dataQuality
        : 'unavailable',
    missing_fields: Array.isArray(raw.missing_fields) ? raw.missing_fields : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : []
  };
}

export function markStale(snapshot, options = {}) {
  const staleSeconds = Number(options.staleSeconds ?? 300);
  const now = normalizeNow(options.now);
  const lastUpdate = snapshot?.last_update ? new Date(snapshot.last_update) : null;
  const stale = !lastUpdate
    || Number.isNaN(lastUpdate.getTime())
    || now.getTime() - lastUpdate.getTime() > staleSeconds * 1000;

  return {
    ...snapshot,
    quality: normalizeQuality(snapshot, stale),
    stale,
    __stale: stale
  };
}

export function createMemoryUwSnapshotStore(options = {}) {
  let snapshot = null;

  return {
    type: 'memory',
    async set(nextSnapshot) {
      snapshot = structuredClone(nextSnapshot);
      return snapshot;
    },
    async get(getOptions = {}) {
      if (!snapshot) {
        return null;
      }

      return markStale(snapshot, {
        staleSeconds: options.staleSeconds,
        now: getOptions.now
      });
    }
  };
}

export function createFileUwSnapshotStore(options = {}) {
  const filePath = options.filePath;
  if (!filePath) {
    throw new Error('filePath is required for file snapshot store');
  }

  return {
    type: 'file',
    async set(snapshot) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      return snapshot;
    },
    async get(getOptions = {}) {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return markStale(parsed, {
          staleSeconds: options.staleSeconds,
          now: getOptions.now
        });
      } catch (error) {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    }
  };
}

export function createRedisUwSnapshotStore(options = {}) {
  const redis = options.redis ?? options.redisClient;
  const key = options.key || 'spx:uw-snapshot:latest';
  const ttlSeconds = Number(options.ttlSeconds ?? 21600);

  return {
    type: 'redis',
    async set(snapshot) {
      if (!redis || typeof redis.set !== 'function') {
        throw new Error('redis client with get/set is required for redis snapshot store');
      }
      await redis.set(key, JSON.stringify(snapshot), { EX: ttlSeconds });
      return snapshot;
    },
    async get(getOptions = {}) {
      if (!redis || typeof redis.get !== 'function') {
        throw new Error('redis client with get/set is required for redis snapshot store');
      }
      const raw = await redis.get(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return markStale(parsed, {
        staleSeconds: options.staleSeconds,
        now: getOptions.now
      });
    }
  };
}

export function createUwSnapshotStore(options = {}) {
  const backend = String(options.backend || 'memory').toLowerCase();

  if (backend === 'memory') {
    return createMemoryUwSnapshotStore(options);
  }
  if (backend === 'file') {
    return createFileUwSnapshotStore(options);
  }
  if (backend === 'redis') {
    return createRedisUwSnapshotStore(options);
  }

  throw new Error(`unsupported UW snapshot backend: ${backend}`);
}

export function getUwSourceStatus(snapshot, options = {}) {
  const staleSeconds = Number(options.staleSeconds ?? 300);
  const now = normalizeNow(options.now);

  if (!snapshot) {
    return {
      source: 'unusual_whales',
      state: 'unavailable',
      stale: false,
      last_update: null,
      message: 'UW snapshot unavailable'
    };
  }

  const marked = markStale(snapshot, { staleSeconds, now });
  const status = String(marked.status || '').toLowerCase();

  return {
    source: 'unusual_whales',
    state:
      status === 'error'
        ? 'error'
        : status === 'partial' || marked.__stale
          ? 'delayed'
          : status === 'unavailable'
            ? 'unavailable'
            : 'real',
    stale: Boolean(marked.__stale),
    last_update: marked.last_update ?? null,
    message:
      status === 'error'
        ? 'UW snapshot error'
        : marked.__stale
          ? 'UW snapshot stale'
          : status === 'partial'
            ? 'UW snapshot partial'
            : ''
  };
}
