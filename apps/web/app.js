const SCENARIOS = [
  'negative_gamma_wait_pullback',
  'positive_gamma_income_watch',
  'flip_conflict_wait',
  'theta_stale_no_trade',
  'fmp_event_no_short_vol',
  'uw_call_strong_unconfirmed',
  'breakout_pullback_pending'
];

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
    const staleClass = item.stale ? 'card stale' : 'card';
    return `
      <section class="${staleClass}">
        <h4>${item.source}</h4>
        <p>fetch_mode: ${item.fetch_mode}</p>
        <p>last_updated: ${item.last_updated}</p>
        <p>latency_ms: ${item.latency_ms}</p>
        <p>stale_reason: ${item.stale_reason || 'none'}</p>
        <p>${item.message}</p>
      </section>
    `;
  }).join('');
}

function renderStrategyCards(signal) {
  return signal.strategy_cards.map((card) => `
    <section class="card strategy-card">
      <h4>${card.strategy_name}</h4>
      <p><strong>suitable_when:</strong> ${card.suitable_when}</p>
      <p><strong>entry_condition:</strong> ${card.entry_condition}</p>
      <p><strong>target_zone:</strong> ${card.target_zone}</p>
      <p><strong>invalidation:</strong> ${card.invalidation}</p>
      <p><strong>avoid_when:</strong> ${card.avoid_when}</p>
    </section>
  `).join('');
}

function renderConflictPoints(points) {
  if (!points.length) {
    return '<p>none</p>';
  }

  return `<ul>${points.map((point) => `<li>${point}</li>`).join('')}</ul>`;
}

function renderDashboard(signal) {
  const root = document.getElementById('app');
  const conflictBanner = signal.conflict.conflict_level === 'high'
    ? '<div class="conflict-banner">逻辑冲突，观望</div>'
    : '';

  root.innerHTML = `
    <main class="shell">
      ${conflictBanner}
      <header class="hero">
        <div>
          <p class="eyebrow">spx-ops-dashboard / mock master engine</p>
          <h1>总判断条</h1>
          <p class="hero-status">${signal.plain_language.market_status}</p>
          <p class="hero-meta">scenario: ${signal.scenario}</p>
          <p class="hero-meta">data_timestamp: ${signal.data_timestamp}</p>
          <p class="hero-meta">received_at: ${signal.received_at}</p>
          <p class="hero-meta">latency_ms: ${signal.latency_ms}</p>
        </div>
        <section class="action-card">
          <p class="eyebrow">你的动作</p>
          <div class="primary-action">${signal.recommended_action}</div>
          <p class="action-copy">${signal.plain_language.user_action}</p>
          <p class="confidence">confidence ${signal.confidence_score}</p>
        </section>
      </header>

      <section class="scenario-strip">
        <h3>开发场景切换</h3>
        <div class="scenario-links">${renderScenarioLinks(signal.scenario)}</div>
      </section>

      <section class="grid two-up">
        <section class="card">
          <h3>禁做事项</h3>
          <div class="chip-wrap">
            ${signal.avoid_actions.map((item) => `<span class="chip">${item}</span>`).join('') || '<span class="chip">none</span>'}
          </div>
        </section>
        <section class="card">
          <h3>失效条件</h3>
          <p>${signal.invalidation_level}</p>
          <p class="muted">${signal.plain_language.invalidation}</p>
        </section>
      </section>

      <section class="grid two-up">
        <section class="card">
          <h3>conflict</h3>
          <p>level: ${signal.conflict.conflict_level}</p>
          <p>has_conflict: ${signal.conflict.has_conflict}</p>
          ${renderConflictPoints(signal.conflict.conflict_points)}
        </section>
        <section class="card">
          <h3>stale_flags</h3>
          <div class="pre">${JSON.stringify(signal.stale_flags, null, 2)}</div>
          <p><strong>stale_reason:</strong> ${signal.stale_reason.join(' | ') || 'none'}</p>
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
          <h3>主力行为</h3>
          <p>${signal.plain_language.dealer_behavior}</p>
          <p>UW flow: ${signal.uw_context.flow_bias}</p>
          <p>dark pool: ${signal.uw_context.dark_pool_bias}</p>
          <p>dealer bias: ${signal.uw_context.dealer_bias}</p>
        </section>
      </section>

      <section class="card">
        <h3>strategy_cards</h3>
        <div class="grid three-up">
          ${renderStrategyCards(signal)}
        </div>
      </section>

      <section class="card">
        <h3>数据源状态</h3>
        <div class="grid four-up">
          ${renderSourceStatus(signal)}
        </div>
      </section>

      <section class="card">
        <h3>完整 /signals/current</h3>
        <div class="pre">${JSON.stringify(signal, null, 2)}</div>
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
