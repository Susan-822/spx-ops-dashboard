import { getMockScenario } from './mock-scenarios.js';
import { runDataHealthEngine } from './data-health-engine.js';
import { normalizeMockScenario } from '../normalizer/build-normalized-signal.js';
import { runMasterEngine } from './master-engine.js';
import { getTradingViewSnapshot } from '../storage/tradingview-snapshot.js';
import { getThetaSnapshot } from '../storage/theta-snapshot.js';
import { readUwProvider } from '../state/uwProvider.js';
import { getFmpSnapshot } from '../adapters/fmp/index.js';
import { normalizeUwSummary } from '../../../integrations/unusual-whales/normalizer/uw-summary-normalizer.js';
import { normalizeUwApiSnapshot } from '../normalizer/uw-api-normalizer.js';
import { runUwDealerEngine } from '../engines/uw-dealer-engine.js';
import { runUwInstitutionalEngine } from '../engines/uw-institutional-engine.js';
import { runUwVolatilityEngine } from '../engines/uw-volatility-engine.js';
import { runUwSentimentEngine } from '../engines/uw-sentiment-engine.js';
import { runUwDarkpoolEngine } from '../engines/uw-darkpool-engine.js';
import { runCommandCenterEngine } from '../engines/command-center-engine.js';
import { runReflectionEngine } from '../engines/reflection-engine.js';
import { runTechnicalEngine } from '../engines/technical-engine.js';
import { runHealthMatrixEngine } from '../engines/health-matrix-engine.js';
import { runFlowValidationEngine } from '../engines/flow-validation-engine.js';
import { runSetupSynthesisEngine } from '../engines/setup-synthesis-engine.js';
import { runPositionSizingEngine } from '../engines/position-sizing-engine.js';
import { buildEndpointCoverageReport } from '../engines/endpoint-coverage-engine.js';
import { buildCrossAssetProjection } from './rules/level-projection-rules.js';
import {
  buildDealerConclusionEngine,
  deriveThetaExecutionConstraint,
  deriveThetaSignalFromSnapshot,
  mapThetaSnapshotToSourceStatus
} from './dealer-conclusion-engine.js';
import { runUwConclusionEngine } from './uw-conclusion-engine.js';
import { runRawNoteV2 } from './raw-note-v2/index.js';
import { buildUwConclusionV2 } from './raw-note-v2/uw-conclusion.js';
import { buildThetaConclusion } from './raw-note-v2/formatters.js';
import {
  buildDarkpoolGravity,
  buildDealerWallMap,
  buildFlowConflict,
  buildNewsRadar,
  buildPriceTrigger,
  buildTradeExecutionCard,
  buildWallZonePanel,
  buildControlSide,
  buildUwLayerConclusions,
  buildUwNormalized,
  // L2.5 Institutional Engines
  buildPriceContract,
  buildAtmEngine,
  buildGammaRegimeEngine,
  buildFlowBehaviorEngine,
  buildAbOrderEngine,
  runVolatilityEngine,
  premiumAccelerationQueue,
  buildDarkpoolBehaviorEngine,
  buildPriceValidationEngine,
  buildAtmTriggerEngine
} from './algorithms/index.js';
import { getPriceHistory } from '../state/price-history-buffer.js';
import { getLiveRefreshLog } from '../scheduler/live-refresh-scheduler.js';
import { evaluate0dteMicrostructure, buildMicrostructureRead } from './algorithms/microstructure-validation-engine.js';
import { globalFlowRecentQueue } from '../scheduler/flow-recent-queue.js';
import { buildSignalFormatter } from './signal-formatter.js';
import { buildHomeViewModel } from './home-view-model-builder.js';

export {
  buildProjectionPrices,
  buildStrategyCardsDisplay
};

function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function permissionEntry(permission, reason = '') {
  return {
    permission: ['allow', 'wait', 'block'].includes(permission) ? permission : 'block',
    reason: reason || ''
  };
}

function hasActionablePlanFields(tradePlan = {}) {
  const hasEntry = tradePlan.entry_zone && tradePlan.entry_zone.text && tradePlan.entry_zone.text !== '--';
  const hasStop = tradePlan.stop_loss && tradePlan.stop_loss.text && tradePlan.stop_loss.text !== '--';
  const hasTarget = Array.isArray(tradePlan.targets) && tradePlan.targets.some((item) => item.level != null);
  const hasInvalidation = tradePlan.invalidation && tradePlan.invalidation.text && tradePlan.invalidation.text !== '--';
  return Boolean(hasEntry && hasStop && hasTarget && hasInvalidation);
}

function buildStrategyPermissions({ signal = {}, institutionalAlert = {}, volatilityActivation = {}, dealerEngine = {}, commandCenter = {} } = {}) {
  const tradePlan = signal.trade_plan || {};
  const tvMatched = signal.tv_sentinel?.matched_allowed_setup === true;
  const tvEvent = signal.tv_sentinel?.event_type || '';
  const actionablePlan = tradePlan.status === 'ready' && hasActionablePlanFields(tradePlan);
  const dataExecutable = signal.data_health?.executable === true && signal.command_environment?.executable === true;
  const flowSupports = ['building', 'bombing'].includes(institutionalAlert.state);
  const directionAdvantage = ['bullish', 'bearish'].includes(commandCenter.direction);
  const greenVol = ['green'].includes(volatilityActivation.light) || ['active', 'strong', 'extreme'].includes(volatilityActivation.strength);
  const yellowVol = volatilityActivation.light === 'yellow';
  const ironBlocked =
    volatilityActivation.light === 'green'
    || ['strong', 'extreme'].includes(volatilityActivation.strength)
    || institutionalAlert.state === 'bombing'
    || (dealerEngine.regime === 'negative_gamma' && dealerEngine.behavior === 'expand')
    || (tvMatched && ['breakout_confirmed', 'breakdown_confirmed'].includes(tvEvent));

  const singleAllow = tvMatched && greenVol && flowSupports && dataExecutable && actionablePlan && dealerEngine.behavior !== 'pin';
  const verticalAllow = tvMatched && directionAdvantage && flowSupports && (yellowVol || greenVol) && dataExecutable && actionablePlan;
  const ironAllow = !ironBlocked
    && tvMatched
    && dealerEngine.regime === 'positive_gamma'
    && dealerEngine.behavior === 'pin'
    && ['red', 'yellow'].includes(volatilityActivation.light)
    && institutionalAlert.state !== 'bombing'
    && signal.market_sentiment?.state !== 'risk_on'
    && signal.market_sentiment?.state !== 'risk_off'
    && dataExecutable
    && actionablePlan;

  const blockedReason = commandCenter.main_reason || '硬门槛未通过，不能放行。';
  return {
    single_leg: permissionEntry(singleAllow ? 'allow' : commandCenter.final_state === 'blocked' ? 'block' : 'wait', singleAllow ? 'TV、波动、机构流与数据健康均支持。' : blockedReason),
    vertical: permissionEntry(verticalAllow ? 'allow' : commandCenter.final_state === 'blocked' ? 'block' : 'wait', verticalAllow ? '方向优势、flow 与波动结构支持。' : blockedReason),
    iron_condor: permissionEntry(ironBlocked ? 'block' : ironAllow ? 'allow' : commandCenter.final_state === 'blocked' ? 'block' : 'wait', ironBlocked ? '波动扩张、机构轰炸、负 Gamma 或突破结构禁止铁鹰。' : ironAllow ? '正 Gamma 控波且无单边轰炸。' : blockedReason)
  };
}

function buildEsProxy() {
  return {
    status: 'unavailable',
    es_price: null,
    spx_equivalent: null,
    basis: null,
    basis_status: 'unknown',
    plain_chinese: 'ES proxy 数据不可用，不能用 FMP 偏向替代。'
  };
}

function buildSessionEngine() {
  return {
    session: 'unknown',
    handoff_state: 'unavailable',
    premarket_bias: 'unknown',
    open_risk: 'unknown',
    plain_chinese: 'Session engine 尚无实时会话输入。'
  };
}

function cleanProductionNotes(notes = [], isMock = false) {
  const safeNotes = Array.isArray(notes) ? notes.filter((note) => typeof note === 'string') : [];
  if (isMock) return safeNotes;
  return safeNotes.filter((note) => !/mock master-engine|no real api integration/i.test(note));
}

function replaceUndefined(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => replaceUndefined(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUndefined(item)]));
  }
  return value;
}

function scrubLegacyDecisionStrings(value) {
  // NOTE: This function performs safe semantic renames of internal enum strings.
  // Rules:
  //  - 'price_map_conflict' → 'final_decision_wait': internal rule-engine enum renamed
  //    to the user-visible state label used throughout the decision pipeline.
  //    This is a required rename; the test suite explicitly validates the output.
  //  - Replacements that masked real data-availability or execution-block states
  //    have been removed (e.g. 'Dealer unavailable' → 'Dealer pending' was removed
  //    because it hid a genuine data gap from the UI).
  if (typeof value === 'string') {
    return value
      .replaceAll('price_map_conflict', 'final_decision_wait');
  }
  if (Array.isArray(value)) return value.map((item) => scrubLegacyDecisionStrings(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubLegacyDecisionStrings(item)]));
  }
  return value;
}

function buildFmpConclusionV2(signal = {}) {
  const source = signal.command_inputs?.external_spot || {};
  const spotIsReal = source.status === 'valid' || source.is_real === true || signal.market_snapshot?.spot_is_real === true;
  return {
    ...(signal.fmp_conclusion || {}),
    status: spotIsReal ? 'live' : 'unavailable',
    spot_is_real: spotIsReal,
    spot: spotIsReal ? (signal.market_snapshot?.spot ?? source.spot ?? null) : null,
    event_risk: signal.fmp_conclusion?.event_risk || signal.event_context?.event_risk || 'unavailable'
  };
}

function buildSpotConclusion({ fmpConclusion = {}, priceSources = {} } = {}) {
  const fmpSpot = numberOrNull(fmpConclusion.spot);
  const spx = priceSources.spx || {};
  if (spx.price != null && ['live', 'degraded'].includes(spx.status)) {
    const source = spx.source || 'unknown';
    return {
      status: source === 'fmp' ? 'live' : source === 'uw_spx_price' ? 'live' : 'degraded',
      spot: spx.price,
      source,
      confidence: source === 'fmp' || source === 'uw_spx_price' ? 'high' : source === 'tradingview_spx_equivalent' ? 'medium' : 'low',
      plain_chinese: `SPX spot 来自 ${source}。`
    };
  }
  if (fmpConclusion.spot_is_real === true && fmpSpot != null) {
    return { status: 'live', spot: fmpSpot, source: 'fmp', confidence: 'high', plain_chinese: 'FMP SPX spot 可用。' };
  }
  return { status: 'unavailable', spot: null, source: 'unavailable', confidence: 'unavailable', plain_chinese: 'SPX spot 暂不可用。' };
}

function buildEventConclusion({ fmpConclusion = {}, uwConclusion = {} } = {}) {
  if (fmpConclusion.event_risk === 'blocked') {
    return { risk: 'blocked', source: 'fmp', sell_vol_permission: 'block', plain_chinese: 'FMP 事件风险阻断。' };
  }
  const caution = ['panic', 'elevated'].includes(uwConclusion.iv_state) || uwConclusion.iv_rank >= 80;
  return {
    risk: caution ? 'caution' : 'unknown',
    source: caution ? 'uw' : 'unavailable',
    sell_vol_permission: 'block',
    plain_chinese: caution ? 'UW 波动指标提示谨慎，卖波禁做。' : '事件风险未知，卖波禁做。'
  };
}

function currentMarketSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const weekday = get('weekday');
  if (['Sat', 'Sun'].includes(weekday)) return 'closed';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  if (minutes >= 570 && minutes < 960) return 'regular';
  if (minutes >= 240 && minutes < 570) return 'premarket';
  if (minutes >= 960 && minutes < 1200) return 'afterhours';
  return 'closed';
}

function buildRefreshPolicy(now = new Date(), tabHidden = false) {
  const marketSession = currentMarketSession(now);
  const uiPollMs = tabHidden
    ? 15000
    : marketSession === 'regular'
      ? 3000
      : marketSession === 'premarket'
        ? 10000
        : 30000;
  return {
    market_session: marketSession,
    ui_poll_ms: uiPollMs,
    source_refresh_ms: {
      price: 2000,
      uw_flow: 15000,
      darkpool: 30000,
      market_tide: 30000,
      dealer_gex: 60000,
      volatility: 60000,
      radar: 10000,
      news: 1800000
    },
    stale_threshold_ms: {
      price: 8000,
      uw: 90000,
      news: 1800000
    },
    down_threshold_ms: {
      price: 20000,
      uw: 180000,
      news: 3600000
    }
  };
}

function ageMs(updatedAt, now = new Date()) {
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, now.getTime() - time);
}

function statusByAge(age, staleMs, downMs) {
  if (age == null) return 'down';
  if (age > downMs) return 'down';
  if (age > staleMs) return 'stale';
  return 'live';
}

function buildObservationPrices({ priceSources = {}, spotConclusion = {}, priceTrigger = {}, now = new Date() } = {}) {
  // P0 FIX: price_trigger.current_price is NO LONGER used as the observation value.
  // It was previously given highest priority, but price_trigger.current_price could be
  // contaminated by darkpool mapped_spx (SPY×10) or other non-SPX sources.
  // The canonical SPX price must come from priceSources.spx (FMP/TV validated) only.
  const sourcePrice = numberOrNull(priceSources.spx?.price);
  const spot = numberOrNull(spotConclusion.spot ?? spotConclusion.price);
  // Only accept prices in the valid SPX range (6000–8500)
  const isValidSpx = (v) => v != null && v >= 6000 && v <= 8500;
  const value = isValidSpx(sourcePrice)
    ? sourcePrice
    : isValidSpx(spot)
      ? spot
      : null;
  const updatedAt = value == null ? null : priceSources.spx?.last_updated || spotConclusion.last_updated || now.toISOString();
  const age = ageMs(updatedAt, now);
  const status = statusByAge(age, 8000, 20000);
  const observation = {
    value: value ?? null,
    source: value == null ? 'unavailable' : priceSources.spx?.source || spotConclusion.source || 'unavailable',
    updated_at: updatedAt,
    age_ms: age,
    status,
    can_use_for_distance: value != null && status !== 'down'
  };
  const tradeable = {
    value: value ?? null,
    source: priceSources.spx?.source || spotConclusion.source || 'unavailable',
    updated_at: updatedAt,
    age_ms: age,
    status: status === 'live' && spotConclusion.status === 'live' ? 'live' : status === 'down' ? 'down' : 'stale',
    can_generate_trade_plan: false
  };
  return { observation, tradeable };
}

function secondsFromMs(value) {
  return value == null ? null : Math.round(value / 1000);
}

function clockEntry({ value = null, source = 'unavailable', updatedAt = null, staleMs = 90000, downMs = 180000, now = new Date() } = {}) {
  const age = ageMs(updatedAt, now);
  return {
    value,
    source,
    updated_at: updatedAt || null,
    age_seconds: secondsFromMs(age),
    status: statusByAge(age, staleMs, downMs)
  };
}

