const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  summarizeGreekExposure,
} = require("../reader/greek-exposure-poc");
const {
  summarizeVolatilityPages,
} = require("../reader/volatility-poc");
const {
  validateUwSummaryPayload,
  rejectRawArtifacts,
  ingestUwSummary,
} = require("../ingest/uw-ingest");
const {
  createUwSnapshotStore,
  getUwSourceStatus,
} = require("../ingest/uw-snapshot-store");
const {
  mergeUwIntoSignalsCurrent,
} = require("../signals/merge-uw-into-signals-current");

function makeSummary(overrides = {}) {
  return {
    source: "unusual_whales_dom",
    status: "live",
    last_update: "2026-04-25T02:30:00.000Z",
    dealer: {
      ticker: "SPX",
      net_gamma: 1200,
      net_delta: 15,
      net_vanna: 4,
      net_charm: -2,
      gamma_regime: "positive",
      dealer_behavior: "pin",
      zero_gamma_or_flip: 5400,
      top_call_gamma_strikes: [5450],
      top_put_gamma_strikes: [5350],
    },
    volatility: {
      iv_rank: 25,
      implied_volatility: 0.18,
      realized_volatility: 0.14,
      implied_move: 33,
      term_structure_state: "normal",
      volatility_activation_light: "green",
      volatility_activation_score: 78,
    },
    flow: {
      status: "not_implemented",
      flow_bias: "unknown",
      flow_speed: "unknown",
      flow_thrust: "unknown",
    },
    darkpool: {
      status: "not_implemented",
      ticker: "SPY",
      nearest_support: null,
      nearest_resistance: null,
      darkpool_bias: "unknown",
    },
    sentiment: {
      status: "not_implemented",
      state: "unknown",
    },
    quality: {
      uw_signal: "neutral",
      conflict_reason: null,
      data_quality: "live",
      missing_fields: [],
    },
    ...overrides,
  };
}

test("reader output examples do not contain raw HTML, cookie, or token", () => {
  const files = [
    path.join(__dirname, "..", "reader", "output", "uw_greek_exposure_dom_poc.json"),
    path.join(__dirname, "..", "reader", "output", "uw_volatility_dom_poc.json"),
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("<html"), false);
    assert.equal(/cookie/i.test(content), false);
    assert.equal(/token/i.test(content), false);
  }
});

test("greek POC uses null for missing fields and does not invent dealer values", () => {
  const result = summarizeGreekExposure({
    pageUrl: "https://unusualwhales.com/stock/SPX/greek-exposure",
    rawVisibleFields: {},
  });

  assert.equal(result.status, "not_found");
  assert.equal(result.mapped_fields.call_gamma, null);
  assert.equal(result.mapped_fields.put_gamma, null);
  assert.equal(result.derived.net_gamma, null);
  assert.equal(result.derived.dealer_behavior, "unknown");
});

test("volatility POC marks unavailable quality when fields are missing", () => {
  const result = summarizeVolatilityPages([]);
  assert.equal(result.status, "not_found");
  assert.equal(result.volatility_activation_candidate.data_quality, "unavailable");
});

test("uw summary validator accepts curated summary payload", () => {
  const validation = validateUwSummaryPayload(makeSummary());
  assert.equal(validation.ok, true);
});

test("ingest rejects missing secret", async () => {
  const store = createUwSnapshotStore({ backend: "memory" });
  await assert.rejects(
    () =>
      ingestUwSummary({
        secret: "",
        expectedSecret: "abc",
        payload: makeSummary(),
        store,
      }),
    /Invalid UW_INGEST_SECRET/,
  );
});

test("ingest rejects raw html payload", async () => {
  const store = createUwSnapshotStore({ backend: "memory" });
  await assert.rejects(
    () =>
      ingestUwSummary({
        secret: "abc",
        expectedSecret: "abc",
        payload: { html: "<html>forbidden</html>" },
        store,
      }),
    /raw HTML/,
  );
});

test("ingest rejects cookie-bearing payload", () => {
  assert.throws(() => rejectRawArtifacts({ cookie: "session=abc" }), /cookie/);
});

test("uwSnapshotStore supports memory backend", async () => {
  const store = createUwSnapshotStore({ backend: "memory" });
  await store.set(makeSummary());
  const snap = await store.get();
  assert.equal(snap.source, "unusual_whales_dom");
});

test("uwSnapshotStore supports file backend", async () => {
  const filePath = path.join(os.tmpdir(), `uw-store-${Date.now()}.json`);
  const store = createUwSnapshotStore({ backend: "file", filePath });
  await store.set(makeSummary());
  const snap = await store.get();
  assert.equal(snap.dealer.ticker, "SPX");
  fs.unlinkSync(filePath);
});

test("uwSnapshotStore exposes redis backend shape", async () => {
  const memoryFallback = createUwSnapshotStore({ backend: "memory" });
  const store = createUwSnapshotStore({
    backend: "redis",
    redisClient: {
      async get() {
        return JSON.stringify(makeSummary());
      },
      async set() {},
    },
    fallbackStore: memoryFallback,
  });
  const snap = await store.get();
  assert.equal(snap.source, "unusual_whales_dom");
});

test("stale UW snapshot sets source_status.uw.stale=true", () => {
  const status = getUwSourceStatus(
    makeSummary({ last_update: "2026-04-25T02:20:00.000Z", status: "live" }),
    {
      now: "2026-04-25T02:30:00.000Z",
      staleSeconds: 300,
    },
  );

  assert.equal(status.stale, true);
  assert.equal(status.state, "delayed");
});

test("/signals/current helper does not crash when UW is missing", () => {
  const merged = mergeUwIntoSignalsCurrent(
    {
      source_status: {},
      executable: true,
      trade_plan: { ready: true },
    },
    null,
    {
      now: "2026-04-25T02:30:00.000Z",
    },
  );

  assert.equal(merged.uw.dealer.net_gamma, null);
  assert.equal(merged.source_status.uw.state, "unavailable");
});

test("/signals/current helper blocks executable when UW is stale", () => {
  const merged = mergeUwIntoSignalsCurrent(
    {
      source_status: {},
      executable: true,
      trade_plan: { ready: true },
    },
    makeSummary({ last_update: "2026-04-25T02:20:00.000Z" }),
    {
      now: "2026-04-25T02:30:00.000Z",
      staleSeconds: 300,
    },
  );

  assert.equal(merged.source_status.uw.stale, true);
  assert.equal(merged.executable, false);
  assert.equal(merged.trade_plan.ready, false);
});

test("UW mock data is not allowed to remain executable", () => {
  const merged = mergeUwIntoSignalsCurrent(
    {
      source_status: {},
      executable: true,
      trade_plan: { ready: true },
    },
    makeSummary({ status: "partial", quality: { uw_signal: "neutral", conflict_reason: null, data_quality: "unavailable", missing_fields: ["iv_rank"] } }),
    {
      now: "2026-04-25T02:30:00.000Z",
      staleSeconds: 300,
    },
  );

  assert.equal(merged.executable, false);
  assert.equal(merged.trade_plan.ready, false);
});
