# PROJECT BASELINE

## Purpose

This document defines the single source of truth for:

- the historically accepted host-app branch,
- the current official deployment branch,
- the Render service and domain targets,
- the repo directories that power the production app,
- which agent owns which subsystem,
- the required merge and deploy checks before production changes.

Every agent must read this file together with `AGENTS.md` before editing code.

---

## 1) Historical reality vs current official baseline

### Historical validated host-app branch

- Historical host-app branch: `cursor/project-rules-scaffold-44ea`
- Historical accepted UI baseline commit family:
  - `5e4cbbc` live UI baseline
  - `a8bfae5` screenshot refresh
  - `fa591d7` FMP risk-gate integration line

This branch is important because it was the branch known to back the accepted host app while later cloud-agent work was happening elsewhere.

### Current official deployment branch

- Official deployment branch going forward: `main`
- Required condition for using `main`: the historical host-app branch must already be contained in `main`
- Current repo status: `origin/cursor/project-rules-scaffold-44ea` is an ancestor of `origin/main`

### Practical rule

- When recovering historical work, compare against `cursor/project-rules-scaffold-44ea`
- When preparing the next formal deploy, start from `main`
- Do not deploy directly from temporary `cursor/*` feature branches

---

## 2) Production deployment target

- Render service name: `spxopslab`
- Public Render URL: `https://spxopslab.onrender.com`
- Custom domain: `https://spxopslab.store`
- Repo: `Susan-822/spx-ops-dashboard`
- Runtime entrypoint:
  - `npm start`
  - `node apps/api/server.js`

### Expected Render settings

- Branch: `main`
- Root Directory: repo root
- Build Command: `npm install`
- Start Command: `npm start`

If the live service shows old behavior after `main` changes were pushed, verify the Render service branch, service identity, latest deploy commit, and cache-cleared deploy path before touching application logic.

---

## 3) Production app directories

### Frontend

- Directory: `apps/web`
- Core files:
  - `apps/web/app.js`
  - `apps/web/styles.css`
  - `apps/web/index.html`

### API

- Directory: `apps/api`
- Core entrypoint:
  - `apps/api/server.js`
- Core routing:
  - `apps/api/routes/index.js`
- Signal assembly:
  - `apps/api/decision_engine/current-signal.js`
  - `apps/api/normalizer/build-normalized-signal.js`
  - `apps/api/decision_engine/master-engine.js`

---

## 4) Data-source module directories

### TradingView

- Webhook route: `apps/api/routes/index.js`
- Snapshot storage: `apps/api/storage/tradingview-snapshot.js`
- Store backend: `apps/api/state/tvSnapshotStore.js`

### FMP

- Adapter directory: `apps/api/adapters/fmp`
- Used for:
  - real backup spot
  - event risk

### ThetaData

- Local client: `apps/api/integrations/thetadata/theta-local-client.js`
- Local bridge scripts:
  - `scripts/spx-bridge.mjs`
  - `scripts/theta-bridge.mjs`
  - `scripts/theta-local-check.mjs`
  - `scripts/theta-probe.mjs`
- Snapshot storage:
  - `apps/api/state/thetaSnapshotStore.js`
  - `apps/api/storage/theta-snapshot.js`

### UW

- Primary directory: `integrations/unusual-whales`
- Runtime state:
  - `apps/api/state/uwSnapshotStore.js`
- API integration touchpoints:
  - `apps/api/routes/index.js`
  - `apps/api/decision_engine/uw-conclusion-engine.js`

---

## 5) Agent ownership boundaries

### Theta / FMP / TradingView / Render agent

Allowed:

- `apps/api/decision_engine/*` except UW-only internals
- `apps/api/routes/index.js`
- `apps/api/storage/*`
- `apps/api/state/thetaSnapshotStore.js`
- `apps/api/integrations/thetadata/*`
- `scripts/spx-bridge.mjs`
- `scripts/theta-*`
- production deployment docs

Must not:

- rebuild UW discovery from scratch
- rewrite unrelated UI styling
- deploy from temporary feature branches

### UW agent

Allowed:

- `integrations/unusual-whales/*`
- `apps/api/state/uwSnapshotStore.js`
- UW ingest / sanitize / normalize paths
- `uw_conclusion` and UW-specific tests

Must not:

- redefine ThetaData logic
- redefine FMP logic
- independently deploy the host app

### UI agent

Allowed:

- `apps/web/app.js`
- `apps/web/styles.css`
- `apps/web/index.html`

Must not:

- compute trading targets client-side
- resurrect mock fallback targets in non-executable states
- bypass `/signals/current`

### Deployment agent

Allowed:

- merge validated feature work into `main`
- verify Render branch / build / start settings
- verify `/health` version and production `/signals/current`

Must not:

- ship from unverified feature branches
- assume `render.yaml` equals live Render settings without console verification

---

## 6) Merge-before-deploy checklist

Before merging to `main`:

1. Compare against `cursor/project-rules-scaffold-44ea` if recovering historical host-app behavior.
2. Confirm the fix is not only present in a temporary `cursor/*` branch.
3. Confirm `/health` on the branch returns build metadata locally.
4. Confirm `/signals/current` contains the new fields being relied on.
5. Confirm non-executable strategy states blank out targets.
6. Confirm scenario/mock cannot generate executable strategy cards.
7. Confirm no secrets are committed.

---

## 7) Deploy-before-acceptance checklist

Before calling production “fixed”:

1. Push `main`.
2. Verify Render service branch is `main`.
3. Trigger deploy on the correct service.
4. Prefer `Clear build cache & deploy` when production still serves old artifacts.
5. Verify `/health` returns `git_commit` / `build_sha`.
6. Verify authenticated `/signals/current` exposes expected current fields.
7. Verify homepage and radar screenshots from production.
8. Verify production no longer shows mock target ladders in blocked states.

---

## 8) Production acceptance standard

Production is only acceptable when:

- `/health` exposes live build metadata,
- `/signals/current` exposes the current merged structure,
- non-executable states do not leak target ladders,
- dashboard and radar reflect the backend safety state,
- Theta/FMP/TradingView roles remain separated,
- deployment branch and live commit are known and traceable.
