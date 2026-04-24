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
    return 'FMP unavailable';
  }
  return spotPositionLabel(snapshot.spot_position);
}

function shortTime(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
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
    real: 'REAL',
    mock: 'MOCK',
    delayed: 'DELAY',
    degraded: 'DEGRADE',
    down: 'DOWN'
  }[state] || String(state || 'UNKNOWN').toUpperCase();
}

function marketStateLabel(value) {
  return {
    positive_gamma_grind: '正Gamma｜磨盘',
    negative_gamma_expand: '负Gamma｜等扩张',
    flip_chop: 'Flip附近｜拉扯',
    event_risk: '事件风险｜先收手',
    unknown: '环境不明｜少做'
  }[value] || value || '环境不明｜少做';
}

function gammaLabel(value) {
  return {
    positive: '正Gamma',
    negative: '负Gamma',
    critical: 'Gamma临界',
    unknown: 'Gamma未知'
  }[value] || value || 'Gamma未知';
}

function spotPositionLabel(value) {
  return {
    below_flip: '现价在 Flip 下方',
    above_flip_below_call_wall: 'Flip 上方，Call Wall 下方',
    above_call_wall: '突破 Call Wall 上方',
    below_put_wall: '跌破 Put Wall 下方',
    between_walls: '墙内震荡区'
  }[value] || value || '位置未知';
}

function flowLabel(value) {
  return {
    call_strong: 'Call 偏强',
    put_strong: 'Put 偏强',
    mixed: '多空混合',
    neutral: '中性',
    unknown: '未知'
  }[value] || value || '未知';
}

function darkPoolLabel(value) {
  return {
    support_below: '下方支撑资金区',
    resistance_above: '上方压力资金区',
    accumulation: '偏吸筹',
    distribution: '偏派发',
    unclear: '不明显'
  }[value] || value || '不明显';
}

function dealerLabel(value) {
  return {
    control_vol: '控波动',
    release_vol: '放波动',
    sweep_up: '往上扫空',
    sweep_down: '往下扫多',
    hedge: '对冲为主',
    unclear: '不清楚'
  }[value] || value || '不清楚';
}

function eventRiskLabel(value) {
  return {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
    none: '无重大事件'
  }[value] || value || '未知';
}

function conflictLabel(value) {
  return {
    none: '无明显冲突',
    low: '轻微冲突',
    medium: '中等冲突',
    high: '高冲突'
  }[value] || value || '未知';
}

function getAction(signal) {
  if (signal?.recommended_action && ACTION_MAP[signal.recommended_action]) return ACTION_MAP[signal.recommended_action];
  if (signal?.conflict?.conflict_level === 'high' || signal?.stale_flags?.any_stale) return ACTION_MAP.no_trade;
  return ACTION_MAP.wait;
}

function hasHardBlock(signal) {
  return signal?.recommended_action === 'no_trade'
    || signal?.conflict?.conflict_level === 'high'
    || signal?.stale_flags?.any_stale
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
  const cards = Array.isArray(signal.strategy_cards) ? signal.strategy_cards : [];
  const callSpread = cards.find((c) => c.strategy_name === '看涨价差');
  const putSpread = cards.find((c) => c.strategy_name === '看跌价差');
  const single = cards.find((c) => c.strategy_name === '单腿');
  const iron = cards.find((c) => c.strategy_name === '铁鹰');

  if (type === '单腿') return single || {};
  if (type === '铁鹰') return iron || {};
  if (type === '垂直') {
    if (signal.recommended_action === 'short_on_retest') return putSpread || callSpread || {};
    return callSpread || putSpread || {};
  }
  return {};
}

function strategyState(signal, type) {
  if (hasHardBlock(signal)) return { text: '不可执行', cls: 'block' };
  if (type === '铁鹰') {
    if (signal.recommended_action === 'income_ok') return { text: '观察可做', cls: 'go' };
    if (signal.gamma_regime === 'negative' || signal.event_context?.event_risk === 'high') return { text: '禁止', cls: 'block' };
    return { text: '等波动回落', cls: 'watch' };
  }
  if (type === '垂直') {
    if (['long_on_pullback', 'short_on_retest'].includes(signal.recommended_action)) return { text: '等触发', cls: 'go' };
    return { text: '等确认', cls: 'watch' };
  }
  if (type === '单腿') {
    if (['long_on_pullback', 'short_on_retest'].includes(signal.recommended_action)) return { text: '轻仓快打', cls: 'watch' };
    return { text: '不优先', cls: 'watch' };
  }
  return { text: '等确认', cls: 'watch' };
}

