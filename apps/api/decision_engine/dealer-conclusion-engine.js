function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  const parsed = toNumber(value);
  if (parsed == null) {
    return null;
  }
  return Number(parsed.toFixed(digits));
}

function midpoint(contract) {
  if (!contract) {
    return null;
  }
  const bid = toNumber(contract.bid);
  const ask = toNumber(contract.ask);
  if (bid != null && ask != null) {
    return round((bid + ask) / 2, 4);
  }
  const mark = toNumber(contract.mark ?? contract.mid);
  if (mark != null) {
    return mark;
  }
  const last = toNumber(contract.last ?? contract.price);
  return last;
}

function normalizeRight(right) {
  const raw = String(right ?? '').trim().toUpperCase();
  if (raw === 'CALL') return 'C';
  if (raw === 'PUT') return 'P';
  return raw;
}

function uniqueSortedStrikes(contracts) {
  return Array.from(
    new Set(contracts.map((item) => toNumber(item.strike)).filter((value) => value != null))
  ).sort((left, right) => left - right);
}

function nearestStrike(strikes, spot) {
  if (!Array.isArray(strikes) || strikes.length === 0 || toNumber(spot) == null) {
    return null;
  }
  return strikes
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(left - spot);
      const rightDistance = Math.abs(right - spot);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return left - right;
    })[0] ?? null;
}

function gexContribution(contract, spot) {
  const gamma = toNumber(contract.gamma);
  const openInterest = toNumber(contract.open_interest);
  if (gamma == null || openInterest == null || spot == null) {
    return null;
  }
  const sign = normalizeRight(contract.right) === 'P' ? -1 : 1;
  return sign * gamma * openInterest * spot * spot * 100 * 0.01;
}

function choosePositiveThreshold() {
  const parsed = toNumber(process.env.THETA_GEX_POSITIVE_THRESHOLD);
  return parsed ?? 100000000;
}

function chooseNegativeThreshold() {
  const parsed = toNumber(process.env.THETA_GEX_NEGATIVE_THRESHOLD);
  return parsed ?? -100000000;
}

function deriveGammaRegime(netGex) {
  if (toNumber(netGex) == null) {
    return 'unknown';
  }
  if (netGex > choosePositiveThreshold()) {
    return 'positive';
  }
  if (netGex < chooseNegativeThreshold()) {
    return 'negative';
  }
  return 'critical';
}

function nearestContractAtStrike(contracts, strike, right) {
  return contracts.find((item) => toNumber(item.strike) === strike && normalizeRight(item.right) === right) ?? null;
}

function computeExpectedMove(contracts, spot, missingFields) {
  if (spot == null) {
    missingFields.add('expected_move');
    return {
      atm_strike: null,
      atm_call: null,
      atm_put: null,
      expected_move: null,
      expected_move_upper: null,
      expected_move_lower: null
    };
  }

  const strike = nearestStrike(uniqueSortedStrikes(contracts), spot);
  const atmCall = strike == null ? null : nearestContractAtStrike(contracts, strike, 'C');
  const atmPut = strike == null ? null : nearestContractAtStrike(contracts, strike, 'P');
  const callMid = midpoint(atmCall);
  const putMid = midpoint(atmPut);

  if (strike == null || callMid == null || putMid == null) {
    missingFields.add('expected_move');
    return {
      atm_strike: strike,
      atm_call: atmCall,
      atm_put: atmPut,
      expected_move: null,
      expected_move_upper: null,
      expected_move_lower: null
    };
  }

  const expectedMove = round(callMid + putMid, 4);
  return {
    atm_strike: strike,
    atm_call: atmCall,
    atm_put: atmPut,
    expected_move: expectedMove,
    expected_move_upper: round(spot + expectedMove, 4),
    expected_move_lower: round(spot - expectedMove, 4)
  };
}

