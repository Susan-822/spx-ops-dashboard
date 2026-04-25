import { ACTIONS } from '../../../packages/shared/src/action-enum.js';

const SETUP_TO_ACTION = Object.freeze({
  A_LONG_PULLBACK: ACTIONS.LONG_ON_PULLBACK,
  A_SHORT_RETEST: ACTIONS.SHORT_ON_RETEST,
  B_LONG_PULLBACK: ACTIONS.LONG_ON_PULLBACK,
  B_SHORT_RETEST: ACTIONS.SHORT_ON_RETEST,
  B_IRON_CONDOR: ACTIONS.INCOME_OK
});

function buildPlanName(setupCode) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return 'A 单｜回踩做多';
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return 'A 单｜反抽做空';
  }
  if (setupCode === 'B_LONG_PULLBACK') {
    return 'B 单｜回踩守多';
  }
  if (setupCode === 'B_SHORT_RETEST') {
    return 'B 单｜反抽失败做空';
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return 'B 单｜区间铁鹰';
  }
  return '未生成交易计划';
}

function buildTriggerText(setupCode, normalized) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return `价格回踩 flip ${normalized.flip_level} 上方并重新企稳。`;
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return `价格反抽不过 call_wall ${normalized.call_wall}。`;
  }
  if (setupCode === 'B_LONG_PULLBACK') {
    return `价格回踩关键支撑并重新转强。`;
  }
  if (setupCode === 'B_SHORT_RETEST') {
    return `价格反抽关键压力失败并重新转弱。`;
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return `价格继续围绕 max_pain ${normalized.max_pain} 钉住，且波动继续回落。`;
  }
  return '等待新的价格条件。';
}

function buildTargetText(setupCode, normalized) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return `${normalized.max_pain} -> ${normalized.call_wall}`;
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return `${normalized.put_wall} -> ${normalized.max_pain}`;
  }
  if (setupCode === 'B_LONG_PULLBACK') {
    return `${normalized.max_pain} -> ${normalized.call_wall}`;
  }
  if (setupCode === 'B_SHORT_RETEST') {
    return `${normalized.put_wall} -> ${normalized.max_pain}`;
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return `${normalized.put_wall} - ${normalized.call_wall}`;
  }
  return '未生成目标位。';
}

function buildInvalidationText(setupCode, normalized) {
  if (setupCode === 'A_LONG_PULLBACK') {
    return `回踩跌破 put_wall ${normalized.put_wall}`;
  }
  if (setupCode === 'A_SHORT_RETEST') {
    return `反抽重新站上 call_wall ${normalized.call_wall}`;
  }
  if (setupCode === 'B_LONG_PULLBACK') {
    return `3m 收回关键支撑下方，或 Call Flow 转弱。`;
  }
  if (setupCode === 'B_SHORT_RETEST') {
    return `3m 重新站回关键压力上方，或 Put Flow 衰退。`;
  }
  if (setupCode === 'B_IRON_CONDOR') {
    return `IV 不再回落，或价格离开 ${normalized.put_wall} - ${normalized.call_wall} 区间`;
  }
  return `价格重新失守 flip ${normalized.flip_level}`;
}

function planFamilyFromSetup(setupCode) {
  return setupCode?.startsWith('A_') ? 'A' : setupCode?.startsWith('B_') ? 'B' : null;
}

function directionLabel(setupCode) {
  switch (setupCode) {
    case 'A_LONG_PULLBACK':
      return 'A多';
    case 'B_LONG_PULLBACK':
      return 'B多';
    case 'A_SHORT_RETEST':
      return 'A空';
    case 'B_SHORT_RETEST':
      return 'B空';
    case 'B_IRON_CONDOR':
      return '等待';
    default:
      return '禁做';
  }
}

function sideFromSetup(setupCode) {
  if (setupCode === 'A_LONG_PULLBACK' || setupCode === 'B_LONG_PULLBACK') return 'long';
  if (setupCode === 'A_SHORT_RETEST' || setupCode === 'B_SHORT_RETEST') return 'short';
  return 'neutral';
}