function buildTrigger(signal) {
  const snap = signal.market_snapshot || {};
  if (signal.recommended_action === 'long_on_pullback') return `回踩 ${fmtInt(snap.flip_level)} 上方不破`;
  if (signal.recommended_action === 'short_on_retest') return `反抽 ${fmtInt(snap.call_wall || snap.flip_level)} 不过`;
  if (signal.recommended_action === 'income_ok') return `围绕 ${fmtInt(snap.max_pain)} 钉住，IV 回落`;
  if (signal.recommended_action === 'no_trade') return '无触发，先保护本金';
  return `离开 Flip ${fmtInt(snap.flip_level)} 后再看`;
}

function buildTarget(signal) {
  const snap = signal.market_snapshot || {};
  if (signal.recommended_action === 'long_on_pullback') return `${fmtInt(snap.call_wall)} / 上方流动性`;
  if (signal.recommended_action === 'short_on_retest') return `${fmtInt(snap.put_wall)} / 下方流动性`;
  if (signal.recommended_action === 'income_ok') return `${fmtInt(snap.put_wall)} - ${fmtInt(snap.call_wall)} 区间内收时间`;
  return '无目标，先等';
}

function buildInvalidation(signal) {
  if (signal.plain_language?.invalidation) return signal.plain_language.invalidation;
  const snap = signal.market_snapshot || {};
  if (signal.invalidation_level) return `跌破 / 站回 ${fmtInt(signal.invalidation_level)}`;
  return `Flip ${fmtInt(snap.flip_level)} 失效`;
}

function buildAvoid(signal) {
  if (signal.plain_language?.avoid) return signal.plain_language.avoid;
  if (Array.isArray(signal.avoid_actions) && signal.avoid_actions.length) return signal.avoid_actions.join(' / ');
  return '不追单，不提前卖波';
}

function summarizeEngine(name, engine) {
  const directText = safeText(
    engine?.output
    || engine?.state
    || engine?.summary
    || engine?.plain_chinese
    || engine?.note
    || engine?.message,
    ''
  );
  if (directText) {
    return directText;
  }

  switch (name) {
    case 'market_regime':
      return marketStateLabel(engine?.market_state);
    case 'gamma_wall':
      if (engine?.wall_position === 'above_call_wall') return '价格已到 Call Wall 上方，关注上方压力。';
      if (engine?.wall_position === 'below_put_wall') return '价格已到 Put Wall 下方，关注下方支撑。';
      if (engine?.wall_position === 'below_flip') return '现价在 Flip 下方，偏弱。';
      if (engine?.wall_position === 'above_flip') return '现价在 Flip 上方，偏强。';
      return '墙位压力/支撑摘要';
    case 'volatility':
      if (engine?.vol_state === 'expanding') return '波动扩张';
      if (engine?.vol_state === 'contained') return '波动收缩';
      if (engine?.vol_state === 'event_loaded') return '禁止卖波';
      return '波动状态待确认';
    case 'price_structure':
      if (engine?.confirmation_status === 'confirmed' && engine?.price_signal === 'long_pullback_ready') return '突破确认，等回踩。';
      if (engine?.confirmation_status === 'confirmed' && engine?.price_signal === 'short_retest_ready') return '跌破确认，等反抽。';
      if (engine?.price_signal === 'structure_invalidated') return '结构失效';
      return '等回踩确认';
    case 'uw_dealer_flow':
      if (engine?.uw_signal === 'bullish_flow') return 'UW 偏多';
      if (engine?.uw_signal === 'bearish_flow') return 'UW 偏空';
      return 'UW 混合';
    case 'event_risk':
      if (engine?.risk_gate === 'blocked') return '高风险';
      if (engine?.risk_gate === 'caution') return '中风险';
      if (safeText(engine?.event_note, '')?.includes('FMP 异常')) return 'FMP 异常';
      return '低风险';
    case 'conflict':
      return engine?.has_conflict ? '有冲突' : '无明显冲突';
    case 'action':
      if (engine?.recommended_action === 'no_trade') return '禁做';
      if (engine?.recommended_action === 'income_ok') return '可做';
      return '等确认';
    default:
      return '--';
  }
}

