const { validateAgainstSchema } = require("./json-schema");

const uwSummarySchema = {
  type: "object",
  required: [
    "source",
    "status",
    "last_update",
    "dealer",
    "volatility",
    "flow",
    "darkpool",
    "sentiment",
    "quality",
  ],
  additionalProperties: false,
  properties: {
    source: {
      type: "string",
      const: "unusual_whales_dom",
    },
    status: {
      type: "string",
      enum: ["live", "stale", "error", "partial"],
    },
    last_update: {
      type: ["string", "null"],
    },
    dealer: {
      type: "object",
      required: [
        "ticker",
        "net_gamma",
        "net_delta",
        "net_vanna",
        "net_charm",
        "gamma_regime",
        "dealer_behavior",
        "zero_gamma_or_flip",
        "top_call_gamma_strikes",
        "top_put_gamma_strikes",
      ],
      additionalProperties: false,
      properties: {
        ticker: { type: "string" },
        net_gamma: { type: ["number", "null"] },
        net_delta: { type: ["number", "null"] },
        net_vanna: { type: ["number", "null"] },
        net_charm: { type: ["number", "null"] },
        gamma_regime: {
          type: "string",
          enum: ["positive", "negative", "neutral", "unknown"],
        },
        dealer_behavior: {
          type: "string",
          enum: ["pin", "expand", "mixed", "unknown"],
        },
        zero_gamma_or_flip: { type: ["number", "string", "null"] },
        top_call_gamma_strikes: {
          type: "array",
          items: { type: ["number", "string"] },
        },
        top_put_gamma_strikes: {
          type: "array",
          items: { type: ["number", "string"] },
        },
      },
    },
    volatility: {
      type: "object",
      required: [
        "iv_rank",
        "implied_volatility",
        "realized_volatility",
        "implied_move",
        "term_structure_state",
        "volatility_activation_light",
        "volatility_activation_score",
      ],
      additionalProperties: false,
      properties: {
        iv_rank: { type: ["number", "null"] },
        implied_volatility: { type: ["number", "null"] },
        realized_volatility: { type: ["number", "null"] },
        implied_move: { type: ["number", "null"] },
        term_structure_state: {
          type: "string",
          enum: ["normal", "front_hot", "inverted", "unknown"],
        },
        volatility_activation_light: {
          type: "string",
          enum: ["red", "yellow", "green", "unknown"],
        },
        volatility_activation_score: { type: ["number", "null"] },
      },
    },
    flow: {
      type: "object",
      required: ["status", "flow_bias", "flow_speed", "flow_thrust"],
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        flow_bias: {
          type: "string",
          enum: ["bullish", "bearish", "mixed", "none", "unknown"],
        },
        flow_speed: {
          type: "string",
          enum: ["accelerating", "normal", "fading", "unknown"],
        },
        flow_thrust: {
          type: "string",
          enum: ["strong", "medium", "weak", "unknown"],
        },
      },
    },
    darkpool: {
      type: "object",
      required: ["status", "ticker", "nearest_support", "nearest_resistance", "darkpool_bias"],
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        ticker: { type: "string" },
        nearest_support: { type: ["number", "null"] },
        nearest_resistance: { type: ["number", "null"] },
        darkpool_bias: {
          type: "string",
          enum: ["support", "resistance", "neutral", "unknown"],
        },
      },
    },
    sentiment: {
      type: "object",
      required: ["status", "state"],
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        state: {
          type: "string",
          enum: ["risk_on", "risk_off", "mixed", "unknown"],
        },
      },
    },
    quality: {
      type: "object",
      required: ["uw_signal", "conflict_reason", "data_quality", "missing_fields"],
      additionalProperties: false,
      properties: {
        uw_signal: {
          type: "string",
          enum: ["confirm", "conflict", "neutral", "unavailable"],
        },
        conflict_reason: { type: ["string", "null"] },
        data_quality: {
          type: "string",
          enum: ["live", "degraded", "stale", "unavailable"],
        },
        missing_fields: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
};

function validateUwSummaryPayload(payload) {
  const result = validateAgainstSchema(payload, uwSummarySchema);
  return {
    ok: result.valid,
    errors: result.errors,
  };
}

const validateUwSummary = validateUwSummaryPayload;

module.exports = {
  uwSummarySchema,
  validateUwSummary,
  validateUwSummaryPayload,
};