function strategyPermissionFromSetup(setupCode, commandEnvironment) {
  const uwConstraint = commandEnvironment?.uw_constraint || {};
  const uwReady = uwConstraint.executable === true;

  if (!setupCode) {
    return {
      single_leg: 'block',
      vertical: 'wait',
      iron_condor: 'block'
    };
  }

  if (setupCode === 'B_IRON_CONDOR') {
    return {
      single_leg: 'block',
      vertical: 'wait',
      iron_condor: commandEnvironment?.allowed ? 'allow' : 'block'
    };
  }

  return {
    single_leg: setupCode.startsWith('A_') && uwReady ? 'allow' : 'wait',
    vertical: commandEnvironment?.allowed ? 'allow' : 'wait',
    iron_condor: 'block'
  };
}

function emptyPriceField(text = '--') {
  return {
    from: null,
    to: null,
    basis: '',
    text
  };
}

function emptyTargets() {
  return [
    { name: 'TP1', level: null, basis: '', action: '--' },
    { name: 'TP2', level: null, basis: '', action: '--' },
    { name: 'TP3', level: null, basis: '', action: '--' }
  ];
}

function reasonTag(reason) {
  return reason || '--';
}

function hasValidNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) !== 0;
}

function hasValidEntryZone(entryZone) {
  return hasValidNumber(entryZone?.from) || hasValidNumber(entryZone?.to);
}

function hasValidStopLoss(stopLoss) {
  return hasValidNumber(stopLoss?.level);
}

function hasValidInvalidation(invalidation) {
  return Boolean(invalidation?.text) && invalidation.text !== '--';
}

function hasValidTargetOne(targets = []) {
  const tp1 = Array.isArray(targets) ? targets.find((item) => item?.name === 'TP1') : null;
  return hasValidNumber(tp1?.level);
}

function buildEntryZone(setupCode, normalized) {
  switch (setupCode) {
    case 'A_LONG_PULLBACK':
      return {
        from: normalized.flip_level,
        to: normalized.flip_level,
        basis: 'flip',
        text: `回踩 ${normalized.flip_level} 附近并重新转强`
      };
    case 'B_LONG_PULLBACK':
      return {
        from: normalized.put_wall,
        to: normalized.flip_level,
        basis: 'support-zone',
        text: `回踩 ${normalized.put_wall}-${normalized.flip_level} 支撑区不破`
      };
    case 'A_SHORT_RETEST':
      return {
        from: normalized.call_wall,
        to: normalized.call_wall,
        basis: 'call_wall',
        text: `反抽 ${normalized.call_wall} 附近受阻`
      };
    case 'B_SHORT_RETEST':
      return {
        from: normalized.flip_level,
        to: normalized.call_wall,
        basis: 'resistance-zone',
        text: `反抽 ${normalized.flip_level}-${normalized.call_wall} 压力区失败`
      };
    default:
      return emptyPriceField();
  }
}

function buildStopLoss(setupCode, normalized, tradingviewSentinel) {
  const invalidationLevel = Number.isFinite(Number(tradingviewSentinel?.invalidation_level))
    && Number(tradingviewSentinel.invalidation_level) !== 0
    ? Number(tradingviewSentinel.invalidation_level)
    : null;

  if (invalidationLevel != null) {
    return {
      level: invalidationLevel,
      basis: 'tv_invalidation_level',
      text: `以 TV 失效位 ${invalidationLevel} 为止损`
    };
  }

  switch (setupCode) {
    case 'A_LONG_PULLBACK':
      return {
        level: normalized.put_wall,
        basis: 'put_wall',
        text: `跌破 ${normalized.put_wall} 止损`
      };
    case 'B_LONG_PULLBACK':
      return {
        level: normalized.put_wall,
        basis: 'support',
        text: `跌破 ${normalized.put_wall} 且 3m 收不回`
      };
    case 'A_SHORT_RETEST':
      return {
        level: normalized.call_wall,
        basis: 'call_wall',
        text: `重新站上 ${normalized.call_wall} 止损`
      };
    case 'B_SHORT_RETEST':
      return {
        level: normalized.call_wall,
        basis: 'resistance',
        text: `重新站回 ${normalized.call_wall} 上方`
      };
    default:
      return {
        level: null,
        basis: '',
        text: '--'
      };
  }
}

function buildInvalidation(setupCode, normalized) {
  return {
    level: null,
    condition: buildInvalidationText(setupCode, normalized),
    text: buildInvalidationText(setupCode, normalized)
  };
}

