"use strict";

const fs = require("node:fs");
const path = require("node:path");

function normalizeNow(now) {
  return now instanceof Date ? now : new Date(now || Date.now());
}

function markStale(snapshot, options = {}) {
  const staleSeconds = Number(options.staleSeconds ?? 300);
  const now = normalizeNow(options.now);
  const lastUpdate = snapshot?.last_update ? new Date(snapshot.last_update) : null;
  const stale =
    !lastUpdate ||
    Number.isNaN(lastUpdate.getTime()) ||
    now.getTime() - lastUpdate.getTime() > staleSeconds * 1000;

  return {
    ...snapshot,
    quality: {
      ...(snapshot?.quality || {}),
      data_quality: stale ? "stale" : snapshot?.quality?.data_quality || "live",
      missing_fields: snapshot?.quality?.missing_fields || [],
    },
    __stale: stale,
  };
}

function createMemoryUwSnapshotStore(options = {}) {
  let snapshot = null;

  return {
    type: "memory",
    async set(nextSnapshot) {
      snapshot = { ...nextSnapshot };
      return snapshot;
    },
    async get(getOptions = {}) {
      if (!snapshot) {
        return null;
      }
      return markStale(snapshot, {
        staleSeconds: options.staleSeconds,
        now: getOptions.now,
      });
    },
  };
}

function createFileUwSnapshotStore(options = {}) {
  const filePath = options.filePath;
  if (!filePath) {
    throw new Error("filePath is required for file snapshot store");
  }

  return {
    type: "file",
    async set(snapshot) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
      return snapshot;
    },
    async get(getOptions = {}) {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return markStale(parsed, {
        staleSeconds: options.staleSeconds,
        now: getOptions.now,
      });
    },
  };
}

function createRedisUwSnapshotStore(options = {}) {
  const redis = options.redis ?? options.redisClient;
  const key = options.key || "uw:summary";

  return {
    type: "redis",
    async set(snapshot) {
      if (!redis || typeof redis.set !== "function") {
        throw new Error("redis client with get/set is required for redis snapshot store");
      }
      await redis.set(key, JSON.stringify(snapshot));
      return snapshot;
    },
    async get(getOptions = {}) {
      if (!redis || typeof redis.get !== "function") {
        throw new Error("redis client with get/set is required for redis snapshot store");
      }
      const raw = await redis.get(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return markStale(parsed, {
        staleSeconds: options.staleSeconds,
        now: getOptions.now,
      });
    },
  };
}

function createUwSnapshotStore(options = {}) {
  const backend = options.backend || "memory";

  if (backend === "memory") {
    return createMemoryUwSnapshotStore(options);
  }
  if (backend === "file") {
    return createFileUwSnapshotStore(options);
  }
  if (backend === "redis") {
    return createRedisUwSnapshotStore(options);
  }

  throw new Error(`unsupported UW snapshot backend: ${backend}`);
}

module.exports = {
  createUwSnapshotStore,
  createMemoryUwSnapshotStore,
  createFileUwSnapshotStore,
  createRedisUwSnapshotStore,
  markStale,
  getUwSourceStatus(snapshot, options = {}) {
    const staleSeconds = Number(options.staleSeconds ?? 300);
    const now = normalizeNow(options.now);
    if (!snapshot) {
      return {
        source: "unusual_whales_dom",
        state: "unavailable",
        stale: false,
        last_update: null,
        message: "UW snapshot unavailable",
      };
    }

    const marked = markStale(snapshot, { staleSeconds, now });
    return {
      source: marked.source ?? "unusual_whales_dom",
      state:
        marked.status === "error"
          ? "error"
          : marked.status === "partial" || marked.__stale
            ? "delayed"
            : "real",
      stale: Boolean(marked.__stale),
      last_update: marked.last_update ?? null,
      message: marked.__stale ? "UW snapshot stale" : "",
    };
  },
};