function computeWallMetrics(contracts, gexByStrike, warnings, missingFields) {
  const grouped = new Map();
  for (const contract of contracts) {
    const strike = toNumber(contract.strike);
    if (strike == null) {
      continue;
    }
    const entry = grouped.get(strike) ?? {
      callOi: 0,
      putOi: 0,
      callHasOi: false,
      putHasOi: false
    };
    const oi = toNumber(contract.open_interest);
    if (normalizeRight(contract.right) === 'C' && oi != null) {
      entry.callOi += oi;
      entry.callHasOi = true;
    }
    if (normalizeRight(contract.right) === 'P' && oi != null) {
      entry.putOi += oi;
      entry.putHasOi = true;
    }
    grouped.set(strike, entry);
  }

  let callWall = null;
  let putWall = null;

  const gexEntries = Array.from(gexByStrike.entries());
  const positiveCalls = gexEntries.filter(([, value]) => toNumber(value.call_gex) != null);
  const negativePuts = gexEntries.filter(([, value]) => toNumber(value.put_gex) != null);

  if (positiveCalls.length > 0) {
    callWall = positiveCalls.sort((left, right) => right[1].call_gex - left[1].call_gex)[0][0];
  }
  if (negativePuts.length > 0) {
    putWall = negativePuts.sort((left, right) => left[1].put_gex - right[1].put_gex)[0][0];
  }

  if (callWall == null || putWall == null) {
    const oiCandidates = Array.from(grouped.entries());
    if (callWall == null) {
      const bestCallOi = oiCandidates
        .filter(([, value]) => value.callHasOi)
        .sort((left, right) => right[1].callOi - left[1].callOi)[0];
      if (bestCallOi) {
        callWall = bestCallOi[0];
      }
    }
    if (putWall == null) {
      const bestPutOi = oiCandidates
        .filter(([, value]) => value.putHasOi)
        .sort((left, right) => right[1].putOi - left[1].putOi)[0];
      if (bestPutOi) {
        putWall = bestPutOi[0];
      }
    }
    if (callWall != null || putWall != null) {
      warnings.push('walls_from_oi_fallback');
    }
  }

  if (callWall == null) {
    missingFields.add('call_wall');
  }
  if (putWall == null) {
    missingFields.add('put_wall');
  }

  return {
    call_wall: callWall,
    put_wall: putWall
  };
}

function computeZeroGamma(gexByStrike, spot) {
  const ordered = Array.from(gexByStrike.entries())
    .map(([strike, values]) => ({
      strike: toNumber(strike),
      net_gex: toNumber(values.net_gex)
    }))
    .filter((item) => item.strike != null && item.net_gex != null)
    .sort((left, right) => left.strike - right.strike);

  const crossings = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    if (left.net_gex === 0) {
      crossings.push(left.strike);
      continue;
    }
    if (left.net_gex > 0 && right.net_gex < 0) {
      crossings.push(round((left.strike + right.strike) / 2, 2));
    }
    if (left.net_gex < 0 && right.net_gex > 0) {
      crossings.push(round((left.strike + right.strike) / 2, 2));
    }
  }

  if (crossings.length === 0) {
    return null;
  }
  if (spot == null) {
    return crossings[0];
  }

  return crossings.sort((left, right) => Math.abs(left - spot) - Math.abs(right - spot))[0];
}

function computeMaxPain(contracts, missingFields) {
  const strikes = uniqueSortedStrikes(contracts);
  if (strikes.length === 0) {
    missingFields.add('max_pain');
    return null;
  }

  const hasAnyOpenInterest = contracts.some((item) => toNumber(item.open_interest) != null);
  if (!hasAnyOpenInterest) {
    missingFields.add('max_pain');
    return null;
  }

  let bestStrike = null;
  let bestPayout = null;
  for (const candidate of strikes) {
    let totalPayout = 0;
    for (const contract of contracts) {
      const strike = toNumber(contract.strike);
      const oi = toNumber(contract.open_interest);
      if (strike == null || oi == null) {
        continue;
      }
      if (normalizeRight(contract.right) === 'C') {
        totalPayout += Math.max(candidate - strike, 0) * oi;
      } else if (normalizeRight(contract.right) === 'P') {
        totalPayout += Math.max(strike - candidate, 0) * oi;
      }
    }
    if (bestPayout == null || totalPayout < bestPayout) {
      bestPayout = totalPayout;
      bestStrike = candidate;
    }
  }

  if (bestStrike == null) {
    missingFields.add('max_pain');
  }
  return bestStrike;
}