function renderTopbar(currentPath, currentScenario, signal) {
  const query = window.location.search || '';
  return `
    <header class="topbar">
      <div class="brand">
        <div class="logo-mark">SP</div>
        <div>
          <div class="brand-title">SPX Ops Dashboard</div>
          <div class="brand-subtitle">White Glass Lab · 0DTE Command Console</div>
        </div>
      </div>

      <nav class="nav">
        <a class="${currentPath === '/' ? 'active' : ''}" href="/${query}">主操作页</a>
        <a class="${currentPath === '/radar' ? 'active' : ''}" href="/radar${query}">Radar 支撑页</a>
      </nav>

      <div class="system-right">
        <div class="heartbeat"><i class="heartbeat-dot ${qualityClass(signal)}"></i><span>${escapeHtml(signal.is_mock ? 'MOCK DATA' : 'LIVE')}</span><span>${shortTime(signal.received_at)}</span></div>
        <select class="scenario-select" id="scenario-select" aria-label="mock scenario">
          ${SCENARIOS.map((item) => `<option value="${item}" ${item === currentScenario ? 'selected' : ''}>${item}</option>`).join('')}
        </select>
      </div>
    </header>
  `;
}

function renderSourceStrip(signal) {
  return `
    <section class="source-row">
      <div class="section-label">Source State</div>
      <div class="source-list">
        ${(signal.source_status || []).filter((item) => ['tradingview', 'fmp_event', 'fmp_price', 'theta_core', 'theta_full_chain', 'uw', 'telegram', 'dashboard'].includes(item.source)).map((item) => `
          <span class="source-chip ${statusClassForSource(item)}">
            ${escapeHtml(item.source)} · ${sourceStateLabel(item.state)} · ${minutesAgo(item.last_updated)}
          </span>
        `).join('')}
      </div>
    </section>
  `;
}

