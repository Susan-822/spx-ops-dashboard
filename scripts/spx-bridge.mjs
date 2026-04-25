import { clearTvSnapshot, readTvSnapshot } from '../apps/api/state/tvSnapshotStore.js';
import { getFmpSnapshot } from '../apps/api/adapters/fmp/index.js';
import {
  thetaCheckTerminal,
  thetaFetchATMStraddle,
  thetaFetchExpirations,
  thetaFetchIndexPrice,
  thetaFetchOptionChainByExp
} from '../apps/api/integrations/thetadata/theta-local-client.js';
import {
  calculateThetaDealerSummary,
  pickThetaTestExpiration,
  resolveExternalSpotInput
} from '../apps/api/decision_engine/dealer-conclusion-engine.js';
import { loadLocalEnv } from './local-env.mjs';

const SYMBOL = 'SPX';

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  return {
    once: flags.has('--once'),
    thetaOnly: flags.has('--theta-only'),
    uwOnly: flags.has('--uw-only'),
    all: flags.has('--all') || (!flags.has('--theta-only') && !flags.has('--uw-only'))
  };
}

function readPresentFlag(value) {
  return Boolean(String(value || '').trim());
}

function getBridgeConfig() {
  const envInfo = loadLocalEnv();
  const cloudUrl = String(process.env.CLOUD_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.DATA_PUSH_API_KEY || '').trim();
  const thetaBaseUrl = String(process.env.THETADATA_BASE_URL || 'http://127.0.0.1:25503').trim();
  const thetaIngestUrl = cloudUrl ? `${cloudUrl}/ingest/theta` : '';
  const intervalSeconds = Number.parseInt(process.env.THETA_BRIDGE_INTERVAL_SECONDS || '30', 10);

  return {
    ...envInfo,
    cloudUrl,
    thetaIngestUrl,
    dataPushApiKey: apiKey,
    thetaBaseUrl,
    intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 30,
    manualSpot: process.env.THETA_TEST_SPOT ? Number(process.env.THETA_TEST_SPOT) : null
  };
}

function printConfigSummary(config) {
  console.log(JSON.stringify({
    env_file_used: config.envFileUsed,
    CLOUD_URL_present: readPresentFlag(config.cloudUrl),
    DATA_PUSH_API_KEY_present: readPresentFlag(config.dataPushApiKey),
    UW_BEARER_TOKEN_present: readPresentFlag(process.env.UW_BEARER_TOKEN || '')
  }, null, 2));
}

function createUnavailableThetaPayload({
  reason,
  testExpiration = null,
  spotSource = 'unavailable',
  spot = null
}) {
  return {
    source: 'thetadata_terminal',
    status: spot == null ? 'unavailable' : 'partial',
    last_update: new Date().toISOString(),
    ticker: SYMBOL,
    spot_source: spotSource,
    spot,
    test_expiration: testExpiration,
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
      data_quality: spot == null ? 'unavailable' : 'partial',
      missing_fields: spot == null ? ['option_chain', 'external_spot'] : ['option_chain'],
      warnings: [reason],
      calculation_scope: 'single_expiry_test',
      raw_rows_sent: false
    }
  };
}

async function resolveExternalSpot() {
  const manualSpot = process.env.THETA_TEST_SPOT ? Number(process.env.THETA_TEST_SPOT) : null;
  const fmpSnapshot = await getFmpSnapshot();
  const fmpPrice = fmpSnapshot?.price?.price_available ? fmpSnapshot.price.price : null;
  const tradingviewSnapshot = await readTvSnapshot();
  const tradingviewPrice = Number.isFinite(Number(tradingviewSnapshot?.price))
    ? Number(tradingviewSnapshot.price)
    : null;
  const marketSnapshotPrice = Number.isFinite(Number(process.env.MARKET_SNAPSHOT_PRICE))
    ? Number(process.env.MARKET_SNAPSHOT_PRICE)
    : null;

  const resolved = resolveExternalSpotInput({
    fmpPrice,
    tradingviewPrice,
    marketSnapshotSpot: marketSnapshotPrice,
    manualSpot
  });

  return {
    externalSpot_source: resolved.spot_source,
    externalSpot: resolved.spot
  };
}

