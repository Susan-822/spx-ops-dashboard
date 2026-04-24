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
  return [
    `市场状态：${signal.plain_language.market_status}`,
    `主力行为：${signal.plain_language.dealer_behavior}`,
    `禁做：${signal.plain_language.avoid}`
  ];
}

async function loadSignal() {
  const query = window.location.search || '';
  const response = await fetch(`/signals/current${query}`);
  if (!response.ok) {
    throw new Error('Failed to load /signals/current');
  }
  return response.json();
}

function renderTopNav(currentPath, currentScenario) {
  return `
    <header class="site-nav">
      <div class="brand">SPX 盘中指挥台</div>
      <nav class="page-links">
        <a class="${currentPath === '/' ? 'active' : ''}" href="/${window.location.search}">指令页</a>
        <a class="${currentPath === '/radar' ? 'active' : ''}" href="/radar${window.location.search}">资金雷达</a>
      </nav>
      <div class="scenario-links compact">${SCENARIOS.map((scenario) => {
        const activeClass = scenario === currentScenario ? 'scenario-link active' : 'scenario-link';
        return `<a class="${activeClass}" href="${currentPath}?scenario=${scenario}">${scenario}</a>`;
      }).join('')}</div>
    </header>
  `;
}

function renderSourceStatusStrip(signal) {
  return signal.source_status.map((item) => `
    <div class="strip-item ${item.stale ? 'strip-stale' : ''}">
      <span>${item.source}</span>
      <strong>${stateLabel(item.state)}</strong>
    </div>
  `).join('');
}

function renderStrategyCards(signal) {
  return signal.strategy_cards.map((card) => `
    <section class="card strategy-card">
      <h4>${card.strategy_name}</h4>
      <p><strong>适合：</strong>${card.suitable_when}</p>
      <p><strong>入场：</strong>${card.entry_condition}</p>
      <p><strong>目标：</strong>${card.target_zone}</p>
      <p><strong>失效：</strong>${card.invalidation}</p>
      <p><strong>禁做：</strong>${card.avoid_when}</p>
    </section>
  `).join('');
}

function renderDashboardPage(signal) {
  const conflictBanner = signal.conflict.conflict_level === 'high'
    ? '<div class="conflict-banner">逻辑冲突，观望</div>'
    : '';
  const noTradeBanner = signal.recommended_action === 'no_trade'
    ? '<div class="no-trade-banner">暂停交易指令</div>'
    : '';
  const riskLevel = deriveRiskLevel(signal);
  const planChips = buildPlanChips(signal);

  return `
    ${conflictBanner}
    ${noTradeBanner}

    <section class="top-command-bar">
      <section class="market-card">
        <p class="eyebrow">当前价</p>
        <div class="spot-value">${signal.market_snapshot.spot}</div>
        <p class="spot-sub">Gamma：${signal.gamma_regime}</p>
      </section>

      <section class="hero hero-inline">
        <p class="eyebrow">总判断条</p>
        <h1>${signal.plain_language.user_action}</h1>
        <div class="chip-wrap">${planChips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div>
      </section>

      <section class="risk-card">
        <p class="eyebrow">风险等级</p>
        <div class="risk-value">${riskLevel}</div>
        <p>${signal.conflict.conflict_level} / confidence ${signal.confidence_score}</p>
      </section>
    </section>

    <section class="grid dashboard-core">
      <section class="card action-card-large">
        <p class="eyebrow">你的动作</p>
        <div class="primary-action">${signal.recommended_action}</div>
        <p><strong>入场条件：</strong>${signal.strategy_cards[0]?.entry_condition ?? '等待更清晰的确认。'}</p>
        <p><strong>禁做：</strong>${signal.plain_language.avoid}</p>
        <p><strong>失效：</strong>${signal.plain_language.invalidation}</p>
      </section>

      <section class="card keymap-card">
        <h3>关键位地图</h3>
        <p>spot: ${signal.market_snapshot.spot}</p>
        <p>flip_level: ${signal.market_snapshot.flip_level}</p>
        <p>call_wall: ${signal.market_snapshot.call_wall}</p>
        <p>put_wall: ${signal.market_snapshot.put_wall}</p>
        <p>max_pain: ${signal.market_snapshot.max_pain}</p>
        <p>distance_to_flip: ${signal.market_snapshot.distance_to_flip}</p>
        <p>distance_to_call_wall: ${signal.market_snapshot.distance_to_call_wall}</p>
        <p>distance_to_put_wall: ${signal.market_snapshot.distance_to_put_wall}</p>
        <p>spot_position: ${signal.market_snapshot.spot_position}</p>
      </section>
    </section>

    <section class="grid three-up mini-grid">
      <section class="card mini-card">
        <h4>主力行为</h4>
        <p class="mini-value">${signal.plain_language.dealer_behavior}</p>
      </section>
      <section class="card mini-card">
        <h4>Gamma 环境</h4>
        <p class="mini-value">${signal.market_state}</p>
      </section>
      <section class="card mini-card">
        <h4>事件风险</h4>
        <p class="mini-value">${signal.event_context.event_risk}</p>
      </section>
    </section>

    <section class="card support-card">
      <h3>UW 是否支持主计划</h3>
      <p>${signal.radar_summary.plan_alignment.effect_on_action}</p>
    </section>

    <section class="card">
      <h3>策略卡</h3>
      <div class="grid three-up">
        ${renderStrategyCards(signal)}
      </div>
    </section>

    <section class="card footer-status-card">
      <h3>数据源状态小条</h3>
      <div class="status-strip">
        ${renderSourceStatusStrip(signal)}
      </div>
    </section>
  `;
}

