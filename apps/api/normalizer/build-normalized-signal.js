import { ACTIONS } from '../../../packages/shared/src/action-enum.js';
import { createSourceStatus } from '../../../packages/shared/src/source-status.js';
import { createNormalizedSignal } from '../../../packages/shared/src/normalized-schema.js';

export function buildNormalizedSignal({ theta, fmp, tradingview, uw }) {
  const source_status = [
    createSourceStatus(theta),
    createSourceStatus(fmp),
    createSourceStatus(tradingview),
    createSourceStatus(uw)
  ];

  return createNormalizedSignal({
    symbol: 'SPX',
    action: ACTIONS.HOLD,
    confidence: 0,
    thesis: 'Architecture skeleton only. No live market signal logic is implemented.',
    source_status,
    is_mock: source_status.some((item) => item.is_mock),
    gamma_summary: {
      regime: 'unknown',
      summary: 'Gamma summary skeleton response.',
      is_mock: true
    },
    events: [
      {
        id: 'boot-event',
        type: 'system',
        title: 'Skeleton bootstrapped',
        details: 'No real APIs connected. Using safe placeholder data.',
        is_mock: true,
        created_at: new Date().toISOString()
      }
    ],
    metadata: {
      environment: process.env.NODE_ENV ?? 'development',
      adapters_used: source_status.map((item) => item.source),
      notes: ['No real API calls executed.', 'IBKR and Brave API are intentionally not implemented.']
    }
  });
}
