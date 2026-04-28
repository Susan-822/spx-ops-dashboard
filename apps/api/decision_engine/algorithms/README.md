# Algorithms

This directory is the unified algorithm library for SPX Ops Dashboard. All Dealer, Flow, Volatility, Dark Pool, Sentiment, Data Health, and Master Synthesis logic belongs here.

## Design principles

- Raw data must not be consumed directly by the homepage.
- Algorithms convert raw and normalized inputs into conclusions first.
- The homepage reads `analysis_layer` and `operation_layer`; it must not compute core trading logic.
- Radar displays data status, endpoint evidence, and mapping gaps; it does not create independent trade signals.
- Operation cards read `operation_layer`; UI code must not decide readiness.
- UI code must not implement core calculations.

## Data flow

```text
UW API / FMP / Theta / TV
→ raw data
→ algorithms/
→ uw_layer_conclusions
→ analysis_layer
→ homepage plain-language analysis
→ operation_layer decides whether operation cards can be ready
```

## File responsibilities

| File | Purpose |
|---|---|
| `dealer-gex.js` | Dealer/GEX/Wall/Flip calculations |
| `flow-aggression.js` | Aggressive flow, repeated hits, ask-side, 0DTE, multileg, net premium logic |
| `volatility.js` | IV Rank, IV Percentile, term structure, 0DTE implied move, volatility state |
| `darkpool.js` | Dark pool prints, >$1M aggregation, support/resistance |
| `sentiment.js` | Market Tide, NOPE, ETF Tide, Sector Tide, risk-on/risk-off |
| `data-health.js` | Source live/partial/stale/unavailable/mock quality logic |
| `master-synthesis.js` | Six-layer synthesis conclusion |
| `uw-layer-conclusion-builder.js` | Assembles UW six-layer conclusions from existing inputs |
| `safe-number.js` | Numeric cleanup for undefined/null/NaN/string numbers |
| `constants.js` | Shared thresholds |

## Output contract

Every layer conclusion must include:

```js
{
  status,
  bias,
  confidence,
  score,
  usable_for_analysis,
  usable_for_operation,
  supports_bullish,
  supports_bearish,
  blocks_operation,
  summary_cn,
  evidence_cn,
  missing_fields,
  current_block,
  next_fix
}
```

## Maintenance rules

1. New algorithms must be added under `apps/api/decision_engine/algorithms/`.
2. New thresholds must be added to `constants.js`.
3. Do not write algorithm logic in page code.
4. Do not write complex scoring logic in routes.
5. Do not let the frontend translate raw fields.
6. Every algorithm must emit `summary_cn`.
7. Every partial conclusion must emit `current_block`.
8. Every algorithm must have tests.