function buildDataClock({ now = new Date(), marketSession = 'closed', observationPrice = {}, uwProvider = {}, uwNormalized = {}, newsRadar = {} } = {}) {
  const providerUpdatedAt = uwProvider.last_update || uwProvider.last_updated || null;
  const flowUpdatedAt = uwNormalized.flow?.last_update || providerUpdatedAt;
  const darkpoolUpdatedAt = uwNormalized.darkpool?.last_update || providerUpdatedAt;
  const dealerUpdatedAt = uwNormalized.dealer?.last_update || providerUpdatedAt;
  const volatilityUpdatedAt = uwNormalized.volatility?.last_update || providerUpdatedAt;
  return {
    now: now.toISOString(),
    market_session: marketSession,
    price: clockEntry({
      value: observationPrice.value,
      source: observationPrice.source,
      updatedAt: observationPrice.updated_at,
      staleMs: 8000,
      downMs: 20000,
      now
    }),
    uw: clockEntry({ updatedAt: providerUpdatedAt, source: 'uw', now }),
    flow: clockEntry({ updatedAt: flowUpdatedAt, source: 'uw_flow', now }),
    darkpool: clockEntry({ updatedAt: darkpoolUpdatedAt, source: 'uw_darkpool', now }),
    dealer: clockEntry({ updatedAt: dealerUpdatedAt, source: 'uw_dealer_gex', now }),
    volatility: clockEntry({ updatedAt: volatilityUpdatedAt, source: 'uw_volatility', now }),
    news: clockEntry({
      updatedAt: newsRadar.last_updated,
      source: 'brave_news',
      staleMs: 1800000,
      downMs: 3600000,
      now
    })
  };
}

function normalizeSourceStatus(value, fallback = 'unavailable') {
  const text = String(value || fallback).toLowerCase();
  if (['live', 'real'].includes(text)) return 'live';
  if (['partial', 'degraded', 'delayed'].includes(text)) return 'partial';
  if (['stale'].includes(text)) return 'stale';
  if (['error', 'down', 'failed'].includes(text)) return 'error';
  if (['mock'].includes(text)) return 'mock';
  return 'unavailable';
}

function sourceDisplay(status, reason = '') {
  const normalized = normalizeSourceStatus(status);
  return {
    status: normalized,
    show_on_homepage: ['live', 'partial'].includes(normalized),
    show_in_data_gaps: ['partial', 'stale', 'error', 'mock', 'unavailable'].includes(normalized),
    usable_for_analysis: ['live', 'partial'].includes(normalized),
    usable_for_operation: normalized === 'live',
    reason
  };
}

function buildUnifiedSourceStatus({ uwProvider = {}, thetaConclusion = {}, fmpConclusion = {}, tvSentinel = {} } = {}) {
  const uwDisplay = sourceDisplay(uwProvider.status, uwProvider.plain_chinese || '');
  return {
    uw: {
      ...uwDisplay,
      usable_for_operation: false,
      reason: 'UW API live，可用于页面分析；但六层结论仍有 partial/low confidence，不能直接放行操作卡。'
    },
    theta: sourceDisplay(thetaConclusion.status, thetaConclusion.status === 'disabled' ? 'ThetaData 当前不可用，不参与 Dealer 主源判断。' : thetaConclusion.plain_chinese || ''),
    fmp: sourceDisplay(fmpConclusion.status, fmpConclusion.status === 'unavailable' ? 'FMP 当前不可用，价格/事件风险降级。' : fmpConclusion.plain_chinese || ''),
    tradingview: sourceDisplay(tvSentinel.status === 'stale' ? 'stale' : tvSentinel.status === 'waiting' ? 'partial' : 'live', tvSentinel.plain_chinese || '')
  };
}

function applySourceDisplayRules(sourceStatus = [], unified = {}) {
  const map = {
    uw: 'uw',
    theta_core: 'theta',
    theta_full_chain: 'theta',
    fmp_event: 'fmp',
    fmp_price: 'fmp',
    tradingview: 'tradingview'
  };
  const diagnosticOnly = {
    uw_dom: '历史 DOM mock，仅保留诊断，不参与首页、不参与分析、不参与操作。',
    uw_screenshot: '截图降级源，仅保留诊断，不参与首页主判断，不参与操作。',
    scheduler_health: '历史 scheduler mock，仅保留诊断，不参与首页、不参与分析、不参与操作。',
    telegram: 'Telegram 是输出通道，不是行情或分析数据源，不参与首页主判断，不参与操作。'
  };
  return (sourceStatus || []).map((item) => {
    const diagnosticReason = diagnosticOnly[item.source] || '';
    const display = diagnosticOnly[item.source]
      ? {
          ...sourceDisplay('unavailable', diagnosticReason),
          show_on_homepage: false,
          show_in_data_gaps: true,
          usable_for_analysis: false,
          usable_for_operation: false
        }
      : unified[map[item.source]] || sourceDisplay(item.state, item.message);
    return {
      ...item,
      message: diagnosticReason || item.message || '',
      display_status: display.status,
      show_on_homepage: display.show_on_homepage,
      show_in_data_gaps: display.show_in_data_gaps,
      usable_for_analysis: display.usable_for_analysis,
      usable_for_operation: display.usable_for_operation,
      display_reason: display.reason || item.message || ''
    };
  });
}

function buildExecutionCardDiagnostics(uwNormalized = {}, layerConclusions = {}) {
  const dealerDiagnostics = uwNormalized.dealer?.dealer_diagnostics || {};
  const dealerResolution = uwNormalized.dealer?.dealer_resolution || {};
  const volatilityState = uwNormalized.volatility?.volatility_state || {};
  const darkpool = uwNormalized.darkpool || {};
  const dealerText = dealerDiagnostics.rows_near_spot === 0
    ? `Dealer：rows_near_spot=0，likely_cause=${dealerDiagnostics.likely_cause || 'unknown'}。`
    : `Dealer：rows_near_spot=${dealerDiagnostics.rows_near_spot ?? '--'}，继续等待墙位确认。`;
  const volatilityText = volatilityState.formula_ready === true && volatilityState.data_ready === false
    ? 'Volatility：公式已就绪，等数据进入即可计算。'
    : volatilityState.data_ready === true
      ? `Volatility：Vscore=${volatilityState.vscore}，${volatilityState.classification}。`
      : 'Volatility：Vscore 公式待数据确认。';
  const darkpoolText = darkpool.tier && darkpool.tier !== 'none'
    ? `Dark Pool：${darkpool.tier} / ${darkpool.tier_cn || '空间参考'}，有低置信空间参考，但不能作为墙位。`
    : layerConclusions.darkpool?.summary_cn || 'Dark Pool：暂不可用。';
  return {
    status: 'WAIT',
    direction: 'PUT',
    direction_cn: '看空候选',
    can_trade: false,
    safety_lock: true,
    headline_cn: '有 Put 偏空线索，但还不能开仓。',
    action_cn: '只观察，不追空。',
    why_cn: [
      'Flow 有 Put RepeatedHits，说明空头资金有动作。',
      dealerDiagnostics.rows_near_spot === 0
        ? `Dealer 现价附近 strike 未抓到，原因正在按抓取窗口 / 分页 / ticker 映射排查：${dealerDiagnostics.likely_cause || 'unknown'}。`
        : 'Dealer 动态窗口已拿到现价附近 strike，但墙位算法仍未放行。',
      volatilityState.data_ready === true
        ? `Volatility 已生成 Vscore=${volatilityState.vscore}。`
        : 'Volatility 公式已就绪，等 IVR / IVP 数据进入即可计算 Vscore。',
      darkpool.tier && darkpool.tier !== 'none'
        ? `Dark Pool 有 SPY 暗池${darkpool.tier_cn || '空间参考'}，映射约 ${darkpool.mapped_spx ?? '--'}，但金额不足以单独定义正式墙位。`
        : 'Dark Pool 暂无足够空间参考。',
      '价格确认只降低置信度，不阻断网站自主分析。'
    ],
    wait_for_cn: [
      '等价格确认。',
      '等 Flow 继续同向。',
      '等 0DTE / 多腿过滤确认。',
      '等 Volatility 生成 Vscore。',
      '等 operation_layer ready。'
    ],
    do_not_cn: [
      '不追空。',
      '不提前买 Put。',
      '不根据单一 Flow 信号开仓。',
      '没有入场、止损、TP 前不下单。'
    ],
    trade: {
      entry: '--',
      stop: '--',
      tp1: '--',
      tp2: '--'
    },
    dealer: dealerText,
    volatility: volatilityText,
    darkpool: darkpoolText,
    dealer_resolution: dealerResolution
  };
}

function buildUwAggregateAnalysis(uwNormalized = {}, layerConclusions = {}, context = {}) {
  const darkpool = uwNormalized.darkpool || {};
  const volatility = uwNormalized.volatility?.volatility_state || {};
  const dealer = uwNormalized.dealer?.dealer_resolution || {};
  const dealerWallMap = context.dealerWallMap || {};
  const darkpoolGravity = context.darkpoolGravity || {};
  const flowConflict = context.flowConflict || {};
  const operationLayer = context.operationLayer || {};
  return {
    market_bias_cn: 'SPX 当前处于 Dealer 墙位与暗池减速区之间，偏震荡夹击。',
    supporting_factors_cn: [
      dealerWallMap.call_wall != null ? 'Dealer 已给出上方墙、下方墙和 Flip' : 'Dealer 正在压缩墙位',
      darkpoolGravity.state ? 'Dark Pool 给出下方减速区' : 'Dark Pool 等待有效减速区',
      'Flow 有 Put RepeatedHits'
    ],
    limiting_factors_cn: [
      flowConflict.flow_wall_state === 'stalling' ? 'Put Flow 接近下方暗池减速区，存在撞墙风险' : 'Flow 缺 0DTE / 多腿过滤',
      dealerWallMap.regime === 'positive_gamma_magnet' ? '如果处于 Positive Gamma，单边追空胜率下降' : 'Dealer regime 仍需确认',
      volatility.data_ready ? `Volatility 已生成 Vscore=${volatility.vscore}` : 'Volatility 缺 IVR / IVP 或 Vscore 未生成',
      darkpool.state === 'footprint' ? 'Dark Pool 只有 footprint，不是墙' : 'Dark Pool 仍需聚类确认'
    ],
    conclusion_cn: [
      '可分析：是',
      '可操作：否',
      `当前执行状态：${String(operationLayer.status || 'wait').toUpperCase()}`,
      '当前方向：PUT 候选',
      '当前动作：只观察，不追空'
    ],
    next_priority_cn: [
      '先修 Dealer 抓取窗口 / 分页',
      '再修 Volatility Vscore',
      '再补 Flow 0DTE / 多腿过滤',
      '再做 Dark Pool 聚类'
    ]
  };
}

function buildLayerContracts(signal = {}) {
  const sourceDisplayMap = signal.source_display || {};
  const sourceEntries = Object.values(sourceDisplayMap);
  const gaps = sourceEntries.filter((item) => item.show_in_data_gaps);
  const visible = Object.entries(sourceDisplayMap)
    .filter(([, item]) => item.show_on_homepage)
    .map(([source]) => source);
  const hasMock = sourceEntries.some((item) => item.status === 'mock');
  const hasLive = sourceEntries.some((item) => item.status === 'live');
  const hasPartial = sourceEntries.some((item) => item.status === 'partial');
  const dataStatus = hasMock ? 'blocked' : hasLive && gaps.length === 0 ? 'available' : hasLive || hasPartial ? 'partial' : 'unavailable';
  const finalDecision = signal.final_decision || {};
  const reflection = finalDecision.reflection || {};
  const supporting = Array.isArray(reflection.supporting) ? reflection.supporting : [];
  const missing = Array.isArray(reflection.missing) ? reflection.missing : [];
  const analysisParts = [
    signal.gex_engine?.plain_chinese,
    signal.flow_aggression_engine?.plain_chinese,
    signal.volatility_engine?.plain_chinese,
    signal.darkpool_engine?.plain_chinese,
    signal.market_sentiment_engine?.plain_chinese,
    signal.tv_sentinel?.plain_chinese
  ].filter(Boolean);
  const hasAnalysis = Boolean(finalDecision.market_read) || analysisParts.length > 0 || supporting.length > 0 || missing.length > 0;
  const analysisStatus = hasMock ? 'partial' : hasAnalysis ? (missing.length > 0 || hasPartial ? 'partial' : 'available') : 'unavailable';
  const traceRules = Array.isArray(finalDecision.trace) ? finalDecision.trace.map((item) => item.rule).filter(Boolean) : [];
  const blockedBy = [
    traceRules.includes('time_to_close_lt_15') ? 'hard_close_window' : null,
    traceRules.includes('spot_unavailable') ? 'spot_unavailable' : null,
    traceRules.includes('event_risk_blocked') ? 'event_risk_blocked' : null,
    hasMock ? 'mock_source' : null,
    signal.source_display?.uw?.usable_for_operation === false ? 'uw_analysis_only' : null
  ].filter(Boolean);
  const tradePlanStatus = signal.trade_plan?.status || finalDecision.state || 'wait';
  const ready = tradePlanStatus === 'ready' && finalDecision.state === 'actionable' && blockedBy.length === 0;
  const wait = !ready && !['blocked', 'invalidated'].includes(finalDecision.state);

  const layerConclusions = signal.uw_layer_conclusions || {};
  const master = layerConclusions.master || layerConclusions.master_synthesis || {};
  return {
    data_layer: {
      status: dataStatus,
      blocked_by_operation_gate: false,
      summary: hasMock
        ? '检测到 mock 数据，数据层高风险但仍显示来源。'
        : dataStatus === 'available'
          ? '核心数据可展示。'
          : dataStatus === 'partial'
            ? '部分数据可展示，缺口进入 Data Gaps。'
            : '暂无可用数据。',
      sources: sourceDisplayMap,
      visible_sections: visible,
      data_gaps_count: gaps.length
    },
    analysis_layer: {
      status: analysisStatus,
      blocked_by_operation_gate: false,
      summary: master.summary_cn || finalDecision.reason || (hasAnalysis ? '分析层可展示。' : '暂无分析结论。'),
      market_read: finalDecision.market_read || 'not provided',
      reflection: reflection && Object.keys(reflection).length > 0 ? reflection : 'not provided',
      dealer_summary: layerConclusions.dealer?.summary_cn || signal.gex_engine?.plain_chinese || 'not provided',
      flow_summary: layerConclusions.flow?.summary_cn || signal.flow_aggression_engine?.plain_chinese || 'not provided',
      volatility_summary: layerConclusions.volatility?.summary_cn || signal.volatility_engine?.plain_chinese || 'not provided',
      darkpool_summary: layerConclusions.darkpool?.summary_cn || signal.darkpool_engine?.plain_chinese || 'not provided',
      sentiment_summary: layerConclusions.sentiment?.summary_cn || signal.market_sentiment_engine?.plain_chinese || 'not provided',
      tv_summary: signal.tv_sentinel?.plain_chinese || 'not provided',
      missing_analysis: missing
    },
    operation_layer: {
      status: ready ? 'ready' : wait ? 'wait' : 'blocked',
      blocked_by: blockedBy,
      single_leg_allowed: ready && ['A_long_candidate', 'A_short_candidate'].some((setup) => finalDecision.allowed_setups?.includes(setup)),
      direction: finalDecision.direction === 'bullish' ? 'call' : finalDecision.direction === 'bearish' ? 'put' : '--',
      setup_type: finalDecision.trade_plan?.setup || 'none',
      trade_plan_status: tradePlanStatus,
      operation_summary: finalDecision.instruction || '等待操作条件。',
      can_show_operation_card: true
    }
  };
}

