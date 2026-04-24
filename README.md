# spx-ops-dashboard

## Render deploy

This repo can be deployed to Render with the included `render.yaml`.

Required environment variables in Render:

- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`
- `TRADINGVIEW_WEBHOOK_SECRET`

Recommended domains:

- `spxopslab.store`
- `www.spxopslab.store`

Health endpoint:

- `GET /health`

Frontend data endpoint:

- `GET /signals/current`

TradingView ingress:

- `POST /webhook/tradingview`