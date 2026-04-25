# SPX Ops Lab System Decision Logic

## Purpose

This document defines the top-level decision logic for SPX Ops Lab.

It does **not** add code, APIs, or UI behavior by itself. Its purpose is to:

- define what each source is responsible for
- define what each source is **not** allowed to do
- define source precedence and relationships
- define the global calculation order
- define the data coherence guard
- define strategy permission rules
- define what Dashboard and Telegram are allowed to do

This document is the policy layer.  
Implementation changes must follow this policy, not invent parallel logic elsewhere.

---

## 1) Source Responsibilities

### 1. TradingView

**Role**

- Primary price structure trigger
- Detects breakout, rejection, reclaim, trend continuation, range behavior
- Anchors intraday chart context
- Provides the structural timing signal for when the system should pay attention

**Can do**

- Identify structure state from price action
- Provide trigger timing for entries, invalidation, reclaim/loss, retest, and momentum context
- Support strategy selection with structure direction and timing

**Cannot do**

- Cannot be the event risk gate
- Cannot decide dealer regime
- Cannot decide volatility permission by itself
- Cannot replace real quote coherence checks
- Cannot send strategy permission on structure alone

---

### 2. FMP Event Risk

**Role**

- Event risk gate
- Detect economic event proximity, macro schedule risk, earnings risk, market-hours or holiday context
- Downgrade or block strategy permissions before and around high-risk events

**Can do**

- Classify event risk as none / low / medium / high
- Produce event note and next event fields
- Set no-short-vol windows
- Downgrade or block trading permissions
- Feed Telegram event-risk reminders

**Cannot do**

- Cannot determine chart structure
- Cannot replace Gamma map
- Cannot replace Options Flow or Dark Pool read
- Cannot decide directional trade quality alone
- Cannot generate strategy targets

---

### 3. FMP Price

**Role**

- Backup real price source
- Used for source coherence, sanity checking, and fallback real quote handling

**Can do**

- Provide backup real price if primary real quote path is degraded
- Help determine whether the system is operating on real data or mixed data
- Support source health and coherence validation

**Cannot do**

- Cannot replace TradingView for structure
- Cannot replace ThetaData or UW for Gamma/Flow/Volatility context
- Cannot independently authorize strategy execution
- Cannot create Dashboard strategy projections on its own

---

### 4. UW Greek Exposure

**Role**

- Auxiliary dealer / gamma context
- Helps interpret dealer positioning, gamma pressure, zero gamma / flip, strike concentration, and expiry concentration

**Can do**

- Provide dealer-supportive context before ThetaData is available or when using cross-check mode
- Help identify likely pinning, support/resistance, and gamma pressure zones
- Support regime interpretation together with ThetaData

**Cannot do**

- Cannot be the official Gamma map when ThetaData is healthy
- Cannot overrule event risk gate
- Cannot replace real price
- Cannot alone authorize execution

---

### 5. UW Options Flow

**Role**

- Active money / flow confirmation layer
- Measures whether real premium, sweep activity, repeated hits, or directional pressure confirms structure

**Can do**

- Confirm or weaken a price-structure hypothesis
- Increase or decrease confidence score
- Help detect whether direction has real participation

**Cannot do**

- Cannot create structure triggers by itself
- Cannot replace event risk gate
- Cannot replace Gamma regime map
- Cannot independently allow high-risk strategies

---

### 6. UW Dark Pool

**Role**

- Auxiliary support / resistance / off-exchange context
- Used to identify potential institutional price levels, dark-pool clustering, and off-lit bias

**Can do**

- Add context around support, resistance, absorption, and institutional positioning
- Improve confidence when dark-pool levels align with price structure or dealer map

**Cannot do**

- Cannot be used as primary entry trigger
- Cannot replace Gamma map
- Cannot replace real price
- Cannot independently authorize execution

---

### 7. UW Volatility

**Role**

- Volatility permission layer
- Helps decide whether short-vol or iron-condor style strategies are structurally acceptable

