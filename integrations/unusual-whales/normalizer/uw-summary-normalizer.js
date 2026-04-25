const { readUwSnapshot } = require("../ingest/uw-snapshot-store");

function determineSourceState(snapshot) {
  if (!snapshot) {
    return {
      source: "unusual_whales_dom",
      state: "unavailable",
      stale: false,
      last_update: null,
      message: "uw snapshot missing",
    };
  }

  if (snapshot.status === "error") {
    return {
      source: "unusual_whales_dom",
      state: "error",
      stale: Boolean(snapshot.stale),
      last_update: snapshot.last_update ?? null,
      message: snapshot.message || "uw snapshot error",
    };
  }

  if (snapshot.stale) {
    return {
      source: "unusual_whales_dom",
      state: "delayed",
      stale: true,
      last_update: snapshot.last_update ?? null,
      message: snapshot.message || "uw snapshot stale",
    };
  }

  return {
    source: "unusual_whales_dom",
    state: "real",
    stale: false,
    last_update: snapshot.last_update ?? null,
    message: snapshot.message || "",
  };
}

function normalizeUwSummary(snapshot) {
  if (!snapshot) {
    return {
      uw: null,
      source_status: determineSourceState(null),
    };
  }

  return {
    uw: {
      dealer: snapshot.dealer || {},
      volatility: snapshot.volatility || {},
      flow: snapshot.flow || {},
      darkpool: snapshot.darkpool || {},
      sentiment: snapshot.sentiment || {},
      quality: snapshot.quality || {},
    },
    source_status: determineSourceState(snapshot),
  };
}

async function loadNormalizedUwSummary(options = {}) {
  const snapshot = await readUwSnapshot(options);
  return normalizeUwSummary(snapshot);
}

module.exports = {
  determineSourceState,
  normalizeUwSummary,
  loadNormalizedUwSummary,
};
