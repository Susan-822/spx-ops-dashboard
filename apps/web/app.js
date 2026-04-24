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

function renderDashboard(signal) {
  const root = document.getElementById('app');
  const conflictBanner = signal.conflict.conflict_level === 'high'
    ? '<div class="conflict-banner">逻辑冲突，观望</div>'
    : '';
  const noTradeBanner = signal.recommended_action === 'no_trade'
    ? '<div class="no-trade-banner">当前不交易，先解决数据或信号质量问题</div>'
    : '';

  root.innerHTML = `
    <main class="shell">
      ${conflictBanner}
      ${noTradeBanner}

      <header class="hero">
        <section>
          <p class="eyebrow">SPX / SPY / ES 0DTE intraday command center</p>
          <h1>盘中总判断</h1>
          <p class="hero-status">${signal.plain_language.market_status}</p>
          <div class="hero-meta-group">
            <span>scenario: ${signal.scenario}</span>
            <span>data_timestamp: ${signal.data_timestamp}</span>
            <span>received_at: ${signal.received_at}</span>
            <span>latency_ms: ${signal.latency_ms}</span>
          </div>
        </section>

        <section class="action-card">
          <p class="eyebrow">你的动作</p>
          <div class="primary-action">${signal.recommended_action}</div>
          <p class="action-copy">${signal.plain_language.user_action}</p>
          <p class="confidence">confidence ${signal.confidence_score}</p>
        </section>
      </header>

      <section class="scenario-strip">
        <h3>场景切换</h3>
        <div class="scenario-links">${renderScenarioLinks(signal.scenario)}</div>
      </section>

      <section class="grid three-up">
        <section class="card">
          <h3>为什么</h3>
          <p>${signal.plain_language.dealer_behavior}</p>
          <p>${signal.plain_language.avoid}</p>
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

      <section class="grid two-up">
        <section class="card">
          <h3>Gamma 环境</h3>
          <p>market_state: ${signal.market_state}</p>
          <p>gamma_regime: ${signal.gamma_regime}</p>
          <p>spot / flip: ${signal.market_snapshot.spot} / ${signal.market_snapshot.flip_level}</p>
          <p>call / put / max pain: ${signal.market_snapshot.call_wall} / ${signal.market_snapshot.put_wall} / ${signal.market_snapshot.max_pain}</p>
        </section>
        <section class="card">
          <h3>冲突与陈旧</h3>
          <p>conflict_level: ${signal.conflict.conflict_level}</p>
          ${renderConflictPoints(signal.conflict.conflict_points)}
          <div class="pre">${JSON.stringify(signal.stale_flags, null, 2)}</div>
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