function deriveDealerBehavior({ gammaRegime, spot, callWall, putWall, zeroGamma, warnings }) {
  if (gammaRegime === 'negative') {
    if (spot != null && callWall != null && spot > callWall) {
      warnings.push('upside_squeeze_risk');
    }
    if (spot != null && putWall != null && spot < putWall) {
      warnings.push('downside_expansion_risk');
    }
    return 'expand';
  }

  if (gammaRegime === 'positive' && spot != null && callWall != null && putWall != null && spot >= putWall && spot <= callWall) {
    return 'pin';
  }

  if (spot != null && zeroGamma != null && Math.abs(spot - zeroGamma) <= 10) {
    return 'mixed';
  }

  return 'unknown';
}

function deriveLeastResistancePath({ gammaRegime, spot, zeroGamma, callWall, putWall }) {
  if (gammaRegime === 'negative' && spot != null && zeroGamma != null) {
    return spot < zeroGamma ? 'down' : 'up';
  }
  if (gammaRegime === 'positive' && spot != null && callWall != null && putWall != null && spot >= putWall && spot <= callWall) {
    return 'range';
  }
  if (spot != null && callWall != null && Math.abs(spot - callWall) <= 10) {
    return 'range';
  }
  if (spot != null && putWall != null && Math.abs(spot - putWall) <= 10) {
    return 'range';
  }
  return 'unknown';
}

function deriveVannaCharmBias(contracts) {
  const values = contracts
    .flatMap((item) => [toNumber(item.vanna), toNumber(item.charm)])
    .filter((value) => value != null);

  if (values.length === 0) {
    return 'unknown';
  }

  const sum = values.reduce((total, value) => total + value, 0);
  if (sum > 0) {
    return 'bullish';
  }
  if (sum < 0) {
    return 'bearish';
  }
  return 'mixed';
}

function deriveThetaSignalFromDealer(dealer = {}) {
  if (dealer.gamma_regime === 'negative' || dealer.least_resistance_path === 'down') {
    return 'bearish_pressure';
  }
  if (dealer.gamma_regime === 'positive' && dealer.dealer_behavior === 'pin') {
    return 'income_supportive';
  }
  if (dealer.least_resistance_path === 'up') {
    return 'bullish_pullback';
  }
  return 'neutral';
}

export function pickThetaTestExpiration(expirations = [], requestedExpiration = null, now = new Date()) {
  if (requestedExpiration) {
    return requestedExpiration;
  }

  const normalized = expirations
    .filter(Boolean)
    .slice()
    .sort();
  if (normalized.length === 0) {
    return null;
  }

  const today = now.toISOString().slice(0, 10);
  if (normalized.includes(today)) {
    return today;
  }

  const upcoming = normalized.filter((item) => item >= today);
  return upcoming[0] ?? normalized[0];
}

export function resolveExternalSpotInput({
  fmpPrice = null,
  tradingviewPrice = null,
  marketSnapshotSpot = null,
  manualSpot = null
} = {}) {
  const fmp = toNumber(fmpPrice);
  if (fmp != null) {
    return { spot_source: 'fmp', spot: fmp };
  }

  const tv = toNumber(tradingviewPrice);
  if (tv != null) {
    return { spot_source: 'tradingview', spot: tv };
  }

  const marketSnapshot = toNumber(marketSnapshotSpot);
  if (marketSnapshot != null) {
    return { spot_source: 'market_snapshot', spot: marketSnapshot };
  }

  const manual = toNumber(manualSpot);
  if (manual != null) {
    return { spot_source: 'manual_test', spot: manual };
  }

  return {
    spot_source: 'unavailable',
    spot: null
  };
}

