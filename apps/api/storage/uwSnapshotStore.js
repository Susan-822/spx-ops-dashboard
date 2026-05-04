/**
 * storage/uwSnapshotStore.js
 *
 * UW API snapshot persistence layer.
 *
 * Priority order (auto-detected, no extra env vars needed):
 *   1. Redis  — when REDIS_URL is set (or UW_STATE_STORE=redis)
 *   2. File   — when UW_STATE_STORE=file (Render Disk)
 *   3. Memory — fallback (default)
 *
 * Redis key: spx:uw-api-snapshot:latest
 * TTL:       8 hours (covers one full trading session gap)
 *
 * On startup, the server calls restoreUwApiSnapshotFromRedis() to
 * pre-populate the in-memory cache from Redis before the first poll.
 * This means the dashboard shows last-known data immediately after
 * a server restart instead of waiting 60 s for the next refresh.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from 'redis';

const DEFAULT_FILE_PATH = '/var/data/uw_api_snapshot.json';
const DEFAULT_STALE_SECONDS = 300;
const REDIS_KEY = 'spx:uw-api-snapshot:latest';
const REDIS_TTL_SECONDS = 8 * 3600; // 8 hours

// In-memory cache (always maintained for fast reads)
let memorySnapshot = null;

// Redis client singleton
let _redisClient = null;
let _redisConnecting = false;
let _redisReady = false;
let _redisError = null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStoreConfig() {
  const explicitMode = String(process.env.UW_API_STATE_STORE || process.env.UW_STATE_STORE || '').toLowerCase();
  const redisUrl = process.env.REDIS_URL || process.env.UW_REDIS_URL || '';
  // Auto-activate Redis when REDIS_URL is present (unless explicitly overridden to file/memory)
  const mode = explicitMode === 'file' || explicitMode === 'memory'
    ? explicitMode
    : (redisUrl ? 'redis' : (explicitMode || 'memory'));
  return {
    mode,
    redisUrl,
    filePath: process.env.UW_API_SNAPSHOT_FILE || process.env.UW_SNAPSHOT_FILE || DEFAULT_FILE_PATH,
    staleSeconds: parsePositiveInt(process.env.UW_STALE_SECONDS, DEFAULT_STALE_SECONDS)
  };
}

function withFreshness(snapshot, options = {}) {
  if (!snapshot) return null;
  const staleSeconds = Number(options.staleSeconds ?? getStoreConfig().staleSeconds);
  const now = new Date(options.now || Date.now()).getTime();
  const lastUpdate = snapshot.last_update ? new Date(snapshot.last_update).getTime() : NaN;
  const stale = Number.isNaN(lastUpdate) || now - lastUpdate > staleSeconds * 1000;
  return {
    ...snapshot,
    stale,
    provider: {
      ...(snapshot.provider || {}),
      status: stale && snapshot.provider?.status === 'live' ? 'stale' : snapshot.provider?.status || 'unavailable'
    }
  };
}

// Redis client management
async function getRedisClient() {
  if (_redisReady && _redisClient?.isOpen) return _redisClient;
  if (_redisConnecting) {
    // Wait up to 3 s for connection
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (_redisReady && _redisClient?.isOpen) return _redisClient;
      if (_redisError) return null;
    }
    return null;
  }

  const config = getStoreConfig();
  if (!config.redisUrl) return null;

  _redisConnecting = true;
  _redisError = null;
  try {
    const client = createClient({ url: config.redisUrl });
    client.on('error', (err) => {
      if (!_redisReady) {
        _redisError = err;
        _redisConnecting = false;
      }
    });
    await client.connect();
    _redisClient = client;
    _redisReady = true;
    _redisConnecting = false;
    console.log('[uwSnapshotStore] Redis connected:', config.redisUrl.replace(/\/\/[^@]*@/, '//:***@'));
    return client;
  } catch (err) {
    _redisError = err;
    _redisConnecting = false;
    _redisReady = false;
    console.warn('[uwSnapshotStore] Redis connection failed, falling back to memory:', err.message);
    return null;
  }
}

async function redisRead() {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    const raw = await client.get(REDIS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[uwSnapshotStore] Redis read error:', err.message);
    return null;
  }
}

async function redisWrite(snapshot) {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    await client.set(REDIS_KEY, JSON.stringify(snapshot), { EX: REDIS_TTL_SECONDS });
    return true;
  } catch (err) {
    console.warn('[uwSnapshotStore] Redis write error:', err.message);
    return false;
  }
}

/**
 * Read the current UW API snapshot.
 * Always returns from in-memory cache (fast path).
 * If memory is empty, tries Redis (cold start recovery).
 */