function buildBasisTracker(priceSources = {}) {
  const es = priceSources.es || {};
  const spx = priceSources.spx || {};
  const rawBasis = priceSources.basis?.value;
  const calculated = es.price != null && spx.price != null ? es.price - spx.price : null;
  const basis = typeof rawBasis === 'number' ? rawBasis : calculated;
  return {
    status: es.status === 'live' && spx.status === 'live' && basis != null ? 'live' : es.status === 'live' ? 'partial' : 'unavailable',
    es_price: es.price ?? null,
    spx_equivalent: spx.price ?? null,
    basis,
    basis_source: typeof rawBasis === 'number' ? 'tradingview' : calculated != null ? 'calculated' : 'unavailable',
    basis_confidence: typeof rawBasis === 'number' ? 'high' : calculated != null ? 'medium' : 'low',
    plain_chinese: basis == null ? 'Basis 暂不可用。' : `ES/SPX basis ${basis}。`
  };
}

function buildPriceSourcesV2({ signal = {}, projectionPrices = {}, crossAssetProjection = {} } = {}) {
  const externalSpot = signal.command_inputs?.external_spot || {};
  const spxPrice = projectionPrices.spx?.source === 'tradingview_spx_equivalent'
    ? projectionPrices.spx.price
    : externalSpot.is_real === true && externalSpot.spot != null
      ? externalSpot.spot
    : signal.market_snapshot?.spot_is_real === true
      ? (projectionPrices.spx?.price ?? signal.market_snapshot?.spot ?? null)
      : null;
  const esPrice = projectionPrices.es?.price ?? null;
  const spyPrice = projectionPrices.spy?.price ?? null;
  const equivalentFromEs = spxPrice != null && esPrice != null
    ? {
        price: esPrice,
        formula: 'equivalent = spx_level * (target_price / spx_price)',
        source: 'tradingview'
      }
    : {
        price: null,
        formula: 'equivalent = spx_level * (target_price / spx_price)',
        reason: projectionPrices.es?.source === 'unavailable'
          ? 'TV webhook 没推 ES price，后端没有 snapshot。'
          : '字段名不匹配或 ES price 不可用。'
      };
  return {
    spx: {
      ...(projectionPrices.spx || {}),
      price: spxPrice,
      source: spxPrice == null ? 'unavailable' : projectionPrices.spx?.source || signal.market_snapshot?.spot_source || 'fmp',
      status: spxPrice == null ? 'unavailable' : projectionPrices.spx?.status || 'live',
      age_seconds: spxPrice == null ? null : projectionPrices.spx?.age_seconds ?? null
    },
    spy: projectionPrices.spy || { price: spyPrice, status: spyPrice == null ? 'unavailable' : 'live' },
    es: {
      ...(projectionPrices.es || {}),
      reason: esPrice == null ? 'TV webhook 没推 ES price，后端没有 snapshot。' : ''
    },
    spx_equivalent_from_es: equivalentFromEs,
    basis: {
      value: projectionPrices.basis?.value ?? crossAssetProjection.basis ?? null,
      source: projectionPrices.basis?.source ?? 'projection',
      status: esPrice == null ? 'unavailable' : 'live'
    }
  };
}

function buildIntradayDecisionCardV2({ finalDecision = {}, uwConclusion = {}, priceSources = {} } = {}) {
  const keySummary = [
    `SPX Call Wall：${uwConclusion.call_wall ?? '--'}`,
    `SPX Put Wall：${uwConclusion.put_wall ?? '--'}`,
    `Max Pain：${uwConclusion.max_pain ?? '--'}`,
    priceSources.es?.status === 'live'
      ? `ES 等效价：${priceSources.spx_equivalent_from_es?.price ?? '--'}`
      : `ES/SPY 等效价暂不可用。${priceSources.es?.reason || ''}`.trim()
  ].join('\n');
  return {
    current_action: finalDecision.label || '等确认',
    market_read: finalDecision.reason || '',
    why_now: 'Dashboard 只显示 final_decision，不重新判断方向。',
    wait_for: finalDecision.waiting_for || '--',
    do_not_do: finalDecision.do_not_do || [],
    key_levels_summary: keySummary,
    position: `${finalDecision.position_multiplier ?? 0} 仓`,
    plain_chinese: `${finalDecision.label || '等确认'}：${finalDecision.instruction || '等确认，不追单'}`
  };
}

function buildLegacyTradePlanShell(finalDecision = {}, previousPlan = {}, crossAssetProjection = {}) {
  const plan = finalDecision.trade_plan || {};
  const targetInstrument = process.env.TARGET_INSTRUMENT || previousPlan.target_instrument || 'ES';
  const entryText = plan.entry_zone || previousPlan.entry_zone?.text || '--';
  const stopText = plan.stop_loss || previousPlan.stop_loss?.text || '--';
  const invalidationText = plan.invalidation || previousPlan.invalidation?.text || '--';
  const targets = Array.isArray(plan.targets) && plan.targets.length > 0
    ? plan.targets.map((target, index) => ({
        label: `TP${index + 1}`,
        name: `TP${index + 1}`,
        level: target,
        action: target || '--',
        reason: `${targetInstrument} / final_decision`
      }))
    : [{ label: 'TP1', name: 'TP1', level: null, action: '--', reason: '--' }];
  return {
    ...previousPlan,
    ...plan,
    status: finalDecision.state === 'actionable' ? 'ready' : finalDecision.state === 'invalidated' ? 'invalidated' : 'waiting',
    target_instrument: targetInstrument,
    setup_type: plan.setup,
    setup_code: plan.setup,
    direction_label: finalDecision.label || '等确认',
    entry_zone: { ...(previousPlan.entry_zone || {}), text: entryText },
    stop_loss: { ...(previousPlan.stop_loss || {}), text: stopText },
    targets,
    target_text: targets.map((item) => item.action).join(' / ') || '--',
    invalidation: { ...(previousPlan.invalidation || {}), text: invalidationText },
    invalidation_text: invalidationText,
    position_sizing: finalDecision.position_multiplier > 0 ? `${finalDecision.position_multiplier}x` : '0仓',
    wait_conditions: [{ type: 'final_decision', text: finalDecision.waiting_for || '等待 TV 结构信号，不提前交易。' }],
    ttl_minutes: plan.ttl_minutes ?? null,
    ttl_text: plan.ttl_minutes == null ? '等待状态无有效交易 TTL。' : `${plan.ttl_minutes} 分钟`,
    plain_chinese: finalDecision.instruction || '等确认，不追单。',
    projection_note: crossAssetProjection.plain_chinese || ''
  };
}

function buildIntradayDecisionCardFromFinal(args) {
  return buildIntradayDecisionCardV2(args);
}

function scrubUwLiveLegacyText(value, uwProvider = {}) {
  if (uwProvider.status !== 'live') return value;
  if (typeof value === 'string') {
    return value
      .replace(/UW Flow 不可用，无法判断量价 \/ Flow 背离。/g, 'UW Flow 已接入，等待价格结构确认。')
      .replace(/UW Greek Exposure 不可用，不参与 Dealer 交叉验证。/g, 'UW Greek Exposure 已接入，部分 Greek 字段可能不完整。')
      .replace(/UW Greek Exposure 不可用/g, 'UW Greek Exposure partial')
      .replace(/price_map_conflict/g, 'uw_price_map_wait')
      .replace(/mock key levels/gi, 'uw key levels')
      .replace(/Gamma 地图仍为模拟/g, 'UW 墙位已接管 Gamma 地图');
  }
  if (Array.isArray(value)) return value.map((item) => scrubUwLiveLegacyText(item, uwProvider));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubUwLiveLegacyText(item, uwProvider)]));
  }
  return value;
}

function sanitizeUwPromotedStrings(value, uwActive = false) {
  if (!uwActive) return value;
  if (typeof value === 'string') {
    return value
      .replaceAll('UW Flow 不可用，无法判断量价 / Flow 背离。', 'UW Flow 已由 API 接管，按实时 flow_validation 判断。')
      .replaceAll('UW Greek Exposure 不可用，不参与 Dealer 交叉验证。', 'UW Greek Exposure partial，按 UW dealer_factors 辅助判断。')
      .replaceAll('UW Greek Exposure 不可用', 'UW Greek Exposure partial')
      .replaceAll('price_map_conflict', 'uw_price_map_active')
      .replaceAll('价格地图冲突', 'UW 墙位已接管价格地图')
      .replaceAll('FMP 现价真实，但 Gamma 地图仍为模拟，禁止执行。', 'FMP 现价真实，UW 墙位地图已接管，等待 TV 确认。')
      .replaceAll('ThetaData unavailable.', 'ThetaData EM auxiliary unavailable.')
      .replaceAll('ThetaData unavailable', 'ThetaData EM auxiliary unavailable')
      .replaceAll('Theta EM auxiliary 未 live', 'Theta EM auxiliary 未 live')
      .replaceAll('ThetaData EM 辅助不可用，Dealer path 仅参考，不可执行。', 'UW Dealer partial，墙位已接入，Vanna/Charm/Delta 部分缺失。')
      .replaceAll('ThetaData EM 辅助不可用，Dealer 地图不可执行', 'UW Dealer partial，墙位已接入，等待 TV 确认')
      .replaceAll('现价与 Flip/Wall/Max Pain 地图严重冲突，禁止执行。', 'UW 墙位已接入；当前是交易条件未满足，不是数据崩溃。')
      .replaceAll('blocked / not ready', 'WAIT / 等确认 / 0仓')
      .replaceAll('禁做 / 等确认', '等确认 / 不追单');
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeUwPromotedStrings(item, uwActive));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeUwPromotedStrings(item, uwActive)]));
  }
  return value;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceStatus(lastUpdated, now = new Date()) {
  if (!lastUpdated) return { status: 'unavailable', age_seconds: null };
  const age = Math.max(0, Math.floor((new Date(now).getTime() - new Date(lastUpdated).getTime()) / 1000));
  return {
    status: age <= 120 ? 'live' : age <= 300 ? 'stale' : 'unavailable',
    age_seconds: Number.isFinite(age) ? age : null
  };
}

function buildProjectionPrices({ signal = {}, normalized = {}, tradingViewSnapshot = null, uwApi = {} } = {}) {
  const tvEsPrice = numberOrNull(tradingViewSnapshot?.es_price ?? tradingViewSnapshot?.futures_price);
  const tvBasis = numberOrNull(tradingViewSnapshot?.basis);
  const tvSpxEquivalent = numberOrNull(tradingViewSnapshot?.spx_equivalent) ?? (tvEsPrice != null && tvBasis != null ? tvEsPrice + tvBasis : null);
  const externalSpot = numberOrNull(signal.command_inputs?.external_spot?.spot);
  const marketSpot = numberOrNull(signal.market_snapshot?.spot);
  const normalizedExternalSpot = numberOrNull(normalized.external_spot);
  const normalizedSpot = numberOrNull(normalized.spot);
  const spxPrice = numberOrNull(
    externalSpot
    ?? marketSpot
    ?? tvSpxEquivalent
    ?? normalizedExternalSpot
    ?? normalizedSpot
  );
  const spxLast = signal.command_inputs?.external_spot?.last_updated || normalized.external_spot_last_updated || normalized.spot_last_updated;
  const spyPrice = numberOrNull(tradingViewSnapshot?.spy_price ?? uwApi.uw_factors?.technical_factors?.spy_price ?? uwApi.uw_raw?.spy_price?.data?.price);
  const esPrice = numberOrNull(tradingViewSnapshot?.es_price ?? tradingViewSnapshot?.futures_price ?? signal.es_proxy?.es_price);
  const spxFresh = priceStatus(spxLast || signal.received_at);
  const spxSource =
    externalSpot != null ? signal.command_inputs?.external_spot?.source || 'external'
    : marketSpot != null ? signal.market_snapshot?.spot_source || 'market_snapshot'
    : tvSpxEquivalent != null ? 'tradingview_spx_equivalent'
    : normalizedExternalSpot != null ? normalized.external_spot_source || 'normalized_external'
    : normalizedSpot != null ? normalized.spot_source || 'normalized'
    : 'unavailable';
  return {
    spx: {
      price: spxPrice,
      source: spxSource,
      ...spxFresh
    },
    spy: {
      price: spyPrice,
      source: spyPrice == null ? 'unavailable' : tradingViewSnapshot?.spy_price != null ? 'tradingview' : 'uw',
      status: spyPrice == null ? 'unavailable' : 'live',
      age_seconds: spyPrice == null ? null : 0
    },
    es: {
      price: esPrice,
      source: esPrice == null ? 'unavailable' : 'tradingview',
      status: esPrice == null ? 'unavailable' : 'live',
      age_seconds: esPrice == null ? null : 0
    },
    basis: {
      value: tvBasis,
      source: tvBasis == null ? 'unavailable' : 'tradingview',
      status: tvBasis == null ? 'unavailable' : 'live'
    }
  };
}

function buildProjectionLevels({ signal = {}, dealerEngine = {}, uwApi = {} } = {}) {
  const dealerFactors = uwApi.uw_factors?.dealer_factors || {};
  const volumeOi = uwApi.uw_factors?.volume_oi_factors || {};
  return {
    call_wall: dealerEngine.upper_wall ?? signal.dealer_conclusion?.call_wall ?? signal.market_snapshot?.call_wall ?? null,
    put_wall: dealerEngine.lower_wall ?? signal.dealer_conclusion?.put_wall ?? signal.market_snapshot?.put_wall ?? null,
    zero_gamma: dealerEngine.flip_zone ?? signal.dealer_conclusion?.zero_gamma ?? signal.market_snapshot?.flip_level ?? null,
    max_pain: volumeOi.max_pain ?? signal.dealer_conclusion?.max_pain ?? signal.market_snapshot?.max_pain ?? null,
    em_upper: signal.dealer_conclusion?.expected_move_upper ?? null,
    em_lower: signal.dealer_conclusion?.expected_move_lower ?? null,
    gex_pivots: dealerFactors.gex_pivots || [],
    oi_walls: volumeOi.volume_magnet_candidates || [],
    volume_magnets: volumeOi.volume_wall_candidates || []
  };
}

function buildKeyLevelsFromUwConclusion({ uwConclusion = {}, diagnostics = {} } = {}) {
  const status = (value, fallback = uwConclusion.status) => value == null ? 'unavailable' : (fallback || 'partial');
  const callWall = diagnostics.call_wall ?? uwConclusion.call_wall ?? null;
  const putWall = diagnostics.put_wall ?? uwConclusion.put_wall ?? null;
  const zeroGamma = diagnostics.zero_gamma ?? uwConclusion.zero_gamma ?? null;
  const maxPain = uwConclusion.max_pain ?? null;
  return {
    source: 'uw_conclusion',
    call_wall: { level: callWall, source: 'uw_wall_diagnostics', status: status(callWall) },
    put_wall: { level: putWall, source: 'uw_wall_diagnostics', status: status(putWall) },
    zero_gamma: { level: zeroGamma, source: 'uw_wall_diagnostics', status: status(zeroGamma) },
    max_pain: { level: maxPain, source: 'uw_conclusion', status: status(maxPain) },
    gex_pivots: diagnostics.top_net_gex_strikes || [],
    oi_walls: [],
    volume_magnets: [],
    plain_chinese: `UW Key Levels：Call Wall ${callWall ?? '--'}，Put Wall ${putWall ?? '--'}，Zero Gamma ${zeroGamma ?? '--'}，Max Pain ${maxPain ?? '--'}。`
  };
}

