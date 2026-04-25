const SCENARIOS = [
  'negative_gamma_wait_pullback',
  'positive_gamma_income_watch',
  'flip_conflict_wait',
  'theta_stale_no_trade',
  'fmp_event_no_short_vol',
  'uw_call_strong_unconfirmed',
  'breakout_pullback_pending'
];

const ACTION_MAP = {
  long_on_pullback: {
    permission: 'WAIT',
    badge: 'wait',
    title: '等回踩不破再多',
    summary: '方向偏多，但不追。只接受回踩确认后的右侧多。',
    plan: '顺势多',
    triggerLabel: '回踩不破',
    targetLabel: '先看上方墙',
    blockLabel: '跌回关键位下方'
  },
  short_on_retest: {
    permission: 'WAIT',
    badge: 'wait',
    title: '等反抽不过再空',
    summary: '结构偏弱，但不低位追空。只接受反抽压力失败。',
    plan: '顺势空',
    triggerLabel: '反抽不过',
    targetLabel: '先看下方墙',
    blockLabel: '重新站回压力上方'
  },
  income_ok: {
    permission: 'WATCH',
    badge: 'go',
    title: '铁鹰观察，等波动回落',
    summary: '只有价格回到中间区并且波动收敛，才允许考虑收入型结构。',
    plan: '收租观察',
    triggerLabel: '回中轴钉住',
    targetLabel: '收时间价值',
    blockLabel: '离开区间或 IV 再抬'
  },
  no_trade: {
    permission: 'BLOCK',
    badge: 'block',
    title: '禁做，等系统恢复',
    summary: '数据、事件或信号冲突不允许给交易指令。先保护本金。',
    plan: '禁止交易',
    triggerLabel: '无',
    targetLabel: '无',
    blockLabel: '解除风险前不做'
  },
  wait: {
    permission: 'WAIT',
    badge: 'wait',
    title: '等确认，不追',
    summary: '位置不够干净，等价格离开中间区后再判断。',
    plan: '观望',
    triggerLabel: '等确认',
    targetLabel: '等待新结构',
    blockLabel: '冲突未解除不做'
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeText(value, fallback = '--') {
  if (value == null) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    const text = value.map((item) => safeText(item, '')).filter(Boolean).join('；');
    return text || fallback;
  }

  if (typeof value === 'object') {
    return (
      value.plain_chinese ||
      value.summary ||
      value.text ||
      value.note ||
      value.message ||
      value.output ||
      value.state ||
      value.label ||
      value.status ||
      fallback
    );
  }

  return fallback;
}

function isExecutable(signal) {
  return signal?.command_environment?.executable === true;
}

function isScenarioOrMock(signal) {
  return signal?.fetch_mode === 'mock_scenario'
    || signal?.data_health?.data_mode === 'mock';
}

function getExecutionBlockReason(signal) {
  if (signal?.command_environment?.executable === true) {
    return '';
  }

  const coherence = signal?.data_health?.coherence_status;
  if (coherence === 'conflict' || signal?.data_health?.spot_structure_mismatch === true) {
    return '数据冲突｜禁止执行';
  }
  if (coherence === 'mixed') {
    return '数据混用｜禁止执行';
  }
  if (isScenarioOrMock(signal)) {
    return '演示场景｜不可交易';
  }
  if (signal?.data_health?.data_mode === 'stale' || signal?.stale_flags?.any_stale) {
    return '数据过期｜禁止执行';
  }
  if (signal?.data_health?.data_mode === 'partial') {
    return signal?.command_environment?.reason || '缺少关键输入｜禁止执行';
  }
  return signal?.command_environment?.reason || '禁止执行';
}

function blockedPriceText(signal, fallback = '--') {
  return isExecutable(signal) ? fallback : '--';
}

function getTopConflictReasons(signal) {
  const items = [];
  const coherence = signal?.data_health?.coherence_reason;
  if (coherence) items.push(coherence);
  if (Array.isArray(signal?.conflict_resolver?.conflicts)) items.push(...signal.conflict_resolver.conflicts);
  if (Array.isArray(signal?.conflict?.conflict_points)) items.push(...signal.conflict.conflict_points);
  return items.filter(Boolean);
}

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function displaySpot(snapshot = {}) {
  return snapshot?.spot_is_real === true && Number.isFinite(Number(snapshot?.spot))
    ? fmt(snapshot.spot, 2)
    : '--';
}

function displaySpotContext(snapshot = {}) {
  if (snapshot?.spot_is_real === true) {
    return `FMP · ${minutesAgo(snapshot.spot_last_updated)}`;
  }

  if (snapshot?.spot_source === 'fmp') {
    return '未接入';
  }

  return spotPositionLabel(snapshot?.spot_position);
}

function shortTime(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function minutesAgo(value) {
  if (!value) return '--';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '--';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  return mins <= 0 ? '刚刚' : `${mins}m ago`;
}

function getScenario() {
  const params = new URLSearchParams(window.location.search);
  return params.get('scenario') || 'negative_gamma_wait_pullback';
}

async function loadSignal() {
  const scenario = getScenario();
  const response = await fetch(`/signals/current?scenario=${encodeURIComponent(scenario)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`/signals/current ${response.status}`);
  return await response.json();
}

function sourceStateLabel(state) {
  return {
    real: '正常',
    mock: '模拟',
    delayed: '延迟',
    degraded: '降级',
    down: '不可用',
    unavailable: '未接入',
    error: '异常'
  }[state] || '未知';
}

function sourceNameLabel(source) {
  return {
    tradingview: 'TradingView',
    fmp: 'FMP',
    fmp_event: 'FMP',
    fmp_price: 'FMP',
    theta_core: 'Theta',
    theta_full_chain: 'Theta',
    uw: 'UW',
    telegram: 'Telegram',
    dashboard: 'Dashboard'
  }[source] || String(source || '数据源');
}

function marketStateLabel(value) {
  return {
    positive_gamma_grind: '做市商对冲压制波动，价格倾向窄幅磨',
    negative_gamma_expand: '做市商顺势对冲，波动容易放大',
    flip_chop: '价格在多空分界线附近拉锯，方向未定',
    event_risk: '重大事件临近，波动不可控，先收手',
    unknown: '状态未明'
  }[value] || value || '状态未明';
}

function gammaLabel(value) {
  return {
    positive: '做市商压波动 (正Gamma)',
    negative: '做市商放波动 (负Gamma)',
    critical: '多空临界，随时切换',
    unknown: '状态未知'
  }[value] || value || '状态未知';
}

function spotPositionLabel(value) {
  return {
    above_call_wall: '突破上方压力位',
    below_put_wall: '跌破下方支撑位',
    below_flip: '多空分界线下方 (偏空)',
    above_flip: '多空分界线上方 (偏多)',
    above_flip_below_call_wall: '多空分界线上方，仍在压力位下方',
    between_walls: '处于支撑与压力之间'
  }[value] || '未接入';
}

function flowLabel(value) {
  return {
    call_strong: 'Call 偏强',
    put_strong: 'Put 偏强',
    bullish: '偏多',
    bearish: '偏空',
    mixed: '多空混合',
    neutral: '中性',
    unavailable: '未接入',
    unknown: '未知'
  }[value] || '未接入';
}

function darkPoolLabel(value) {
  return {
    support_below: '下方支撑资金区',
    resistance_above: '上方压力资金区',
    accumulation: '偏吸筹',
    distribution: '偏派发',
    support: '偏支撑',
    resistance: '偏压制',
    neutral: '中性',
    unavailable: '未接入',
    unclear: '不明显'
  }[value] || '未接入';
}

function dealerLabel(value) {
  return {
    control_vol: '控波动',
    release_vol: '放波动',
    sweep_up: '往上扫空',
    sweep_down: '往下扫多',
    hedge: '对冲为主',
    pin: '偏控波动',
    expand: '偏放波动',
    supportive: '偏支持',
    confirm: '偏确认',
    conflict: '有冲突',
    mixed: '多空拉扯',
    unavailable: '未接入',
    unclear: '不明显'
  }[value] || '未接入';
}

function eventRiskLabel(value) {
  return {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
    none: '无重大事件',
    normal: '正常',
    caution: '谨慎',
    blocked: '禁止'
  }[value] || '未知';
}

function conflictLabel(value) {
  return {
    none: '无明显冲突',
    low: '轻微冲突',
    medium: '中等冲突',
    high: '高冲突'
  }[value] || '未知';
}

function distanceLabel(value) {
  return Number.isFinite(Number(value)) ? `${fmt(value, 1)} pt` : '--';
}

function qualityScore(signal) {
  return fmtInt(signal.confidence_score || signal.conflict?.adjusted_confidence || 0);
}

function getAction(signal) {
  if (signal?.recommended_action && ACTION_MAP[signal.recommended_action]) return ACTION_MAP[signal.recommended_action];
  if (signal?.conflict?.conflict_level === 'high' || signal?.stale_flags?.any_stale) return ACTION_MAP.no_trade;
  return ACTION_MAP.wait;
}

function hasHardBlock(signal) {
  return signal?.command_environment?.executable === false
    || signal?.recommended_action === 'no_trade'
    || signal?.conflict?.conflict_level === 'high'
    || signal?.stale_flags?.any_stale
    || signal?.data_health?.coherence_status === 'mixed'
    || signal?.data_health?.coherence_status === 'conflict'
    || signal?.source_status?.some((s) => s.state === 'down');
}

function qualityClass(signal) {
  if (hasHardBlock(signal)) return 'bad';
  if (signal?.conflict?.conflict_level === 'medium' || signal?.event_context?.event_risk === 'high') return 'warn';
  if ((signal?.confidence_score || 0) >= 72) return 'good';
  return 'ok';
}

function statusClassForSource(item) {
  if (item?.stale) return 'stale';
  return item?.state || 'mock';
}

function chipClassByRisk(value) {
  if (['negative', 'high', 'down', 'stale'].includes(value)) return 'red';
  if (['critical', 'medium', 'mixed', 'degraded', 'delayed'].includes(value)) return 'amber';
  if (['positive', 'low', 'none', 'real'].includes(value)) return 'green';
  return 'blue';
}

function getStrategyCard(signal, type) {
  const tradePlan = signal?.trade_plan || {};
  const strategyPermission = tradePlan.strategy_permission || {};
  const projectionCard = Array.isArray(signal?.projection?.strategy_cards)
    ? signal.projection.strategy_cards.find((item) => item?.strategy_name === type)
    : null;

  const blocked = !isExecutable(signal);
  const baseCard = {
    strategy_name: type,
    suitable_when: blocked ? getExecutionBlockReason(signal) : '等待后端策略投影。',
    entry_condition: blocked ? '--' : tradePlan.entry_zone?.text || '--',
    target_zone: blocked ? '--' : tradePlan.target_text || '--',
    invalidation: blocked ? '--' : tradePlan.invalidation?.text || tradePlan.invalidation_text || '--',
    avoid_when: signal?.command_environment?.reason || tradePlan?.plain_chinese || '等待后端判断。'
  };

  const merged = {
    ...baseCard,
    ...(projectionCard || {})
  };

  if (blocked) {
    return {
      ...merged,
      entry_condition: '--',
      target_zone: '--',
      invalidation: '--',
      suitable_when: getExecutionBlockReason(signal),
      avoid_when: signal?.command_environment?.reason || getExecutionBlockReason(signal)
    };
  }

  if (type === '单腿') {
    merged.entry_condition = tradePlan.entry_zone?.text || merged.entry_condition || '--';
  } else if (type === '垂直') {
    merged.entry_condition = tradePlan.entry_zone?.text || merged.entry_condition || '--';
    merged.target_zone = tradePlan.target_text || merged.target_zone || '--';
    merged.invalidation = tradePlan.invalidation?.text || tradePlan.invalidation_text || merged.invalidation || '--';
  } else if (type === '铁鹰') {
    merged.entry_condition = strategyPermission.iron_condor === 'allow'
      ? tradePlan.entry_zone?.text || merged.entry_condition || '--'
      : '--';
    merged.target_zone = strategyPermission.iron_condor === 'allow'
      ? tradePlan.target_text || merged.target_zone || '--'
      : '--';
    merged.invalidation = strategyPermission.iron_condor === 'allow'
      ? tradePlan.invalidation?.text || tradePlan.invalidation_text || merged.invalidation || '--'
      : '--';
  }

  return merged;
}

function strategyState(signal, type) {
  if (hasHardBlock(signal)) return { text: '禁止', cls: 'block' };

  const permission = signal?.trade_plan?.strategy_permission || {};
  const value =
    type === '单腿' ? permission.single_leg
      : type === '垂直' ? permission.vertical
        : permission.iron_condor;

  if (value === 'allow') return { text: '允许', cls: 'go' };
  if (value === 'wait') return { text: '等待', cls: 'watch' };
  return { text: '禁止', cls: 'block' };
}

function buildTrigger(signal) {
  if (!isExecutable(signal)) return '--';
  return signal?.trade_plan?.entry_zone?.text || '--';
}

function buildTarget(signal) {
  if (!isExecutable(signal)) return '--';
  return signal?.trade_plan?.target_text || '--';
}

function buildInvalidation(signal) {
  if (!isExecutable(signal)) return '--';
  return signal?.trade_plan?.invalidation?.text || signal?.trade_plan?.invalidation_text || '--';
}

function buildAvoid(signal) {
  if (signal.plain_language?.avoid) return signal.plain_language.avoid;
  if (Array.isArray(signal.avoid_actions) && signal.avoid_actions.length) return signal.avoid_actions.join(' / ');
  return '不追单，不提前卖波';
}

function getSentimentClass(signal) {
  const gamma = signal.gamma_regime;
  const conflict = signal.conflict?.conflict_level;
  const action = getAction(signal);
  if (conflict === 'high') return 'conflict';
  if (action.badge === 'block') return 'bear';
  if (gamma === 'positive' && action.badge === 'go') return 'bull';
  if (gamma === 'negative') return 'bear';
  return 'neutral';
}

function getSentimentFill(signal) {
  const score = Number(signal.confidence_score || signal.conflict?.adjusted_confidence || 50);
  return Math.min(Math.max(score, 10), 95);
}

function getSentimentText(signal) {
  const cls = getSentimentClass(signal);
  const score = Number(signal.confidence_score || signal.conflict?.adjusted_confidence || 50);
  const map = {
    bull:     `看多情绪 · 信心 ${score}`,
    bear:     `看空情绪 · 信心 ${score}`,
    conflict: `多空冲突 · 信心 ${score}`,
    neutral:  `中性观望 · 信心 ${score}`
  };
  return map[cls] || `中性 · 信心 ${score}`;
}

function renderTopbar(path, signal) {
  const scenario = getScenario();
  const sourceBad = signal.source_status?.some((s) => s.state === 'down' || s.stale);
  const sourceWarn = signal.source_status?.some((s) => ['delayed', 'degraded'].includes(s.state));
  const dotClass = sourceBad ? 'bad' : sourceWarn ? 'warn' : '';
  const sentCls = getSentimentClass(signal);
  const sentFill = getSentimentFill(signal);
  const sentText = getSentimentText(signal);
  const blockReason = getExecutionBlockReason(signal);
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/?scenario=${escapeHtml(scenario)}">
          <div class="logo-mark">SP</div>
          <div>
            <div class="brand-title">SPX Ops Dashboard</div>
            <div class="brand-subtitle">0DTE Command Console</div>
          </div>
        </a>
        <nav class="nav" aria-label="primary navigation">
          <a class="${path === '/' ? 'active' : ''}" href="/?scenario=${escapeHtml(scenario)}">主操作页</a>
          <a class="${path === '/radar' ? 'active' : ''}" href="/radar?scenario=${escapeHtml(scenario)}">Radar 支撑页</a>
        </nav>
        <div class="system-right">
          <div class="heartbeat"><i class="heartbeat-dot ${dotClass}"></i><span>${escapeHtml(signal.is_mock ? 'MOCK' : 'LIVE')}</span><span>${shortTime(signal.received_at)}</span></div>
          <select class="scenario-select" id="scenario-select" aria-label="mock scenario">
            ${SCENARIOS.map((item) => `<option value="${item}" ${item === scenario ? 'selected' : ''}>${item}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sentiment-row">
        <div class="sentiment-label">市场情绪</div>
        <div class="sentiment-track">
          <div class="sentiment-fill ${sentCls}" style="width:${sentFill}%"></div>
        </div>
        <div class="sentiment-chips">
          <span class="sentiment-chip ${sentCls}">${escapeHtml(sentText)}</span>
          ${blockReason ? `<span class="sentiment-chip conflict">${escapeHtml(blockReason)}</span>` : ''}
        </div>
      </div>
    </header>
  `;
}

function renderSourceStrip(signal) {
  return `
    <section class="source-row">
      <div class="section-label">数据状态</div>
      <div class="source-list">
        ${(signal.source_status || []).filter((item) => ['tradingview', 'fmp', 'theta_core', 'theta_full_chain', 'uw', 'telegram', 'dashboard'].includes(item.source)).map((item) => `
          <span class="source-chip ${statusClassForSource(item)}">
            ${escapeHtml(sourceNameLabel(item.source))} · ${sourceStateLabel(item.state)}${item.last_updated ? ` · ${minutesAgo(item.last_updated)}` : ''}
          </span>
        `).join('')}
      </div>
    </section>
  `;
}

function renderMetricCards(signal) {
  const snap = signal.market_snapshot || {};
  const vix = signal.vix || {};
  const vixVal = Number(vix.value ?? 18);
  const vixPrev = Number(vix.prev_close ?? vixVal);
  const vixChange = vixVal - vixPrev;
  const vixChangeStr = (vixChange >= 0 ? '+' : '') + vixChange.toFixed(2);
  const vixChangeColor = vixChange > 0 ? 'var(--red)' : 'var(--green)';
  let vixZone, vixZoneLabel;
  if (vixVal < 15)      { vixZone = 'calm';     vixZoneLabel = '低波动'; }
  else if (vixVal < 20) { vixZone = 'elevated'; vixZoneLabel = '偏高'; }
  else if (vixVal < 30) { vixZone = 'fear';     vixZoneLabel = '恐慌区'; }
  else                  { vixZone = 'extreme';  vixZoneLabel = '极端恐慌'; }

  // VIX gauge SVG
  const MAX_VIX = 50, cx = 100, cy = 90, r = 72;
  const clamp = Math.min(Math.max(vixVal, 0), MAX_VIX);
  const angleDeg = (clamp / MAX_VIX) * 180;
  function pxy(deg) {
    const rad = (deg - 180) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  const zones = [
    { s:0,   e:54,  c:'#059669' },
    { s:54,  e:72,  c:'#d97706' },
    { s:72,  e:108, c:'#dc2626' },
    { s:108, e:180, c:'#7c3aed' },
  ];
  function arc(s,e,col) {
    const a = pxy(s), b = pxy(e), lg = e-s>90?1:0;
    return `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 ${lg} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}" stroke="${col}" stroke-width="11" fill="none" stroke-linecap="butt" opacity="0.9"/>`;
  }
  const arcPaths = zones.map(z => arc(z.s, z.e, z.c)).join('');
  const np = pxy(angleDeg);
  const p0 = pxy(0), p180 = pxy(180);
  function tick(v) {
    const deg = (v/MAX_VIX)*180, rad = (deg-180)*Math.PI/180;
    const ix = cx+(r-14)*Math.cos(rad), iy = cy+(r-14)*Math.sin(rad);
    const ox = cx+(r+3)*Math.cos(rad),  oy = cy+(r+3)*Math.sin(rad);
    const lx = cx+(r+14)*Math.cos(rad), ly = cy+(r+14)*Math.sin(rad);
    return `<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="#d1d5db" stroke-width="1.5"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="JetBrains Mono,monospace" fill="#9ca3af">${v}</text>`;
  }
  const ticks = [15,20,30].map(tick).join('');

  return `
    <div class="price-vix-col">
      <div class="metric-card">
        <div class="metric-label">SPX 现价</div>
        <div class="big-number">${displaySpot(snap)}</div>
        <div class="delta-line"><i class="pulse-bar"></i><span>${displaySpotContext(snap)}</span></div>
        <div class="tag-row" style="margin-top:8px">
          <span class="tag blue">Spot ${escapeHtml(signal?.market_snapshot?.spot_source || signal?.command_inputs?.external_spot?.source || 'unavailable')}</span>
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${gammaLabel(signal.gamma_regime)}</span>
          <span class="tag blue" title="多空分界线：价格在此上方偏多，下方偏空">多空线 ${isExecutable(signal) ? fmtInt(snap.flip_level) : '--'}</span>
        </div>
        <div class="metric-sublabel" style="margin-top:6px">${marketStateLabel(signal.market_state)}</div>
      </div>
      <div class="vix-inline">
        <div class="vix-header">
          <div class="metric-label">VIX 恐慌指数</div>
          <span class="vix-zone-pill ${vixZone}">${escapeHtml(vixZoneLabel)}</span>
        </div>
        <svg class="vix-gauge-svg" viewBox="28 18 144 78" xmlns="http://www.w3.org/2000/svg">
          <path d="M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${r} ${r} 0 0 1 ${p180.x.toFixed(1)} ${p180.y.toFixed(1)}" stroke="#e5e7eb" stroke-width="11" fill="none" stroke-linecap="butt"/>
          ${arcPaths}
          ${ticks}
          <line x1="${cx}" y1="${cy}" x2="${np.x.toFixed(1)}" y2="${np.y.toFixed(1)}" stroke="#1f2937" stroke-width="2" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="4" fill="#1f2937"/>
          <text x="${(cx-r-2).toFixed(0)}" y="${cy+16}" text-anchor="middle" font-size="8" font-family="JetBrains Mono,monospace" fill="#9ca3af">0</text>
          <text x="${(cx+r+2).toFixed(0)}" y="${cy+16}" text-anchor="middle" font-size="8" font-family="JetBrains Mono,monospace" fill="#9ca3af">50</text>
        </svg>
        <div class="vix-val-row">
          <span class="vix-number">${fmt(vixVal, 2)}</span>
          <span class="vix-unit">pts</span>
          <span style="font-family:var(--mono);font-size:11px;font-weight:600;color:${vixChangeColor}">${escapeHtml(vixChangeStr)}</span>
        </div>
        <div class="vix-meta-row">
          <div class="vix-meta-item"><div class="vix-meta-label">昨收</div><div class="vix-meta-value">${fmt(vixPrev,2)}</div></div>
          <div class="vix-meta-item"><div class="vix-meta-label">卖波许可</div><div class="vix-meta-value" style="font-size:11px;color:${vixVal<20?'var(--green)':'var(--red)'}">${vixVal<20?'可评估':'暂禁'}</div></div>
        </div>
      </div>
    </div>
  `;
}

function renderVolLights(signal) {
  const snap = signal.market_snapshot || {};
  const vix = signal.vix || {};
  const vixVal = Number(vix.value ?? 18);
  const gamma = signal.gamma_regime;
  const conflict = signal.conflict?.conflict_level;
  const eventRisk = signal.event_context?.event_risk;
  const uwFlow = signal.uw_context?.flow_bias || signal.signals?.uw_signal;
  const confidence = Number(signal.confidence_score || signal.conflict?.adjusted_confidence || 50);

  // Evaluate each condition
  const lights = [
    {
      name: 'VIX 波动率',
      sub: vixVal >= 15 ? `当前 ${vixVal.toFixed(1)}，市场有足够波动` : `当前 ${vixVal.toFixed(1)}，波动偏低`,
      state: vixVal >= 15 ? 'on' : 'off',
      label: vixVal >= 15 ? '放行' : '偏低'
    },
    {
      name: '做市商方向',
      sub: gamma === 'negative' ? '放波动，利于卖方' : gamma === 'positive' ? '压波动，不利卖方' : '临界，方向未定',
      state: gamma === 'negative' ? 'on' : gamma === 'critical' ? 'warn' : 'off',
      label: gamma === 'negative' ? '放行' : gamma === 'critical' ? '注意' : '压制'
    },
    {
      name: '信号冲突',
      sub: conflict === 'none' || conflict === 'low' ? '冲突低，信号干净' : `冲突${conflict === 'medium' ? '中等' : '较高'}，谨慎`,
      state: (conflict === 'none' || conflict === 'low') ? 'on' : conflict === 'medium' ? 'warn' : 'off',
      label: (conflict === 'none' || conflict === 'low') ? '放行' : conflict === 'medium' ? '注意' : '冲突'
    },
    {
      name: '事件风险',
      sub: eventRisk === 'none' || eventRisk === 'low' ? '无重大事件' : `事件风险${eventRisk === 'medium' ? '中等' : '高'}`,
      state: (eventRisk === 'none' || eventRisk === 'low') ? 'on' : eventRisk === 'medium' ? 'warn' : 'off',
      label: (eventRisk === 'none' || eventRisk === 'low') ? '放行' : eventRisk === 'medium' ? '注意' : '禁止'
    },
    {
      name: '主动资金流',
      sub: uwFlow === 'bullish' || uwFlow === 'call_strong' ? '买方主导' : uwFlow === 'bearish' || uwFlow === 'put_strong' ? '卖方主导' : '中性/混合',
      state: (uwFlow === 'bullish' || uwFlow === 'call_strong' || uwFlow === 'bearish' || uwFlow === 'put_strong') ? 'on' : 'warn',
      label: (uwFlow === 'bullish' || uwFlow === 'call_strong') ? '看多' : (uwFlow === 'bearish' || uwFlow === 'put_strong') ? '看空' : '中性'
    },
  ];

  const rows = lights.map(l => `
    <div class="vol-light-row">
      <div class="vol-dot ${l.state}"></div>
      <div class="vol-light-name">${l.name}<small>${l.sub}</small></div>
      <span class="vol-light-badge ${l.state}">${l.label}</span>
    </div>
  `).join('');

  return `
    <div class="vol-lights-card">
      <div class="vol-lights-title">波动率起爆条件</div>
      ${rows}
    </div>
  `;
}

function renderRiskStack(signal) {
  const cls = qualityClass(signal);
  const conflicts = getTopConflictReasons(signal);
  return `
    <div class="risk-col">
      <div class="metric-card">
        <div class="metric-label">执行把握</div>
        <div class="big-number">${qualityScore(signal)}</div>
        <div class="tag-row">
          <span class="quality-chip ${cls}">${conflictLabel(signal.conflict?.conflict_level)}</span>
          <span class="quality-chip ${signal.event_context?.event_risk === 'high' ? 'bad' : 'ok'}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
        </div>
      </div>
      ${renderVolLights(signal)}
      <div class="alert-card">
        <div class="section-label">执行底线</div>
        <ul class="alert-list">
          <li>${escapeHtml(buildAvoid(signal))}</li>
          <li>${escapeHtml(buildInvalidation(signal))}</li>
          <li>${escapeHtml(conflicts[0] || signal.event_context?.event_note || '无新增冲突，仍按触发条件执行。')}</li>
        </ul>
      </div>
    </div>
  `;
}

function renderCommandHero(signal) {
  const action = getAction(signal);
  const trigger = buildTrigger(signal);
  const target = buildTarget(signal);
  const invalidation = buildInvalidation(signal);
  const avoid = buildAvoid(signal);
  const summary = signal.plain_language?.user_action || action.summary;

  return `
    <section class="command-hero">
      ${renderMetricCards(signal)}
      <div class="main-command">
        <div class="command-status-line">
          <div class="section-label">当前主操作</div>
          <div class="permission-badge ${action.badge}">${action.permission}</div>
        </div>
        <h1 class="command-title">${escapeHtml(action.title)}</h1>
        <p class="command-subtitle">${escapeHtml(summary)}</p>
        <div class="tag-row">
          <span class="tag blue">${escapeHtml(action.plan)}</span>
          <span class="tag ${chipClassByRisk(signal.event_context?.event_risk)}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${gammaLabel(signal.gamma_regime)}</span>
          <span class="tag violet">${dealerLabel(signal.uw_context?.dealer_bias || signal.signals?.dealer_behavior)}</span>
        </div>
        <div class="command-grid">
          <div class="command-cell"><span class="card-label">触发</span><b>${escapeHtml(trigger)}</b></div>
          <div class="command-cell"><span class="card-label">第一目标</span><b>${escapeHtml(target)}</b></div>
          <div class="command-cell"><span class="card-label">作废</span><b>${escapeHtml(invalidation)}</b></div>
          <div class="command-cell"><span class="card-label">禁做</span><b>${escapeHtml(avoid)}</b></div>
        </div>
      </div>
      ${renderRiskStack(signal)}
    </section>
  `;
}

function renderStrategyCards(signal) {
  const strategyTypes = ['单腿', '垂直', '铁鹰'];
  return `
    <section class="grid-3">
      ${strategyTypes.map((type) => {
        const card = getStrategyCard(signal, type);
        const state = strategyState(signal, type);
        const target = card.target_zone || '--';
        const entry = card.entry_condition || '--';
        const suitable = card.suitable_when || '只在结构、Gamma、事件风险同时支持时考虑。';
        const invalidation = card.invalidation || '--';
        const avoid = card.avoid_when || buildAvoid(signal);

        return `
          <article class="strategy-card ${state.cls}">
            <div class="strategy-headline">
              <div>
                <div class="section-label">Strategy</div>
                <div class="strategy-name">${type}</div>
              </div>
              <span class="strategy-status ${state.cls}">${state.text}</span>
            </div>
            <div class="strategy-kv">
              <div class="kv-row"><span>适合</span><b>${escapeHtml(suitable)}</b></div>
              <div class="kv-row"><span>入场</span><b>${escapeHtml(entry)}</b></div>
              <div class="kv-row"><span>目标</span><b>${escapeHtml(target)}</b></div>
              <div class="kv-row"><span>作废</span><b>${escapeHtml(invalidation)}</b></div>
              <div class="kv-row"><span>禁做</span><b>${escapeHtml(avoid)}</b></div>
            </div>
          </article>
        `;
      }).join('')}
    </section>
  `;
}

function renderLevelMatrix(signal) {
  const snap = signal.market_snapshot || {};
  const items = [
    ['SPX', displaySpot(snap), displaySpotContext(snap)],
    ['Flip', isExecutable(signal) ? fmtInt(snap.flip_level) : '--', isExecutable(signal) ? `距离 ${distanceLabel(snap.distance_to_flip)}` : getExecutionBlockReason(signal)],
    ['Call Wall', isExecutable(signal) ? fmtInt(snap.call_wall) : '--', isExecutable(signal) ? `距离 ${distanceLabel(snap.distance_to_call_wall)}` : getExecutionBlockReason(signal)],
    ['Put Wall', isExecutable(signal) ? fmtInt(snap.put_wall) : '--', isExecutable(signal) ? `距离 ${distanceLabel(snap.distance_to_put_wall)}` : getExecutionBlockReason(signal)],
    ['Max Pain', isExecutable(signal) ? fmtInt(snap.max_pain) : '--', isExecutable(signal) ? '中轴参考' : getExecutionBlockReason(signal)],
    ['把握度', qualityScore(signal), '当前执行把握']
  ];
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">关键位置</div><span class="tag blue">只看位置，不猜方向</span></div>
      <div class="matrix-list">
        ${items.map(([name, value, note]) => `
          <div class="matrix-item">
            <div class="matrix-name">${escapeHtml(name)}</div>
            <div class="matrix-value">${escapeHtml(note)}</div>
            <div class="matrix-number">${escapeHtml(value)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderIntelMatrix(signal) {
  const items = [
    ['Dealer', safeText(signal.engines?.dealer_conclusion, gammaLabel(signal.gamma_regime)), '做市商主判断'],
    ['TradingView', safeText(signal.engines?.tv_sentinel, '等待价格确认'), '价格确认'],
    ['UW', safeText(signal.engines?.uw_conclusion, 'UW 未接入'), '辅助情报'],
    ['FMP', safeText(signal.engines?.fmp_conclusion, eventRiskLabel(signal.event_context?.event_risk)), '事件与市场气氛'],
    ['冲突', safeText(signal.engines?.conflict_resolver, conflictLabel(signal.conflict?.conflict_level)), '跨源一致性'],
    ['执行环境', safeText(signal.engines?.command_environment, '等待价格触发'), '是否允许观察/执行']
  ];
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">辅助判断</div><span class="tag ${chipClassByRisk(signal.conflict?.conflict_level)}">${conflictLabel(signal.conflict?.conflict_level)}</span></div>
      <div class="matrix-list">
        ${items.map(([name, value, note]) => `
          <div class="matrix-item">
            <div class="matrix-name">${escapeHtml(name)}</div>
            <div class="matrix-value">${escapeHtml(value)}</div>
            <div class="matrix-number">${escapeHtml(note)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}



function renderHome(signal) {
  const buildInfo = signal?.build_info?.git_commit || signal?.build_info?.build_sha || 'unknown';
  return `
    <main class="page">
      ${renderCommandHero(signal)}
      ${renderStrategyCards(signal)}
      <section class="matrix-grid">
        ${renderLevelMatrix(signal)}
        ${renderIntelMatrix(signal)}
      </section>
      ${renderSourceStrip(signal)}
      <div class="footer-note">本页只展示操作结论与关键位置，场景切换仅用于本地验收。 build ${escapeHtml(buildInfo)}</div>
    </main>
  `;
}

function renderRadarSummary(signal) {
  const snap = signal.market_snapshot || {};
  const conflictPoints = getTopConflictReasons(signal);
  const dealerConclusion = safeText(signal.engines?.dealer_conclusion, signal.plain_language?.dealer_behavior || '等待做市商方向确认。');
  const uwConclusion = safeText(signal.engines?.uw_conclusion, 'UW 未接入，当前只作为后续辅助位。');
  const fmpConclusion = safeText(signal.engines?.fmp_conclusion, signal.event_context?.event_note || '无重大事件风险。');
  const conflictConclusion = safeText(signal.engines?.conflict_resolver, signal.plain_language?.market_status || '暂无明显冲突说明。');
  return `
    <section class="radar-layout">
      <article class="radar-card">
        <div class="radar-title">
          <h2>Dealer / 结构说明</h2>
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${gammaLabel(signal.gamma_regime)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.radar_summary?.dealer, dealerConclusion))}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">Spot 来源</div><div class="matrix-value">${escapeHtml(signal?.market_snapshot?.spot_source || signal?.command_inputs?.external_spot?.source || 'unavailable')}</div><div class="matrix-number">${displaySpot(snap)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Gamma 来源</div><div class="matrix-value">${escapeHtml(signal?.dealer_conclusion?.status === 'live' ? 'theta/live' : 'scenario/mock')}</div><div class="matrix-number">${escapeHtml(signal?.data_health?.coherence_status || signal?.data_health?.data_mode || 'unknown')}</div></div>
          <div class="matrix-item"><div class="matrix-name">Flip</div><div class="matrix-value">${isExecutable(signal) ? distanceLabel(snap.distance_to_flip) : getExecutionBlockReason(signal)}</div><div class="matrix-number">${isExecutable(signal) ? fmtInt(snap.flip_level) : '--'}</div></div>
          <div class="matrix-item"><div class="matrix-name">结论</div><div class="matrix-value">${escapeHtml(getExecutionBlockReason(signal) || '可观察')}</div><div class="matrix-number">${escapeHtml(signal?.data_health?.coherence_reason || '价格地图一致')}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Flow / UW 辅助</h2>
          <span class="tag violet">${flowLabel(signal.engines?.uw_conclusion?.flow_bias || signal.uw_context?.flow_bias)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.radar_summary?.order_flow, uwConclusion))}</p>
        <div class="tag-row">
          <span class="tag blue">Flow ${flowLabel(signal.engines?.uw_conclusion?.flow_bias || signal.uw_context?.flow_bias)}</span>
          <span class="tag green">Dark Pool ${darkPoolLabel(signal.engines?.uw_conclusion?.darkpool_bias || signal.uw_context?.dark_pool_bias)}</span>
          <span class="tag amber">波动灯 ${safeText(signal.engines?.uw_conclusion?.volatility_light, '未接入')}</span>
          <span class="tag violet">机构 ${safeText(signal.engines?.uw_conclusion?.institutional_entry, '未接入')}</span>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>事件过滤</h2>
          <span class="tag ${chipClassByRisk(signal.event_context?.event_risk)}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
        </div>
        <p class="radar-note">${escapeHtml(fmpConclusion)}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">卖波许可</div><div class="matrix-value">${signal.event_context?.event_risk === 'high' ? '禁止提前铁鹰 / 裸卖' : '仅在波动回落后评估'}</div><div class="matrix-number">FMP</div></div>
          <div class="matrix-item"><div class="matrix-name">主操作页影响</div><div class="matrix-value">${escapeHtml(getAction(signal).title)}</div><div class="matrix-number">${getAction(signal).permission}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>当前限制</h2>
          <span class="quality-chip ${qualityClass(signal)}">${conflictLabel(signal.conflict?.conflict_level)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.radar_summary?.plan_alignment, conflictConclusion))}</p>
        <ul class="alert-list">
          ${(conflictPoints.length ? conflictPoints : ['没有强冲突，但仍必须等触发。']).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </article>
    </section>
  `;
}

function renderRadarContext(signal) {
  const items = [
    ['Dealer 结论', safeText(signal.engines?.dealer_conclusion, gammaLabel(signal.gamma_regime)), '做市商主判断'],
    ['FMP 结论', safeText(signal.engines?.fmp_conclusion, 'FMP 未接入'), '事件与市场气氛'],
    ['UW 结论', safeText(signal.engines?.uw_conclusion, 'UW 未接入'), '辅助情报'],
    ['价格哨兵', safeText(signal.engines?.tv_sentinel, '等待价格确认'), '只做触发，不单独定方向'],
    ['执行环境', safeText(signal.engines?.command_environment, '等待价格触发'), '是否允许观察/执行'],
    ['冲突处理', safeText(signal.engines?.conflict_resolver, '暂无明显冲突'), '跨源一致性']
  ];

  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">支撑说明</div><span class="tag blue">只读结论，不读原始字段</span></div>
      <div class="matrix-list">
        ${items.map(([name, value, note]) => `
          <div class="matrix-item">
            <div class="matrix-name">${escapeHtml(name)}</div>
            <div class="matrix-value">${escapeHtml(value)}</div>
            <div class="matrix-number">${escapeHtml(note)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderRadar(signal) {
  const buildInfo = signal?.build_info?.git_commit || signal?.build_info?.build_sha || 'unknown';
  return `
    <main class="page">
      ${renderRadarSummary(signal)}
      ${renderRadarContext(signal)}
      ${renderSourceStrip(signal)}
      <div class="footer-note">Radar 只负责解释支撑与限制，不单独生成交易指令。 build ${escapeHtml(buildInfo)}</div>
    </main>
  `;
}

function bindScenarioSelector() {
  const select = document.getElementById('scenario-select');
  if (!select) return;
  select.addEventListener('change', () => {
    const path = window.location.pathname === '/radar' ? '/radar' : '/';
    window.location.href = `${path}?scenario=${encodeURIComponent(select.value)}`;
  });
}

function renderLoading() {
  document.getElementById('app').innerHTML = `
    <main class="loading">
      <h1>Loading SPX Ops Dashboard</h1>
      <p>正在读取 /signals/current mock 数据。</p>
    </main>
  `;
}

function renderError(error) {
  document.getElementById('app').innerHTML = `
    <main class="error-card">
      <h1>Load Error</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>检查 server.js 是否运行，以及 /signals/current 是否返回 JSON。</p>
    </main>
  `;
}

async function main() {
  renderLoading();
  try {
    const signal = await loadSignal();
    const path = window.location.pathname === '/radar' ? '/radar' : '/';
    document.getElementById('app').innerHTML = `
      ${renderTopbar(path, signal)}
      ${path === '/radar' ? renderRadar(signal) : renderHome(signal)}
    `;
    bindScenarioSelector();
  } catch (error) {
    renderError(error);
  }
}

main();
