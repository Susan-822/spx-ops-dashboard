import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from 'redis';

const DEFAULT_MODE = 'memory';
const DEFAULT_FILE_PATH = '/var/data/theta_snapshot.json';
const DEFAULT_TTL_SECONDS = 21600;
const DEFAULT_STALE_SECONDS = 300;
const REDIS_KEY = 'spx:theta-snapshot:latest';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStoreConfig() {
  return {
    mode: String(process.env.THETA_STATE_STORE || process.env.STATE_STORE || DEFAULT_MODE).toLowerCase(),
    redisUrl: process.env.THETA_REDIS_URL || process.env.REDIS_URL || '',
    filePath: process.env.THETA_SNAPSHOT_FILE || DEFAULT_FILE_PATH,
    ttlSeconds: parsePositiveInt(process.env.THETA_SNAPSHOT_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    staleSeconds: parsePositiveInt(process.env.THETA_SNAPSHOT_STALE_SECONDS, DEFAULT_STALE_SECONDS)
  };
}

function assertValidFilePath(filePath) {
  if (String(filePath).startsWith('/tmp/')) {
    throw new Error('THETA_SNAPSHOT_FILE cannot use /tmp for formal file mode.');
  }
}

class MemoryThetaSnapshotStore {
  constructor() {
    this.snapshot = null;
  }

  async read() {
    return this.snapshot;
  }

  async write(snapshot) {
    this.snapshot = snapshot;
    return snapshot;
  }

  async clear() {
    this.snapshot = null;
  }

  async close() {}

  describe() {
    return {
      backend: 'memory',
      persisted: false,
      key: null,
      file_path: null
    };
  }
}

class FileThetaSnapshotStore {
  constructor(filePath) {
    assertValidFilePath(filePath);
    this.filePath = filePath;
  }

  async ensureParentDirectory() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write(snapshot) {
    await this.ensureParentDirectory();
    await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  async clear() {
    try {
      await fs.rm(this.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async close() {}

  describe() {
    return {
      backend: 'file',
      persisted: true,
      key: null,
      file_path: this.filePath
    };
  }
}

class RedisThetaSnapshotStore {
  constructor({ redisUrl, ttlSeconds }) {
    this.redisUrl = redisUrl;
    this.ttlSeconds = ttlSeconds;
    this.client = null;
    this.connectPromise = null;
  }

  async getClient() {
    if (this.client?.isOpen) {
      return this.client;
    }

    if (!this.connectPromise) {
      this.client = createClient({ url: this.redisUrl });
      this.client.on('error', () => {});
      this.connectPromise = this.client.connect();
    }

    await this.connectPromise;
    return this.client;
  }

  async read() {
    const client = await this.getClient();
    const payload = await client.get(REDIS_KEY);
    return payload ? JSON.parse(payload) : null;
  }

  async write(snapshot) {
    const client = await this.getClient();
    await client.set(REDIS_KEY, JSON.stringify(snapshot), { EX: this.ttlSeconds });
    return snapshot;
  }

  async clear() {
    const client = await this.getClient();
    await client.del(REDIS_KEY);
  }

  async close() {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
    this.client = null;
    this.connectPromise = null;
  }

  describe() {
    return {
      backend: 'redis',
      persisted: true,
      key: REDIS_KEY,
      file_path: null
    };
  }
}

let storeSingleton = null;
let storeMetadata = null;

function annotateSnapshot(snapshot, staleSeconds) {
  if (!snapshot) {
    return null;
  }

  const lastUpdate = snapshot.last_update || snapshot.last_updated || null;
  const ageMs = lastUpdate ? Math.max(0, Date.now() - new Date(lastUpdate).getTime()) : null;
  const stale = ageMs != null ? ageMs > staleSeconds * 1000 : true;
  const nextStatus =
    (snapshot.status === 'live' || snapshot.status === 'partial') && stale
      ? 'stale'
      : snapshot.status || 'unavailable';

  return {
    ...snapshot,
    status: nextStatus,
    stale,
    stale_seconds: staleSeconds,
    age_ms: ageMs
  };
}

async function initializeStore() {
  const config = getStoreConfig();

  if (config.mode === 'redis' && config.redisUrl) {
    try {
      const redisStore = new RedisThetaSnapshotStore(config);
      await redisStore.getClient();
      return {
        store: redisStore,
        metadata: {
          ...redisStore.describe(),
          mode: 'redis',
          stale_seconds: config.staleSeconds,
          ttl_seconds: config.ttlSeconds,
          message: 'Theta snapshot store uses Redis.'
        }
      };
    } catch (error) {
      const fileStore = new FileThetaSnapshotStore(config.filePath);
      return {
        store: fileStore,
        metadata: {
          ...fileStore.describe(),
          mode: 'file',
          stale_seconds: config.staleSeconds,
          ttl_seconds: config.ttlSeconds,
          message: `Redis unavailable (${error.message}); fell back to file store.`
        }
      };
    }
  }

  if (config.mode === 'file') {
    const fileStore = new FileThetaSnapshotStore(config.filePath);
    return {
      store: fileStore,
      metadata: {
        ...fileStore.describe(),
        mode: 'file',
        stale_seconds: config.staleSeconds,
        ttl_seconds: config.ttlSeconds,
        message: 'Theta snapshot store uses file persistence.'
      }
    };
  }

  const memoryStore = new MemoryThetaSnapshotStore();
  return {
    store: memoryStore,
    metadata: {
      ...memoryStore.describe(),
      mode: 'memory',
      stale_seconds: config.staleSeconds,
      ttl_seconds: config.ttlSeconds,
      message: 'Theta snapshot store uses in-memory fallback.'
    }
  };
}

async function getStore() {
  if (!storeSingleton) {
    const initialized = await initializeStore();
    storeSingleton = initialized.store;
    storeMetadata = initialized.metadata;
  }
  return storeSingleton;
}

export function getThetaSnapshotStoreConfig() {
  return getStoreConfig();
}

export async function readThetaSnapshot() {
  const store = await getStore();
  const snapshot = await store.read();
  return annotateSnapshot(snapshot, getStoreConfig().staleSeconds);
}

export async function writeThetaSnapshot(snapshot) {
  const store = await getStore();
  const payload = {
    ...snapshot,
    last_update: snapshot?.last_update || new Date().toISOString()
  };
  await store.write(payload);
  return annotateSnapshot(payload, getStoreConfig().staleSeconds);
}

export async function clearThetaSnapshot() {
  const store = await getStore();
  await store.clear();
}

export async function describeThetaSnapshotStore() {
  await getStore();
  return storeMetadata;
}

export async function resetThetaSnapshotStoreForTests() {
  if (storeSingleton?.close) {
    await storeSingleton.close();
  }
  storeSingleton = null;
  storeMetadata = null;
}
