# SYSTEM DECISION LOGIC

## Purpose

This document defines the top-level decision rules for SPX Ops Lab.

It answers four questions:

1. What each data source is responsible for.
2. What each data source must never do.
3. How data sources are combined into one safe decision pipeline.
4. How the system blocks execution when data is stale, degraded, conflicting, or structurally incoherent.

This document is the policy layer. The dashboard should project these rules, not invent new ones.

---

## Core principles

- Safety is more important than completeness.
- Real data is preferred, but real data mixed with mock decision maps must not be treated as executable.
- The system is advisory only in phase 1.
- No source is allowed to place orders.
- The frontend must not compute hidden trading logic on its own.
- Telegram is a notification layer, not an analysis engine.

---

## 1) Data source responsibilities

### TradingView

**Responsible for**
- Price structure trigger detection.
- Breakout, breakdown, pullback, retest, invalidation, and related structural events.
- Lightweight trigger state that can confirm whether price structure is confirmed or not.

**Must not do**
- Must not decide event risk.
- Must not provide final gamma map.
- Must not decide dealer regime.
- Must not place trades.
- Must not be treated as a direct execution trigger by itself.

### FMP Event Risk

**Responsible for**
- Economic and event calendar risk gate.
- Detecting whether short-vol windows should be blocked or downgraded.
- Producing event risk context for `/signals/current`.

**Must not do**
- Must not decide long/short direction.
- Must not replace TradingView structure confirmation.
- Must not replace ThetaData gamma map.
- Must not create strategy targets by itself.

### FMP Price

**Responsible for**
- Backup real-time SPX cash/index spot.
- Intraday day-change and day-change percentage when available.
- `last_updated` and price health checks.
- Replacing mock display spot when real FMP price is available.

**Must not do**
- Must not create trading direction.
- Must not compute gamma regime.
- Must not compute wall distances for execution when wall map is still mock.
- Must not generate strategy targets.

### UW Greek Exposure

**Responsible for**
- Supplemental dealer and greek context from UW.
- Assist with understanding positioning pressure and directional stress.

**Must not do**
- Must not replace ThetaData as the formal gamma map.
- Must not create final execution permission on its own.
- Must not be parsed directly by the frontend from raw UW payloads.

### UW Options Flow

**Responsible for**
- Flow confirmation and aggressor context.
- Identifying whether option flow is supportive, conflicting, or neutral.

**Must not do**
- Must not replace price structure confirmation.
- Must not decide event risk.
- Must not independently authorize execution.

### UW Dark Pool

**Responsible for**
- Supplemental support/resistance context.
- Identifying likely liquidity zones or absorption/distribution areas.

**Must not do**
- Must not define formal gamma walls.
- Must not replace spot or event risk.
- Must not independently define entries, exits, or invalidation.

### UW Volatility

**Responsible for**
- Supplemental volatility context from UW-derived observations.
- Supporting whether vol is expanding, compressing, or unstable.

**Must not do**
- Must not replace the system-wide volatility permission decision.
- Must not authorize short-vol by itself.
- Must not override event risk gate.

### UW NOPE

**Responsible for**
- Supplemental crowd/dealer pressure context when available.
- Helping explain whether intraday pressure is supportive or unstable.

**Must not do**
- Must not replace gamma map.
- Must not replace TradingView structure.
- Must not independently generate trade instructions.

### ThetaData

**Responsible for**
- Formal gamma map.
- Flip, call wall, put wall, max pain, and related structured map outputs.
- The official wall model used for distance calculations and strategy permission logic.

**Must not do**
- Must not decide event risk.
- Must not replace TradingView trigger structure.
- Must not place orders.

### Telegram

**Responsible for**
- Sending compact state-change notifications.
- Broadcasting meaningful changes in permission, event risk, structure state, or data health.

**Must not do**
- Must not send large analysis dumps.
- Must not mirror raw JSON.
- Must not compute new logic.
- Must not trigger execution.

### Dashboard

**Responsible for**
- Projecting already-computed system state.
- Showing consolidated source health, source coherence, recommendation state, and notes.
- Blocking display-level execution suggestions when coherence is unsafe.

**Must not do**
- Must not invent new strategy logic.
- Must not calculate new hidden decisions beyond presentation guards.
- Must not interpret raw source payloads directly.

---

## 2) Source relationships

- **TradingView = price structure trigger**
- **FMP = event risk gate + backup real spot**
- **UW = dealer / flow / dark pool / volatility assistance**
- **ThetaData = formal gamma map**
- **Dashboard = projection layer**
- **Telegram = reminder layer**

Expanded relationship model:

- TradingView tells the system whether structure is confirmed, probing, invalidated, or waiting.
- FMP tells the system whether an event window should downgrade or block permissions, and may supply a real SPX display spot.
- UW explains supportive or conflicting flow conditions, but does not replace structure or formal map.
- ThetaData is the formal map authority for Flip / Call Wall / Put Wall / Max Pain.
- Dashboard shows the merged result and enforces display safety when sources are incoherent.
- Telegram only reports compact decision changes after the result is already computed.

---

## 3) Total calculation order

The full system should follow this order:

1. **data ingestion**
2. **normalization**
3. **source health**
4. **data coherence guard**
5. **event risk gate**
6. **gamma regime**
7. **price structure**
8. **flow confirmation**
9. **volatility permission**
10. **confidence score**
11. **strategy permission**
12. **dashboard projection**
13. **telegram alert**

