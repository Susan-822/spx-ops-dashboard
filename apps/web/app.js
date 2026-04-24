const SCENARIOS = [
  'negative_gamma_wait_pullback',
  'positive_gamma_income_watch',
  'flip_conflict_wait',
  'theta_stale_no_trade',
  'fmp_event_no_short_vol',
  'uw_call_strong_unconfirmed',
  'breakout_pullback_pending'
];

function stateLabel(state) {
  const labels = {
    real: 'REAL',
    mock: 'MOCK',
    delayed: 'DELAYED',
    degraded: 'DEGRADED',
    down: 'DOWN'
  };
  return labels[state] ?? state;
}

function deriveRiskLevel(signal) {
  if (signal.recommended_action === 'no_trade' || signal.conflict.conflict_level === 'high' || signal.stale_flags.any_stale) {
    return '高';
  }
  if (signal.conflict.conflict_level === 'medium' || signal.event_context.event_risk === 'high') {
    return '中';
  }
  return '低';
}

function buildPlanChips(signal) {
  const mainPlan = signal.recommended_action === 'long_on_pullback'
    ? '主计划：回踩不破再多'
    : signal.recommended_action === 'short_on_retest'
      ? '主计划：反抽受阻再空'
      : signal.recommended_action === 'income_ok'
        ? '主计划：观察收入型机会'
        : '主计划：观望';

  const rhythm = signal.market_state === 'negative_gamma_expand'
    ? '节奏：快进快出'
    : signal.market_state === 'flip_chop'
      ? '节奏：先等离开中间区'
      : '节奏：按确认节奏执行';

  const avoid = signal.avoid_actions.length > 0
    ? `禁做：${signal.avoid_actions[0]}`
    : '禁做：无';

  return [mainPlan, rhythm, avoid];
}

async function loadSignal() {
  const query = window.location.search || '';
  const response = await fetch(`/signals/current${query}`);
  if (!response.ok) {
    throw new Error('Failed to load /signals/current');
  }
  return response.json();
}

function renderScenarioLinks(currentScenario) {
  return SCENARIOS.map((scenario) => {
    const activeClass = scenario === currentScenario ? 'scenario-link active' : 'scenario-link';
    return `<a class="${activeClass}" href="/?scenario=${scenario}">${scenario}</a>`;
  }).join('');
}

function renderSourceStatus(signal) {
  return signal.source_status.map((item) => {
    const stateClass = `status-pill state-${item.state}`;
    const staleClass = item.stale ? 'status-card stale' : 'status-card';
    return `
      <section class="${staleClass}">
        <div class="status-head">
          <h4>${item.source}</h4>
          <span class="${stateClass}">${stateLabel(item.state)}</span>
        </div>
        <p>fetch_mode: ${item.fetch_mode}</p>
        <p>last_updated: ${item.last_updated}</p>
        <p>latency_ms: ${item.latency_ms}</p>
        <p>${item.stale_reason || item.message}</p>
      </section>
    `;
  }).join('');
}

function renderStrategyCards(signal) {
  return signal.strategy_cards.map((card) => `
    <section class="card strategy-card">
      <h4>${card.strategy_name}</h4>
      <p><strong>适合时机：</strong>${card.suitable_when}</p>
      <p><strong>入场条件：</strong>${card.entry_condition}</p>
      <p><strong>目标区域：</strong>${card.target_zone}</p>
      <p><strong>失效：</strong>${card.invalidation}</p>
      <p><strong>避免：</strong>${card.avoid_when}</p>
    </section>
  `).join('');
}

function renderConflictPoints(points) {
  if (!points.length) {
    return '<p>当前没有明显逻辑冲突。</p>';
  }
  return `<ul>${points.map((point) => `<li>${point}</li>`).join('')}</ul>`;
}

function renderStatusStrip(signal) {
  return signal.source_status.map((item) => `
    <div class="strip-item ${item.state === 'down' ? 'strip-alert' : ''}">
      <span>${item.source}</span>
      <strong>${stateLabel(item.state)}</strong>
    </div>
  `).join('');
}

function renderMiniCards(signal) {
  const cards = [
    {
      title: '波动启动灯',
      value: signal.engines.volatility.vol_state,
      note: signal.gamma_regime === 'negative' ? '波动更容易放大，别追。' : '波动相对可控，但仍需确认。'
    },
    {
      title: '做市商敞口',
      value: signal.market_state,
      note: signal.plain_language.dealer_behavior
    },
    {
      title: 'Spot Gamma',
      value: signal.gamma_regime,
      note: `Flip ${signal.market_snapshot.flip_level}`
    },
    {
      title: '主力流向',
      value: signal.signals.uw_signal,
      note: signal.uw_context.flow_bias
    },
    {
      title: '事件',
      value: signal.event_context.event_risk,
      note: signal.event_context.event_note
    },
    {
      title: '系统状态',
      value: signal.source_status.some((item) => item.state === 'down') ? '异常' : '正常',
      note: signal.source_status.filter((item) => item.state !== 'mock').map((item) => `${item.source}:${item.state}`).join(' / ') || '当前均为 mock fallback'
    }
  ];

  return cards.map((card) => `
    <section class="card mini-card">
      <h4>${card.title}</h4>
      <p class="mini-value">${card.value}</p>
      <p>${card.note}</p>
    </section>
  `).join('');
}

