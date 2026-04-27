function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildVolumePressure({ tvSentinel = {}, normalized = {} } = {}) {
  const snapshot = tvSentinel?.snapshot || normalized?.tradingview_snapshot || {};
  const direct = toNumber(snapshot.volume_ratio ?? snapshot.rvol ?? normalized.volume_ratio ?? normalized.rvol);
  const currentVolume = toNumber(snapshot.current_volume ?? normalized.current_volume);
  const averageVolume = toNumber(snapshot.avg_volume ?? snapshot.average_volume ?? normalized.avg_volume);
  const rvol = direct ?? (currentVolume != null && averageVolume > 0 ? currentVolume / averageVolume : null);

  if (rvol == null) {
    return {
      status: 'unavailable',
      rvol: null,
      level: 'unavailable',
      direction: 'unclear',
      plain_chinese: '量比不可用，不能用推动强度放行。'
    };
  }

  const level =
    rvol >= 2 ? 'impulse'
      : rvol >= 1.5 ? 'active'
        : rvol >= 1.2 ? 'warming'
          : rvol >= 0.8 ? 'normal'
            : 'low';
  const direction =
    snapshot.side === 'bullish' || tvSentinel.direction === 'bullish'
      ? 'up'
      : snapshot.side === 'bearish' || tvSentinel.direction === 'bearish'
        ? 'down'
        : 'unclear';

  return {
    status: 'live',
    rvol: Number(rvol.toFixed(2)),
    level,
    direction,
    plain_chinese:
      level === 'impulse'
        ? '量比强推动，禁止逆势抢反向。'
        : level === 'active'
          ? '量比主动推动，必须等待价格哨兵确认。'
          : level === 'warming'
            ? '量比开始升温，观察 A/B 候选。'
            : '量比未形成主动推动。'
  };
}

export function buildChannelShape({ volumePressure = {}, tvSentinel = {}, normalized = {} } = {}) {
  const event = tvSentinel.event_type || normalized.tv_event_type || normalized.tv_structure_event;
  let shape = 'unavailable';
  let direction = 'unclear';

  if (event === 'breakout_confirmed' || event === 'breakout_confirmed_pullback_ready') {
    shape = volumePressure.level === 'impulse' ? 'spiral' : 'expansion';
    direction = 'up';
  } else if (event === 'breakdown_confirmed') {
    shape = volumePressure.level === 'impulse' ? 'spiral' : 'expansion';
    direction = 'down';
  } else if (event === 'pullback_holding' || event === 'retest_failed') {
    shape = 'equal_step';
    direction = event === 'pullback_holding' ? 'up' : 'down';
  } else if (volumePressure.level === 'warming') {
    shape = 'compression';
    direction = 'range';
  } else if (volumePressure.status === 'live') {
    shape = 'chop';
    direction = 'range';
  }

  return {
    status: shape === 'unavailable' ? 'unavailable' : 'partial',
    shape,
    direction,
    plain_chinese:
      shape === 'spiral'
        ? '通道接近加速段，避免逆势。'
        : shape === 'expansion'
          ? '通道扩张，等待 TV 与风控匹配。'
          : shape === 'compression'
            ? '通道压缩，等待方向选择。'
            : shape === 'chop'
              ? '通道震荡，方向不清。'
              : '通道形态不可用。'
  };
}

