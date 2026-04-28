function baseLayer(overrides = {}) {
  return {
    status: 'unavailable',
    bias: 'unknown',
    confidence: 0,
    score: 0,
    usable_for_analysis: false,
    usable_for_operation: false,
    supports_bullish: false,
    supports_bearish: false,
    blocks_operation: true,
    summary_cn: '未提供。',
    evidence_cn: [],
    missing_fields: [],
    current_block: '',
    next_fix: '',
    ...overrides
  };
}

function buildDealerLayer(dealer = {}) {
  const hasData = dealer.has_data === true || dealer.greek_exposure_has_data === true;
  const diagnostics = dealer.dealer_diagnostics || {};
  const likelyCause = diagnostics.likely_cause || 'unknown';
  return baseLayer({
    status: hasData ? 'partial' : 'unavailable',
    bias: 'unknown',
    confidence: hasData ? 30 : 0,
    usable_for_analysis: hasData,
    blocks_operation: true,
    summary_cn: hasData ? `做市商数据已经接通，但墙位还不能用。原因：${likelyCause}。` : '做市商数据未接通。',
    evidence_cn: hasData
      ? [
          'UW 返回了真实 Gamma / Vanna / Charm 字段。',
          `当前 spot_price=${diagnostics.spot_price ?? dealer.spot_price ?? '--'}，请求区间 ${diagnostics.requested_min_strike ?? '--'} 到 ${diagnostics.requested_max_strike ?? '--'}，rows_near_spot=${diagnostics.rows_near_spot ?? dealer.rows_near_spot ?? 0}。`,
          `pages_checked=${diagnostics.pages_checked ?? '--'}，SPX near spot=${diagnostics.spx_has_near_spot === true ? '是' : '否'}，SPY proxy near spot=${diagnostics.spy_proxy_has_near_spot === true ? '是' : '否'}。`,
          '所以 Call Wall / Put Wall / Gamma Flip 暂不能计算。'
        ]
      : [],
    missing_fields: dealer.missing_fields || ['有效 strike 区间', 'Call Wall', 'Put Wall', 'Gamma Flip'],
    current_block: `strike 区间和现价不匹配，likely_cause=${likelyCause}，Dealer 只能做背景，不能给目标位。`,
    next_fix: diagnostics.next_fix || '确认 SPX / SPY ticker 映射、strike 单位和 spot_gex 过滤区间。'
  });
}

function buildFlowLayer(flow = {}) {
  const hasData = flow.has_data === true;
  const bearishHint = hasData && flow.contract_type === 'put' && Number(flow.ask_side_premium) > 0;
  return baseLayer({
    status: hasData ? 'partial' : 'unavailable',
    bias: bearishHint ? 'bearish_hint' : 'mixed',
    confidence: hasData ? 55 : 0,
    usable_for_analysis: hasData,
    supports_bearish: bearishHint,
    blocks_operation: true,
    summary_cn: hasData
      ? '资金流已经接通，目前有 Put ask-side RepeatedHits，属于偏空线索，但还不能确认强空。'
      : '资金流数据未接通。',
    evidence_cn: hasData
      ? [
          `UW Flow 出现 ${flow.alert_rule || '--'}。`,
          `合约类型是 ${flow.contract_type || '--'}。`,
          `ask-side premium 约 ${flow.ask_side_premium ?? '--'}，trade_count=${flow.trade_count ?? '--'}。`,
          '但 ask/bid 官方语义、0DTE 和多腿比例还没有完全确认。'
        ]
      : [],
    missing_fields: flow.missing_fields || ['ask/bid 官方语义', '0DTE 标记', '多腿比例'],
    current_block: '只能作为偏空资金线索，不能直接放行 Put。',
    next_fix: '确认 ask/bid 语义，并补齐 0DTE、多腿比例、Volume/OI。'
  });
}

function buildVolatilityConclusionLayer(volatility = {}) {
  const hasData = volatility.has_data === true;
  const state = volatility.volatility_state || {};
  const formulaReady = state.formula_ready === true;
  const dataReady = state.data_ready === true;
  return baseLayer({
    status: hasData ? 'partial' : 'unavailable',
    bias: 'unknown',
    confidence: hasData ? 40 : 0,
    usable_for_analysis: hasData,
    blocks_operation: true,
    summary_cn: formulaReady && dataReady
      ? `Vscore=${state.vscore}，分类=${state.classification}。`
      : formulaReady
        ? 'Vscore 公式已就绪，等数据进入即可计算。'
        : hasData
          ? '波动率数据已经接通并展开，但还没形成完整打法结论。'
          : '波动率数据未接通。',
    evidence_cn: hasData
      ? [
          'Vscore = IVR * 0.3 + IVP * 0.7。',
          `formula_ready=${formulaReady ? 'true' : 'false'}，parser_ready=${state.parser_ready === true ? 'true' : 'false'}，data_ready=${dataReady ? 'true' : 'false'}。`,
          dataReady ? `IVR=${state.iv_rank_normalized}，IVP=${state.iv_percentile_normalized}。` : '等待 IV Rank / IV Percentile 同时进入。'
        ]
      : [],
    missing_fields: volatility.missing_fields || ['IV Rank', 'IV Percentile', 'Interpolated IV', '0DTE Implied Move'],
    current_block: formulaReady && !dataReady ? '公式已就绪，等数据进入即可计算。' : '波动率只能说明数据已接入，暂不能判断单腿是否划算。',
    next_fix: '把 iv_rank_1y、percentile、term_structure、implied_move 映射成 volatility_state。'
  });
}

