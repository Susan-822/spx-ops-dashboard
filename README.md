# spx-ops-dashboard

## Render deploy

This repo can be deployed to Render with the included `render.yaml`.

Required environment variables in Render:

- `APP_BASIC_AUTH_USER`
- `APP_BASIC_AUTH_PASSWORD`
- `TRADINGVIEW_WEBHOOK_SECRET`
- `TELEGRAM_ENABLED`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Recommended domains:

- `spxopslab.store`
- `www.spxopslab.store`

Health endpoint:

- `GET /health`

Frontend data endpoint:

- `GET /signals/current`

TradingView ingress:

- `POST /webhook/tradingview`

Telegram test ingress:

- `POST /telegram/test`

Theta curated ingest:

- `POST /ingest/theta`

## ThetaData local dealer workflow

ThetaData is options-only in the current plan. SPX spot / VIX must come from FMP, TradingView, `market_snapshot`, or a manual local test spot. Do not make Theta index endpoints a required dependency for execution.

Useful local env vars:

- `THETADATA_BASE_URL` default `http://127.0.0.1:25503`
- `THETA_INGEST_SECRET`
- `THETA_STATE_STORE` = `memory | file | redis`
- `THETA_SNAPSHOT_FILE` default `/var/data/theta_snapshot.json`
- `THETA_SNAPSHOT_STALE_SECONDS` default `300`
- `THETA_SNAPSHOT_TTL_SECONDS` default `21600`
- `THETA_REDIS_URL`
- `THETA_GEX_POSITIVE_THRESHOLD` default `100000000`
- `THETA_GEX_NEGATIVE_THRESHOLD` default `-100000000`
- `THETA_TEST_EXPIRATION`
- `THETA_TEST_SPOT`
- `THETA_INGEST_URL` for `scripts/theta-bridge.mjs`

Local commands:

- `node scripts/theta-probe.mjs`
- `npm run dev`
- `THETA_INGEST_URL=http://localhost:3000/ingest/theta THETA_INGEST_SECRET=local-test-secret THETA_TEST_SPOT=5300 node scripts/theta-bridge.mjs --once`
