import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_FILE_PATH = '/var/data/uw_api_snapshot.json';
const DEFAULT_STALE_SECONDS = 300;

let memorySnapshot = null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStoreConfig() {
  return {
    mode: String(process.env.UW_API_STATE_STORE || process.env.UW_STATE_STORE || 'memory').toLowerCase(),
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

export async function readUwApiSnapshot(options = {}) {
  const config = getStoreConfig();
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

export async function writeUwApiSnapshot(snapshot) {
  const config = getStoreConfig();
  const safeSnapshot = structuredClone(snapshot);
  memorySnapshot = safeSnapshot;
  if (config.mode === 'file') {
    await fs.mkdir(path.dirname(config.filePath), { recursive: true });
    await fs.writeFile(config.filePath, JSON.stringify(safeSnapshot, null, 2), 'utf8');
  }
  return safeSnapshot;
}

export async function clearUwApiSnapshot() {
  const config = getStoreConfig();
  memorySnapshot = null;
  if (config.mode === 'file') {
    try {
      await fs.rm(config.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function getUwApiSnapshotStoreConfig() {
  return getStoreConfig();
}