function buildDarkpoolConclusionLayer(darkpool = {}) {
  const hasData = darkpool.has_data === true || Number(darkpool.prints_count) > 0;
  const tier = darkpool.tier || 'none';
  return baseLayer({
    status: hasData ? 'partial' : 'unavailable',
    bias: 'neutral',
    confidence: hasData ? 40 : 0,
    usable_for_analysis: hasData,
    blocks_operation: true,
    summary_cn: hasData ? '有低置信空间参考，但不能作为墙位。' : '暗池数据未接通。',
    evidence_cn: hasData
      ? [
          `当前暗池样本来自 ${darkpool.source_ticker || 'SPY'}，可作为 SPX 的参考 proxy。`,
          `当前档位 ${tier} / ${darkpool.tier_cn || '零星脚印'} / 低置信参考。`,
          `mapped_spx=${darkpool.mapped_spx ?? '--'}，distance_pct=${darkpool.distance_pct ?? '--'}。`
        ]
      : [],
    missing_fields: darkpool.missing_fields || ['nearest_support', 'nearest_resistance', 'SPX 支撑压力映射'],
    current_block: hasData ? '有低置信空间参考，但不能作为墙位。' : '暗池 raw 暂无可用样本。',
    next_fix: '生成 price_bins、nearest_support、nearest_resistance、largest_level。'
  });
}

function buildSentimentLayer(sentiment = {}) {
  const hasData = sentiment.has_data === true || sentiment.status === 'partial';
  return baseLayer({
    status: hasData ? 'partial' : 'unavailable',
    bias: 'mixed',
    confidence: hasData ? 40 : 0,
    score: typeof sentiment.sentiment_score === 'number' ? sentiment.sentiment_score : 0,
    usable_for_analysis: hasData,
    blocks_operation: true,
    summary_cn: hasData ? '市场情绪略偏防守，但没有形成强单边。' : '市场情绪数据未接通。',
    evidence_cn: hasData
      ? [
          'Market Tide 已接通。',
          'Put premium 略高于 Call premium，但差距很小。',
          'NOPE、ETF Tide、Sector Tide 还没完成映射。'
        ]
      : [],
    missing_fields: sentiment.missing_fields || ['NOPE', 'ETF Tide', 'Sector Tide'],
    current_block: '只能做情绪背景，不能直接判断 risk-on / risk-off。',
    next_fix: '补 NOPE、ETF Tide、Sector Tide，并确认 Market Tide 的适用范围。'
  });
}

function buildDataHealthLayer(dataHealth = {}) {
  const live = dataHealth.provider_live === true || dataHealth.status === 'live';
  return baseLayer({
    status: live ? 'live' : dataHealth.status || 'unavailable',
    bias: 'neutral',
    confidence: live ? 80 : 20,
    usable_for_analysis: live,
    blocks_operation: false,
    summary_cn: live ? 'UW API 主源已经接通，当前不是 mock。' : 'UW API 主源未完全接通。',
    evidence_cn: [
      `provider ${dataHealth.status || 'unavailable'}。`,
      `is_mock=${dataHealth.is_mock === true ? 'true' : 'false'}。`,
      '失败 endpoint 已记录。'
    ],
    missing_fields: dataHealth.missing_fields || [],
    current_block: '主要问题不是 API 连接，而是部分字段和结论映射未完成。',
    next_fix: '继续把 missing_fields_by_layer 用于 Radar 和首页降级提示。'
  });
}

export function buildUwLayerConclusions({
  uw_normalized = {},
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
  const gex_engine = buildDealerLayer(uw_normalized.dealer || {});
  const flow_aggression_engine = buildFlowLayer(uw_normalized.flow || {});
  const volatility_engine = buildVolatilityConclusionLayer(uw_normalized.volatility || {});
  const darkpool_engine = buildDarkpoolConclusionLayer(uw_normalized.darkpool || {});
  const market_sentiment_engine = buildSentimentLayer(uw_normalized.sentiment || {});
  const data_health_engine = buildDataHealthLayer(uw_normalized.data_health || { status: uw_provider.status, provider_live: uw_provider.status === 'live', is_mock: uw_provider.is_mock });
  const master_synthesis = {
    state: 'insufficient_data_wait',
    bias: flow_aggression_engine.bias === 'bearish_hint' ? 'bearish_hint' : flow_aggression_engine.bias === 'bullish_hint' ? 'bullish_hint' : 'mixed',
    confidence: 45,
    summary_cn: '当前有偏空资金线索，但 Dealer 墙位、波动率打法、暗池空间和 TV 触发都不完整，只能等待。',
    why_cn: [
      'Flow 有 Put RepeatedHits，说明空头资金有线索。',
      'Dealer 墙位不可用，不能给目标位。',
      'Volatility 还没形成打法结论。',
      'Dark Pool 没有明确支撑压力。',
      'Sentiment 只是轻微防守，不是强空。',
      '操作卡不能 ready。'
    ],
    blocks_operation: true
  };

  return {
    dealer: gex_engine,
    flow: flow_aggression_engine,
    volatility: volatility_engine,
    darkpool: darkpool_engine,
    sentiment: market_sentiment_engine,
    data_health: data_health_engine,
    master: master_synthesis,
    gex_engine,
    flow_aggression_engine,
    volatility_engine,
    darkpool_engine,
    market_sentiment_engine,
    data_health_engine,
    master_synthesis
  };
}
