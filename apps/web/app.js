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
    throw new Error(`无法读取 /signals/current：${response.status}`);
  }
  return response.json();
}

function sanitizeText(text) {
  if (text === undefined || text === null) {
    return '';
  }
  return String(text)
    .replaceAll('negative_gamma_expand', '负Gamma｜容易扩波')
    .replaceAll('positive_gamma_grind', '正Gamma｜偏磨盘')
    .replaceAll('flip_chop', 'Flip附近｜拉扯')
    .replaceAll('event_risk', '事件风险｜先防守')
    .replaceAll('below_flip', '现价在 Flip 下方')
    .replaceAll('above_flip_below_call_wall', 'Flip 上方，Call Wall 下方')
    .replaceAll('above_call_wall', '突破上方墙')
    .replaceAll('below_put_wall', '跌破下方墙')
    .replaceAll('between_walls', '墙内震荡区')
    .replaceAll('chasing', '不追高')
    .replaceAll('early_iron_condor', '不提前铁鹰')
    .replaceAll('naked_sell', '不裸卖')
    .replaceAll('middle_zone_countertrend', '不在中间区逆势抢')
    .replaceAll('short_vol_before_event', '消息前禁卖波')
    .replaceAll('trade_on_stale_data', '不用旧数据交易');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  return `$${Number(value).toFixed(1)}m`;
}

