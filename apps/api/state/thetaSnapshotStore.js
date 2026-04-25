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
    mode: String(process.env.THETA_STATE_STORE || DEFAULT_MODE).toLowerCase(),
    redisUrl: process.env.THETA_REDIS_URL || process.env.REDIS_URL || '',
    filePath: process.env.THETA_SNAPSHOT_FILE || DEFAULT_FILE_PATH,
    ttlSeconds: parsePositiveInt(process.env.THETA_SNAPSHOT_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    staleSeconds: parsePositiveInt(process.env.THETA_SNAPSHOT_STALE_SECONDS, DEFAULT_STALE_SECONDS)
  };
}

function normalizeNow(now) {
  return now instanceof Date ? now : new Date(now || Date.now());
}

function markStale(snapshot, staleSeconds, now) {
  if (!snapshot) {
    return null;
  }
  const lastUpdate = snapshot.last_update ? new Date(snapshot.last_update) : null;
  const stale = !lastUpdate
    || Number.isNaN(lastUpdate.getTime())
    || normalizeNow(now).getTime() - lastUpdate.getTime() > staleSeconds * 1000;
  return {
    ...snapshot,
    stale
  };
}

class MemoryThetaSnapshotStore {
  constructor(config) {
    this.config = config;
    this.snapshot = null;
  }

  async read(now) {
    return markStale(this.snapshot, this.config.staleSeconds, now);
  }

  async write(snapshot) {
    this.snapshot = structuredClone(snapshot);
    return this.snapshot;
  }

  async clear() {
    this.snapshot = null;
  }

  async close() {}
}

class FileThetaSnapshotStore {
  constructor(config) {
    this.config = config;
    this.filePath = config.filePath;
  }

  async read(now) {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return markStale(JSON.parse(raw), this.config.staleSeconds, now);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write(snapshot) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
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
}

class RedisThetaSnapshotStore {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connectPromise = null;
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
    return this.client;
  }

  async read(now) {
    const client = await this.getClient();
    const raw = await client.get(REDIS_KEY);
    return raw ? markStale(JSON.parse(raw), this.config.staleSeconds, now) : null;
  }

  async write(snapshot) {
    const client = await this.getClient();
    await client.set(REDIS_KEY, JSON.stringify(snapshot), { EX: this.config.ttlSeconds });
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
}

let storeSingleton = null;

async function getStore() {
  if (storeSingleton) {
    return storeSingleton;
  }
  const config = getStoreConfig();
  if (config.mode === 'redis' && config.redisUrl) {
    storeSingleton = new RedisThetaSnapshotStore(config);
    return storeSingleton;
  }
  if (config.mode === 'file') {
    storeSingleton = new FileThetaSnapshotStore(config);
    return storeSingleton;
  }
  storeSingleton = new MemoryThetaSnapshotStore(config);
  return storeSingleton;
}

export async function readThetaSnapshot(options = {}) {
  const store = await getStore();
  return store.read(options.now);
}

export async function writeThetaSnapshot(snapshot) {
  const store = await getStore();
  return store.write(snapshot);
}

export async function clearThetaSnapshot() {
  const store = await getStore();
  await store.clear();
}

export async function resetThetaSnapshotStoreForTests() {
  if (storeSingleton?.close) {
    await storeSingleton.close();
  }
  storeSingleton = null;
}
