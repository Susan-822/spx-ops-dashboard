import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from 'redis';
import {
  createUwSnapshotStore,
  getUwSourceStatus as getPackageUwSourceStatus
} from '../../../integrations/unusual-whales/ingest/uw-snapshot-store.js';

const DEFAULT_MODE = 'memory';
const DEFAULT_FILE_PATH = '/var/data/uw_snapshot.json';
const DEFAULT_TTL_SECONDS = 21600;
const DEFAULT_STALE_SECONDS = 300;
const REDIS_KEY = 'spx:uw-snapshot:latest';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStoreConfig() {
  return {
    mode: String(process.env.UW_STATE_STORE || DEFAULT_MODE).toLowerCase(),
    redisUrl: process.env.UW_REDIS_URL || process.env.REDIS_URL || '',
    filePath: process.env.UW_SNAPSHOT_FILE || DEFAULT_FILE_PATH,
    ttlSeconds: parsePositiveInt(process.env.UW_SNAPSHOT_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    staleSeconds: parsePositiveInt(process.env.UW_SNAPSHOT_STALE_SECONDS, DEFAULT_STALE_SECONDS)
  };
}

class MemoryStoreWrapper {
  constructor(config) {
    this.inner = createUwSnapshotStore({
      backend: 'memory',
      staleSeconds: config.staleSeconds,
      ttlSeconds: config.ttlSeconds
    });
  }

  async read(now) {
    return this.inner.get({ now });
  }

  async write(snapshot) {
    return this.inner.set(snapshot);
  }

  async clear() {
    this.inner = createUwSnapshotStore({ backend: 'memory' });
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

class FileStoreWrapper {
  constructor(config) {
    this.filePath = config.filePath;
    this.inner = createUwSnapshotStore({
      backend: 'file',
      filePath: this.filePath,
      staleSeconds: config.staleSeconds,
      ttlSeconds: config.ttlSeconds
    });
  }

  async read(now) {
    return this.inner.get({ now });
  }

  async write(snapshot) {
    return this.inner.set(snapshot);
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

class RedisStoreWrapper {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connectPromise = null;
    this.inner = null;
  }

  async getClient() {
    if (this.client?.isOpen) {
      return this.client;
    }

    if (!this.connectPromise) {
      this.client = createClient({ url: this.config.redisUrl });
      this.client.on('error', () => {});
      this.connectPromise = this.client.connect();
    }

    await this.connectPromise;
    if (!this.inner) {
      this.inner = createUwSnapshotStore({
        backend: 'redis',
        redis: this.client,
        key: REDIS_KEY,
        staleSeconds: this.config.staleSeconds,
        ttlSeconds: this.config.ttlSeconds
      });
    }
    return this.client;
  }

  async read(now) {
    await this.getClient();
    return this.inner.get({ now });
  }

  async write(snapshot) {
    await this.getClient();
    return this.inner.set(snapshot);
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
    this.inner = null;
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
      const store = new RedisStoreWrapper(config);
      await store.getClient();
      return {
        store,
        metadata: {
          ...store.describe(),
          mode: 'redis',
          stale_seconds: config.staleSeconds,
          ttl_seconds: config.ttlSeconds,
          message: 'UW snapshot store uses Redis.'
        }
      };
    } catch (error) {
      const fallback = new FileStoreWrapper(config);
      return {
        store: fallback,
        metadata: {
          ...fallback.describe(),
          mode: 'file',
          stale_seconds: config.staleSeconds,
          ttl_seconds: config.ttlSeconds,
          message: `UW Redis unavailable (${error.message}); fell back to file store.`
        }
      };
    }
  }

  if (config.mode === 'file') {
    const store = new FileStoreWrapper(config);
    return {
      store,
      metadata: {
        ...store.describe(),
        mode: 'file',
        stale_seconds: config.staleSeconds,
        ttl_seconds: config.ttlSeconds,
        message: 'UW snapshot store uses file persistence.'
      }
    };
  }

  const store = new MemoryStoreWrapper(config);
  return {
    store,
    metadata: {
      ...store.describe(),
      mode: 'memory',
      stale_seconds: config.staleSeconds,
      ttl_seconds: config.ttlSeconds,
      message: 'UW snapshot store uses in-memory fallback.'
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

export function getUwSnapshotStoreConfig() {
  return getStoreConfig();
}

export async function readUwSnapshot(options = {}) {
  const store = await getStore();
  return store.read(options.now);
}

export async function writeUwSnapshot(snapshot) {
  const store = await getStore();
  return store.write(snapshot);
}

export async function clearUwSnapshot() {
  const store = await getStore();
  await store.clear();
}

export async function describeUwSnapshotStore() {
  await getStore();
  return storeMetadata;
}

export async function resetUwSnapshotStoreForTests() {
  if (storeSingleton?.close) {
    await storeSingleton.close();
  }
  storeSingleton = null;
  storeMetadata = null;
}

export function getUwSourceStatus(snapshot, options = {}) {
  return getPackageUwSourceStatus(snapshot, {
    staleSeconds: options.staleSeconds ?? getStoreConfig().staleSeconds,
    now: options.now
  });
}