**Can do**

- Provide IV Rank, IV Percentile, Implied Volatility, Realized Volatility, Term Structure, and Volatility Statistics context
- Gate or downgrade short-vol permissions
- Improve confidence for iron-condor suitability when volatility regime is supportive

**Cannot do**

- Cannot replace event risk gate
- Cannot replace structure trigger
- Cannot decide directional thesis alone
- Cannot authorize short-vol if event gate blocks it

---

### 8. UW NOPE

**Role**

- Overheat / divergence assist layer
- Used only as an auxiliary signal for net options pricing effect, overheating, or divergence context

**Can do**

- Add caution when directional enthusiasm is overheated
- Support divergence flags between price action and options-derived pressure
- Reduce confidence score when the move looks extended

**Cannot do**

- Cannot be a primary trigger
- Cannot replace Gamma map
- Cannot replace Options Flow
- Cannot independently authorize or block strategies unless combined with other negative evidence

---

### 9. ThetaData

**Role**

- Official Gamma map
- Formal dealer / gamma regime source
- Main source for Gamma regime once available and healthy

**Can do**

- Define official Gamma regime
- Provide the formal gamma map used in executable decision logic
- Override auxiliary Gamma interpretation from UW when ThetaData is healthy

**Cannot do**

- Cannot replace event risk gate
- Cannot replace chart structure timing
- Cannot replace flow confirmation
- Cannot directly push alerts without synthesized decision logic

---

### 10. Telegram

**Role**

- Reminder layer
- Distribution channel for short decision-state changes only

**Can do**

- Send event-risk changes
- Send permission changes
- Send state transitions such as block/downgrade/restore
- Send short, structured alerts

**Cannot do**

- Cannot calculate new logic
- Cannot send long-form analysis as default behavior
- Cannot invent strategy decisions not already produced by the core decision engine

---

### 11. Dashboard

**Role**

- Projection layer
- Visual display of already-computed results

**Can do**

- Display source health
- Display synthesized regime, permission, confidence, and alert state
- Display structure, event, Gamma, flow, volatility, and final permission outputs

**Cannot do**

- Cannot calculate new logic
- Cannot override strategy permissions
- Cannot bypass coherence guard
- Cannot show executable strategy targets when the system is in mixed state

---

## 2) Source Relationship Model

### Core relationship rules

- **TradingView = price structure trigger**
- **FMP = event risk gate + backup real price**
- **UW = Dealer / Flow / Dark Pool / Volatility auxiliary context**
- **ThetaData = official Gamma map**
- **Dashboard = projection layer**
- **Telegram = reminder layer**

### Practical precedence

1. TradingView decides **when structure matters**
2. FMP Event Risk decides **whether the system is even allowed to act**
3. ThetaData decides **official Gamma regime**
4. UW sources refine confidence through:
   - Greek Exposure
   - Flow
   - Dark Pool
   - Volatility
   - NOPE
5. Dashboard only displays synthesized results
6. Telegram only sends important state changes

### Gamma precedence rule

- If ThetaData is healthy and real, ThetaData is the official Gamma regime source
- UW Greek Exposure is auxiliary confirmation, fallback context, or cross-check input
- UW Greek Exposure must not silently replace ThetaData in official executable logic unless explicitly designated as fallback mode

---

## 3) Global Calculation Order

The system must compute in this order:

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

### Order details

#### 1. data ingestion

- Pull or receive all upstream source payloads
- Keep source identity attached to every field

#### 2. normalization

- Convert each source to internal typed fields
- Preserve `real / degraded / stale / mock / down` state where relevant

#### 3. source health

- Evaluate freshness, source state, and whether each source is healthy enough for use

#### 4. data coherence guard

- Check whether the system is mixing real and mock layers in an unsafe way
- Determine whether the stack is executable or display-only

#### 5. event risk gate

- Block or downgrade if macro / earnings / market-hours conditions require it

