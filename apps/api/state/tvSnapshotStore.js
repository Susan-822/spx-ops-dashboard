import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from 'redis';

const DEFAULT_MODE = 'file';
const DEFAULT_FILE_PATH = '/var/data/tv_snapshot.json';
const DEFAULT_TTL_SECONDS = 21600;
const DEFAULT_STALE_SECONDS = 900;
const REDIS_KEY = 'spx:tv-snapshot:latest';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStoreConfig() {
  return {
    mode: String(process.env.STATE_STORE || DEFAULT_MODE).toLowerCase(),
    redisUrl: process.env.REDIS_URL || '',
    filePath: process.env.TV_SNAPSHOT_FILE || DEFAULT_FILE_PATH,
    ttlSeconds: parsePositiveInt(process.env.TV_SNAPSHOT_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    staleSeconds: parsePositiveInt(process.env.TV_SNAPSHOT_STALE_SECONDS, DEFAULT_STALE_SECONDS)
  };
}

class MemoryTvSnapshotStore {
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

class FileTvSnapshotStore {
  constructor(filePath) {
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

class RedisTvSnapshotStore {
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

async function initializeStore() {
  const config = getStoreConfig();

  if (config.mode === 'redis' && config.redisUrl) {
    try {
      const redisStore = new RedisTvSnapshotStore(config);
      await redisStore.getClient();
      return {
        store: redisStore,
        metadata: {
          ...redisStore.describe(),
          mode: 'redis',
          stale_seconds: config.staleSeconds,
          ttl_seconds: config.ttlSeconds,
          message: 'TradingView snapshot store uses Redis.'
        }
      };
    } catch (error) {
      const fileStore = new FileTvSnapshotStore(config.filePath);
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
    const fileStore = new FileTvSnapshotStore(config.filePath);
    return {
      store: fileStore,
      metadata: {
        ...fileStore.describe(),
        mode: 'file',
        stale_seconds: config.staleSeconds,
        ttl_seconds: config.ttlSeconds,
        message: 'TradingView snapshot store uses file persistence.'
      }
    };
  }

  const memoryStore = new MemoryTvSnapshotStore();
  return {
    store: memoryStore,
    metadata: {
      ...memoryStore.describe(),
      mode: 'memory',
      stale_seconds: config.staleSeconds,
      ttl_seconds: config.ttlSeconds,
      message: 'TradingView snapshot store uses in-memory fallback.'
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

export function getTvSnapshotStoreConfig() {
  return getStoreConfig();
}

export async function readTvSnapshot() {
  const store = await getStore();
  return store.read();
}

export async function writeTvSnapshot(snapshot) {
  const store = await getStore();
  return store.write(snapshot);
}

export async function clearTvSnapshot() {
  const store = await getStore();
  await store.clear();
}

export async function describeTvSnapshotStore() {
  await getStore();
  return storeMetadata;
}

export async function resetTvSnapshotStoreForTests() {
  if (storeSingleton?.close) {
    await storeSingleton.close();
  }
  storeSingleton = null;
  storeMetadata = null;
}
