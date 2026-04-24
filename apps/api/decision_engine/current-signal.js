import { getThetaSnapshot } from '../adapters/theta/index.js';
import { getFmpSnapshot } from '../adapters/fmp/index.js';
import { getTradingViewSnapshot } from '../adapters/tradingview/index.js';
import { getUwSnapshot } from '../adapters/uw/index.js';
import { buildNormalizedSignal } from '../normalizer/build-normalized-signal.js';

export async function getCurrentSignal() {
  const [theta, fmp, tradingview, uw] = await Promise.all([
    getThetaSnapshot(),
    getFmpSnapshot(),
    getTradingViewSnapshot(),
    getUwSnapshot()
  ]);

  return buildNormalizedSignal({ theta, fmp, tradingview, uw });
}