function renderMetricCards(signal) {
  const snap = signal.market_snapshot || {};
  return `
    <div class="price-stack">
      <div class="metric-card">
        <div class="metric-label">SPX Spot</div>
        <div class="big-number">${displaySpot(snap)}</div>
        <div class="delta-line"><i class="pulse-bar"></i><span>${escapeHtml(displaySpotContext(snap))}</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Gamma Regime</div>
        <div class="big-number">${gammaLabel(signal.gamma_regime)}</div>
        <div class="tag-row">
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${marketStateLabel(signal.market_state)}</span>
          <span class="tag blue">Flip ${fmtInt(snap.flip_level)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderRiskStack(signal) {
  const cls = qualityClass(signal);
  const conflicts = signal.conflict?.conflict_points || [];
  return `
    <div class="risk-stack">
      <div class="metric-card ${qualityClass(signal) === 'good' ? 'risk-low' : qualityClass(signal) === 'warn' ? 'risk-mid' : 'risk-high'}">
        <div class="metric-label">Signal Quality</div>
        <div class="big-number">${fmtInt(signal.confidence_score || signal.conflict?.adjusted_confidence || 0)}</div>
        <div class="tag-row">
          <span class="quality-chip ${cls}">${conflictLabel(signal.conflict?.conflict_level)}</span>
          <span class="quality-chip ${signal.event_context?.event_risk === 'high' ? 'bad' : 'ok'}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
        </div>
      </div>
      <div class="alert-panel">
        <div class="section-label">Do Not Violate</div>
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
          <div class="section-label">Current Command</div>
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
        const target = type === '垂直' ? card.target_zone || buildTarget(signal) : card.target_zone || '等待';
        const entry = type === '垂直' ? card.entry_condition || buildTrigger(signal) : card.entry_condition || buildTrigger(signal);
        const suitable = card.suitable_when || '只在结构、Gamma、事件风险同时支持时考虑。';
        const invalidation = card.invalidation || buildInvalidation(signal);
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
    ['SPX', displaySpot(snap), snap.spot_is_real ? `当前现价 · ${snap.spot_source || 'fmp'}` : '当前现价 unavailable'],
    ['Flip', fmtInt(snap.flip_level), `距离 ${fmt(snap.distance_to_flip, 1)} pt`],
    ['Call Wall', fmtInt(snap.call_wall), `距离 ${fmt(snap.distance_to_call_wall, 1)} pt`],
    ['Put Wall', fmtInt(snap.put_wall), `距离 ${fmt(snap.distance_to_put_wall, 1)} pt`],
    ['Max Pain', fmtInt(snap.max_pain), '中轴参考'],
    ['Confidence', fmtInt(signal.confidence_score), '指令可信度']
  ];
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">Key Levels</div><span class="tag blue">No Chart · Data Matrix</span></div>
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
    ['Theta', signal.signals?.theta_signal || gammaLabel(signal.gamma_regime), 'Gamma 主环境'],
    ['TradingView', signal.signals?.tv_signal || '等待结构确认', '价格确认'],
    ['UW Flow', flowLabel(signal.uw_context?.flow_bias), '主动流向'],
    ['Dark Pool', darkPoolLabel(signal.uw_context?.dark_pool_bias), '资金区'],
    ['Dealer', dealerLabel(signal.uw_context?.dealer_bias || signal.signals?.dealer_behavior), '做市商路径'],
    ['FMP', signal.event_context?.event_note || eventRiskLabel(signal.event_context?.event_risk), '事件过滤']
  ];
  return `
    <section class="matrix-panel">
      <div class="matrix-title"><div class="section-label">Decision Inputs</div><span class="tag ${chipClassByRisk(signal.conflict?.conflict_level)}">${conflictLabel(signal.conflict?.conflict_level)}</span></div>
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
  return `
    <main class="page">
      ${renderCommandHero(signal)}
      ${renderStrategyCards(signal)}
      <section class="matrix-grid">
        ${renderLevelMatrix(signal)}
        ${renderIntelMatrix(signal)}
      </section>
      ${renderSourceStrip(signal)}
      <div class="footer-note">schema ${escapeHtml(signal.schema_version)} · scenario ${escapeHtml(signal.scenario)} · ${escapeHtml(signal.fetch_mode)}</div>
    </main>
  `;
}

function renderRadarSummary(signal) {
  const snap = signal.market_snapshot || {};
  const conflictPoints = signal.conflict?.conflict_points || [];
  return `
    <section class="radar-layout">
      <article class="radar-card">
        <div class="radar-title">
          <h2>Gamma / Dealer Radar</h2>
          <span class="tag ${chipClassByRisk(signal.gamma_regime)}">${gammaLabel(signal.gamma_regime)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.radar_summary?.dealer, safeText(signal.plain_language?.dealer_behavior, '等待 dealer 行为确认。')))}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">现价位置</div><div class="matrix-value">${escapeHtml(displaySpotContext(snap))}</div><div class="matrix-number">${displaySpot(snap)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Flip</div><div class="matrix-value">${fmt(snap.distance_to_flip, 1)} pt</div><div class="matrix-number">${fmtInt(snap.flip_level)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Call Wall</div><div class="matrix-value">${fmt(snap.distance_to_call_wall, 1)} pt</div><div class="matrix-number">${fmtInt(snap.call_wall)}</div></div>
          <div class="matrix-item"><div class="matrix-name">Put Wall</div><div class="matrix-value">${fmt(snap.distance_to_put_wall, 1)} pt</div><div class="matrix-number">${fmtInt(snap.put_wall)}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Flow / UW Radar</h2>
          <span class="tag violet">${dealerLabel(signal.uw_context?.dealer_bias)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.radar_summary?.order_flow, 'UW 只作为辅助情报，不直接替代价格确认。'))}</p>
        <div class="tag-row">
          <span class="tag blue">Flow ${flowLabel(signal.uw_context?.flow_bias)}</span>
          <span class="tag green">Dark Pool ${darkPoolLabel(signal.uw_context?.dark_pool_bias)}</span>
          <span class="tag amber">Theta Weight ${fmtInt((signal.weights?.theta || 0) * 100)}%</span>
          <span class="tag violet">UW Weight ${fmtInt((signal.weights?.uw || 0) * 100)}%</span>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Event Risk</h2>
          <span class="tag ${chipClassByRisk(signal.event_context?.event_risk)}">${eventRiskLabel(signal.event_context?.event_risk)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.event_context?.event_note, '无重大事件风险。'))}</p>
        <div class="matrix-list">
          <div class="matrix-item"><div class="matrix-name">卖波许可</div><div class="matrix-value">${signal.event_context?.event_risk === 'high' ? '禁止提前铁鹰 / 裸卖' : '仅在波动回落后评估'}</div><div class="matrix-number">FMP</div></div>
          <div class="matrix-item"><div class="matrix-name">主操作页影响</div><div class="matrix-value">${escapeHtml(getAction(signal).title)}</div><div class="matrix-number">${getAction(signal).permission}</div></div>
        </div>
      </article>

      <article class="radar-card">
        <div class="radar-title">
          <h2>Signal Conflict</h2>
          <span class="quality-chip ${qualityClass(signal)}">${conflictLabel(signal.conflict?.conflict_level)}</span>
        </div>
        <p class="radar-note">${escapeHtml(safeText(signal.radar_summary?.plan_alignment, safeText(signal.plain_language?.market_status, '暂无冲突说明。')))}</p>
        <ul class="alert-list">
          ${(conflictPoints.length ? conflictPoints : ['没有强冲突，但仍必须等触发。']).map((item) => `<li>${escapeHtml(safeText(item))}</li>`).join('')}
        </ul>
      </article>
    </section>
  `;
}

function renderEngineMatrix(signal) {
  const engines = signal.engines || {};
  const rows = Object.entries(engines).map(([name, engine]) => {
    const output = summarizeEngine(name, engine);
    const weight = typeof engine === 'object' && engine.weight != null ? fmtInt(Number(engine.weight) * 100) + '%' : '--';
    return `
      <div class="matrix-item">
        <div class="matrix-name">${escapeHtml(name)}</div>
        <div class="matrix-value">${escapeHtml(output)}</div>
        <div class="matrix-number">${weight}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="matrix-grid">
      <div class="matrix-panel">
        <div class="matrix-title"><div class="section-label">Engine Outputs</div><span class="tag blue">Pure Data</span></div>
        <div class="matrix-list">${rows || '<div class="matrix-item"><div class="matrix-value">No engine data</div></div>'}</div>
      </div>
      <div class="matrix-panel">
        <div class="matrix-title"><div class="section-label">Raw Notes</div><span class="tag amber">只看结论，不看图表</span></div>
        <div class="matrix-list">
          ${(signal.notes || []).map((note, index) => `
            <div class="matrix-item">
              <div class="matrix-name">NOTE ${index + 1}</div>
              <div class="matrix-value">${escapeHtml(safeText(note))}</div>
              <div class="matrix-number">LOG</div>
            </div>
          `).join('') || '<div class="matrix-item"><div class="matrix-value">No notes</div></div>'}
        </div>
      </div>
    </section>
  `;
}

function renderRadar(signal) {
  return `
    <main class="page">
      ${renderRadarSummary(signal)}
      ${renderEngineMatrix(signal)}
      ${renderSourceStrip(signal)}
      <div class="footer-note">Radar only supports Page 1 command. It does not create separate trade signals.</div>
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

function renderPage(signal) {
  const path = window.location.pathname === '/radar' ? '/radar' : '/';
  document.getElementById('app').innerHTML = `
    ${renderTopbar(path, getScenario(), signal)}
    ${path === '/radar' ? renderRadar(signal) : renderHome(signal)}
  `;
  bindScenarioSelector();
}

document.addEventListener('DOMContentLoaded', async () => {
  renderLoading();
  try {
    const signal = await loadSignal();
    renderPage(signal);
  } catch (error) {
    renderError(error);
  }
});
