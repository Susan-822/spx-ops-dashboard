function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function createEmptyUwSummary() {
  return {
    dealer: {
      ticker: "SPX",
      net_gamma: null,
      net_delta: null,
      net_vanna: null,
      net_charm: null,
      gamma_regime: "unknown",
      dealer_behavior: "unknown",
      zero_gamma_or_flip: null,
      top_call_gamma_strikes: [],
      top_put_gamma_strikes: [],
    },
    volatility: {
      iv_rank: null,
      implied_volatility: null,
      realized_volatility: null,
      implied_move: null,
      term_structure_state: "unknown",
      volatility_activation_light: "unknown",
      volatility_activation_score: null,
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
      uw_signal: "unavailable",
      conflict_reason: null,
      data_quality: "unavailable",
      missing_fields: [],
    },
  };
}

function computeUwSourceStatus(snapshot, staleSeconds, now = new Date()) {
  const fallback = {
    source: "unusual_whales_dom",
    state: "unavailable",
    stale: false,
    last_update: null,
    message: "UW snapshot unavailable",
  };

  if (!snapshot) {
    return fallback;
  }

  const lastUpdate = snapshot.last_update ?? null;
  if (!lastUpdate) {
    return {
      ...fallback,
      state: "error",
      message: "UW snapshot missing last_update",
    };
  }

  const ageSeconds = Math.max(0, (new Date(now).getTime() - new Date(lastUpdate).getTime()) / 1000);
  const stale = ageSeconds > staleSeconds;

  let state = "real";
  if (snapshot.status === "error") {
    state = "error";
  } else if (snapshot.status === "partial") {
    state = "delayed";
  } else if (stale) {
    state = "delayed";
  }

  return {
    source: snapshot.source ?? "unusual_whales_dom",
    state,
    stale,
    last_update: lastUpdate,
    message: stale ? "UW snapshot stale" : "",
  };
}

function getUwSourceStatus(snapshot, options = {}) {
  return computeUwSourceStatus(snapshot, options.staleSeconds ?? 300, options.now ?? new Date());
}

function isUwExecutable(sourceStatus, snapshot) {
  if (!snapshot) {
    return false;
  }
  if (sourceStatus.state === "error" || sourceStatus.state === "unavailable") {
    return false;
  }
  if (sourceStatus.stale) {
    return false;
  }
  if (snapshot.status === "partial") {
    return false;
  }
  if (snapshot.quality?.data_quality === "unavailable") {
    return false;
  }
  return true;
}

function mergeUwIntoSignalsCurrent(baseSignalsCurrent, uwSummaryOrOptions = null, maybeOptions = {}) {
  const options =
    uwSummaryOrOptions &&
    typeof uwSummaryOrOptions === "object" &&
    !Array.isArray(uwSummaryOrOptions) &&
    ("uwSummary" in uwSummaryOrOptions || "now" in uwSummaryOrOptions || "staleSeconds" in uwSummaryOrOptions)
      ? uwSummaryOrOptions
      : {
          uwSummary: uwSummaryOrOptions,
          ...maybeOptions,
        };

  const {
    uwSummary = null,
    now = new Date(),
    staleSeconds = Number(process.env.UW_SNAPSHOT_STALE_SECONDS ?? 300),
  } = options;

  const result = clone(baseSignalsCurrent ?? {});
  result.executable = result.executable ?? false;
  result.source_status = result.source_status ?? {};

  const sourceStatus = computeUwSourceStatus(uwSummary, staleSeconds, now);
  result.source_status.uw = sourceStatus;

  const emptyUw = createEmptyUwSummary();
  result.uw = uwSummary
    ? {
        dealer: { ...emptyUw.dealer, ...(uwSummary.dealer ?? {}) },
        volatility: { ...emptyUw.volatility, ...(uwSummary.volatility ?? {}) },
        flow: { ...emptyUw.flow, ...(uwSummary.flow ?? {}) },
        darkpool: { ...emptyUw.darkpool, ...(uwSummary.darkpool ?? {}) },
        sentiment: { ...emptyUw.sentiment, ...(uwSummary.sentiment ?? {}) },
        quality: { ...emptyUw.quality, ...(uwSummary.quality ?? {}) },
      }
    : emptyUw;

  result.execution_constraints = result.execution_constraints ?? {};
  result.execution_constraints.uw = {
    available: Boolean(uwSummary),
    executable: isUwExecutable(sourceStatus, uwSummary),
    reason: !uwSummary
      ? "UW unavailable"
      : sourceStatus.stale
        ? "UW stale"
        : uwSummary.status === "partial"
          ? "UW partial"
          : sourceStatus.state === "error"
            ? "UW error"
            : "",
  };

  result.trade_plan = result.trade_plan ?? {};
  if (!result.execution_constraints.uw.executable) {
    result.trade_plan.uw_ready = false;
    result.trade_plan.ready = false;
    result.trade_plan.executable = false;
    result.executable = false;
  } else {
    result.trade_plan.uw_ready = true;
  }

  return result;
}

module.exports = {
  computeUwSourceStatus,
  getUwSourceStatus,
  isUwExecutable,
  mergeUwIntoSignalsCurrent,
};