export async function readUwApiSnapshot(options = {}) {
  const config = getStoreConfig();

  if (config.mode === 'redis') {
    if (memorySnapshot) {
      return withFreshness(memorySnapshot, options);
    }
    // Cold start: try Redis
    const redisSnap = await redisRead();
    if (redisSnap) {
      memorySnapshot = redisSnap;
      console.log('[uwSnapshotStore] Cold-start restore from Redis OK');
    }
    return withFreshness(memorySnapshot, options);
  }

  if (config.mode === 'file') {
    try {
      const raw = await fs.readFile(config.filePath, 'utf8');
      return withFreshness(JSON.parse(raw), options);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  return withFreshness(memorySnapshot, options);
}

/**
 * Write a new UW API snapshot.
 * Always updates in-memory cache.
 * Also persists to Redis (async, fire-and-forget) or file.
 */
export async function writeUwApiSnapshot(snapshot) {
  const config = getStoreConfig();
  const safeSnapshot = structuredClone(snapshot);
  memorySnapshot = safeSnapshot;

  if (config.mode === 'redis') {
    // Persist to Redis asynchronously — don't block the response
    redisWrite(safeSnapshot).catch(() => {});
    return safeSnapshot;
  }

  if (config.mode === 'file') {
    await fs.mkdir(path.dirname(config.filePath), { recursive: true });
    await fs.writeFile(config.filePath, JSON.stringify(safeSnapshot, null, 2), 'utf8');
  }

  return safeSnapshot;
}

/**
 * Clear the snapshot from all storage layers.
 */
export async function clearUwApiSnapshot() {
  const config = getStoreConfig();
  memorySnapshot = null;

  if (config.mode === 'redis') {
    try {
      const client = await getRedisClient();
      if (client) await client.del(REDIS_KEY);
    } catch {}
    return;
  }

  if (config.mode === 'file') {
    try {
      await fs.rm(config.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

/**
 * On server startup: pre-populate in-memory cache from Redis.
 * Call this once before startLiveRefreshScheduler().
 * Safe to call even if Redis is unavailable — silently falls back.
 */
export async function restoreUwApiSnapshotFromRedis() {
  const config = getStoreConfig();
  if (config.mode !== 'redis') return null;
  if (memorySnapshot) return memorySnapshot;

  try {
    const snap = await redisRead();
    if (snap) {
      memorySnapshot = snap;
      const age = snap.last_update
        ? Math.round((Date.now() - new Date(snap.last_update).getTime()) / 1000)
        : null;
      console.log(
        `[uwSnapshotStore] Restored from Redis: last_update=${snap.last_update}, ` +
        `age=${age != null ? age + 's' : 'unknown'}`
      );
      return snap;
    }
    console.log('[uwSnapshotStore] Redis restore: no snapshot found (first start or TTL expired)');
    return null;
  } catch (err) {
    console.warn('[uwSnapshotStore] Redis restore failed:', err.message);
    return null;
  }
}

/**
 * Describe the current store configuration (for /health or diagnostics).
 */
export function getUwApiSnapshotStoreConfig() {
  const config = getStoreConfig();
  return {
    ...config,
    redis_key: config.mode === 'redis' ? REDIS_KEY : null,
    redis_ttl_seconds: config.mode === 'redis' ? REDIS_TTL_SECONDS : null,
    redis_ready: _redisReady,
    memory_loaded: memorySnapshot != null
  };
}