### Step meanings

#### 1. data ingestion
- Pull or receive raw source records from TradingView, FMP, UW, ThetaData, and other configured inputs.

#### 2. normalization
- Convert raw source payloads into stable internal fields.
- Every source should expose `last_updated`, availability, and mock/real labeling.

#### 3. source health
- Check configured state, availability, stale state, degraded state, and down state.

#### 4. data coherence guard
- Verify that the sources used together belong to the same executable layer.
- This step must run before strategy permission.

#### 5. event risk gate
- Apply FMP event risk rules.
- Restrict or block short-vol windows when risk is elevated or unknown.

#### 6. gamma regime
- Use ThetaData as the formal map authority when available.

#### 7. price structure
- Use TradingView to determine trigger structure and confirmation state.

#### 8. flow confirmation
- Use UW to support, weaken, or conflict-check the structure.

#### 9. volatility permission
- Determine whether short-vol is permitted, downgraded, or blocked.

#### 10. confidence score
- Combine health, conflict, structure, and permission quality into a bounded score.

#### 11. strategy permission
- Decide whether single-leg, vertical, or iron-condor style projections may be shown.

#### 12. dashboard projection
- Display only the already-computed result.
- If coherence is unsafe, the dashboard must block display of execution-style outputs.

#### 13. telegram alert
- Send a concise change notification only if the projected state materially changed.

---

## 4) Data coherence guard

### Mandatory rule

If:

- `market_snapshot.spot_source = "fmp"`
- and the displayed price is real
- and **Flip / Call Wall / Put Wall / Max Pain still come from mock scenario data**

then the system must classify:

- `data_coherence = "mixed"`
- `executable = false`
- `reason = "真实现价与 mock Gamma 地图不一致，禁止执行。"`

### Operational meaning

Real price plus mock map is not an executable state.

The system may still show:
- the real FMP spot
- source health
- event risk
- explanatory warnings

But it must not:
- compute wall distances for execution
- compute strategy targets from mock walls
- project actionable entries, exits, or invalidation using that mixed set

### Required UI behavior in mixed mode

When `data_coherence = mixed`:

- Main command title must become: **数据混合，禁止执行**
- Main explanation must state that FMP price is real but gamma map is still mock.
- Trigger, first target, invalidation, and execution-style avoid text must be blocked or replaced with safe placeholders.
- Wall distance numbers must not be shown.
- Strategy cards must not show executable target ladders derived from mock map.

### Required rule summary

- **real price + mock gamma map = mixed**
- **mixed = executable false**
- **mixed must suppress strategy targets and distance displays**

---

## 5) Strategy permission rules

### Single-leg

Allowed only when:
- price structure is confirmed or safely waiting for a valid trigger,
- event risk gate is not blocking,
- source coherence is executable,
- required sources are sufficiently fresh.

Must be blocked when:
- data coherence is mixed,
- required source health is degraded in a way that invalidates execution,
- high conflict or explicit no-trade state exists.

### Vertical spread

Allowed only when:
- structure and map are coherent,
- target and invalidation levels are based on trusted map data,
- conflict is not high,
- event risk does not block execution.

Must be blocked when:
- data coherence is mixed,
- wall map is mock while spot is real,
- targets would be derived from mock walls.

### Iron condor

Allowed only when:
- event risk is low,
- volatility permission allows short-vol,
- gamma map is trusted,
- coherence is executable,
- stale/conflict guards do not block.

Must be blocked when:
- event risk is medium/high or unknown,
- FMP event risk gate downgrades short-vol,
- data coherence is mixed,
- any required map component is mock in an otherwise real execution path.

---

## 6) Telegram rule

Telegram must only send **changes**, not large analysis dumps.

Telegram messages should:
- describe the state change,
- describe the permission change,
- describe why the user must or must not act,
- stay compact and human-readable.

Telegram must not:
- send large JSON payloads,
- send raw engine outputs,
- send full dashboard reasoning every cycle,
- become the primary analysis surface.

---

## 7) Dashboard rule

Dashboard does not compute new hidden trading logic.

Dashboard should:
- show already-computed results,
- show source state,
- show event risk,
- show confidence and permission summaries,
- enforce display-level safety guards such as coherence blocking.

Dashboard must not:
- reinterpret raw payloads into new strategy logic,
- override backend decision results,
- synthesize executable targets from incoherent data.

---

## 8) Practical mixed-data examples

### Valid display-only mixed state

- FMP Price = real SPX 7158.xx
- ThetaData Gamma Map = mock
- Flip / Call Wall / Put Wall / Max Pain = mock

Allowed:
- show `FMP · REAL`
- show real SPX price
- show warning that map is still mock

Blocked:
- show wall distances
- show entry/target/invalidation from mock walls
- show strategy permissions as executable

### Invalid display behavior that must never happen

These are forbidden in mixed mode:

- `距离 Flip 1874 pt`
- `距离 Call Wall -1839 pt`
- `5275 -> 5320`
- `回踩 flip 5285`
- `跌破 put_wall 5225`

---

## 9) Implementation policy summary

- TradingView confirms structure.
- FMP gates event risk and may supply backup real spot.
- UW assists but does not authorize.
- ThetaData is the formal map authority.
- Dashboard projects the synthesized result.
- Telegram only alerts on meaningful changes.
- Mixed real-price plus mock-map state is non-executable by definition.

