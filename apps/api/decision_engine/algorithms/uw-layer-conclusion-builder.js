import { buildDealerGexConclusion } from './dealer-gex.js';
import { buildFlowAggressionLayer } from './flow-aggression.js';
import { buildVolatilityLayer } from './volatility.js';
import { buildDarkpoolLayer } from './darkpool.js';
import { buildMarketSentimentConclusion } from './sentiment.js';
import { buildDataHealthConclusion } from './data-health.js';
import { synthesizeUwLayers } from './master-synthesis.js';

export function buildUwLayerConclusions({
  uw_provider = {},
  uw_conclusion = {},
  uw_wall_diagnostics = {},
  darkpool_summary = {},
  volatility_activation = {},
  market_sentiment = {},
  institutional_alert = {},
  uw_factors = {},
  source_display = {},
  spot_conclusion = {},
  tv_sentinel = {}
} = {}) {
  const gex_engine = buildDealerGexConclusion({
    uw_conclusion,
    diagnostics: uw_wall_diagnostics
  });
  const flow_aggression_engine = buildFlowAggressionLayer({
    uwConclusion: uw_conclusion,
    flow: uw_factors.flow_factors,
    institutionalAlert: institutional_alert
  });
  const volatility_engine = buildVolatilityLayer({
    volatilityActivation: volatility_activation,
    volatilityFactors: uw_factors.volatility_factors
  });
  const darkpool_engine = buildDarkpoolLayer({
    uwConclusion: uw_conclusion,
    darkpoolSummary: darkpool_summary
  });
  const market_sentiment_engine = buildMarketSentimentConclusion({
    marketSentiment: market_sentiment,
    sentimentFactors: uw_factors.sentiment_factors
  });
  const data_health_engine = buildDataHealthConclusion({
    uw_provider,
    source_display
  });
  const master_synthesis = synthesizeUwLayers({
      gex_engine,
      flow_aggression_engine,
      volatility_engine,
      darkpool_engine,
      market_sentiment_engine,
      data_health_engine
  });

  return {
    gex_engine,
    flow_aggression_engine,
    volatility_engine,
    darkpool_engine,
    market_sentiment_engine,
    data_health_engine,
    master_synthesis
  };
}