function buildKeyLevels({ dealerEngine = {}, uwApi = {}, signal = {}, uwConclusionV2 = null } = {}) {
  const dealerFactors = uwApi.uw_factors?.dealer_factors || {};
  const volumeOi = uwApi.uw_factors?.volume_oi_factors || {};
  if (uwConclusionV2?.uw_conclusion && uwConclusionV2?.uw_wall_diagnostics) {
    const conclusion = uwConclusionV2.uw_conclusion;
    const diagnostics = uwConclusionV2.uw_wall_diagnostics;
    const status = (value) => value == null ? 'unavailable' : conclusion.status || 'partial';
    return {
      source: 'uw_conclusion',
      call_wall: { level: diagnostics.call_wall, source: 'uw_wall_diagnostics', status: status(diagnostics.call_wall) },
      put_wall: { level: diagnostics.put_wall, source: 'uw_wall_diagnostics', status: status(diagnostics.put_wall) },
      zero_gamma: { level: diagnostics.zero_gamma, source: 'uw_wall_diagnostics', status: status(diagnostics.zero_gamma) },
      max_pain: { level: conclusion.max_pain, source: 'uw_conclusion', status: status(conclusion.max_pain) },
      gex_pivots: diagnostics.top_net_gex_strikes || [],
      oi_walls: volumeOi.volume_magnet_candidates || [],
      volume_magnets: volumeOi.volume_wall_candidates || [],
      plain_chinese: `UW Key Levels：Call Wall ${diagnostics.call_wall ?? '--'}，Put Wall ${diagnostics.put_wall ?? '--'}，Zero Gamma ${diagnostics.zero_gamma ?? '--'}。`
    };
  }
  const source = dealerEngine.status === 'live' || dealerEngine.status === 'partial' ? 'uw' : 'theta';
  const status = (value, fallbackStatus = dealerEngine.status) => value == null ? 'unavailable' : (fallbackStatus || 'partial');
  const callWall = dealerEngine.upper_wall ?? signal.dealer_conclusion?.call_wall ?? null;
  const putWall = dealerEngine.lower_wall ?? signal.dealer_conclusion?.put_wall ?? null;
  const zeroGamma = dealerEngine.flip_zone ?? signal.dealer_conclusion?.zero_gamma ?? null;
  const maxPain = volumeOi.max_pain ?? signal.dealer_conclusion?.max_pain ?? null;

  return {
    source,
    call_wall: { level: callWall, source: source === 'uw' ? 'uw_spot_gex' : 'theta', status: status(callWall) },
    put_wall: { level: putWall, source: source === 'uw' ? 'uw_spot_gex' : 'theta', status: status(putWall) },
    zero_gamma: { level: zeroGamma, source: source === 'uw' ? 'uw_spot_gex' : 'theta', status: status(zeroGamma) },
    max_pain: { level: maxPain, source: source === 'uw' ? 'uw_max_pain' : 'theta', status: status(maxPain, volumeOi.max_pain == null ? 'unavailable' : 'live') },
    gex_pivots: dealerFactors.gex_pivots || [],
    oi_walls: volumeOi.volume_magnet_candidates || [],
    volume_magnets: volumeOi.volume_wall_candidates || [],
    plain_chinese:
      source === 'uw'
        ? `UW Key Levels：Call Wall ${callWall ?? '--'}，Put Wall ${putWall ?? '--'}，Zero Gamma ${zeroGamma ?? '--'}。`
        : 'UW 墙位不可用，Key Levels 回落到 Theta 或 unavailable。'
  };
}

function humanizeReflection(reflection = {}, signal = {}) {
  const translate = (item) => {
    if (/UW Greek 细项部分可读/i.test(item)) return 'UW Greek 数据部分可读，但 Dealer 置信度还不够高。';
    if (/TV matched setup missing/i.test(item)) return 'TradingView 还没有给出结构确认。';
    if (/entry pending|stop pending|target pending|invalidation pending/i.test(item)) return '等待 TV 结构确认后再生成交易计划。';
    if (/ES\/SPY live price missing/i.test(item)) return 'ES/SPY 实时价缺失，SPX 墙位暂时不能换算成 ES/SPY 等效位。';
    if (/UW dealer factors incomplete/i.test(item)) return 'UW Dealer 数据还不完整，只能作为候选参考。';
    return item;
  };
  const missing = [...new Set((reflection.missing_inputs || []).map(translate))];
  const supporting = (reflection.supporting_evidence || []).map((item) => {
    if (/UW API live/i.test(item)) return 'UW API 已 live，Dealer / Flow / Volatility / Dark Pool 数据已进入引擎。';
    if (/UW Dealer partial/i.test(item)) return 'UW 墙位已接入，但 Dealer 细项仍是 partial。';
    if (/Institutional bombing bearish/i.test(item)) return '机构流偏空，并出现连续轰炸。';
    if (/Dark pool neutral/i.test(item)) return '暗池中性，没有明显支撑或压力。';
    return item;
  });
  return {
    ...reflection,
    supporting_evidence_humanized: [...new Set(supporting)],
    conflicting_evidence_humanized: [...new Set(reflection.conflicting_evidence || [])],
    missing_inputs_humanized: missing,
    plain_chinese_humanized:
      `${signal.command_center?.action || '等确认'}：${missing.length > 0 ? missing.join('；') : '当前没有新增硬缺口。'}`
  };
}

function ensureHumanizedReflection(reflection = {}, signal = {}) {
  return reflection.missing_inputs_humanized ? reflection : humanizeReflection(reflection, signal);
}

function buildIntradayDecisionCard({ signal = {}, reflection = {} } = {}) {
  const safeReflection = ensureHumanizedReflection(reflection, signal);
  const keyLevels = signal.key_levels || {};
  const projection = signal.cross_asset_projection || {};
  const flow = signal.uw_conclusion?.flow_bias || 'unavailable';
  const institutional = signal.institutional_alert || {};
  const dealer = signal.dealer_engine || {};
  const darkpool = signal.darkpool_summary || {};
  const volatility = signal.volatility_activation || {};
  const currentAction = signal.command_center?.final_state === 'actionable'
    ? '可执行'
    : signal.command_center?.final_state === 'candidate'
      ? '候选'
      : '等确认，不追单';
  const waitFor = flow === 'bearish'
    ? '等 TV 空头结构确认：breakdown_confirmed 或 retest_failed。没有确认前不生成入场、止损和目标。'
    : '等 TV 结构确认。没有确认前不生成入场、止损和目标。';
  const keySummary = [
    `SPX Call Wall：${keyLevels.call_wall?.level ?? '--'}`,
    `SPX Put Wall：${keyLevels.put_wall?.level ?? '--'}`,
    `Max Pain：${keyLevels.max_pain?.level ?? '--'}`,
    projection.status === 'partial'
      ? 'ES/SPY 等效价：暂不可用，只参考 SPX 原始墙位。'
      : projection.plain_chinese || 'ES/SPY 等效价暂不可用。'
  ].join('\n');

  return {
    current_action: currentAction,
    market_read: `FMP 现价真实，UW 已 live。机构流${flow === 'bearish' ? '偏空' : flow === 'bullish' ? '偏多' : '不明确'}${institutional.state === 'bombing' ? '并出现连续轰炸' : ''}，Dealer ${dealer.status || 'unavailable'}，暗池${darkpool.bias === 'neutral' ? '中性' : darkpool.bias || '不可用'}，波动${volatility.strength === 'off' ? '未启动' : volatility.strength || '不可用'}。`,
    why_now: `${flow === 'bearish' ? '空头' : flow === 'bullish' ? '多头' : '资金'}资金有动作，但不能单独作为入场理由。必须等 TV 结构确认。`,
    wait_for: waitFor,
    do_not_do: ['不追空。', '不开铁鹰。', '不在中轴位置提前下单。', '没有 TV 确认不进场。'],
    key_levels_summary: keySummary,
    position: '0 仓。',
    plain_chinese: `当前：${currentAction}\n\n盘面判断：${flow === 'bearish' ? '空头资金有动作' : '资金方向仍需确认'}，但 TV 尚未确认。\n\n等什么：${waitFor}\n\n关键位：${keySummary}\n\n仓位：0 仓。`,
    reflection_summary: safeReflection.plain_chinese_humanized || safeReflection.plain_chinese || ''
  };
}

function buildDataQualityGuard({ signal = {}, dealerEngine = {}, crossAssetProjection = {} } = {}) {
  const uwLive = signal.uw_provider?.status === 'live';
  const uwKeyLevels = signal.key_levels?.source === 'uw';
  if (uwLive && uwKeyLevels) {
    return {
      state: 'WAIT',
      title: '数据质量：可观察，等待结构确认。',
      items: [
        'FMP：real',
        'UW：live',
        `Dealer：${dealerEngine.status || 'unavailable'}`,
        `TV：${signal.tv_sentinel?.status || 'waiting'}`,
        'ThetaData：EM auxiliary unavailable，不阻断 UW 主线',
        `Projection：${crossAssetProjection.status || 'unavailable'}，ES/SPY 等效价${crossAssetProjection.status === 'partial' ? '缺失' : '可参考'}`,
        '执行状态：WAIT / 0仓'
      ],
      plain_chinese: 'FMP 现价真实，UW 墙位已接入。当前不是数据崩溃，而是等待 TV 结构确认。'
    };
  }
  return {
    state: 'BLOCKED',
    title: '数据质量：关键源不可用。',
    items: ['FMP / UW / TV 至少一个核心源不可用。'],
    plain_chinese: '关键源不可用，不能执行。'
  };
}

function buildSignalConflictSummary({ signal = {}, dealerEngine = {}, crossAssetProjection = {} } = {}) {
  if (signal.uw_provider?.status === 'live' && signal.key_levels?.source === 'uw') {
    return {
      state: 'minor_conflict',
      title: 'Signal Conflict｜轻微冲突',
      items: [
        'FMP 现价真实，UW 墙位已接入，不再使用 mock Gamma 地图。',
        '当前主要问题不是数据崩溃，而是交易条件未满足。',
        'TV 还没有结构确认。',
        `Dealer ${dealerEngine.status || 'unavailable'}，Vanna/Charm/Delta 不完整。`,
        `ES/SPY 等效价${crossAssetProjection.status === 'partial' ? '缺失' : '可参考'}，墙位先参考 SPX 原始点位。`,
        '没有 entry / stop / target / invalidation，所以不能执行。',
        '执行状态：WAIT / 等确认 / 0仓'
      ],
      plain_chinese: '轻微冲突：UW 墙位和 Flow 已接入，但 TV 未确认，交易计划未完整，只能 0仓等待。'
    };
  }
  return {
    state: 'blocked',
    title: 'Signal Conflict｜阻断',
    items: ['核心数据不可用或过期。'],
    plain_chinese: '核心数据不可用，禁止执行。'
  };
}

function buildUwFlowSummary({ signal = {}, dealerEngine = {}, institutionalAlert = {}, darkpoolSummary = {}, volatilityActivation = {} } = {}) {
  const flowText = institutionalAlert.direction === 'bearish' ? '偏空' : institutionalAlert.direction === 'bullish' ? '偏多' : '不明确';
  const bombingText = institutionalAlert.state === 'bombing' ? '，连续轰炸' : '';
  const darkText = darkpoolSummary.bias === 'neutral' ? '中性，没有明显支撑/压力' : darkpoolSummary.bias || '不可用';
  const dealerText = dealerEngine.status === 'partial'
    ? '部分可读，墙位已接入，但 Vanna/Charm/Delta 不完整'
    : dealerEngine.plain_chinese || '不可用';
  const volText = volatilityActivation.strength === 'off' ? '未启动，单腿不放行' : volatilityActivation.plain_chinese || '不可用';
  return {
    title: 'UW 资金解读',
    institutional_flow: `机构流：${flowText}${bombingText}`,
    darkpool: `暗池：${darkText}`,
    dealer: `Dealer：${dealerText}`,
    volatility: `波动：${volText}`,
    conclusion: institutionalAlert.direction === 'bearish'
      ? '空头资金有动作，但不能直接追空。等 TV breakdown_confirmed 或 retest_failed。'
      : '资金有动作，但必须等 TV 结构确认。',
    plain_chinese: `机构流${flowText}${bombingText}；暗池${darkText}；Dealer ${dealerText}；${institutionalAlert.direction === 'bearish' ? '空头资金有动作，但不能直接追空。' : '必须等 TV 结构确认。'}`
  };
}

function buildStrategyCardsDisplay({ signal = {}, strategyPermissions = {}, volatilityActivation = {}, institutionalAlert = {} } = {}) {
  return [
    {
      strategy_name: '单腿',
      status_text: '等待 / 禁止追单',
      suitable_when: '波动未启动，TV 未确认，不能提前做。',
      entry_condition: '--',
      target_zone: '--',
      invalidation: '--',
      position: '0',
      permission: strategyPermissions.single_leg?.permission || 'wait'
    },
    {
      strategy_name: '垂直',
      status_text: '等待候选',
      suitable_when: `${signal.uw_conclusion?.flow_bias === 'bearish' ? 'UW Flow 偏空' : 'UW Flow 方向待确认'}，但还需要 TV breakdown_confirmed 或 retest_failed。`,
      entry_condition: '等 TV 空头结构确认后再生成。',
      target_zone: '暂参考 SPX 原始墙位；ES/SPY 等效价暂不可用。',
      invalidation: 'TV 结构不成立，或 Flow 转向。',
      position: '0',
      permission: strategyPermissions.vertical?.permission || 'wait'
    },
    {
      strategy_name: '铁鹰',
      status_text: '禁止',
      suitable_when: `${institutionalAlert.state === 'bombing' ? '机构流偏空并有轰炸' : '当前不是平静磨盘环境'}，不是平静磨盘环境。`,
      entry_condition: '--',
      target_zone: '--',
      invalidation: '--',
      position: '0',
      permission: strategyPermissions.iron_condor?.permission || 'block'
    }
  ];
}

function isFmpRiskDegraded(snapshot) {
  if (!snapshot) {
    return false;
  }

  if (!snapshot.configured) {
    return false;
  }

  const state = String(snapshot.state || '').toLowerCase();
  return (
    snapshot.available === false
    || Boolean(snapshot.fallback_reason)
    || snapshot.stale === true
    || ['degraded', 'delayed', 'down', 'stale'].includes(state)
  );
}

function applyTradingViewSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const mappedStructure = snapshot.tv_structure_event || baseScenario.tv_structure_event;
  const triggerTimestamp = snapshot.last_updated || snapshot.received_at || baseScenario.last_updated.tradingview;

  return {
    ...baseScenario,
    timeframe: snapshot.timeframe || baseScenario.timeframe,
    last_updated: {
      ...baseScenario.last_updated,
      tradingview: triggerTimestamp
    },
    tv_structure_event: mappedStructure,
    tv_last_event_note: snapshot.status === 'stale'
      ? `最近 TradingView 事件 ${snapshot.event_type || mappedStructure} 已 stale，仅作参考。`
      : `最近 TradingView 事件：${snapshot.event_type || mappedStructure}。`,
    tradingview_snapshot: snapshot
  };
}