export function calculateThetaDealerSummary({
  ticker = 'SPX',
  status = 'live',
  spot_source = 'unavailable',
  spot = null,
  test_expiration = null,
  contracts = [],
  warnings: inputWarnings = [],
  source = 'thetadata_terminal'
} = {}) {
  const warnings = [...new Set((Array.isArray(inputWarnings) ? inputWarnings : []).filter(Boolean))];
  const missingFields = new Set();
  const normalizedSpot = toNumber(spot);
  const filteredContracts = Array.isArray(contracts)
    ? contracts
      .map((item) => ({
        ...item,
        strike: toNumber(item.strike),
        bid: toNumber(item.bid),
        ask: toNumber(item.ask),
        mark: toNumber(item.mark),
        last: toNumber(item.last),
        mid: midpoint(item),
        delta: toNumber(item.delta),
        gamma: toNumber(item.gamma),
        iv: toNumber(item.iv ?? item.implied_vol),
        open_interest: toNumber(item.open_interest),
        volume: toNumber(item.volume),
        vanna: toNumber(item.vanna),
        charm: toNumber(item.charm),
        right: normalizeRight(item.right)
      }))
      .filter((item) => item.strike != null && (item.right === 'C' || item.right === 'P'))
    : [];

  const sampleFields = {
    strike: filteredContracts.some((item) => item.strike != null),
    right: filteredContracts.some((item) => item.right != null),
    bid: filteredContracts.some((item) => item.bid != null),
    ask: filteredContracts.some((item) => item.ask != null),
    iv: filteredContracts.some((item) => item.iv != null),
    gamma: filteredContracts.some((item) => item.gamma != null),
    delta: filteredContracts.some((item) => item.delta != null),
    open_interest: filteredContracts.some((item) => item.open_interest != null),
    volume: filteredContracts.some((item) => item.volume != null),
    mid: filteredContracts.some((item) => item.mid != null)
  };

  if (!sampleFields.iv) {
    missingFields.add('iv');
  }
  if (!sampleFields.gamma) {
    missingFields.add('gamma');
  }
  if (!sampleFields.open_interest) {
    missingFields.add('open_interest');
  }
  if (!sampleFields.bid && !sampleFields.ask && !sampleFields.mid) {
    missingFields.add('bid_ask');
  }

  const expectedMove = computeExpectedMove(filteredContracts, normalizedSpot, missingFields);

  const gexByStrike = new Map();
  let callGex = 0;
  let putGex = 0;

  for (const contract of filteredContracts) {
    const strike = toNumber(contract.strike);
    if (strike == null) {
      continue;
    }
    const contribution = gexContribution(contract, normalizedSpot);
    const entry = gexByStrike.get(strike) ?? {
      call_gex: 0,
      put_gex: 0,
      net_gex: 0
    };

    if (contribution != null) {
      if (contract.right === 'C') {
        entry.call_gex += contribution;
        callGex += contribution;
      } else {
        entry.put_gex += contribution;
        putGex += contribution;
      }
      entry.net_gex = entry.call_gex + entry.put_gex;
      gexByStrike.set(strike, entry);
    } else if (!gexByStrike.has(strike)) {
      gexByStrike.set(strike, entry);
    }
  }

  const netGex = gexByStrike.size > 0 && normalizedSpot != null ? round(callGex + putGex, 2) : null;
  if (netGex == null) {
    missingFields.add('net_gex');
  }

  const gammaRegime = normalizedSpot == null ? 'unknown' : deriveGammaRegime(netGex);
  const wallMetrics = computeWallMetrics(filteredContracts, gexByStrike, warnings, missingFields);
  const zeroGamma = normalizedSpot == null ? null : computeZeroGamma(gexByStrike, normalizedSpot);
  if (zeroGamma == null) {
    missingFields.add('zero_gamma');
  }
  const maxPain = computeMaxPain(filteredContracts, missingFields);
  const vannaCharmBias = deriveVannaCharmBias(filteredContracts);
  if (vannaCharmBias === 'unknown') {
    missingFields.add('vanna_charm_bias');
  }

  let effectiveStatus = status;
  if (effectiveStatus === 'live' && normalizedSpot == null) {
    effectiveStatus = filteredContracts.length > 0 ? 'partial' : 'unavailable';
  }
  if (effectiveStatus === 'live' && filteredContracts.length === 0) {
    effectiveStatus = 'unavailable';
  }
  if (effectiveStatus === 'live' && (
    wallMetrics.call_wall == null ||
    wallMetrics.put_wall == null ||
    maxPain == null ||
    zeroGamma == null
  )) {
    warnings.push('dealer_levels_incomplete');
  }

  const dealerBehavior = effectiveStatus === 'live'
    ? deriveDealerBehavior({
      gammaRegime,
      spot: normalizedSpot,
      callWall: wallMetrics.call_wall,
      putWall: wallMetrics.put_wall,
      zeroGamma,
      warnings
    })
    : 'unknown';

  const leastResistancePath = effectiveStatus === 'live'
    ? deriveLeastResistancePath({
      gammaRegime,
      spot: normalizedSpot,
      zeroGamma,
      callWall: wallMetrics.call_wall,
      putWall: wallMetrics.put_wall
    })
    : 'unknown';

  const qualityState =
    effectiveStatus === 'live'
      ? warnings.includes('walls_from_oi_fallback') || missingFields.size > 0
        ? 'partial'
        : 'live'
      : effectiveStatus;

  return {
    source,
    status: effectiveStatus,
    last_update: new Date().toISOString(),
    ticker,
    spot_source,
    spot: normalizedSpot,
    test_expiration,
    dealer: {
      net_gex: netGex,
      call_gex: normalizedSpot == null ? null : round(callGex, 2),
      put_gex: normalizedSpot == null ? null : round(putGex, 2),
      gamma_regime: gammaRegime,
      dealer_behavior: dealerBehavior,
      least_resistance_path: leastResistancePath,
      call_wall: wallMetrics.call_wall,
      put_wall: wallMetrics.put_wall,
      max_pain: maxPain,
      zero_gamma: zeroGamma,
      expected_move_upper: expectedMove.expected_move_upper,
      expected_move_lower: expectedMove.expected_move_lower,
      vanna_charm_bias: vannaCharmBias
    },
    quality: {
      data_quality: qualityState,
      missing_fields: Array.from(missingFields),
      warnings: [...new Set(warnings)],
      calculation_scope: 'single_expiry_test',
      raw_rows_sent: false
    },
    metadata: {
      contracts_count: filteredContracts.length,
      calls_count: filteredContracts.filter((item) => item.right === 'C').length,
      puts_count: filteredContracts.filter((item) => item.right === 'P').length,
      sample_fields: sampleFields,
      atm_strike: expectedMove.atm_strike,
      theta_signal: deriveThetaSignalFromDealer({
        gamma_regime: gammaRegime,
        dealer_behavior: dealerBehavior,
        least_resistance_path: leastResistancePath
      })
    }
  };
}

