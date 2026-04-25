import {
  thetaFetchATMStraddle,
  thetaFetchExpirations,
  thetaFetchOptionChainByExp
} from '../apps/api/integrations/thetadata/theta-local-client.js';
import {
  calculateThetaDealerSummary,
  pickThetaTestExpiration,
  resolveExternalSpotInput
} from '../apps/api/decision_engine/dealer-conclusion-engine.js';

const DEFAULT_INGEST_URL = process.env.THETA_INGEST_URL || 'http://localhost:3000/ingest/theta';
const DEFAULT_INTERVAL_SECONDS = Number.parseInt(process.env.THETA_BRIDGE_INTERVAL_SECONDS || '30', 10);
const SYMBOL = 'SPX';

function readManualSpot() {
  const value = process.env.THETA_TEST_SPOT;
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveExternalInputs() {
  const manualSpot = readManualSpot();
  const resolved = resolveExternalSpotInput({
    manualSpot
  });

  return {
    spot_source: resolved.spot_source,
    spot: resolved.spot,
    vix_source: 'unavailable',
    vix: null
  };
}

async function buildBridgePayload() {
  try {
    const expirations = await thetaFetchExpirations({ symbol: SYMBOL });
    const testExpiration = pickThetaTestExpiration(expirations, process.env.THETA_TEST_EXPIRATION || null);
    if (!testExpiration) {
      return {
        secret: process.env.THETA_INGEST_SECRET || '',
        source: 'thetadata_terminal',
        status: 'unavailable',
        last_update: new Date().toISOString(),
        ticker: SYMBOL,
        spot_source: 'unavailable',
        spot: null,
        test_expiration: null,
        dealer: {
          net_gex: null,
          call_gex: null,
          put_gex: null,
          gamma_regime: 'unknown',
          dealer_behavior: 'unknown',
          least_resistance_path: 'unknown',
          call_wall: null,
          put_wall: null,
          max_pain: null,
          zero_gamma: null,
          expected_move_upper: null,
          expected_move_lower: null,
          vanna_charm_bias: 'unknown'
        },
        quality: {
          data_quality: 'unavailable',
          missing_fields: ['expirations'],
          warnings: ['no_expiration_available'],
          calculation_scope: 'single_expiry_test',
          raw_rows_sent: false
        }
      };
    }

    const externalInputs = await resolveExternalInputs();
    const chain = await thetaFetchOptionChainByExp(testExpiration, { symbol: SYMBOL });
    const atmStraddle = await thetaFetchATMStraddle(testExpiration, externalInputs.spot, { symbol: SYMBOL });

    const summary = calculateThetaDealerSummary({
      ticker: SYMBOL,
      status: externalInputs.spot == null ? 'partial' : 'live',
      spot_source: externalInputs.spot_source,
      spot: externalInputs.spot,
      test_expiration: testExpiration,
      contracts: chain.contracts,
      warnings: [
        ...chain.warnings,
        atmStraddle.straddle_mid == null ? 'atm_straddle_unavailable' : null
      ].filter(Boolean)
    });

    return {
      secret: process.env.THETA_INGEST_SECRET || '',
      source: 'thetadata_terminal',
      status: summary.status,
      last_update: summary.last_update,
      ticker: summary.ticker,
      spot_source: summary.spot_source,
      spot: summary.spot,
      test_expiration: summary.test_expiration,
      dealer: summary.dealer,
      quality: summary.quality
    };
  } catch (error) {
    return {
      secret: process.env.THETA_INGEST_SECRET || '',
      source: 'thetadata_terminal',
      status: 'unavailable',
      last_update: new Date().toISOString(),
      ticker: SYMBOL,
      spot_source: 'unavailable',
      spot: null,
      test_expiration: process.env.THETA_TEST_EXPIRATION || null,
      dealer: {
        net_gex: null,
        call_gex: null,
        put_gex: null,
        gamma_regime: 'unknown',
        dealer_behavior: 'unknown',
        least_resistance_path: 'unknown',
        call_wall: null,
        put_wall: null,
        max_pain: null,
        zero_gamma: null,
        expected_move_upper: null,
        expected_move_lower: null,
        vanna_charm_bias: 'unknown'
      },
      quality: {
        data_quality: 'unavailable',
        missing_fields: ['option_chain', 'external_spot'],
        warnings: [error.message],
        calculation_scope: 'single_expiry_test',
        raw_rows_sent: false
      }
    };
  }
}

async function postPayload(payload) {
  const response = await fetch(DEFAULT_INGEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body: json
  };
}

async function runOnce() {
  const payload = await buildBridgePayload();
  const result = await postPayload(payload);
  const output = {
    ingest_url: DEFAULT_INGEST_URL,
    request: payload,
    response: result
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

async function main() {
  const runContinuously = !process.argv.includes('--once');
  if (!runContinuously) {
    await runOnce();
    return;
  }

  await runOnce();
  setInterval(() => {
    runOnce().catch((error) => {
      console.error(JSON.stringify({
        status: 'error',
        message: error.message
      }, null, 2));
    });
  }, Math.max(5, DEFAULT_INTERVAL_SECONDS) * 1000);
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'error',
    message: error.message
  }, null, 2));
  process.exitCode = 1;
});