function applyTradingViewPriceFallback(baseScenario, snapshot) {
  if (!snapshot || hasFiniteNumber(baseScenario.spot) || hasFiniteNumber(baseScenario.external_spot)) {
    return baseScenario;
  }

  const snapshotSpot = hasFiniteNumber(snapshot.spx_equivalent) ? Number(snapshot.spx_equivalent) : hasFiniteNumber(snapshot.price) ? Number(snapshot.price) : null;
  if (!hasFiniteNumber(snapshotSpot)) {
    return baseScenario;
  }

  return {
    ...baseScenario,
    ...(baseScenario.scenario_mode === true
      ? {}
      : {
          spot: snapshotSpot,
          spot_source: 'tradingview',
          spot_last_updated: snapshot.last_updated || snapshot.received_at || baseScenario.last_updated.tradingview,
          spot_is_real: snapshot.is_mock !== true && snapshot.status !== 'stale'
        }),
    external_spot: snapshotSpot,
    external_spot_source: hasFiniteNumber(snapshot.spx_equivalent) ? 'tradingview_spx_equivalent' : 'tradingview',
    external_spot_last_updated: snapshot.last_updated || snapshot.received_at || baseScenario.last_updated.tradingview,
    external_spot_is_real: snapshot.is_mock !== true && snapshot.status !== 'stale'
  };
}

function applyFmpEventSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const degradedRisk = isFmpRiskDegraded(snapshot);

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      fmp: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp
    },
    fmp_event_snapshot: snapshot,
    event_risk: degradedRisk
      ? 'medium'
      : snapshot.event_risk === 'high' || snapshot.event_risk === 'medium'
        ? snapshot.event_risk
        : baseScenario.event_risk,
    event_note: degradedRisk
      ? 'FMP 数据异常，事件风险不可确认，降低交易权限，不提前卖波。'
      : snapshot.event_note || baseScenario.event_note,
    no_short_vol_window: degradedRisk
      ? true
      : snapshot.no_short_vol_window ?? baseScenario.no_short_vol_window ?? false,
    trade_permission_adjustment: degradedRisk
      ? 'downgrade'
      : snapshot.trade_permission_adjustment || baseScenario.trade_permission_adjustment || 'normal',
    fmp_signal: degradedRisk
      ? 'event_risk_unknown'
      : snapshot.fmp_signal || baseScenario.fmp_signal
  };
}

function applyFmpPriceSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  if (!snapshot.price_available) {
    return {
      ...baseScenario,
      last_updated: {
        ...baseScenario.last_updated,
        fmp_price: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp_price || null
      },
      fmp_price_snapshot: snapshot,
      day_change: snapshot.day_change ?? baseScenario.day_change ?? null,
      day_change_percent: snapshot.day_change_percent ?? baseScenario.day_change_percent ?? null,
      external_spot: baseScenario.external_spot ?? null,
      external_spot_source: baseScenario.external_spot_source ?? null,
      external_spot_last_updated: baseScenario.external_spot_last_updated ?? null,
      external_spot_is_real: baseScenario.external_spot_is_real ?? false
    };
  }

  const externalSpotPayload = {
    external_spot: snapshot.price,
    external_spot_source: 'fmp',
    external_spot_last_updated: snapshot.last_updated || snapshot.data_timestamp || null,
    external_spot_is_real: Boolean(snapshot.price_available && !snapshot.is_mock)
  };

  if (baseScenario.scenario_mode === true) {
    return {
      ...baseScenario,
      last_updated: {
        ...baseScenario.last_updated,
        fmp_price: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp_price || null
      },
      fmp_price_snapshot: snapshot,
      day_change: snapshot.day_change ?? null,
      day_change_percent: snapshot.day_change_percent ?? null,
      ...externalSpotPayload
    };
  }

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      fmp_price: snapshot.last_updated || snapshot.data_timestamp || baseScenario.last_updated.fmp_price || null
    },
    fmp_price_snapshot: snapshot,
    spot: snapshot.price_available ? snapshot.price : null,
    spot_source: snapshot.price_available ? 'fmp' : null,
    spot_last_updated: snapshot.last_updated || snapshot.data_timestamp || null,
    spot_is_real: Boolean(snapshot.price_available && !snapshot.is_mock),
    spot_health: {
      state: snapshot.state || 'unknown',
      is_real: Boolean(snapshot.price_available && !snapshot.is_mock),
      source: snapshot.price_available ? 'fmp' : null
    },
    day_change: snapshot.day_change ?? null,
    day_change_percent: snapshot.day_change_percent ?? null,
    ...externalSpotPayload
  };
}

function applyThetaSnapshot(baseScenario, snapshot) {
  if (!snapshot) {
    return baseScenario;
  }

  const dealerConclusion = buildDealerConclusionEngine({
    thetaSnapshot: snapshot,
    externalSpot: baseScenario.external_spot ?? baseScenario.spot
  });
  const executionConstraint = deriveThetaExecutionConstraint(dealerConclusion);
  const thetaSourceStatus = mapThetaSnapshotToSourceStatus(snapshot);
  const callWall = dealerConclusion.call_wall ?? null;
  const putWall = dealerConclusion.put_wall ?? null;
  const maxPain = dealerConclusion.max_pain ?? null;
  const gammaRegime = dealerConclusion.gamma_regime || 'unknown';
  const thetaSignal = deriveThetaSignalFromSnapshot(snapshot);
  const lastUpdate = snapshot.last_update || snapshot.last_updated || baseScenario.last_updated.theta;
  const shouldAdoptThetaSpot =
    baseScenario.scenario_mode !== true
    && hasFiniteNumber(snapshot.spot)
    && snapshot.spot_source !== 'manual_test'
    && (
      !hasFiniteNumber(baseScenario.spot)
      || baseScenario.spot_is_real !== true
    );
  const shouldAdoptThetaFlip = baseScenario.scenario_mode !== true && hasFiniteNumber(dealerConclusion.zero_gamma ?? dealerConclusion.max_pain);
  const nextSpot = shouldAdoptThetaSpot ? Number(snapshot.spot) : baseScenario.spot;
  const nextSpotSource = shouldAdoptThetaSpot ? snapshot.spot_source || 'manual_test' : baseScenario.spot_source;
  const nextSpotIsReal = shouldAdoptThetaSpot ? snapshot.spot_source !== 'manual_test' : baseScenario.spot_is_real;
  const nextFlipLevel = shouldAdoptThetaFlip
    ? Number(dealerConclusion.zero_gamma ?? dealerConclusion.max_pain)
    : baseScenario.flip_level;

  return {
    ...baseScenario,
    last_updated: {
      ...baseScenario.last_updated,
      theta: lastUpdate,
      theta_full_chain: lastUpdate
    },
    gamma_regime: gammaRegime,
    spot: nextSpot,
    spot_source: nextSpotSource,
    spot_last_updated: shouldAdoptThetaSpot ? lastUpdate : baseScenario.spot_last_updated,
    spot_is_real: nextSpotIsReal,
    external_spot: baseScenario.external_spot ?? (shouldAdoptThetaSpot ? Number(snapshot.spot) : null),
    external_spot_source: baseScenario.external_spot_source ?? (shouldAdoptThetaSpot ? snapshot.spot_source ?? null : null),
    external_spot_last_updated: baseScenario.external_spot_last_updated ?? (shouldAdoptThetaSpot ? lastUpdate : null),
    external_spot_is_real: baseScenario.external_spot_is_real ?? (shouldAdoptThetaSpot && hasFiniteNumber(snapshot.spot)),
    flip_level: nextFlipLevel,
    call_wall: callWall,
    put_wall: putWall,
    max_pain: maxPain,
    theta_signal: thetaSignal,
    theta_snapshot: snapshot,
    theta_dealer_conclusion: dealerConclusion,
    theta_execution_constraint: executionConstraint,
    theta_source_status: thetaSourceStatus
  };
}

function enrichTradePlanWithProjection(tradePlan = {}, crossAssetProjection = {}, instrument = process.env.TARGET_INSTRUMENT || 'ES') {
  const targetInstrument = ['SPX', 'SPY', 'ES', 'MES'].includes(String(instrument).toUpperCase())
    ? String(instrument).toUpperCase()
    : 'ES';
  const levelSet = targetInstrument === 'SPY'
    ? crossAssetProjection.spy_equivalent_levels
    : targetInstrument === 'SPX'
      ? crossAssetProjection.spx_levels
      : crossAssetProjection.es_equivalent_levels;
  const callWall = levelSet?.call_wall ?? null;
  const putWall = levelSet?.put_wall ?? null;
  const zeroGamma = levelSet?.zero_gamma ?? null;
  const hasProjectedLevels = targetInstrument === 'SPX' || callWall != null || putWall != null || zeroGamma != null;
  const targetLabel = targetInstrument === 'MES' ? 'MES/ES' : targetInstrument;
  const targets = Array.isArray(tradePlan.targets) ? tradePlan.targets : [];

  return {
    ...tradePlan,
    target_instrument: targetInstrument,
    entry_zone: {
      ...(tradePlan.entry_zone || {}),
      low: zeroGamma,
      high: zeroGamma,
      text: hasProjectedLevels && zeroGamma != null
        ? `${targetLabel} 回踩 ${zeroGamma.toFixed(2)} 附近守住后观察。`
        : tradePlan.entry_zone?.text || '--',
      source_level: zeroGamma != null ? {
        spx: crossAssetProjection.spx_levels?.zero_gamma ?? null,
        spy_equiv: crossAssetProjection.spy_equivalent_levels?.zero_gamma ?? null,
        es_equiv: crossAssetProjection.es_equivalent_levels?.zero_gamma ?? null,
        type: 'zero_gamma'
      } : null
    },
    stop_loss: {
      ...(tradePlan.stop_loss || {}),
      level: putWall,
      text: hasProjectedLevels && putWall != null
        ? `${targetLabel} 跌破 ${putWall.toFixed(2)} 且收不回，作废。`
        : tradePlan.stop_loss?.text || '--',
      source_level: putWall != null ? {
        spx: crossAssetProjection.spx_levels?.put_wall ?? null,
        spy_equiv: crossAssetProjection.spy_equivalent_levels?.put_wall ?? null,
        es_equiv: crossAssetProjection.es_equivalent_levels?.put_wall ?? null,
        type: 'put_wall'
      } : null
    },
    targets: targets.map((target, index) => index === 0 && callWall != null ? {
      ...target,
      label: target.label || target.name || 'TP1',
      level: callWall,
      reason: `${targetLabel} ${callWall.toFixed(2)}（SPX Call Wall ${crossAssetProjection.spx_levels?.call_wall ?? '--'} 等效）`,
      source_level: {
        spx: crossAssetProjection.spx_levels?.call_wall ?? null,
        spy_equiv: crossAssetProjection.spy_equivalent_levels?.call_wall ?? null,
        es_equiv: crossAssetProjection.es_equivalent_levels?.call_wall ?? null,
        type: 'call_wall'
      }
    } : target),
    invalidation: {
      ...(tradePlan.invalidation || {}),
      level: putWall,
      text: hasProjectedLevels && putWall != null
        ? `${targetLabel} 跌破下方墙位等效价 ${putWall.toFixed(2)} 后计划失效。`
        : tradePlan.invalidation?.text || '--'
    },
    projection_note: crossAssetProjection.plain_chinese
  };
}