async function buildThetaPayload(config) {
  const terminal = await thetaCheckTerminal(config.thetaBaseUrl);
  const externalSpot = await resolveExternalSpot();

  if (!terminal.reachable) {
    return createUnavailableThetaPayload({
      reason: terminal.error || 'Theta terminal unreachable.',
      spotSource: externalSpot.externalSpot_source,
      spot: externalSpot.externalSpot
    });
  }

  let expirations = [];
  try {
    expirations = await thetaFetchExpirations({
      symbol: SYMBOL,
      baseUrl: config.thetaBaseUrl
    });
  } catch (error) {
    return createUnavailableThetaPayload({
      reason: error.message,
      spotSource: externalSpot.externalSpot_source,
      spot: externalSpot.externalSpot
    });
  }

  const testExpiration = pickThetaTestExpiration(expirations, process.env.THETA_TEST_EXPIRATION || null);
  if (!testExpiration) {
    return createUnavailableThetaPayload({
      reason: 'No expiration available from ThetaData.',
      testExpiration: null,
      spotSource: externalSpot.externalSpot_source,
      spot: externalSpot.externalSpot
    });
  }

  try {
    const chain = await thetaFetchOptionChainByExp(testExpiration, {
      symbol: SYMBOL,
      baseUrl: config.thetaBaseUrl
    });
    const atmStraddle = await thetaFetchATMStraddle(testExpiration, externalSpot.externalSpot, {
      symbol: SYMBOL,
      baseUrl: config.thetaBaseUrl
    });

    const summary = calculateThetaDealerSummary({
      ticker: SYMBOL,
      status: externalSpot.externalSpot == null ? 'partial' : 'live',
      spot_source: externalSpot.externalSpot_source,
      spot: externalSpot.externalSpot,
      test_expiration: testExpiration,
      contracts: chain.contracts,
      warnings: [
        ...chain.warnings,
        atmStraddle.straddle_mid == null ? 'atm_straddle_unavailable' : null
      ].filter(Boolean)
    });

    return {
      source: 'thetadata_terminal',
      status: summary.status,
      last_update: summary.last_update,
      ticker: summary.ticker,
      spot_source: summary.spot_source,
      spot: summary.spot,
      test_expiration: summary.test_expiration,
      dealer: summary.dealer,
      quality: summary.quality,
      externalSpot_source: externalSpot.externalSpot_source
    };
  } catch (error) {
    return createUnavailableThetaPayload({
      reason: error.message,
      testExpiration,
      spotSource: externalSpot.externalSpot_source,
      spot: externalSpot.externalSpot
    });
  }
}

async function postThetaPayload(config, payload) {
  if (!config.cloudUrl) {
    throw new Error('CLOUD_URL missing.');
  }
  if (!config.dataPushApiKey) {
    throw new Error('DATA_PUSH_API_KEY missing.');
  }

  const body = {
    ...payload,
    secret: config.dataPushApiKey
  };
  const response = await fetch(config.thetaIngestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}

  return {
    status: response.status,
    ok: response.ok,
    body: parsed
  };
}

async function runThetaOnly(config, { once }) {
  printConfigSummary(config);
  const payload = await buildThetaPayload(config);
  console.log(JSON.stringify({
    mode: 'theta-only',
    externalSpot_source: payload.externalSpot_source || payload.spot_source,
    payload
  }, null, 2));

  const pushResult = await postThetaPayload(config, payload);
  console.log(JSON.stringify({
    mode: 'theta-only',
    push_result: pushResult
  }, null, 2));

  if (once) {
    return;
  }

  setInterval(async () => {
    try {
      const nextPayload = await buildThetaPayload(config);
      const nextResult = await postThetaPayload(config, nextPayload);
      console.log(JSON.stringify({
        mode: 'theta-only',
        externalSpot_source: nextPayload.externalSpot_source || nextPayload.spot_source,
        push_result: nextResult
      }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({
        mode: 'theta-only',
        status: 'error',
        message: error.message
      }, null, 2));
    }
  }, Math.max(5, config.intervalSeconds) * 1000);
}

async function runUwOnly(config) {
  printConfigSummary(config);
  const tokenPresent = readPresentFlag(process.env.UW_BEARER_TOKEN || '');
  console.log(JSON.stringify({
    mode: 'uw-only',
    skipped: tokenPresent !== true,
    reason: tokenPresent ? 'UW-only placeholder path.' : 'UW_BEARER_TOKEN missing.'
  }, null, 2));
}

async function main() {
  const args = parseArgs();
  const config = getBridgeConfig();

  if (args.thetaOnly) {
    await runThetaOnly(config, { once: args.once });
    return;
  }

  if (args.uwOnly) {
    await runUwOnly(config);
    return;
  }

  if (args.all) {
    await runThetaOnly(config, { once: args.once });
    return;
  }
}

await main();