function fmtNumber(v) {
  if (v === undefined || v === null || v === "") return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function timeOnly(v) {
  if (!v) return "--";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function flowBiasText(v) {
  const map = {
    call_strong: "Call 强，但仍等价格确认",
    put_strong: "Put 强，但不能直接追空",
    mixed: "多空混乱，降低等级",
    neutral: "中性，暂无强方向",
  };
  return map[v] || "订单流不明确";
}

function dealerBehaviorText(v) {
  const map = {
    control_vol: "控波，偏磨盘",
    release_vol: "放波，容易走大",
    sweep_up: "扫空，向上挤压",
    sweep_down: "扫多，向下挤压",
    hedge: "对冲为主",
    unclear: "做市商不清楚",
  };
  return map[v] || "做市商不清楚";
}

function darkPoolBiasText(v) {
  const map = {
    support_below: "下方有承接",
    resistance_above: "上方有压力",
    accumulation: "偏吸筹",
    distribution: "偏派发",
    unclear: "暗池不明显",
  };
  return map[v] || "暗池不明显";
}

function planBadge(status) {
  if (String(status).includes("支持")) return "支持 / 等确认";
  if (String(status).includes("冲突")) return "冲突 / 降级";
  return "数据辅助";
}

function yn(v) {
  if (v === true) return "有";
  if (v === false) return "无";
  return v || "不明显";
}

function mockRadar() {
  return {
    order_flow: {
      call_buy_premium: 4.2,
      call_sell_premium: 1.2,
      put_buy_premium: 4.4,
      put_sell_premium: 1.1,
      zero_dte_call_buy_premium: 0.8,
      zero_dte_put_buy_premium: 0.7,
      flow_bias: "put_strong",
      flow_quality: "ask-side / sweep",
      aggressor: "ask-side / sweep",
      explanation: "资金偏空，但价格未确认，不追。",
    },
    dealer: {
      gamma_bias: "negative",
      vanna_bias: "negative",
      charm_bias: "negative",
      vomma_risk: "高",
      speed_risk: "高",
      color_decay: "不明显",
      dealer_behavior: "release_vol",
      explanation: "Gamma 偏负，Speed / Vomma 风险高，容易放大波动，禁止提前铁鹰 / 裸卖。",
    },
    dark_pool: {
      support_below: "不明显",
      resistance_above: "不明显",
      key_levels: [5225, 5275, 5320],
      distance_to_spot: [27, 23, 68],
      dark_pool_bias: "unclear",
      explanation: "暗池没有形成足够支撑或压力，不能单独作为入场理由。",
    },
    plan_alignment: {
      status: "部分支持，等确认",
      support_reason: "资金偏向与主计划部分一致。",
      conflict_reason: "价格未确认，不能把资金偏向直接翻译成行动。",
      effect_on_action: "资金雷达只支持等待，不支持直接追单。",
    },
  };
}

function shortTime(value) {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return value;
  }
}

function stateLabel(state) {
  return {
    real: '正常',
    mock: 'mock',
    delayed: '延迟',
    degraded: '降级',
    down: 'down'
  }[state] ?? state;
}

function connectionStatus(signal) {
  if (signal.source_status.some((item) => item.state === 'down')) {
    return '连接异常';
  }
  if (signal.source_status.some((item) => item.state === 'delayed' || item.state === 'degraded')) {
    return '连接降级';
  }
  return '连接正常';
}

function actionLabel(signal) {
  switch (signal.recommended_action) {
    case 'long_on_pullback':
      return '等回踩，不追';
    case 'short_on_retest':
      return '等反抽受阻，再空';
    case 'income_ok':
      return '等波动回落，再看铁鹰';
    case 'no_trade':
      return '暂停交易指令';
    default:
      return signal.conflict.conflict_level === 'high' ? '观望，逻辑冲突' : '等确认，不追';
  }
}

function marketStateLabel(value) {
  return {
    positive_gamma_grind: '正Gamma｜偏磨盘',
    negative_gamma_expand: '负Gamma｜容易扩波',
    flip_chop: 'Flip 附近｜来回拉扯',
    event_risk: '事件风险｜先收手',
    unknown: '状态未明'
  }[value] ?? value;
}

function spotPositionLabel(value) {
  return {
    above_call_wall: '现价在上方墙上方',
    below_put_wall: '现价在下方墙下方',
    below_flip: '现价在 Flip 下方',
    above_flip: '现价在 Flip 上方',
    between_walls: '现价在墙之间'
  }[value] ?? value;
}

function riskClass(signal) {
  if (signal.recommended_action === 'no_trade' || signal.conflict.conflict_level === 'high') {
    return 'risk-high';
  }
  if (signal.event_context.event_risk === 'high' || signal.conflict.conflict_level === 'medium') {
    return 'risk-mid';
  }
  return 'risk-low';
}

function derivedVolNumber(signal) {
  const base = signal.gamma_regime === 'negative' ? 31 : signal.gamma_regime === 'positive' ? 18 : 24;
  if (signal.event_context.event_risk === 'high') {
    return base + 6;
  }
  return base;
}

function buildCommandLine(signal) {
  if (signal.recommended_action === 'long_on_pullback') {
    return `当前指令：回踩不破 ${signal.market_snapshot.flip_level} 再多；跌破 ${signal.market_snapshot.put_wall} 撤退`;
  }
  if (signal.recommended_action === 'short_on_retest') {
    return `当前指令：反抽不过 ${signal.market_snapshot.call_wall} 偏空做；重新站回 ${signal.market_snapshot.call_wall} 上方撤退`;
  }
  if (signal.recommended_action === 'income_ok') {
    return `当前指令：围绕 ${signal.market_snapshot.max_pain} 观察收入型策略；离开 ${signal.market_snapshot.put_wall}-${signal.market_snapshot.call_wall} 区间撤退`;
  }
  if (signal.recommended_action === 'no_trade') {
    return '当前指令：数据过期，暂停交易指令';
  }
  if (signal.conflict.conflict_level === 'high') {
    return '当前指令：逻辑冲突，先观望；离开中间区再判断';
  }
  return `当前指令：等确认，不追；回到 Flip ${signal.market_snapshot.flip_level} 附近再判断`;
}

function buildTopChips(signal) {
  const mainPlan = signal.recommended_action === 'long_on_pullback'
    ? '主计划：顺势多'
    : signal.recommended_action === 'short_on_retest'
      ? '主计划：顺势空'
      : signal.recommended_action === 'income_ok'
        ? '主计划：观察铁鹰'
        : '主计划：观望';

  const rhythm = signal.market_state === 'negative_gamma_expand'
    ? '节奏：快进快出'
    : signal.market_state === 'flip_chop'
      ? '节奏：先等离开中间区'
      : '节奏：等确认再做';

  return [mainPlan, rhythm, `禁做：${signal.plain_language.avoid}`];
}

function strategyExecutionCards(signal) {
  const defaultReason = signal.plain_language.avoid;
  return [
    {
      name: '铁鹰',
      status: signal.recommended_action === 'income_ok' ? '可执行' : signal.event_context.event_risk === 'high' || signal.gamma_regime === 'negative' ? '不可执行' : '等确认',
      reason: signal.recommended_action === 'income_ok'
        ? '波动回落，区间结构仍在'
        : signal.event_context.event_risk === 'high'
          ? '消息前禁卖波'
          : signal.gamma_regime === 'negative'
            ? '负Gamma 容易扩波'
            : '先等 IV 继续回落',
      trigger: `围绕 ${signal.market_snapshot.max_pain} 附近钉住再考虑`
    },
    {
      name: '垂直',
      status: signal.recommended_action === 'long_on_pullback' || signal.recommended_action === 'short_on_retest' ? '可执行' : signal.recommended_action === 'no_trade' ? '不可执行' : '等确认',
      reason: signal.recommended_action === 'long_on_pullback'
        ? '回踩确认更适合价差跟进'
        : signal.recommended_action === 'short_on_retest'
          ? '反抽受阻更适合偏空价差'
          : defaultReason,
      trigger: signal.recommended_action === 'short_on_retest'
        ? `反抽不过 ${signal.market_snapshot.call_wall}`
        : `回踩不破 ${signal.market_snapshot.flip_level}`
    },
    {
      name: '单腿',
      status: signal.recommended_action === 'long_on_pullback' || signal.recommended_action === 'short_on_retest' ? '可执行' : signal.recommended_action === 'no_trade' ? '不可执行' : '等确认',
      reason: signal.recommended_action === 'long_on_pullback'
        ? '方向已明，回踩是更好的点'
        : signal.recommended_action === 'short_on_retest'
          ? '结构转弱，等反抽再空'
          : defaultReason,
      trigger: signal.strategy_cards[0]?.entry_condition ?? '等待更清晰的结构确认'
    }
  ];
}

function statusClass(status) {
  if (status === '可执行') return 'go';
  if (status === '不可执行') return 'no';
  return 'wait';
}

function renderTopbar(currentPath, currentScenario, signal) {
  const query = window.location.search || '';
  return `
    <header class="topbar">
      <div class="brand">
        <div class="logo-mark">↗</div>
        <div>
          <div class="brand-title">SPX 盘中指挥台</div>
          <div class="brand-subtitle">盘中执行版</div>
        </div>
      </div>

      <nav class="nav">
        <a class="${currentPath === '/' ? 'active' : ''}" href="/${query}">主操作页</a>
        <a class="${currentPath === '/radar' ? 'active' : ''}" href="/radar${query}">辅助雷达页</a>
      </nav>

      <div class="topbar-right">
        <div class="top-status">
          <span>当前时间 ${shortTime(new Date())}</span>
          <span>最后刷新 ${shortTime(signal.received_at)}</span>
          <span><i class="dot"></i>${connectionStatus(signal)}</span>
        </div>
        <details class="dev-menu">
          <summary>开发模式</summary>
          <div class="dev-list">
            ${SCENARIOS.map((scenario) => `
              <a class="${scenario === currentScenario ? 'dev-active' : ''}" href="${currentPath}?scenario=${scenario}">${scenario}</a>
            `).join('')}
          </div>
        </details>
      </div>
    </header>
  `;
}

function renderStrategyTable(signal) {
  const rows = signal.strategy_cards.map((card) => {
    const status = signal.recommended_action === 'income_ok' && card.strategy_name === '铁鹰'
      ? '可执行'
      : signal.recommended_action === 'no_trade'
        ? '不可执行'
        : '等确认';
    return `
      <div class="strategy-name">${card.strategy_name}</div>
      <div><span class="status ${statusClass(status)}">${status}</span></div>
      <div>${card.avoid_when}</div>
      <div>${card.entry_condition}</div>
    `;
  }).join('');

  return `
    <section class="strategy-section">
      <div class="section-title">策略卡</div>
      <div class="strategy-table">
        <div class="strategy-head">策略</div>
        <div class="strategy-head">状态</div>
        <div class="strategy-head">一句话原因</div>
        <div class="strategy-head">触发条件</div>
        ${rows}
      </div>
    </section>
  `;
}

function renderSourceStrip(signal) {
  return `
    <section class="source-strip">
      <div class="source-title">数据源状态</div>
      <div class="source-list">
        ${signal.source_status.map((item) => `
          <div class="source-pill ${item.stale ? 'stale' : ''}">
            <span>${item.source}</span>
            <b>${stateLabel(item.state)}</b>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderDashboardPage(signal) {
  const chips = buildTopChips(signal);
  const riskNumber = derivedVolNumber(signal);
  const strategyCards = strategyExecutionCards(signal);
  const delta = signal.market_snapshot.spot - signal.market_snapshot.max_pain;
  const deltaPct = ((delta / signal.market_snapshot.max_pain) * 100).toFixed(2);
  const banner = signal.recommended_action === 'no_trade'
    ? '<div class="banner danger">暂停交易指令</div>'
    : signal.conflict.conflict_level === 'high'
      ? '<div class="banner warning">逻辑冲突，观望</div>'
      : '';

  return `
    ${banner}

    <section class="hero">
      <section class="price-card">
        <div class="eyebrow">SPX 现价</div>
        <div class="price">${signal.market_snapshot.spot}</div>
        <div class="muted">${delta >= 0 ? '+' : ''}${delta.toFixed(2)} (${deltaPct}%)</div>
      </section>

      <section class="command-card">
        <div class="eyebrow">当前指令</div>
        <h1>${buildCommandLine(signal)}</h1>
        <div class="command-line">${signal.plain_language.market_status}</div>
        <div class="chip-row">${chips.map((chip) => `<span class="blue-chip">${chip}</span>`).join('')}</div>
      </section>

      <section class="risk-card ${riskClass(signal)}">
        <div class="eyebrow">风险 / 波动</div>
        <div class="risk-big">${riskNumber}</div>
        <div class="muted">${marketStateLabel(signal.market_state)}</div>
      </section>
    </section>

    <section class="hero" style="grid-template-columns: repeat(3, 1fr);">
      ${strategyCards.map((card) => `
        <section class="price-card">
          <div class="eyebrow">${card.name}</div>
          <div class="price" style="font-size: 26px; color: ${card.status === '可执行' ? 'var(--green)' : card.status === '不可执行' ? 'var(--red)' : 'var(--blue)'};">${card.status}</div>
          <div class="command-line" style="font-size: 15px; margin: 12px 0 10px;">${card.reason}</div>
          <div class="muted">${card.trigger}</div>
        </section>
      `).join('')}
    </section>

    <section class="execution-grid">
      <section class="action-panel">
        <div class="section-title">当前动作</div>
        <div class="big-action">${actionLabel(signal)}</div>
        <div class="rule-list">
          <div><b>入场条件：</b>${signal.strategy_cards[0]?.entry_condition ?? '等待更清晰的确认。'}</div>
          <div><b>禁做：</b>${signal.plain_language.avoid}</div>
          <div><b>失效条件：</b>${signal.plain_language.invalidation}</div>
        </div>
      </section>

      <section class="levels-panel">
        <div class="section-title">关键位地图</div>
        <div class="level-row"><span>现价</span><b>${signal.market_snapshot.spot}</b><em>${spotPositionLabel(signal.market_snapshot.spot_position)}</em></div>
        <div class="level-row"><span>Flip</span><b>${signal.market_snapshot.flip_level}</b><em>${signal.market_snapshot.distance_to_flip}</em></div>
        <div class="level-row"><span>上方墙</span><b>${signal.market_snapshot.call_wall}</b><em>${signal.market_snapshot.distance_to_call_wall}</em></div>
        <div class="level-row"><span>下方墙</span><b>${signal.market_snapshot.put_wall}</b><em>${signal.market_snapshot.distance_to_put_wall}</em></div>
        <div class="level-row"><span>最大痛点</span><b>${signal.market_snapshot.max_pain}</b><em>${signal.market_snapshot.spot - signal.market_snapshot.max_pain}</em></div>
        <div class="spot-position">${spotPositionLabel(signal.market_snapshot.spot_position)}</div>
      </section>
    </section>

    <section class="intel-grid">
      <section class="intel-card">
        <div class="intel-title">波动启动灯</div>
        <div class="intel-main">${signal.engines.volatility.vol_state}</div>
        <div class="intel-sub">${signal.gamma_regime === 'negative' ? '波动起来了，可做趋势' : '波动相对可控，但仍等确认'}</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">做市商敞口</div>
        <div class="intel-main">${signal.plain_language.dealer_behavior}</div>
        <div class="intel-sub">${signal.radar_summary.dealer.explanation}</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">Spot Gamma</div>
        <div class="intel-main">${marketStateLabel(signal.market_state)}</div>
        <div class="intel-sub">${signal.gamma_regime === 'negative' ? '别抄底，等反抽再做' : '更像磨盘，等回踩再考虑'}</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">净 Premium 流</div>
        <div class="intel-main">${signal.radar_summary.order_flow.flow_bias}</div>
        <div class="intel-sub">${signal.radar_summary.order_flow.explanation}</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">暗池</div>
        <div class="intel-main">${signal.radar_summary.dark_pool.dark_pool_bias}</div>
        <div class="intel-sub">${signal.radar_summary.dark_pool.explanation}</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">事件</div>
        <div class="intel-main">${signal.event_context.event_risk}</div>
        <div class="intel-sub">${signal.event_context.event_note}</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">新闻</div>
        <div class="intel-main">暂无新催化</div>
        <div class="intel-sub">当前阶段仍以 mock 解释为主，不接真实新闻流</div>
      </section>
      <section class="intel-card">
        <div class="intel-title">系统状态</div>
        <div class="intel-main">${connectionStatus(signal)}</div>
        <div class="intel-sub">${signal.source_status.filter((item) => item.state !== 'mock').map((item) => `${item.source} ${stateLabel(item.state)}`).join(' / ') || '当前为 mock fallback'}</div>
      </section>
    </section>

    ${renderStrategyTable(signal)}
    ${renderSourceStrip(signal)}
  `;
}

function renderRadarPage(signal) {
  const radar = signal.radar_summary;
  return `
    <section class="radar-hero">
      <div>
        <h1>资金雷达</h1>
        <p>${radar.plan_alignment.effect_on_action}</p>
      </div>
      <div class="radar-badge">${radar.plan_alignment.status}</div>
    </section>

    <section class="radar-grid">
      <section class="radar-card">
        <div class="section-title">订单流</div>
        <div class="radar-conclusion">${radar.order_flow.flow_bias}，但是否能做要看价格确认</div>
        <div class="flow-table">
          <div class="metric"><span>Call 买入</span><b>${money(radar.order_flow.call_buy_premium)}</b></div>
          <div class="metric"><span>Call 卖出</span><b>${money(radar.order_flow.call_sell_premium)}</b></div>
          <div class="metric"><span>Put 买入</span><b>${money(radar.order_flow.put_buy_premium)}</b></div>
          <div class="metric"><span>Put 卖出</span><b>${money(radar.order_flow.put_sell_premium)}</b></div>
          <div class="metric"><span>0DTE Call 买入</span><b>${money(radar.order_flow.zero_dte_call_buy_premium)}</b></div>
          <div class="metric"><span>0DTE Put 买入</span><b>${money(radar.order_flow.zero_dte_put_buy_premium)}</b></div>
          <div class="metric"><span>净偏向</span><b>${radar.order_flow.flow_bias}</b></div>
          <div class="metric"><span>主动性</span><b>${radar.order_flow.aggressor}</b></div>
        </div>
        <div class="explain">${radar.order_flow.explanation}</div>
      </section>

      <section class="radar-card">
        <div class="section-title">做市商</div>
        <div class="radar-conclusion">${radar.dealer.dealer_behavior}</div>
        <div class="mini-grid">
          <div class="metric"><span>Gamma</span><b>${radar.dealer.gamma_bias}</b></div>
          <div class="metric"><span>Vanna</span><b>${radar.dealer.vanna_bias}</b></div>
          <div class="metric"><span>Charm 偏向</span><b>${radar.dealer.charm_bias}</b></div>
          <div class="metric"><span>Gamma 衰减</span><b>${radar.dealer.color_decay}</b></div>
          <div class="metric"><span>Vomma 风险</span><b>${radar.dealer.vomma_risk}</b></div>
          <div class="metric"><span>Speed 风险</span><b>${radar.dealer.speed_risk}</b></div>
        </div>
        <div class="explain">${radar.dealer.explanation}</div>
      </section>

      <section class="radar-card">
        <div class="section-title">暗池</div>
        <div class="radar-conclusion">${radar.dark_pool.dark_pool_bias}</div>
        <div class="mini-grid">
          <div class="metric"><span>下方承接</span><b>${radar.dark_pool.support_below}</b></div>
          <div class="metric"><span>上方压力</span><b>${radar.dark_pool.resistance_above}</b></div>
          <div class="metric"><span>关键位</span><b>${radar.dark_pool.key_levels.join(' / ')}</b></div>
          <div class="metric"><span>距现价</span><b>${radar.dark_pool.distance_to_spot.join(' / ')}</b></div>
        </div>
        <div class="explain">${radar.dark_pool.explanation}</div>
      </section>

      <section class="radar-card">
        <div class="section-title">计划一致性</div>
        <div class="radar-conclusion">${radar.plan_alignment.status}</div>
        <div class="alignment-block">
          <p><b>支持原因：</b>${radar.plan_alignment.support_reason}</p>
          <p><b>冲突原因：</b>${radar.plan_alignment.conflict_reason}</p>
          <p><b>对当前动作的影响：</b>${radar.plan_alignment.effect_on_action}</p>
        </div>
      </section>
    </section>
  `;
}

function renderApp(signal) {
  const root = document.getElementById('app');
  const currentPath = window.location.pathname === '/radar' ? '/radar' : '/';
  const pageContent = currentPath === '/radar' ? renderRadarPage(signal) : renderDashboardPage(signal);
  root.innerHTML = `${renderTopbar(currentPath, signal.scenario, signal)}<main class="page">${pageContent}</main>`;
}

async function boot() {
  const root = document.getElementById('app');
  root.innerHTML = '<main class="loading">Loading /signals/current ...</main>';
  try {
    const signal = await loadSignal();
    renderApp(signal);
  } catch (error) {
    root.innerHTML = `<main class="error-card"><h2>Load Error</h2><p>${error.message}</p></section>`;
  }
}

boot();