function buildTargets(setupCode, normalized) {
  if (!setupCode) {
    return emptyTargets();
  }

  if (setupCode === 'A_LONG_PULLBACK' || setupCode === 'B_LONG_PULLBACK') {
    return [
      { name: 'TP1', level: normalized.max_pain, basis: 'max_pain', action: '先减仓观察延续' },
      { name: 'TP2', level: normalized.call_wall, basis: 'call_wall', action: '继续减仓' },
      { name: 'TP3', level: null, basis: 'em_upper', action: '--' }
    ];
  }

  if (setupCode === 'A_SHORT_RETEST' || setupCode === 'B_SHORT_RETEST') {
    return [
      { name: 'TP1', level: normalized.max_pain, basis: 'max_pain', action: '先减仓观察延续' },
      { name: 'TP2', level: normalized.put_wall, basis: 'put_wall', action: '继续减仓' },
      { name: 'TP3', level: null, basis: 'em_lower', action: '--' }
    ];
  }

  return emptyTargets();
}

function buildPlainChinese({ status, directionLabelText, commandEnvironment, tradingviewSentinel, setupCode }) {
  if (status === 'invalidated') {
    return '旧方向作废，停止追随，等待新的 A/B 结构。';
  }
  if (status === 'blocked') {
    return `${commandEnvironment?.plain_chinese || commandEnvironment?.reason || '底层环境不支持执行。'} 即使 TV 触发，也只可等待。`;
  }
  if (status === 'waiting') {
    return `${commandEnvironment?.plain_chinese || commandEnvironment?.reason || '底层环境支持观察。'} 但 ${tradingviewSentinel?.plain_chinese || tradingviewSentinel?.reason || 'TV 条件尚未到位'}。`;
  }
  return `${directionLabelText} 已进入可执行准备，等待进场区与触发条件同时满足。`;
}