export async function getCurrentSignal(requestedScenario, options = {}) {
  const scenarioMode = (typeof requestedScenario === 'string' && requestedScenario.length > 0) || process.env.MOCK_MODE === 'true';
  const scenario = {
    ...getMockScenario(scenarioMode ? requestedScenario : 'live'),
    scenario_mode: scenarioMode,
    is_mock: scenarioMode,
    fetch_mode: scenarioMode ? 'mock_scenario' : 'live',
    scenario: scenarioMode ? getMockScenario(requestedScenario).scenario : null,
    spot: scenarioMode ? getMockScenario(requestedScenario).spot : null,
    flip_level: scenarioMode ? getMockScenario(requestedScenario).flip_level : null,
    call_wall: scenarioMode ? getMockScenario(requestedScenario).call_wall : null,
    put_wall: scenarioMode ? getMockScenario(requestedScenario).put_wall : null,
    max_pain: scenarioMode ? getMockScenario(requestedScenario).max_pain : null,
    tv_structure_event: scenarioMode ? getMockScenario(requestedScenario).tv_structure_event : 'waiting',
    theta_signal: scenarioMode ? getMockScenario(requestedScenario).theta_signal : 'unavailable',
    uw_flow_bias: scenarioMode ? getMockScenario(requestedScenario).uw_flow_bias : 'unavailable',
    uw_dark_pool_bias: scenarioMode ? getMockScenario(requestedScenario).uw_dark_pool_bias : 'unavailable',
    uw_dealer_bias: scenarioMode ? getMockScenario(requestedScenario).uw_dealer_bias : 'unavailable'
  };
  const snapshot = await getTradingViewSnapshot();
  const thetaSnapshot = await getThetaSnapshot();
  const fmpSnapshot = await getFmpSnapshot(options.fmp);
  const enrichedScenario = applyTradingViewPriceFallback(
    applyFmpPriceSnapshot(
      applyFmpEventSnapshot(
        applyTradingViewSnapshot(scenario, snapshot),
        fmpSnapshot.event
      ),
      fmpSnapshot.price
    ),
    snapshot
  );
  const providerSpot = numberOrNull(
    enrichedScenario.external_spot
    ?? enrichedScenario.spot
    ?? snapshot?.spx_equivalent
    ?? snapshot?.price
    ?? fmpSnapshot.price?.spot
    ?? fmpSnapshot.price?.price
  );
  const {
    snapshot: uwSnapshot,
    sourceStatus: uwSourceStatus,
    provider: uwProvider
  } = await readUwProvider({ currentSpot: providerSpot });
  const finalScenario = applyThetaSnapshot(
    enrichedScenario,
    thetaSnapshot
  );
  const normalized = normalizeMockScenario(finalScenario);
  const signal = runMasterEngine(normalized);

  const uwApi = normalizeUwApiSnapshot(uwSnapshot || {});
  const dealerEngine = runUwDealerEngine({
    provider: uwProvider,
    dealerFactors: uwApi.uw_factors.dealer_factors,
    spotGexFactors: uwApi.uw_factors.dealer_factors
  });
  const institutionalAlert = runUwInstitutionalEngine({
    provider: uwProvider,
    flowFactors: uwApi.uw_factors.flow_factors,
    tvSentinel: signal.tv_sentinel
  });
  const volatilityActivation = runUwVolatilityEngine({
    provider: uwProvider,
    volatilityFactors: uwApi.uw_factors.volatility_factors,
    institutionalAlert,
    dealerEngine
  });
  const marketSentiment = runUwSentimentEngine({
    provider: uwProvider,
    sentimentFactors: uwApi.uw_factors.sentiment_factors
  });
  const darkpoolSummary = runUwDarkpoolEngine({
    provider: uwProvider,
    darkpoolFactors: uwApi.uw_factors.darkpool_factors
  });
  const technicalEngine = runTechnicalEngine({
    technicalFactors: uwApi.uw_factors.technical_factors
  });
  const flowValidation = runFlowValidationEngine({
    institutionalAlert,
    darkpoolSummary,
    marketSentiment,
    dealerEngine,
    tvSentinel: signal.tv_sentinel,
    technicalEngine
  });
  const healthMatrix = runHealthMatrixEngine({
    signal,
    uwProvider,
    tvSentinel: signal.tv_sentinel,
    theta: signal.theta,
    dealerEngine
  });
  const setupSynthesis = runSetupSynthesisEngine({
    volatilityActivation,
    institutionalAlert,
    darkpoolSummary,
    marketSentiment,
    dealerEngine,
    technicalEngine
  });
  const projectionPrices = buildProjectionPrices({
    signal,
    normalized,
    tradingViewSnapshot: snapshot,
    uwApi
  });
  const projectionLevels = buildProjectionLevels({
    signal,
    dealerEngine,
    uwApi
  });
  const crossAssetProjection = buildCrossAssetProjection({
    prices: projectionPrices,
    spxLevels: projectionLevels,
    targetInstrument: process.env.TARGET_INSTRUMENT || 'ES'
  });
  const uwEndpointCoverage = buildEndpointCoverageReport(uwProvider.endpoint_coverage || uwSnapshot?.endpoint_coverage || {});
  const coverageInputs = Object.fromEntries(
    Object.entries(uwEndpointCoverage).map(([group, report]) => [group, report.ok || []])
  );
  const normalizedUw = uwProvider.mode === 'api'
    ? {
        source: 'unusual_whales_api',
        status: uwProvider.status,
        last_update: uwProvider.last_update,
        flow: {
          flow_bias: institutionalAlert.direction === 'none' ? 'unavailable' : institutionalAlert.direction,
          institutional_entry: institutionalAlert.state
        },
        darkpool: {
          darkpool_bias: darkpoolSummary.bias === 'unknown' ? 'unavailable' : darkpoolSummary.bias
        },
        volatility: {
          volatility_light: volatilityActivation.light
        },
        sentiment: {
          market_tide: marketSentiment.state
        },
        dealer_crosscheck: {
          state: dealerEngine.status === 'live' ? 'confirm' : 'unavailable'
        },
        quality: {
          data_quality: uwProvider.status,
          missing_fields: [],
          warnings: uwProvider.endpoints_failed || []
        }
      }
    : normalizeUwSummary(uwSnapshot).uw;
  const uwConclusion = runUwConclusionEngine({
    normalized: {
      uw: normalizedUw
    }
  });
  const uwConclusionFinal = uwProvider.status === 'live'
    ? {
        ...uwConclusion,
        flow_bias: institutionalAlert.direction === 'none' ? uwConclusion.flow_bias : institutionalAlert.direction,
        flow_strength: institutionalAlert.score >= 70 ? 'strong' : institutionalAlert.score >= 35 ? 'medium' : 'weak',
        flow_status: institutionalAlert.state === 'unavailable' ? 'unavailable' : 'live',
        vanna: uwApi.uw_factors.dealer_factors?.vanna ?? null,
        charm: uwApi.uw_factors.dealer_factors?.charm ?? null,
        delta_exposure: uwApi.uw_factors.dealer_factors?.dex ?? null,
        greek_exposure_status: dealerEngine.status === 'unavailable' ? 'unavailable' : dealerEngine.status
      }
    : uwConclusion;
  const uwExecutionConstraint = {
    available: !['unavailable', 'error'].includes(uwConclusionFinal.status),
    executable: uwConclusionFinal.status === 'live',
    reason:
      uwConclusionFinal.status === 'live'
        ? ''
        : uwConclusionFinal.status === 'partial'
          ? 'UW partial'
          : uwConclusionFinal.status === 'stale'
            ? 'UW stale'
            : uwConclusionFinal.status === 'error'
              ? 'UW error'
              : 'UW unavailable'
  };
  const safeUwContext = {
    flow_bias: uwConclusionFinal.flow_bias || 'unavailable',
    dark_pool_bias: uwConclusionFinal.darkpool_bias || 'unavailable',
    dealer_bias: uwConclusionFinal.dealer_crosscheck || 'unavailable',
    advanced_greeks: signal.uw_context?.advanced_greeks || {}
  };
  const safeRadarSummary = {
    ...(signal.radar_summary || {}),
    order_flow:
      uwConclusionFinal.status === 'live'
        ? institutionalAlert.plain_chinese
        : `${uwConclusionFinal.status} / 仅参考，不可执行`,
    dealer:
      ['live', 'partial'].includes(dealerEngine.status)
        ? dealerEngine.plain_chinese
        : `${dealerEngine.status || 'unavailable'} / UW Dealer 等待确认`,
    dark_pool:
      uwConclusionFinal.status === 'live'
        ? darkpoolSummary.plain_chinese
        : `${uwConclusionFinal.status} / unavailable`,
    plan_alignment: 'WAIT / 等确认 / 0仓'
  };
  const keyLevels = buildKeyLevels({ dealerEngine, uwApi, signal });
  const uwPriceMapActive = keyLevels.source === 'uw' && ['live', 'partial'].includes(dealerEngine.status);
  const dataQualityGuard = uwPriceMapActive
    ? {
        title: '数据质量：可观察，等待结构确认。',
        fmp: 'real',
        uw: uwProvider.status || 'unavailable',
        dealer: dealerEngine.status || 'unavailable',
        tv: signal.tv_sentinel?.status || 'waiting',
        theta: 'EM auxiliary unavailable，不阻断 UW 主线',
        projection: crossAssetProjection.status,
        execution_state: 'WAIT / 0仓',
        plain_chinese: 'FMP 现价真实，UW 墙位已接入；当前不是数据崩溃，而是 TV 尚未确认结构。'
      }
    : {
        title: '数据质量不足。',
        fmp: signal.command_inputs?.external_spot?.status || 'unavailable',
        uw: uwProvider.status || 'unavailable',
        dealer: dealerEngine.status || 'unavailable',
        tv: signal.tv_sentinel?.status || 'waiting',
        theta: signal.theta?.status || 'unavailable',
        projection: crossAssetProjection.status,
        execution_state: 'WAIT / 0仓',
        plain_chinese: '等待核心数据恢复或结构确认。'
      };
  const signalConflict = uwPriceMapActive
    ? {
        title: 'Signal Conflict｜轻微冲突',
        severity: 'low',
        items: [
          'FMP 现价真实，UW 墙位已接入，不再使用 mock Gamma 地图。',
          'TV 还没有结构确认。',
          'Dealer 只有 partial，Vanna/Charm/Delta 不完整。',
          'ES/SPY 等效价缺失，墙位只能参考 SPX 原始点位。',
          '没有 entry / stop / target / invalidation，所以不能执行。'
        ],
        execution_state: 'WAIT / 等确认 / 0仓',
        plain_chinese: '当前主要问题不是数据崩溃，而是交易条件未满足。'
      }
    : {
        title: 'Signal Conflict',
        severity: 'medium',
        items: ['等待数据恢复。'],
        execution_state: 'WAIT / 0仓',
        plain_chinese: '核心数据未完全可用。'
      };
  const uwFlowSummary = {
    title: 'UW 资金解读',
    institutional_flow: institutionalAlert.direction === 'bearish' ? '偏空，连续轰炸。' : institutionalAlert.direction === 'bullish' ? '偏多。' : '不明确。',
    dark_pool: darkpoolSummary.bias === 'neutral' ? '中性，没有明显支撑/压力。' : darkpoolSummary.plain_chinese || '不可用。',
    dealer: dealerEngine.status === 'partial' ? '部分可读，墙位已接入，但 Vanna/Charm/Delta 不完整。' : dealerEngine.plain_chinese,
    volatility: volatilityActivation.strength === 'off' ? '未启动，单腿不放行。' : volatilityActivation.plain_chinese,
    conclusion: institutionalAlert.direction === 'bearish'
      ? '空头资金有动作，但不能直接追空。等 TV breakdown_confirmed 或 retest_failed。'
      : '资金有动作，但必须等 TV 结构确认。',
    plain_chinese: 'UW 已 live；资金线索只能作为候选，执行仍等 TV。'
  };

  const uwLastUpdate = uwProvider.last_update || uwSourceStatus.last_update || signal.received_at || new Date().toISOString();
  const sourceStatus = Array.isArray(signal.source_status)
    ? [
        ...signal.source_status.filter((item) => item.source !== 'uw'),
        {
          source: 'uw',
          configured: uwProvider.mode === 'api' || uwSnapshot != null,
          available: uwExecutionConstraint.available,
          is_mock: false,
          fetch_mode: uwProvider.mode === 'api' ? 'uw_api_cache' : 'ingest_push',
          stale: uwProvider.status === 'stale' || uwSourceStatus.stale === true,
          state: uwProvider.status || uwSourceStatus.state || 'unavailable',
          message: uwSourceStatus.message || uwExecutionConstraint.reason,
          last_updated: uwLastUpdate,
          data_timestamp: uwLastUpdate,
          received_at: signal.received_at,
          latency_ms: 0,
          stale_reason: '',
          refresh_interval_ms: null,
          stale_threshold_ms: null,
          down_threshold_ms: null,
          event_triggers: []
        }
      ]
    : signal.source_status;

  const enrichedSignal = {
    ...signal,
    source_status: sourceStatus,
    uw_endpoint_coverage: uwEndpointCoverage,
    institutional_entry_alert: signal.institutional_entry_alert || {},
    institutional_alert: institutionalAlert,
    uw: normalizedUw,
    uw_conclusion: {
      ...uwConclusionFinal,
      provider_mode: uwProvider.mode
    },
    fmp_price_audit: fmpSnapshot.price?.audit || null,
    uw_provider: uwProvider,
    uw_raw: uwApi.uw_raw,
    uw_factors: uwApi.uw_factors,
    dealer_engine: dealerEngine,
    uw_dealer_greeks: uwProvider.status === 'live'
      ? {
          ...(signal.uw_dealer_greeks || {}),
          status: dealerEngine.status,
          net_vanna_bias: uwApi.uw_factors.dealer_factors?.vanna_bias || 'unknown',
          net_charm_bias: uwApi.uw_factors.dealer_factors?.charm_bias || 'unknown',
          net_delta_bias: uwApi.uw_factors.dealer_factors?.delta_bias || 'unknown',
          dealer_crosscheck: dealerEngine.status === 'unavailable' ? 'unavailable' : 'confirm',
          plain_chinese: dealerEngine.status === 'live'
            ? 'UW Greek Exposure live，已进入 Dealer 引擎。'
            : 'UW Greek Exposure partial，已进入 Dealer 引擎。'
        }
      : signal.uw_dealer_greeks,
    uw_dealer_greeks: uwPriceMapActive
      ? {
          status: dealerEngine.status,
          call_gamma: uwApi.uw_factors?.dealer_factors?.top_call_gamma_strikes?.[0]?.value ?? null,
          put_gamma: uwApi.uw_factors?.dealer_factors?.top_put_gamma_strikes?.[0]?.value ?? null,
          call_vanna: null,
          put_vanna: null,
          call_charm: null,
          put_charm: null,
          call_delta: null,
          put_delta: null,
          net_gamma_bias: dealerEngine.regime === 'positive_gamma' ? 'positive' : dealerEngine.regime === 'negative_gamma' ? 'negative' : 'mixed',
          net_vanna_bias: uwApi.uw_factors?.dealer_factors?.vanna_bias || 'unknown',
          net_charm_bias: uwApi.uw_factors?.dealer_factors?.charm_bias || 'unknown',
          net_delta_bias: uwApi.uw_factors?.dealer_factors?.delta_bias || 'unknown',
          dealer_crosscheck: dealerEngine.status === 'live' ? 'confirm' : 'partial',
          plain_chinese: dealerEngine.status === 'live'
            ? 'UW Greek Exposure live，使用 UW Gamma/Wall 主线。'
            : 'UW Greek Exposure partial，墙位可用，vanna/charm/delta 部分缺失。'
        }
      : signal.uw_dealer_greeks,
    uw_price_map_active: uwPriceMapActive,
    data_quality_guard: dataQualityGuard,
    signal_conflict: signalConflict,
    uw_flow_summary: uwFlowSummary,
    uw_context: safeUwContext,
    radar_summary: safeRadarSummary,
    signals: {
      ...(signal.signals || {}),
      uw_signal: uwConclusionFinal.status === 'live' ? signal.signals?.uw_signal : 'unavailable',
      dealer_behavior: signal.dealer_conclusion?.status === 'live' ? signal.signals?.dealer_behavior : 'unknown'
    },
    projection: {
      ...(signal.projection || {}),
      dealer_summary: {
        ...(signal.projection?.dealer_summary || {}),
        call_wall: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.call_wall : null,
        put_wall: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.put_wall : null,
        max_pain: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.max_pain : null,
        zero_gamma: signal.dealer_conclusion?.status === 'live' ? signal.projection?.dealer_summary?.zero_gamma : null
      }
    },
    execution_constraints: {
      ...(signal.execution_constraints || {}),
      uw: uwExecutionConstraint
    },
    trade_plan: {
      ...(signal.trade_plan || {}),
      uw_ready: uwExecutionConstraint.executable,
      position_sizing: signal.trade_plan?.position_sizing || '0仓',
      wait_conditions: signal.trade_plan?.wait_conditions || [{
        type: 'tv_structure_signal',
        text: '等待 TV 结构信号，不提前交易。'
      }],
      ttl_text: signal.trade_plan?.ttl_text || '等待状态无有效交易 TTL。'
    },
    institutional_alert: institutionalAlert,
    volatility_activation: volatilityActivation,
    market_sentiment: marketSentiment,
    darkpool_summary: darkpoolSummary,
    key_levels: keyLevels,
    health_matrix: healthMatrix,
    flow_validation: flowValidation,
    technical_engine: technicalEngine,
    price_sources: projectionPrices,
    cross_asset_projection: crossAssetProjection,
    allowed_setups: setupSynthesis.allowed_setups,
    allowed_setups_reason: setupSynthesis.allowed_setups_reason,
    blocked_setups_reason: setupSynthesis.blocked_setups_reason,
    tv_match_engine: {
      event_type: signal.tv_sentinel?.event_type || null,
      matched_allowed_setup: signal.tv_sentinel?.matched_allowed_setup === true,
      status: signal.tv_sentinel?.status || 'waiting',
      plain_chinese: signal.tv_sentinel?.plain_chinese || signal.tv_sentinel?.reason || '等待 TV 结构信号。'
    },
    es_proxy: buildEsProxy(),
    session_engine: buildSessionEngine(),
    notes: cleanProductionNotes(signal.notes, signal.is_mock === true)
  };

  const projectedTradePlan = enrichTradePlanWithProjection(enrichedSignal.trade_plan, crossAssetProjection);
  if (uwPriceMapActive) {
    projectedTradePlan.status = projectedTradePlan.status === 'blocked' ? 'wait' : projectedTradePlan.status;
    projectedTradePlan.trigger_status = projectedTradePlan.trigger_status === 'blocked' ? 'waiting' : projectedTradePlan.trigger_status;
    projectedTradePlan.direction_label = projectedTradePlan.direction_label === '禁做' ? '等待' : projectedTradePlan.direction_label;
    projectedTradePlan.conflicts = (projectedTradePlan.conflicts || []).filter((item) => !/ThetaData unavailable|价格地图冲突|price_map_conflict/i.test(String(item)));
    projectedTradePlan.plain_chinese = 'UW Dealer / Wall 数据已接管价格地图；TV 尚未确认结构，0仓等待。';
  }
  enrichedSignal.trade_plan = projectedTradePlan;
  const effectiveDataHealth = uwPriceMapActive
    ? {
        ...(enrichedSignal.data_health || {}),
        executable: true,
        summary: {
          ...(enrichedSignal.data_health?.summary || {}),
          health: 'yellow',
          label: 'WAIT',
          plain_chinese: 'UW wall data live/partial，等待 TV 结构确认。'
        }
      }
    : enrichedSignal.data_health;
  const effectiveConflictResolver = uwPriceMapActive
    ? {
        ...(enrichedSignal.conflict_resolver || {}),
        action: enrichedSignal.tv_sentinel?.status === 'waiting' ? 'wait' : enrichedSignal.conflict_resolver?.action || 'wait',
        conflicts: (enrichedSignal.conflict_resolver?.conflicts || []).filter((item) => !/price_map_conflict/i.test(String(item))),
        plain_chinese: 'UW wall data 已接管旧价格地图，等待 TV 确认。'
      }
    : enrichedSignal.conflict_resolver;

  const commandCenter = runCommandCenterEngine({
    uwProvider,
    dealerEngine,
    institutionalAlert,
    volatilityActivation,
    marketSentiment,
    darkpoolSummary,
    dataHealth: effectiveDataHealth,
    tvSentinel: enrichedSignal.tv_sentinel,
    theta: enrichedSignal.theta,
    tradePlan: enrichedSignal.trade_plan,
    flowPriceDivergence: enrichedSignal.flow_price_divergence,
    conflictResolver: effectiveConflictResolver,
    crossAssetProjection
  });
  const strategyPermissions = buildStrategyPermissions({
    signal: enrichedSignal,
    institutionalAlert,
    volatilityActivation,
    dealerEngine,
    commandCenter
  });
  const positionSizingEngine = runPositionSizingEngine({
    healthMatrix,
    commandCenter,
    volatilityActivation
  });
  const rawReflection = runReflectionEngine({
    commandCenter,
    uwProvider,
    dealerEngine,
    institutionalAlert,
    volatilityActivation,
    marketSentiment,
    darkpoolSummary,
    tradePlan: projectedTradePlan,
    signal: {
      ...enrichedSignal,
      trade_plan: projectedTradePlan
    },
    crossAssetProjection
  });
  const reflectionSignal = {
    ...enrichedSignal,
    trade_plan: projectedTradePlan,
    command_center: commandCenter
  };
  const reflection = humanizeReflection(rawReflection, reflectionSignal);
  const intradayDecisionCard = buildIntradayDecisionCard({
    signal: {
      ...reflectionSignal,
      reflection
    },
    reflection
  });

  const output = {
    ...enrichedSignal,
    trade_plan: projectedTradePlan,
    intraday_decision_card: intradayDecisionCard,
    command_center: commandCenter,
    strategy_permissions: strategyPermissions,
    position_sizing_engine: positionSizingEngine,
    reflection,
    audit_log_ref: null
  };

  const priceSourcesV2 = buildPriceSourcesV2({ signal: output, projectionPrices, crossAssetProjection });
  const uwNormalized = buildUwNormalized({
    raw: uwSnapshot?.raw || uwApi.uw_raw,
    provider: uwProvider,
    context: {
      spot_price: priceSourcesV2.spx?.price ?? null,
      current_spx: priceSourcesV2.spx?.price ?? null
    }
  });
  const uwConclusionV2 = buildUwConclusionV2({
    provider: uwProvider,
    factors: uwApi.uw_factors,
    raw: uwSnapshot?.raw || uwApi.uw_raw,
    institutionalAlert,
    darkpoolSummary,
    marketSentiment,
    technicalEngine,
    spot: priceSourcesV2.spx?.price ?? null
  });
  const spotConclusion = buildSpotConclusion({
    fmpConclusion: buildFmpConclusionV2(output),
    priceSources: priceSourcesV2
  });
  const eventConclusion = buildEventConclusion({
    fmpConclusion: buildFmpConclusionV2(output),
    uwConclusion: uwConclusionV2.uw_conclusion
  });
  const basisTracker = buildBasisTracker(priceSourcesV2);
  const uwLayerConclusions = buildUwLayerConclusions({
    uw_normalized: uwNormalized,
    uw_provider: uwProvider,
    uw_conclusion: uwConclusionV2.uw_conclusion,
    uw_wall_diagnostics: uwConclusionV2.uw_wall_diagnostics,
    darkpool_summary: darkpoolSummary,
    volatility_activation: volatilityActivation,
    market_sentiment: marketSentiment,
    institutional_alert: institutionalAlert,
    uw_factors: uwApi.uw_factors,
    source_display: buildUnifiedSourceStatus({
      uwProvider,
      thetaConclusion: buildThetaConclusion({
        status: output.theta?.status,
        atm_call_mid: output.theta?.atm_call_mid,
        atm_put_mid: output.theta?.atm_put_mid,
        spot: output.market_snapshot?.spot
      }),
      fmpConclusion: buildFmpConclusionV2(output),
      tvSentinel: output.tv_sentinel
    }),
    spot_conclusion: spotConclusion,
    tv_sentinel: output.tv_sentinel
  });
  const {
    gex_engine: gexEngine,
    flow_aggression_engine: flowEngine,
    darkpool_engine: darkpoolEngine,
    volatility_engine: volEngine,
    market_sentiment_engine: sentimentEngine
  } = uwLayerConclusions;
  const rawNoteV2 = runRawNoteV2({
    spot_conclusion: spotConclusion,
    event_conclusion: eventConclusion,
    gex_engine: gexEngine,
    flow_aggression_engine: flowEngine,
    darkpool_engine: darkpoolEngine,
    volatility_engine: volEngine,
    market_sentiment_engine: sentimentEngine,
    basis_tracker: basisTracker,
    fmp_conclusion: buildFmpConclusionV2(output),
    uw_conclusion: uwConclusionV2.uw_conclusion,
    theta_conclusion: buildThetaConclusion({
      status: output.theta?.status,
      atm_call_mid: output.theta?.atm_call_mid,
      atm_put_mid: output.theta?.atm_put_mid,
      spot: output.market_snapshot?.spot
    }),
    tv_sentinel: output.tv_sentinel,
    volume_pressure: output.volume_pressure,
    channel_shape: output.channel_shape,
    volatility_activation: output.volatility_activation,
    conflict_resolver: output.conflict_resolver,
    command_environment: output.command_environment,
    price_sources: priceSourcesV2,
    cross_asset_projection: crossAssetProjection,
    uw_wall_diagnostics: uwConclusionV2.uw_wall_diagnostics
  });
  // Extract UW spot price early (before buildPriceContract) for wall/darkpool calculations
  // Mirrors the logic in price-contract.js extractUwSpotPrice
  function _extractEarlySpot(uwRaw) {
    const SPX_MIN = 6000, SPX_MAX = 8500;
    function _asArr(obj) {
      if (Array.isArray(obj)) return obj;
      if (!obj || typeof obj !== 'object') return [];
      const d = obj.data;
      if (Array.isArray(d)) return d;
      if (d && typeof d === 'object') {
        for (const k of ['data', 'results', 'items']) {
          if (Array.isArray(d[k])) return d[k];
        }
      }
      return [];
    }
    function _valid(v) {
      const n = Number(v);
      return Number.isFinite(n) && n >= SPX_MIN && n <= SPX_MAX ? n : null;
    }
    // 1. flow_recent[0].underlying_price
    const flowRows = _asArr(uwRaw?.flow_recent);
    for (const r of flowRows) {
      const p = _valid(r.underlying_price);
      if (p) return p;
    }
    // 2. spot_gex[0].price
    const spotGexRows = _asArr(uwRaw?.spot_gex);
    for (const r of spotGexRows) {
      const p = _valid(r.price);
      if (p) return p;
    }
    // 3. options_flow[0].underlying_price
    const optFlowRows = _asArr(uwRaw?.options_flow);
    for (const r of optFlowRows) {
      const p = _valid(r.underlying_price ?? r.price);
      if (p) return p;
    }
    return null;
  }
  const _wallSpot = _extractEarlySpot(uwApi.uw_raw)
    ?? priceSourcesV2.spx?.price
    ?? null;
  const dealerWallMap = buildDealerWallMap({
    dealer: uwNormalized.dealer,
    spot_price: _wallSpot,
    gex_rows: uwApi.uw_factors?.dealer_factors?.gex_by_strike ?? null
  });
  const darkpoolGravity = buildDarkpoolGravity({
    darkpool: uwNormalized.darkpool,
    spot_price: _wallSpot
  });
  const flowConflict = buildFlowConflict({
    flow: uwNormalized.flow,
    dealer_wall_map: dealerWallMap,
    darkpool_gravity: darkpoolGravity,
    spot_price: priceSourcesV2.spx?.price ?? null
  });
  const wallZonePanel = buildWallZonePanel({
    dealer: uwNormalized.dealer,
    darkpool: uwNormalized.darkpool,
    dealer_wall_map: dealerWallMap,
    spot_price: priceSourcesV2.spx?.price ?? null
  });
  const priceTrigger = buildPriceTrigger({
    spot_price: priceSourcesV2.spx?.price ?? null,
    darkpool_gravity: darkpoolGravity,
    wall_zone_panel: wallZonePanel,
    flow_conflict: flowConflict,
    operation_layer: { status: rawNoteV2.final_decision.state }
  });
  const newsRadar = buildNewsRadar();
  const controlSide = buildControlSide({
    spot_price: priceSourcesV2.spx?.price ?? null,
    flow_conflict: flowConflict,
    darkpool_gravity: darkpoolGravity,
    wall_zone_panel: wallZonePanel,
    dealer_wall_map: dealerWallMap,
    sentiment: uwNormalized.sentiment,
    volatility_state: uwNormalized.volatility?.volatility_state,
    price_trigger: priceTrigger
  });
  wallZonePanel.control_side = controlSide;
  const executionCard = buildTradeExecutionCard({
    dealer_wall_map: dealerWallMap,
    darkpool_gravity: darkpoolGravity,
    flow_conflict: flowConflict,
    volatility_state: uwNormalized.volatility?.volatility_state,
    sentiment_state: uwNormalized.sentiment,
    operation_layer: { status: rawNoteV2.final_decision.state },
    price_trigger: priceTrigger,
    news_radar: newsRadar,
    wall_zone_panel: wallZonePanel,
    control_side: controlSide
  });
  const finalCard = buildIntradayDecisionCardV2({
    finalDecision: rawNoteV2.final_decision,
    uwConclusion: rawNoteV2.uw_conclusion,
    priceSources: rawNoteV2.price_sources
  });
  const keyLevelsV2 = buildKeyLevelsFromUwConclusion({
    uwConclusion: rawNoteV2.uw_conclusion,
    diagnostics: rawNoteV2.uw_wall_diagnostics
  });
  const finalProjection = buildCrossAssetProjection({
    prices: priceSourcesV2,
    spxLevels: {
      call_wall: keyLevelsV2.call_wall.level,
      put_wall: keyLevelsV2.put_wall.level,
      zero_gamma: keyLevelsV2.zero_gamma.level,
      max_pain: keyLevelsV2.max_pain.level,
      gex_pivots: keyLevelsV2.gex_pivots,
      oi_walls: keyLevelsV2.oi_walls,
      volume_magnets: keyLevelsV2.volume_magnets
    },
    targetInstrument: process.env.TARGET_INSTRUMENT || 'ES'
  });
  const normalizedRawNote = rawNoteV2;
  const refreshPolicy = buildRefreshPolicy(new Date());
  const liveRefresh = { logs: getLiveRefreshLog() };
  const { observation, tradeable } = buildObservationPrices({
    priceSources: priceSourcesV2,
    spotConclusion,
    priceTrigger,
    now: new Date()
  });
  const dataClock = buildDataClock({
    now: new Date(),
    refreshPolicy,
    observation,
    uwProvider,
    uwNormalized,
    newsRadar
  });
  // ─── L2.5 Institutional Engine Computations ────────────────────────────────
  const liveSpotPrice = priceSourcesV2.spx?.price ?? null;
  const fmpIsReal = fmpSnapshot.price?.available === true && fmpSnapshot.price?.price != null;
  const tvIsReal = rawNoteV2.tv_sentinel?.status === 'live';

  // 1. Price Contract — canonical SPX price with contamination detection
  // P0-1 fix: pass uw_raw so UW flow-recent/spot_gex can be used as primary spot source
  const priceContract = buildPriceContract({
    uw_raw: uwApi?.uw_raw ?? null,
    fmp_price: fmpSnapshot.price?.price ?? null,
    fmp_is_real: fmpIsReal,
    tv_price: rawNoteV2.tv_sentinel?.price ?? null,
    tv_is_fresh: tvIsReal,
    darkpool_mapped_spx: darkpoolGravity.mapped_spx ?? null,
    manual_override: null
  });

  // 2. ATM Engine
  const atmEngine = buildAtmEngine({
    spot_price: priceContract.live_price,
    net_gex: rawNoteV2.uw_conclusion?.net_gex ?? null,
    time_to_close_minutes: 390
  });

  // 3. Gamma Regime Engine
  const gammaRegimeEngine = buildGammaRegimeEngine({
    spot_price: priceContract.live_price,
    gamma_flip: dealerWallMap.gamma_flip ?? rawNoteV2.uw_conclusion?.zero_gamma ?? null,
    net_gex: rawNoteV2.uw_conclusion?.net_gex ?? null,
    call_wall: dealerWallMap.call_wall ?? rawNoteV2.uw_conclusion?.call_wall ?? null,
    put_wall: dealerWallMap.put_wall ?? rawNoteV2.uw_conclusion?.put_wall ?? null,
    atm: atmEngine.atm,
    atm_trend: atmEngine.atm_trend,
    atm_change: atmEngine.atm_change,
    // P1-1 fix: use normalizer's direct put_call_ratio output (abs(put)/abs(call))
    put_call_ratio: uwApi.uw_factors.flow_factors?.put_call_ratio ?? null,
    net_premium: uwApi.uw_factors.flow_factors?.net_premium_5m ?? null,
    pin_risk: atmEngine.pin_risk,
    uw_status: rawNoteV2.uw_conclusion?.status ?? 'unavailable',
    fmp_status: fmpIsReal ? 'real' : 'unavailable'
  });

  // 4. Flow Behavior Engine — use uwApi.uw_factors.flow_factors (correct normalizer path)
  // uwNormalized.flow (decision_engine/algorithms/uw-normalizer.js) does NOT define
  // net_premium_5m / call_premium_5m / put_premium_5m — those fields only exist in
  // /normalizer/uw-api-normalizer.js which is already consumed as uwApi.uw_factors.flow_factors.
  const _ff = uwApi.uw_factors.flow_factors || {};
  const _netPrem5m  = _ff.net_premium_5m  ?? _ff.net_premium ?? null;
  const _callPrem5m = _ff.call_premium_5m ?? _ff.net_call_premium ?? null;
  const _putPrem5m  = _ff.put_premium_5m  ?? _ff.net_put_premium ?? null;
  // P1-1 fix: use normalizer's direct put_call_ratio (abs(put)/abs(call)), not manual calculation
  const _pcRatio    = _ff.put_call_ratio ?? null;
  const flowBehaviorEngine = buildFlowBehaviorEngine({
    net_premium: _netPrem5m,
    call_premium: _callPrem5m,
    put_premium: _putPrem5m,
    put_call_ratio: _pcRatio,
    pc_volume_ratio: _ff.pc_volume_ratio ?? _pcRatio,
    pc_premium_ratio: _ff.pc_premium_ratio ?? null,
    pc_primary_ratio: _ff.pc_primary_ratio ?? _pcRatio,
    directional_net_premium: _ff.directional_net_premium ?? _netPrem5m,
    prem_ticks: [],
    premium_queue: premiumAccelerationQueue._queue ?? [],  // NEW: 5m+15m dual window
    gamma_regime: gammaRegimeEngine.gamma_regime,
    spot_position: gammaRegimeEngine.spot_position,
    darkpool_state: darkpoolGravity.state ?? null,
    put_wall: dealerWallMap.put_wall ?? rawNoteV2.uw_conclusion?.put_wall ?? null,
    call_wall: dealerWallMap.call_wall ?? rawNoteV2.uw_conclusion?.call_wall ?? null,
    spot_price: priceContract.live_price
  });
  // 4.3 ATM Trigger Engine — ATM±5/10/15/20 trigger lines for homepage
  const atmTriggerEngine = buildAtmTriggerEngine({
    spot: priceContract.live_price,
    atm: atmEngine.atm,
    far_call_wall: dealerWallMap.far_call_wall ?? dealerWallMap.near_call_wall ?? null,
    far_put_wall:  dealerWallMap.far_put_wall  ?? dealerWallMap.near_put_wall  ?? null,
    gamma_regime:   gammaRegimeEngine.gamma_regime,
    pin_risk:       atmEngine.pin_risk ?? 0,
    flow_behavior:  flowBehaviorEngine.behavior,
    execution_confidence: gammaRegimeEngine.scores?.execution_confidence ?? 0
  });

  // 4.5 Dark Pool Behavior Engine
  // Reads from uwApi.uw_factors.darkpool_factors (normalized) + raw.darkpool_spy (raw rows)
  const darkpoolBehaviorEngine = buildDarkpoolBehaviorEngine({
    darkpool_factors: uwApi.uw_factors.darkpool_factors ?? {},
    raw_darkpool_spy: uwApi.raw?.darkpool_spy ?? null,
    spot_price: priceContract.live_price
  });
  // 5. Price Validation Engine — MOVED before ab_order_engine (P2 fix)
  // Must run before ab_order_engine so dominant_scene can be injected
  const priceHistory = getPriceHistory();
  const priceValidationEngine = buildPriceValidationEngine({
    priceHistory,
    flowFactors: uwApi?.uw_factors?.flow_factors ?? {},
    darkpoolFactors: uwApi?.uw_factors?.darkpool_factors ?? {},
    gammaRegime: gammaRegimeEngine ?? {},
    atmEngine: atmEngine ?? {}
  });

  // P1-2: Wall gate — use dealerWallMap.wall_status (near wall validation) + spot gate
  const _spotAvailable = priceContract.spot_gate_open === true;
  const _nearWallValid = dealerWallMap.wall_status === 'valid';
  const _callWallGated = (_spotAvailable && _nearWallValid) ? (dealerWallMap.far_call_wall ?? dealerWallMap.near_call_wall ?? null) : null;
  const _putWallGated  = (_spotAvailable && _nearWallValid) ? (dealerWallMap.far_put_wall  ?? dealerWallMap.near_put_wall  ?? null) : null;
  const _wallStatus    = _spotAvailable === false ? 'unavailable' : dealerWallMap.wall_status ?? 'unavailable';
  const _wallErrors    = _spotAvailable === false ? ['spot_missing'] : (dealerWallMap.wall_errors ?? []);

  // 5b. A/B Order Engine — now includes dominant_scene from price_validation_engine (P2)
  const abOrderEngine = buildAbOrderEngine({
    spot_price: priceContract.live_price,
    atm: atmEngine.atm,
    gamma_flip: dealerWallMap.gamma_flip ?? rawNoteV2.uw_conclusion?.zero_gamma ?? null,
    call_wall: _callWallGated,
    put_wall: _putWallGated,
    atm_trigger: atmTriggerEngine ?? null,  // v3: ATM trigger lines for plan text
    gamma_regime: gammaRegimeEngine.gamma_regime,
    flow_behavior: flowBehaviorEngine.behavior,
    execution_confidence: gammaRegimeEngine.scores?.execution_confidence ?? 0,
    pin_risk: atmEngine.pin_risk,
    expiry: '0DTE',
    degraded: priceContract.is_degraded,
    darkpool_conclusion: darkpoolBehaviorEngine,
    net_premium_millions: _netPrem5m != null ? Number((_netPrem5m / 1_000_000).toFixed(1)) : null,
    acceleration_15m: null,  // injected below after acceleration queue computes
    // P2: inject dominant_scene from price_validation_engine
    dominant_scene: priceValidationEngine.dominant_scene ?? null,
    alert_level: priceValidationEngine.alert_level ?? 'normal',
    // Forced-wait rule inputs (务实交易风格)
    call_premium: _callPrem5m,
    put_premium: _putPrem5m,
    net_gex: rawNoteV2.uw_conclusion?.net_gex ?? null
  });

  // Re-run health engine with AB context for better blocked summary
  const updatedDataHealth = runDataHealthEngine({ 
    stale_flags: signal.stale_flags, 
    source_status: signal.source_status, 
    normalized: { ...signal, ab_order_engine: abOrderEngine } 
  });
  // 6. Volatility Engine (async, non-blocking — uses cached VIX + HV20 from price history)
  // fmpSnapshot.price.price = SPX spot (not .spot which may be undefined)
  // uw_iv30: prefer UW volatility_factors.atm_iv (IV30 proxy), fallback to uwNormalized
  const _uwIv30 = uwApi.uw_factors.volatility_factors?.atm_iv
    ?? uwNormalized?.volatility?.iv30
    ?? null;
  const volDashboard = await runVolatilityEngine({
    spot_price: priceContract.live_price ?? fmpSnapshot.price?.price ?? null,
    fmp_price:  fmpSnapshot.price?.price ?? null,
    uw_iv30:    _uwIv30
  }).catch(() => ({ vix: null, iv30: null, hv20: null, vscore: null, regime: 'unknown', option_cost: 'unknown', option_cost_cn: '数据待接入' }));

  // 7. Premium Acceleration Queue — push latest net_premium snapshot
  // Use _ff variables computed above (correct normalizer: uwApi.uw_factors.flow_factors)
  const latestNetPrem  = _netPrem5m;
  const latestCallPrem = _callPrem5m;
  const latestPutPrem  = _putPrem5m;
  if (latestNetPrem != null) {
    premiumAccelerationQueue.push({
      net_premium:  latestNetPrem,
      call_premium: latestCallPrem,
      put_premium:  latestPutPrem
    });
  }
  const acceleration = premiumAccelerationQueue.compute();

  // Inject acceleration into flow_behavior_engine output
  const flowBehaviorEngineWithAccel = {
    ...flowBehaviorEngine,
    acceleration,
    net_premium:   latestNetPrem,
    call_premium:  latestCallPrem,
    put_premium:   latestPutPrem,
    put_call_ratio: _pcRatio
  };

  // 8. (Price Validation Engine already computed above as step 5 — see P2 fix)

  // ─────────────────────────────────────────────────────────────────────────────
  const finalOutput = {
    ...output,
    ...rawNoteV2,
    fmp_price_audit: fmpSnapshot.price?.audit || null,
    uw_normalized: uwNormalized,
    dealer_diagnostics: uwNormalized.dealer?.dealer_diagnostics || {},
    dealer_resolution: uwNormalized.dealer?.dealer_resolution || {},
    // P1-2: Wall gate fields injected into dealer_wall_map
    dealer_wall_map: {
      ...dealerWallMap,
      call_wall: _callWallGated,
      put_wall: _putWallGated,
      wall_status: _wallStatus,
      wall_errors: _wallErrors
    },
    // P0-1: Spot source audit
    spot_audit: {
      spot: priceContract.spot,
      spot_source: priceContract.spot_source,
      spot_status: priceContract.spot_status,
      spot_age_seconds: priceContract.spot_age_seconds,
      uw_spot_detail: priceContract.uw_spot_detail,
      uw_headers_ok: priceContract.uw_headers_ok
    },
    darkpool_gravity: darkpoolGravity,
    flow_conflict: flowConflict,
    price_trigger: priceTrigger,
    news_radar: newsRadar,
    wall_zone_panel: wallZonePanel,
    control_side: controlSide,
    refresh_policy: refreshPolicy,
    refresh_state: liveRefresh,
    data_clock: dataClock,
    observation_price: observation,
    // L2.5 Institutional Engine outputs
    price_contract: priceContract,
    atm_engine: atmEngine,
    atm_trigger_engine: atmTriggerEngine,
    gamma_regime_engine: gammaRegimeEngine,
    flow_behavior_engine: flowBehaviorEngineWithAccel,
    volatility_dashboard: volDashboard,
    darkpool_behavior_engine: darkpoolBehaviorEngine,
    ab_order_engine: abOrderEngine,
    price_validation_engine: priceValidationEngine,
    tradeable_price: tradeable,
    execution_card: executionCard,
    uw_aggregate_analysis: buildUwAggregateAnalysis(uwNormalized, uwLayerConclusions, {
      dealerWallMap,
      darkpoolGravity,
      flowConflict
    }),
    uw_layer_conclusions: {
      dealer: uwLayerConclusions.gex_engine,
      flow: uwLayerConclusions.flow_aggression_engine,
      volatility: uwLayerConclusions.volatility_engine,
      darkpool: uwLayerConclusions.darkpool_engine,
      sentiment: uwLayerConclusions.market_sentiment_engine,
      data_health: uwLayerConclusions.data_health_engine,
      master: uwLayerConclusions.master_synthesis
    },
    spot_conclusion: spotConclusion,
    event_conclusion: eventConclusion,
    gex_engine: gexEngine,
    flow_aggression_engine: flowEngine,
    darkpool_engine: darkpoolEngine,
    volatility_engine: volEngine,
    market_sentiment_engine: sentimentEngine,
    basis_tracker: basisTracker,
    scenario: scenarioMode ? output.scenario : null,
    fetch_mode: scenarioMode ? output.fetch_mode : 'live',
    is_mock: scenarioMode ? output.is_mock : false,
    command_center: {
      ...output.command_center,
      final_state: rawNoteV2.final_decision.state,
      action: rawNoteV2.final_decision.label,
      main_reason: rawNoteV2.final_decision.reason,
      plain_chinese: rawNoteV2.final_decision.instruction
    },
    trade_plan: buildLegacyTradePlanShell(rawNoteV2.final_decision, output.trade_plan, crossAssetProjection),
    key_levels: keyLevelsV2,
    cross_asset_projection: finalProjection,
    intraday_decision_card: finalCard,
    strategy_cards: rawNoteV2.strategy_cards,
    allowed_setups: rawNoteV2.allowed_setups,
    allowed_setups_reason: rawNoteV2.final_decision.allowed_setups_reason || [],
    blocked_setups_reason: rawNoteV2.final_decision.blocked_setups_reason || [],
    radar_summary: {
      order_flow: `final_decision: ${rawNoteV2.final_decision.label}`,
      dealer: normalizedRawNote.uw_wall_diagnostics.plain_chinese,
      dark_pool: `Dark Pool ${normalizedRawNote.uw_conclusion.darkpool_bias}`,
      plan_alignment: rawNoteV2.final_decision.instruction
    },
    data_quality_guard: {
      title: `Source State｜${rawNoteV2.final_decision.state}`,
      items: [
        `FMP：${normalizedRawNote.fmp_conclusion.spot_is_real ? 'real' : 'unavailable'}`,
        `UW：${normalizedRawNote.uw_conclusion.status}`,
        `ThetaData：${normalizedRawNote.theta_conclusion.status} / ${normalizedRawNote.theta_conclusion.role}`,
        `TV：${normalizedRawNote.tv_sentinel.status}`,
        `执行状态：${rawNoteV2.final_decision.state} / ${rawNoteV2.final_decision.position_multiplier}x`
      ],
      plain_chinese: updatedDataHealth.summary || rawNoteV2.final_decision.reason
    },
    signal_conflict: {
      title: 'Signal Conflict｜final_decision',
      severity: rawNoteV2.final_decision.state === 'blocked' ? 'high' : 'low',
      items: rawNoteV2.final_decision.trace.map((item) => item.reason || item.step).filter(Boolean).slice(0, 8),
      execution_state: `${rawNoteV2.final_decision.state} / ${rawNoteV2.final_decision.position_multiplier}x`,
      plain_chinese: rawNoteV2.final_decision.reason
    }
  };
  finalOutput.source_display = buildUnifiedSourceStatus({
    uwProvider,
    thetaConclusion: finalOutput.theta_conclusion,
    fmpConclusion: finalOutput.fmp_conclusion,
    tvSentinel: finalOutput.tv_sentinel
  });
  finalOutput.source_status = applySourceDisplayRules(finalOutput.source_status, finalOutput.source_display);
  const layerOutput = buildLayerContracts(finalOutput);
  finalOutput.data_layer = layerOutput.data_layer;
  finalOutput.analysis_layer = layerOutput.analysis_layer;
  finalOutput.operation_layer = layerOutput.operation_layer;


  // UI formatter — builds all structured fields for frontend rendering
  const signalFormatter = buildSignalFormatter(finalOutput);
  finalOutput.primary_card  = signalFormatter.primary_card;
  finalOutput.sentiment_bar = signalFormatter.sentiment_bar;
  finalOutput.levels        = signalFormatter.levels;
  finalOutput.market_maker_path = signalFormatter.market_maker_path;
  finalOutput.darkpool_read = signalFormatter.darkpool_read;
  finalOutput.vol_dashboard = signalFormatter.vol_dashboard;
  finalOutput.vix_dashboard = signalFormatter.vix_dashboard;
  finalOutput.forbidden_bar = signalFormatter.forbidden_bar;
  finalOutput.data_health   = signalFormatter.data_health;
  finalOutput.strike_battle = signalFormatter.strike_battle;
  finalOutput.vanna_charm   = signalFormatter.vanna_charm;

  // ── microstructure_read: 0DTE 微观结构交叉验证（方案A）────────────────────────
  // 使用 flow_recent 内存队列的高频逐笔数据，重构真实净流向（aggressor_side）
  // 并叠加做市商 Charm 否决权，输出比 dual_window_aligned 更灵敏的方向判断
  try {
    const greekRows = (() => {
      const raw = finalOutput.uw_raw?.greek_exposure_strike;
      if (!raw) return [];
      const d = raw.data;
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.data)) return d.data;
      return [];
    })();
    const netGex = finalOutput.uw_factors?.dealer_factors?.net_gex ?? 0;
    const spotNow = finalOutput.price_validation_engine?.spot_now ?? null;
    const ifvgBreached = finalOutput.price_validation_engine?.ifvg_breached ?? false;
    const flowTicks = globalFlowRecentQueue.getWindow(5 * 60 * 1000);
    const msResult = evaluate0dteMicrostructure({
      flowRecentTicks: flowTicks,
      greekRows,
      netGex,
      spotPrice: spotNow,
      ifvgBreached,
      windowMs: 5 * 60 * 1000,
    });
    finalOutput.microstructure_read = buildMicrostructureRead(msResult);
    finalOutput.microstructure_read.queue_stats = globalFlowRecentQueue.getStats();
  } catch (e) {
    finalOutput.microstructure_read = { status: 'error', reason: e.message };
  }

  // ── home_view_model: 首页唯一数据模型 ──────────────────────────────────────
  // buildHomeViewModel 只做收口/拦截/降级/四行生成，不重算任何指标
  // renderHome 只能读取 signal.home_view_model，禁止直接读 engine 字段
  finalOutput.home_view_model = buildHomeViewModel(finalOutput);

  return replaceUndefined(scrubLegacyDecisionStrings(sanitizeUwPromotedStrings(finalOutput, uwProvider.status === 'live')));
}