export function buildDealerConclusionEngine({
  thetaSnapshot,
  externalSpot = null
} = {}) {
  const snapshot = thetaSnapshot ?? null;
  const status = snapshot?.status || 'unavailable';
  const dealer = snapshot?.dealer || {};
  const spot = toNumber(snapshot?.spot ?? externalSpot);
  const hasSpot = spot != null;
  const missingFields = Array.isArray(snapshot?.quality?.missing_fields)
    ? snapshot.quality.missing_fields
    : [];

  if (['unavailable', 'error', 'mock'].includes(status)) {
    return {
      source: 'theta',
      status,
      gamma_regime: 'unknown',
      dealer_behavior: 'unknown',
      least_resistance_path: 'unknown',
      call_wall: null,
      put_wall: null,
      max_pain: null,
      zero_gamma: null,
      expected_move_upper: null,
      expected_move_lower: null,
      vanna_charm_bias: 'unknown',
      plain_chinese: status === 'mock'
        ? 'ThetaData 仍是 mock，不可执行。'
        : 'ThetaData 目前不可用，只能展示，不可执行。'
    };
  }

  if (!hasSpot) {
    return {
      source: 'theta',
      status: status === 'live' ? 'partial' : status,
      gamma_regime: 'unknown',
      dealer_behavior: 'unknown',
      least_resistance_path: 'unknown',
      call_wall: toNumber(dealer.call_wall),
      put_wall: toNumber(dealer.put_wall),
      max_pain: toNumber(dealer.max_pain),
      zero_gamma: toNumber(dealer.zero_gamma),
      expected_move_upper: null,
      expected_move_lower: null,
      vanna_charm_bias: 'unknown',
      plain_chinese: 'ThetaData 已收到期权数据，但缺少 externalSpot，只能部分展示，不可执行。'
    };
  }

  if (status === 'partial' || status === 'stale') {
    return {
      source: 'theta',
      status,
      gamma_regime: dealer.gamma_regime || 'unknown',
      dealer_behavior: dealer.dealer_behavior || 'unknown',
      least_resistance_path: dealer.least_resistance_path || 'unknown',
      call_wall: toNumber(dealer.call_wall),
      put_wall: toNumber(dealer.put_wall),
      max_pain: toNumber(dealer.max_pain),
      zero_gamma: toNumber(dealer.zero_gamma),
      expected_move_upper: toNumber(dealer.expected_move_upper),
      expected_move_lower: toNumber(dealer.expected_move_lower),
      vanna_charm_bias: dealer.vanna_charm_bias || 'unknown',
      plain_chinese: 'ThetaData 仅为 partial/stale，关键位可展示，但不可执行。'
    };
  }

  const gammaRegime = dealer.gamma_regime || 'unknown';
  const behavior = dealer.dealer_behavior || 'unknown';
  const leastResistance = dealer.least_resistance_path || 'unknown';
  const callWall = toNumber(dealer.call_wall);
  const putWall = toNumber(dealer.put_wall);
  const maxPain = toNumber(dealer.max_pain);
  const zeroGamma = toNumber(dealer.zero_gamma);
  const expectedMoveUpper = toNumber(dealer.expected_move_upper);
  const expectedMoveLower = toNumber(dealer.expected_move_lower);
  const vannaCharmBias = dealer.vanna_charm_bias || 'unknown';

  return {
    source: 'theta',
    status: 'live',
    gamma_regime: gammaRegime,
    dealer_behavior: behavior,
    least_resistance_path: leastResistance,
    call_wall: callWall,
    put_wall: putWall,
    max_pain: maxPain,
    zero_gamma: zeroGamma,
    expected_move_upper: expectedMoveUpper,
    expected_move_lower: expectedMoveLower,
    vanna_charm_bias: vannaCharmBias,
    plain_chinese: gammaRegime === 'positive' && behavior === 'pin'
      ? 'Dealer 偏正 Gamma，倾向控波磨盘。'
      : gammaRegime === 'negative' && behavior === 'expand'
        ? 'Dealer 偏负 Gamma，倾向放大波动扩张。'
        : missingFields.length > 0
          ? 'Dealer 已部分计算完成，但关键位仍有缺失。'
          : 'Dealer 地图已生成，等待 TV 与风险门控共振。'
  };
}