export function runTradePlanBuilder({ normalized, commandEnvironment, allowedSetups, tradingviewSentinel }) {
  const sentinelReason = tradingviewSentinel?.plain_chinese || tradingviewSentinel?.reason || '价格条件尚未到位。';
  const nonExecutableReason =
    commandEnvironment?.reason
    || commandEnvironment?.coherence_reason
    || commandEnvironment?.plain_chinese
    || '指挥部环境尚未允许执行。';

  if (tradingviewSentinel?.event_type === 'structure_invalidated') {
    return {
      active: false,
      status: 'invalidated',
      has_trade_plan: false,
      triggered_by_tv: false,
      plan_family: null,
      setup_code: null,
      setup_type: 'none',
      direction_label: '结构作废',
      side: 'neutral',
      bias: 'neutral',
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'invalidated',
      title: '结构作废',
      entry_zone: emptyPriceField(),
      entry_trigger: '--',
      stop_loss: { level: null, basis: '', text: '--' },
      invalidation: { level: null, condition: '等待新 A/B 结构', text: '等待新 A/B 结构' },
      targets: emptyTargets(),
      strategy_permission: {
        single_leg: 'block',
        vertical: 'block',
        iron_condor: 'wait'
      },
      confidence_score: 0,
      supporting_factors: [],
      conflicts: [],
      forbidden_actions: ['不补仓', '不摊低', '不反手追'],
      plain_chinese: '旧方向作废，停止追随。'
    };
  }

  if (!commandEnvironment?.executable) {
    return {
      active: false,
      status: 'blocked',
      has_trade_plan: false,
      triggered_by_tv: false,
      plan_family: null,
      setup_code: null,
      setup_type: 'none',
      direction_label: '禁做',
      side: 'neutral',
      bias: commandEnvironment?.bias || 'neutral',
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'blocked',
      title: '等待指挥部允许',
      trigger_text: nonExecutableReason,
      target_text: '--',
      invalidation_text: '--',
      entry_zone: emptyPriceField(),
      entry_trigger: '--',
      stop_loss: { level: null, basis: '', text: '--' },
      invalidation: { level: null, condition: '等待指挥部允许', text: '等待指挥部允许' },
      targets: emptyTargets(),
      strategy_permission: {
        single_leg: 'block',
        vertical: 'wait',
        iron_condor: 'block'
      },
      confidence_score: commandEnvironment?.confidence_score ?? 0,
      supporting_factors: [],
      conflicts: [nonExecutableReason].filter(Boolean),
      forbidden_actions: ['不追高', '不提前押方向'],
      plain_chinese: buildPlainChinese({
        status: 'blocked',
        directionLabelText: '禁做',
        commandEnvironment,
        tradingviewSentinel
      })
    };
  }

  if (!tradingviewSentinel?.triggered) {
    return {
      active: false,
      status: tradingviewSentinel?.status === 'stale' ? 'blocked' : 'waiting',
      has_trade_plan: false,
      triggered_by_tv: false,
      plan_family: null,
      setup_code: null,
      setup_type: 'none',
      direction_label: tradingviewSentinel?.status === 'stale' ? 'TV过期' : '等待',
      side: 'neutral',
      bias: commandEnvironment?.bias || 'neutral',
      recommended_action: ACTIONS.WAIT,
      trigger_status: tradingviewSentinel?.status === 'stale' ? 'stale' : 'waiting',
      title: '等待 TradingView 哨兵确认',
      trigger_text: sentinelReason,
      target_text: '未生成目标位。',
      invalidation_text: '--',
      entry_zone: emptyPriceField(),
      entry_trigger: '--',
      stop_loss: { level: null, basis: '', text: '--' },
      invalidation: { level: null, condition: '等待新的价格确认', text: '等待新的价格确认' },
      targets: emptyTargets(),
      strategy_permission: {
        single_leg: 'wait',
        vertical: 'wait',
        iron_condor: 'wait'
      },
      confidence_score: commandEnvironment?.confidence_score ?? 0,
      supporting_factors: [commandEnvironment?.plain_chinese || commandEnvironment?.reason].filter(Boolean),
      conflicts: tradingviewSentinel?.status === 'stale' ? ['TradingView stale'] : [],
      forbidden_actions: tradingviewSentinel?.status === 'stale' ? ['不得按旧信号开仓'] : ['不追高'],
      plain_chinese: buildPlainChinese({
        status: tradingviewSentinel?.status === 'stale' ? 'blocked' : 'waiting',
        directionLabelText: '等待',
        commandEnvironment,
        tradingviewSentinel
      })
    };
  }

  const setupCode = tradingviewSentinel.setup_code;
  if (!allowedSetups?.permitted_setup_codes?.includes(setupCode)) {
    return {
      active: false,
      status: 'blocked',
      has_trade_plan: false,
      triggered_by_tv: true,
      plan_family: null,
      setup_code: null,
      setup_type: 'none',
      direction_label: '突破不追',
      side: 'neutral',
      bias: commandEnvironment?.bias || 'neutral',
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'not_allowed',
      title: '哨兵触发，但当前 setup 未被允许',
      trigger_text: sentinelReason,
      target_text: '未生成目标位。',
      invalidation_text: '--',
      entry_zone: emptyPriceField(),
      entry_trigger: '--',
      stop_loss: { level: null, basis: '', text: '--' },
      invalidation: { level: null, condition: '当前 setup 不在允许集内', text: '当前 setup 不在允许集内' },
      targets: emptyTargets(),
      strategy_permission: {
        single_leg: 'block',
        vertical: 'wait',
        iron_condor: allowedSetups?.iron_condor?.allowed ? 'allow' : 'wait'
      },
      confidence_score: commandEnvironment?.confidence_score ?? 0,
      supporting_factors: [commandEnvironment?.plain_chinese || commandEnvironment?.reason].filter(Boolean),
      conflicts: [sentinelReason],
      forbidden_actions: ['不追高', '不提前押方向'],
      plain_chinese: buildPlainChinese({
        status: 'blocked',
        directionLabelText: '突破不追',
        commandEnvironment,
        tradingviewSentinel
      })
    };
  }

  const setupType = setupCode === 'A_LONG_PULLBACK'
    ? 'A_breakout'
    : setupCode === 'B_LONG_PULLBACK'
      ? 'B_pullback'
      : setupCode === 'A_SHORT_RETEST'
        ? 'A_breakdown'
        : setupCode === 'B_SHORT_RETEST'
          ? 'B_retest'
          : setupCode === 'B_IRON_CONDOR'
            ? 'B_iron_condor'
            : 'none';
  const directionLabelText = directionLabel(setupCode);
  const entryZone = buildEntryZone(setupCode, normalized);
  const stopLoss = buildStopLoss(setupCode, normalized, tradingviewSentinel);
  const invalidation = buildInvalidation(setupCode, normalized);
  const targets = buildTargets(setupCode, normalized);
  const canReady =
    commandEnvironment?.executable === true
    && tradingviewSentinel?.fresh === true
    && tradingviewSentinel?.matched_allowed_setup === true
    && hasValidEntryZone(entryZone)
    && hasValidStopLoss(stopLoss)
    && hasValidInvalidation(invalidation)
    && hasValidTargetOne(targets);

  if (!canReady) {
    return {
      active: false,
      status: 'waiting',
      has_trade_plan: false,
      triggered_by_tv: Boolean(tradingviewSentinel?.triggered),
      plan_family: planFamilyFromSetup(setupCode),
      setup_code: setupCode,
      setup_type: setupType,
      direction_label: directionLabelText,
      side: sideFromSetup(setupCode),
      bias: commandEnvironment?.bias || 'neutral',
      recommended_action: ACTIONS.WAIT,
      trigger_status: 'waiting',
      title: '环境支持，但关键执行字段不足',
      trigger_text: sentinelReason,
      target_text: '未生成目标位。',
      invalidation_text: hasValidInvalidation(invalidation) ? invalidation.text : '等待新的有效失效位',
      entry_zone: hasValidEntryZone(entryZone) ? entryZone : emptyPriceField(),
      entry_trigger: hasValidEntryZone(entryZone) ? buildTriggerText(setupCode, normalized) : '--',
      stop_loss: hasValidStopLoss(stopLoss)
        ? stopLoss
        : { level: null, basis: '', text: '止损：--，缺少有效失效位，不能执行' },
      invalidation: hasValidInvalidation(invalidation)
        ? invalidation
        : { level: null, condition: '缺少有效失效位', text: '缺少有效失效位，不能执行' },
      targets,
      strategy_permission: strategyPermissionFromSetup(setupCode, commandEnvironment),
      confidence_score: commandEnvironment?.confidence_score ?? 0,
      supporting_factors: [commandEnvironment?.plain_chinese || commandEnvironment?.reason, tradingviewSentinel?.plain_chinese || tradingviewSentinel?.reason].filter(Boolean),
      conflicts: ['环境分高，但缺少 TV 触发 / 数据源 / 风控字段，不能 ready。'],
      forbidden_actions: ['不追高', '不得按缺失止损位开仓'],
      plain_chinese: '环境分高，但缺少 TV 触发 / 数据源 / 风控字段，不能 ready。'
    };
  }

  return {
    active: true,
    status: 'ready',
    has_trade_plan: true,
    triggered_by_tv: true,
    plan_family: planFamilyFromSetup(setupCode),
    setup_code: setupCode,
    setup_type: setupType,
    direction_label: directionLabelText,
    side: sideFromSetup(setupCode),
    bias: commandEnvironment?.bias || 'neutral',
    recommended_action: SETUP_TO_ACTION[setupCode] ?? ACTIONS.WAIT,
    trigger_status: 'triggered',
    title: buildPlanName(setupCode),
    trigger_text: buildTriggerText(setupCode, normalized),
    target_text: buildTargetText(setupCode, normalized),
    invalidation_text: buildInvalidationText(setupCode, normalized),
    entry_zone: entryZone,
    entry_trigger: buildTriggerText(setupCode, normalized),
    stop_loss: stopLoss,
    invalidation,
    targets,
    strategy_permission: strategyPermissionFromSetup(setupCode, commandEnvironment),
    confidence_score: commandEnvironment?.confidence_score ?? 0,
    supporting_factors: [commandEnvironment?.plain_chinese || commandEnvironment?.reason, tradingviewSentinel?.plain_chinese || tradingviewSentinel?.reason].filter(Boolean),
    conflicts: [],
    forbidden_actions: setupCode === 'B_IRON_CONDOR'
      ? ['不提前押方向']
      : ['不追高', '不在中轴补单'],
    plain_chinese: buildPlainChinese({
      status: 'ready',
      directionLabelText,
      commandEnvironment,
      tradingviewSentinel,
      setupCode
    })
  };
}
