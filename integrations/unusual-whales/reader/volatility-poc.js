const { cleanNumeric, deriveActivationLight } = require("./field-utils");

const VOL_FIELDS = [
  "iv_rank",
  "iv_rank_1y",
  "iv_percentile",
  "implied_volatility",
  "realized_volatility",
  "implied_move",
  "implied_move_perc",
  "last_update",
];

function createEmptyVolatilityOutput() {
  return {
    source: "unusual_whales_dom",
    module: "volatility_iv",
    status: "not_found",
    tickers: ["SPX", "SPY", "XSP"],
    fields: {
      iv_rank: null,
      iv_rank_1y: null,
      iv_percentile: null,
      implied_volatility: null,
      realized_volatility: null,
      implied_move: null,
      implied_move_perc: null,
      term_structure: [],
      last_update: null,
    },
    volatility_activation_candidate: {
      data_quality: "unavailable",
      light: "unknown",
      score: null,
      strength: "unknown",
      single_leg_permission: "unknown",
      vertical_permission: "unknown",
      iron_condor_permission: "unknown",
    },
    missing_fields: [],
    manual_confirmation_needed: [],
    notes: [],
  };
}

function computeActivation(fields) {
  const qualityAvailable = fields.iv_rank !== null || fields.implied_volatility !== null;
  if (!qualityAvailable) {
    return {
      data_quality: "unavailable",
      light: "unknown",
      score: null,
      strength: "unknown",
      single_leg_permission: "unknown",
      vertical_permission: "unknown",
      iron_condor_permission: "unknown",
    };
  }

  const ivRank = fields.iv_rank ?? fields.iv_rank_1y;
  const ivPct = fields.iv_percentile;
  let score = null;
  if (ivRank !== null || ivPct !== null) {
    score = Number((((ivRank ?? 0) + (ivPct ?? 0)) / (ivRank !== null && ivPct !== null ? 2 : 1)).toFixed(2));
  }

  const light = deriveActivationLight(score);
  const strengthMap = {
    green: "active",
    yellow: "lifting",
    red: "off",
    unknown: "unknown",
  };
  const permissionMap = {
    green: "allow",
    yellow: "wait",
    red: "block",
    unknown: "unknown",
  };

  return {
    data_quality: "live",
    light,
    score,
    strength: strengthMap[light],
    single_leg_permission: permissionMap[light],
    vertical_permission: permissionMap[light],
    iron_condor_permission: light === "green" ? "allow" : permissionMap[light],
  };
}

function normalizeTermStructure(termStructure) {
  if (!Array.isArray(termStructure)) {
    return [];
  }
  return termStructure
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      return {
        label: item.label ?? item.expiry ?? null,
        implied_volatility: cleanNumeric(item.implied_volatility ?? item.iv ?? item.value),
      };
    })
    .filter(Boolean);
}

function buildVolatilityPoc({ pages = [] } = {}) {
  const output = createEmptyVolatilityOutput();
  const combinedVisibleFields = {};

  for (const page of pages) {
    if (!page || typeof page !== "object") {
      continue;
    }
    const visibleFields = page.raw_visible_fields ?? {};

    for (const field of VOL_FIELDS) {
      if (visibleFields[field] !== undefined && output.fields[field] === null) {
        output.fields[field] = cleanNumeric(visibleFields[field], { keepStrings: field === "last_update" });
      }
    }

    if (visibleFields.term_structure !== undefined && output.fields.term_structure.length === 0) {
      output.fields.term_structure = normalizeTermStructure(visibleFields.term_structure);
    }

    for (const [key, value] of Object.entries(visibleFields)) {
      if (combinedVisibleFields[key] === undefined) {
        combinedVisibleFields[key] = value;
      }
    }

    if (Array.isArray(page.notes)) {
      output.notes.push(...page.notes);
    }
  }

  output.missing_fields = [
    ...VOL_FIELDS.filter((field) => output.fields[field] === null),
    ...(output.fields.term_structure.length === 0 ? ["term_structure"] : []),
  ];

  if (output.missing_fields.length === VOL_FIELDS.length + 1) {
    output.status = "not_found";
    output.manual_confirmation_needed.push("volatility page visible fields not captured yet");
  } else if (output.missing_fields.length > 0) {
    output.status = "partial";
    output.manual_confirmation_needed.push(...output.missing_fields);
  } else {
    output.status = "found";
  }

  output.volatility_activation_candidate = computeActivation(output.fields);
  return output;
}

module.exports = {
  createEmptyVolatilityOutput,
  buildVolatilityPoc,
  summarizeVolatilityPages: buildVolatilityPoc,
};