#### 6. gamma regime

- Determine official dealer regime using ThetaData first
- Use UW Greek Exposure as auxiliary confirmation only

#### 7. price structure

- Evaluate TradingView structural trigger

#### 8. flow confirmation

- Evaluate whether flow confirms, weakens, or contradicts structure

#### 9. volatility permission

- Evaluate whether short-vol or iron-condor style setups are allowed

#### 10. confidence score

- Synthesize structure + Gamma + flow + volatility + health + event context

#### 11. strategy permission

- Decide what strategy families are allowed, downgraded, or blocked

#### 12. dashboard projection

- Display already-computed output only

#### 13. telegram alert

- Emit short alerts only when state changes materially

---

## 4) Data Coherence Guard

The system must explicitly guard against mixed-state execution.

### Required rule

- **real price + mock gamma map = mixed**

### Mixed-state policy

- **mixed = executable false**
- **mixed state must not show strategy target**
- **mixed state must not show distance-to-target**
- **mixed state may show regime context, but only as non-executable informational state**

### Why this is mandatory

If live price is paired with mock Gamma logic, the system creates false precision:

- price appears real-time
- targets appear precise
- distance appears tradable
- but the regime driver is not real

This is an unsafe combination and must be blocked.

### Required output behavior in mixed state

When state is `mixed`:

- `executable = false`
- `strategy_permission = blocked`
- hide:
  - target
  - target distance
  - strike distance logic
  - executable strategy labels
- allow:
  - source health display
  - warning badge
  - explanatory note such as `real price + mock gamma map`

### Coherence state examples

#### State: fully real

- real price
- real Gamma map
- real or healthy auxiliary layers
- executable may proceed if all other gates pass

#### State: mixed

- real price
- mock Gamma map
- executable must be false

#### State: degraded but coherent

- real price
- real Gamma map
- one or more auxiliary layers stale/down
- executable may still be possible if policy allows degraded auxiliary context

#### State: display-only

- insufficient real inputs for execution
- system may show context, but not executable strategy outputs

---

## 5) Strategy Permission Rules

Strategy permission is decided **after**:

- event risk gate
- gamma regime
- price structure
- flow confirmation
- volatility permission
- confidence score
- coherence guard

### Strategy families

- Single-leg
- Vertical
- Iron condor

### Global blocking conditions

All strategy families must be blocked if any of the following is true:

- coherence state is `mixed`
- `executable = false`
- event risk gate = `block`
- critical source health failure makes regime non-executable

---

### A. Single-leg

**Default role**

- Highest directional freedom
- Highest timing sensitivity
- More tolerant than iron condor when volatility is not ideal

**Allowed when**

- price structure trigger is clear
- event risk is not blocked
- coherence guard passes
- Gamma regime does not strongly contradict the direction
- flow is at least neutral-to-supportive, or confidence is otherwise high enough

**Downgraded when**

- flow confirmation is weak
- Gamma regime conflicts with structure
- volatility is unstable but not blocked
- event risk is medium but not in hard block window

**Blocked when**

- mixed state
- high event risk block
- no clear structure
- Gamma regime directly invalidates the directional premise

---

### B. Vertical

**Default role**

- Controlled-risk directional structure
- More conservative than single-leg

**Allowed when**

- single-leg conditions are mostly met
- structure is clear
- confidence is moderate or above
- Gamma regime is not severely hostile
- flow is supportive or at least not contradictory

**Downgraded when**

- structure is valid but confidence is only moderate
- flow is neutral rather than confirming
- event risk is elevated but not blocked

**Blocked when**

- mixed state
- event risk gate block
- structure and Gamma regime strongly conflict
- confidence too low for defined-risk directional positioning

---

### C. Iron condor

**Default role**

- Short-vol / range-dependent strategy
- Requires the strictest permission logic

**Allowed when**

