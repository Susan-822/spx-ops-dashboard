async function loadSignal() {
  const response = await fetch('/signals/current');
  if (!response.ok) {
    throw new Error('Failed to load /signals/current');
  }
  return response.json();
}

function renderPage(signal) {
  const route = window.location.pathname;
  const root = document.getElementById('app');

  const pages = {
    '/': {
      title: 'Dashboard',
      content: `
        <div class="card-grid">
          <section class="card"><h3>Action</h3><p>${signal.action}</p></section>
          <section class="card"><h3>Confidence</h3><p>${signal.confidence}</p></section>
          <section class="card"><h3>Mode</h3><p>${signal.is_mock ? 'Mock fallback' : 'Real'}</p></section>
          <section class="card"><h3>Symbol</h3><p>${signal.symbol}</p></section>
        </div>
      `
    },
    '/sources': {
      title: 'Data Source Status',
      content: `
        <div class="card-grid">
          ${signal.source_status.map((item) => `
            <section class="card">
              <h3>${item.source}</h3>
              <p>Status: ${item.available ? 'available' : 'unavailable'}</p>
              <p>Configured: ${item.configured}</p>
              <p>is_mock: ${item.is_mock}</p>
              <p class="muted">${item.message}</p>
            </section>
          `).join('')}
        </div>
      `
    },
    '/uw-reader': {
      title: 'UW Reader',
      content: `
        <section class="card">
          <h3>Reader Summary</h3>
          <p>${signal.source_status.find((item) => item.source === 'uw')?.message ?? 'No UW status available.'}</p>
          <p>Only reading /signals/current. No screenshot processing is implemented.</p>
        </section>
      `
    },
    '/strategy-cards': {
      title: 'Strategy Cards',
      content: `
        <div class="card-grid">
          <section class="card"><h3>Thesis</h3><p>${signal.thesis}</p></section>
          <section class="card"><h3>Gamma</h3><p>${signal.gamma_summary.summary}</p></section>
          <section class="card"><h3>Safety</h3><p>No auto-order placement is implemented.</p></section>
        </div>
      `
    },
    '/logs-alerts': {
      title: 'Logs / Alerts',
      content: `
        <section class="card">
          <h3>Events Snapshot</h3>
          <div class="pre">${JSON.stringify(signal.events, null, 2)}</div>
        </section>
      `
    }
  };

  const page = pages[route] ?? pages['/'];

  root.innerHTML = `
    <header class="header">
      <h1>spx-ops-dashboard</h1>
      <span class="badge">/signals/current only</span>
      <nav class="nav">
        <a href="/">Dashboard</a>
        <a href="/sources">Data Source Status</a>
        <a href="/uw-reader">UW Reader</a>
        <a href="/strategy-cards">Strategy Cards</a>
        <a href="/logs-alerts">Logs / Alerts</a>
      </nav>
    </header>
    <main class="page">
      <h2>${page.title}</h2>
      <p class="muted">All page content is derived from /signals/current with mock-safe fallbacks.</p>
      ${page.content}
      <section class="card" style="margin-top: 16px;">
        <h3>Normalized Signal JSON</h3>
        <div class="pre">${JSON.stringify(signal, null, 2)}</div>
      </section>
    </main>
  `;
}

async function boot() {
  const root = document.getElementById('app');
  root.innerHTML = '<main class="page"><p>Loading /signals/current ...</p></main>';
  try {
    const signal = await loadSignal();
    renderPage(signal);
  } catch (error) {
    root.innerHTML = `<main class="page"><section class="card"><h2>Load Error</h2><p>${error.message}</p></section></main>`;
  }
}

boot();