function renderDashboard(signal) {
  const root = document.getElementById('app');
  const conflictBanner = signal.conflict.conflict_level === 'high'
    ? '<div class="conflict-banner">逻辑冲突，观望</div>'
    : '';
  const noTradeBanner = signal.recommended_action === 'no_trade'
    ? '<div class="no-trade-banner">当前不交易，先解决数据或信号质量问题</div>'
    : '';
  const riskLevel = deriveRiskLevel(signal);
  const planChips = buildPlanChips(signal);

  root.innerHTML = `
    <main class="shell">
      ${conflictBanner}
      ${noTradeBanner}

      <header class="top-command-bar">
        <section class="market-card">
          <p class="eyebrow">SPX 现价</p>
          <div class="spot-value">${signal.market_snapshot.spot}</div>
          <p class="spot-sub">Gamma: ${signal.gamma_regime}</p>
        </section>

        <section class="hero hero-inline">
          <div>
            <p class="eyebrow">当前指令</p>
            <h1>${signal.plain_language.user_action}</h1>
            <p class="hero-status">${signal.plain_language.market_status}</p>
            <div class="chip-wrap">${planChips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div>
          </div>
        </section>

        <section class="risk-card">
          <p class="eyebrow">风险等级</p>
          <div class="risk-value">${riskLevel}</div>
          <p>${signal.conflict.conflict_level} conflict / confidence ${signal.confidence_score}</p>
        </section>
      </header>

      <section class="scenario-strip">
        <h3>场景切换</h3>
        <div class="scenario-links">${renderScenarioLinks(signal.scenario)}</div>
      </section>

      <section class="grid three-up">
        <section class="card emphasis-card">
          <h3>你的动作</h3>
          <div class="primary-action">${signal.recommended_action}</div>
          <p class="action-copy">${signal.plain_language.user_action}</p>
          <p class="confidence">confidence ${signal.confidence_score}</p>
        </section>
        <section class="card emphasis-card">
          <h3>禁做事项</h3>
          <div class="chip-wrap">
            ${signal.avoid_actions.map((item) => `<span class="chip">${item}</span>`).join('') || '<span class="chip">none</span>'}
          </div>
        </section>
        <section class="card emphasis-card">
          <h3>失效条件</h3>
          <p>${signal.invalidation_level}</p>
          <p class="muted">${signal.plain_language.invalidation}</p>
        </section>
      </section>

      <section class="grid three-up mini-grid">
        ${renderMiniCards(signal)}
      </section>

      <section class="grid two-up">
        <section class="card">
          <h3>冲突与陈旧</h3>
          <p>conflict_level: ${signal.conflict.conflict_level}</p>
          ${renderConflictPoints(signal.conflict.conflict_points)}
          <div class="pre">${JSON.stringify(signal.stale_flags, null, 2)}</div>
        </section>
        <section class="card">
          <h3>关键位地图</h3>
          <p>spot / flip: ${signal.market_snapshot.spot} / ${signal.market_snapshot.flip_level}</p>
          <p>call wall: ${signal.market_snapshot.call_wall}</p>
          <p>put wall: ${signal.market_snapshot.put_wall}</p>
          <p>max pain: ${signal.market_snapshot.max_pain}</p>
          <p>data_timestamp: ${signal.data_timestamp}</p>
          <p>received_at: ${signal.received_at}</p>
        </section>
      </section>

      <section class="card">
        <h3>策略卡</h3>
        <div class="grid three-up">
          ${renderStrategyCards(signal)}
        </div>
      </section>

      <section class="card">
        <h3>数据源状态条</h3>
        <div class="status-strip">
          ${renderStatusStrip(signal)}
        </div>
        <div class="grid three-up status-grid">
          ${renderSourceStatus(signal)}
        </div>
      </section>
    </main>
  `;
}

async function boot() {
  const root = document.getElementById('app');
  root.innerHTML = '<main class="shell"><p>Loading /signals/current ...</p></main>';
  try {
    const signal = await loadSignal();
    renderDashboard(signal);
  } catch (error) {
    root.innerHTML = `<main class="shell"><section class="card"><h2>Load Error</h2><p>${error.message}</p></section></main>`;
  }
}

boot();