export function mapThetaSnapshotToSourceStatus(thetaSnapshot) {
  const snapshot = thetaSnapshot ?? {};
  const status = snapshot.status || 'unavailable';
  const stale = status === 'stale';

  return {
    source: 'theta',
    state:
      status === 'live'
        ? 'real'
        : status === 'stale'
          ? 'delayed'
          : status === 'mock'
            ? 'mock'
            : status === 'error'
              ? 'error'
              : 'unavailable',
    stale,
    last_update: snapshot.last_update || null,
    message:
      status === 'live'
        ? 'ThetaData dealer snapshot live.'
        : status === 'partial'
          ? 'ThetaData dealer snapshot partial.'
          : status === 'stale'
            ? 'ThetaData dealer snapshot stale.'
            : status === 'mock'
              ? 'ThetaData dealer snapshot mock.'
              : status === 'error'
                ? 'ThetaData dealer snapshot error.'
                : 'ThetaData dealer snapshot unavailable.'
  };
}

export function deriveThetaExecutionConstraint(dealerConclusion = {}) {
  const blockedStatuses = new Set(['partial', 'stale', 'unavailable', 'error', 'mock']);
  const status = dealerConclusion.status || 'unavailable';
  const executable = !blockedStatuses.has(status);
  return {
    available: status === 'live' || status === 'partial' || status === 'stale',
    executable,
    reason: executable
      ? 'ThetaData dealer live.'
      : status === 'partial'
        ? 'ThetaData dealer partial，不可执行。'
        : status === 'stale'
          ? 'ThetaData dealer stale，不可执行。'
          : status === 'mock'
            ? 'ThetaData dealer mock，不可执行。'
            : 'ThetaData dealer unavailable/error，不可执行。'
  };
}

export function deriveThetaSignalFromSnapshot(thetaSnapshot = {}) {
  return thetaSnapshot?.metadata?.theta_signal || deriveThetaSignalFromDealer(thetaSnapshot?.dealer || {});
}