export function buildVolatilityActivation({
  dealerConclusion = {},
  fmpConclusion = {},
  uwConclusion = {},
  volumePressure = {},
  channelShape = {},
  tvSentinel = {},
  externalSpot = {},
  normalized = {}
} = {}) {
  const warnings = [];
  const emUpper = toNumber(dealerConclusion.expected_move_upper);
  const emLower = toNumber(dealerConclusion.expected_move_lower);
  const spot = toNumber(externalSpot.spot ?? normalized.spot ?? normalized.external_spot);
  const atrRatio = toNumber(normalized.atr_ratio ?? normalized.current_atr_ratio);
  const hasExpectedMove = emUpper != null && emLower != null;
  const blocked = [];
  const allow = [];
  const triggers = [];
  const nearEmEdge = hasExpectedMove && spot != null && Math.min(Math.abs(spot - emUpper), Math.abs(spot - emLower)) <= 10;
  const outsideEm = hasExpectedMove && spot != null && (spot > emUpper || spot < emLower);

  let state = 'inactive';
  if (volumePressure.level === 'impulse' || channelShape.shape === 'spiral' || outsideEm || (atrRatio != null && atrRatio > 1.6)) {
    state = 'expansion';
    triggers.push('rvol/ATR/EM expansion');
  } else if (volumePressure.level === 'active' || tvSentinel.triggered === true || channelShape.shape === 'expansion' || nearEmEdge || (atrRatio != null && atrRatio >= 1.3)) {
    state = 'active';
    triggers.push('active volume or TV/EM edge');
  } else if (volumePressure.level === 'warming' || channelShape.shape === 'compression' || uwConclusion.volatility_light === 'yellow' || (atrRatio != null && atrRatio >= 1.1)) {
    state = 'warming';
    triggers.push('warming volume/ATR/compression');
  }

  if (fmpConclusion.event_risk === 'blocked') {
    blocked.push('all_setups');
  }
  if (state === 'active' || state === 'expansion' || dealerConclusion.gamma_regime === 'negative') {
    blocked.push('iron_condor');
    allow.push('single_leg_candidate', 'vertical_candidate');
  } else if (state === 'inactive' && dealerConclusion.gamma_regime === 'positive') {
    allow.push('range_observation');
  } else {
    allow.push('observe');
  }
  if (!hasExpectedMove) {
    warnings.push('expected_move_unavailable');
  }

  const unavailable = volumePressure.status === 'unavailable' && !hasExpectedMove;
  const finalState = unavailable ? 'unavailable' : state;
  const light =
    finalState === 'unavailable'
      ? 'unavailable'
      : finalState === 'expansion' || fmpConclusion.event_risk === 'blocked'
        ? 'red'
        : finalState === 'active' || finalState === 'warming'
          ? 'yellow'
          : 'green';
  const score =
    finalState === 'unavailable'
      ? 0
      : Math.max(0, Math.min(100, Math.round(
          (volumePressure.rvol ? Math.min(volumePressure.rvol * 20, 45) : 10)
          + (hasExpectedMove ? 20 : 0)
          + (finalState === 'expansion' ? 35 : finalState === 'active' ? 25 : finalState === 'warming' ? 15 : 0)
        )));
  const strengthLabel =
    finalState === 'unavailable'
      ? 'unavailable'
      : finalState === 'expansion'
        ? score >= 80 ? 'extreme' : 'strong'
        : finalState === 'active'
          ? 'active'
          : finalState === 'warming'
            ? 'lifting'
            : 'off';
  const directionalPermission =
    finalState === 'unavailable' || fmpConclusion.event_risk === 'blocked'
      ? 'block'
      : finalState === 'active' || finalState === 'expansion'
        ? 'wait'
        : 'wait';
  const ironCondorPermission =
    finalState === 'unavailable' || fmpConclusion.event_risk === 'blocked'
      ? 'block'
      : blocked.includes('iron_condor')
        ? 'block'
        : finalState === 'inactive' && dealerConclusion.gamma_regime === 'positive'
          ? 'wait'
          : 'block';

  return {
    state: finalState,
    strength: strengthLabel,
    legacy_strength: volumePressure.rvol ?? 0,
    light,
    score,
    single_leg_permission: directionalPermission,
    vertical_permission: directionalPermission,
    iron_condor_permission: ironCondorPermission,
    atr_ratio: atrRatio,
    triggers,
    direction: volumePressure.direction === 'up' ? 'up' : volumePressure.direction === 'down' ? 'down' : finalState === 'expansion' ? 'both' : 'unclear',
    allow: [...new Set(allow)],
    block: [...new Set(blocked)],
    plain_chinese:
      finalState === 'unavailable'
        ? '波动数据不可用，不能假装 volatility live。'
        : finalState === 'expansion'
        ? '波动扩张，只允许顺势候选，铁鹰禁做。'
        : finalState === 'active'
          ? '波动 active，允许方向候选观察，禁止铁鹰。'
          : finalState === 'warming'
            ? '波动升温，等 TV 哨兵匹配。'
            : '波动未启动，只观察。'
  };
}

export function buildMarketSentimentV1({
  fmpConclusion = {},
  uwConclusion = {}
} = {}) {
  if (uwConclusion.status === 'unavailable') {
    return {
      status: fmpConclusion.status === 'live' ? 'partial' : 'unavailable',
      state: fmpConclusion.market_bias || 'unavailable',
      strength: fmpConclusion.status === 'live' ? 35 : 0,
      plain_chinese: 'UW sentiment unavailable，市场情绪只保留 FMP 参考。'
    };
  }

  const fmpState = fmpConclusion.market_bias || 'unavailable';
  const uwState = uwConclusion.market_tide || 'unavailable';
  const state = fmpState === uwState && ['risk_on', 'risk_off'].includes(fmpState)
    ? fmpState
    : fmpState === 'unavailable' ? uwState : uwState === 'unavailable' ? fmpState : 'mixed';
  return {
    status: uwConclusion.status === 'live' && fmpConclusion.status === 'live' ? 'live' : 'partial',
    state,
    strength: state === 'mixed' ? 40 : state === 'unavailable' ? 0 : 65,
    plain_chinese: state === 'mixed'
      ? 'FMP 与 UW 情绪不一致，setup 降级等待。'
      : `市场情绪 ${state}，只能作为 setup 加权。`
  };
}

export function buildInstitutionalEntryAlert({
  uwConclusion = {},
  volumePressure = {},
  volatilityActivation = {},
  tvSentinel = {}
} = {}) {
  const state = uwConclusion.institutional_entry || 'unavailable';
  if (uwConclusion.status === 'unavailable' || state === 'unavailable') {
    return {
      status: 'unavailable',
      state: 'unavailable',
      side: 'unavailable',
      confidence: 0,
      plain_chinese: '机构入场信号不可用。'
    };
  }
  const side = uwConclusion.flow_bias === 'bullish' || uwConclusion.flow_bias === 'bearish'
    ? uwConclusion.flow_bias
    : 'mixed';
  const bombing = state === 'bombing'
    && volumePressure.rvol >= 1.5
    && ['active', 'expansion'].includes(volatilityActivation.state);
  const confidence = bombing ? 75 : state === 'building' && volumePressure.rvol >= 1.2 ? 55 : 30;
  return {
    status: uwConclusion.status === 'live' ? 'live' : 'partial',
    state: tvSentinel.direction && side !== 'mixed' && tvSentinel.direction !== side ? 'conflict' : state,
    side,
    confidence,
    plain_chinese: tvSentinel.matched_allowed_setup
      ? '机构信号已有 TV 哨兵配合，但仍需硬门槛。'
      : '机构可能进场，等待价格哨兵。'
  };
}