- coherence guard passes
- no short-vol window is false
- event risk is low or none
- volatility permission is supportive
- Gamma regime suggests pinning, containment, or non-expansion
- price structure supports range behavior rather than breakout expansion

**Downgraded when**

- volatility is only partially supportive
- structure is range-like but not stable enough
- event risk is not high but upcoming timing creates caution

**Blocked when**

- mixed state
- event risk gate blocks short-vol
- volatility permission is not supportive
- breakout / expansion structure is active
- Gamma regime suggests expansion rather than containment

### Short-vol rule

Iron condor must never be allowed simply because price is quiet.  
It requires:

- event permission
- volatility permission
- coherence pass
- structure compatibility
- Gamma compatibility

---

## 6) Confidence Score Policy

Confidence score is a synthesis layer, not a raw-source property.

It should reflect:

- source health
- coherence state
- event risk
- Gamma alignment
- structure clarity
- flow confirmation
- volatility suitability
- contradiction penalties

### Confidence must be reduced when

- sources conflict
- flow contradicts structure
- Gamma contradicts direction
- volatility regime conflicts with strategy type
- NOPE suggests overheat/divergence
- source health is degraded

### Confidence must not override hard gates

Even high confidence cannot bypass:

- mixed-state block
- event-risk hard block
- non-executable source coherence failure

---

## 7) Dashboard Policy

Dashboard is display-only.

### Dashboard must do

- display synthesized outputs
- display source health
- display coherence status
- display event risk state
- display strategy permission state

### Dashboard must not do

- calculate new logic
- derive new strategy rules
- override gates
- display executable strategy targets in mixed state
- display target distance in mixed state

### Dashboard display rule in mixed state

If coherence = `mixed`:

- show warning state
- show non-executable badge
- suppress target, distance, and actionable strategy projection

---

## 8) Telegram Policy

Telegram is a reminder layer, not an analysis engine.

### Telegram must do

- send short state-change alerts
- send permission-change alerts
- send event-risk alerts
- send recovery alerts when blocked state clears

### Telegram must not do

- send long narrative analysis by default
- re-explain the entire system in each message
- emit repetitive unchanged-state spam

### Telegram rule

- **Telegram only sends changes**
- **Telegram does not send long-form analysis**

Examples of valid triggers:

- event risk rises from medium to high
- single-leg changes from allowed to blocked
- iron condor changes from cautious to blocked
- coherence changes from real to mixed
- source health changes from healthy to degraded

Examples of invalid default behavior:

- repeating the same unchanged market state every cycle
- sending long explanatory essays instead of compact alerts

---

## 9) Source-by-Source Summary Table

| Source | Primary responsibility | Must not do |
| --- | --- | --- |
| TradingView | Price structure trigger | Cannot be event gate or Gamma regime authority |
| FMP Event Risk | Event risk gate | Cannot determine structure or dealer regime |
| FMP Price | Backup real price and coherence support | Cannot replace structure or authorize execution |
| UW Greek Exposure | Auxiliary dealer/gamma context | Cannot replace official ThetaData Gamma map when ThetaData is healthy |
| UW Options Flow | Active money confirmation | Cannot independently trigger execution |
| UW Dark Pool | Auxiliary support/resistance context | Cannot be primary trigger |
| UW Volatility | Volatility permission context | Cannot override event gate |
| UW NOPE | Overheat/divergence assist | Cannot be primary trigger |
| ThetaData | Official Gamma map | Cannot replace event gate or structure timing |
| Telegram | Reminder layer | Cannot calculate new logic |
| Dashboard | Projection layer | Cannot calculate new logic |

---

## 10) Implementation Directive

The next implementation step after this document is:

### First fix

- implement the **data coherence guard**

### Required implementation result

- `real price + mock gamma map => mixed`
- `mixed => executable false`
- mixed state hides:
  - strategy targets
  - distance
  - executable strategy display

### Important

Do **not** implement new business logic in Dashboard or Telegram.  
The core decision layer must compute once, and Dashboard/Telegram must consume that result.