function renderRadarPage(signal) {
  const radar = signal.radar_summary;

  return `
    <section class="radar-header card">
      <h1>资金雷达</h1>
      <p>${radar.plan_alignment.status}</p>
      <p>${radar.plan_alignment.effect_on_action}</p>
    </section>

    <section class="grid two-up radar-grid">
      <section class="card">
        <h3>订单流</h3>
        <p>Call 买入：$${radar.order_flow.call_buy_premium}m</p>
        <p>Call 卖出：$${radar.order_flow.call_sell_premium}m</p>
        <p>Put 买入：$${radar.order_flow.put_buy_premium}m</p>
        <p>Put 卖出：$${radar.order_flow.put_sell_premium}m</p>
        <p>0DTE Call 买入：$${radar.order_flow.zero_dte_call_buy_premium}m</p>
        <p>0DTE Put 买入：$${radar.order_flow.zero_dte_put_buy_premium}m</p>
        <p><strong>净偏向：</strong>${radar.order_flow.flow_bias}</p>
        <p><strong>主动性：</strong>${radar.order_flow.aggressor}</p>
        <p>${radar.order_flow.explanation}</p>
      </section>

      <section class="card">
        <h3>做市商 / Dealer</h3>
        <p>Gamma：${radar.dealer.gamma_bias}</p>
        <p>Vanna：${radar.dealer.vanna_bias}</p>
        <p>Charm：${radar.dealer.charm_bias}</p>
        <p>Vomma 风险：${radar.dealer.vomma_risk}</p>
        <p>Speed 风险：${radar.dealer.speed_risk}</p>
        <p>Color：${radar.dealer.color_decay}</p>
        <p><strong>综合：</strong>${radar.dealer.dealer_behavior}</p>
        <p>${radar.dealer.explanation}</p>
      </section>
    </section>

    <section class="grid two-up radar-grid">
      <section class="card">
        <h3>暗池</h3>
        <p>下方承接：${radar.dark_pool.support_below}</p>
        <p>上方压力：${radar.dark_pool.resistance_above}</p>
        <p>关键暗池价位：${radar.dark_pool.key_levels.join(' / ')}</p>
        <p>距当前 spot：${radar.dark_pool.distance_to_spot.join(' / ')}</p>
        <p><strong>暗池偏向：</strong>${radar.dark_pool.dark_pool_bias}</p>
        <p>${radar.dark_pool.explanation}</p>
      </section>

      <section class="card radar-summary-card">
        <h3>资金雷达总判断</h3>
        <p><strong>状态：</strong>${radar.plan_alignment.status}</p>
        <p><strong>支持原因：</strong>${radar.plan_alignment.support_reason}</p>
        <p><strong>冲突原因：</strong>${radar.plan_alignment.conflict_reason}</p>
        <p><strong>对第一页动作的影响：</strong>${radar.plan_alignment.effect_on_action}</p>
      </section>
    </section>
  `;
}

function renderApp(signal) {
  const root = document.getElementById('app');
  const currentPath = window.location.pathname === '/radar' ? '/radar' : '/';
  const pageContent = currentPath === '/radar' ? renderRadarPage(signal) : renderDashboardPage(signal);

  root.innerHTML = `
    <main class="shell">
      ${renderTopNav(currentPath, signal.scenario)}
      ${pageContent}
    </main>
  `;
}

async function boot() {
  const root = document.getElementById('app');
  root.innerHTML = '<main class="shell"><p>Loading /signals/current ...</p></main>';
  try {
    const signal = await loadSignal();
    renderApp(signal);
  } catch (error) {
    root.innerHTML = `<main class="shell"><section class="card"><h2>Load Error</h2><p>${error.message}</p></section></main>`;
  }
}

boot();
