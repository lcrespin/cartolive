export const MONITORING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>breathe.live — feed monitor</title>
  <style>
    :root {
      --bg: #0a0e14;
      --panel: #10151e;
      --border: #ffffff14;
      --text: #e4e8ed;
      --dim: #8b95a5;
      --ok: #3ed9c4;
      --bad: #e85d4c;
      --warn: #f2a65a;
      --mono: ui-monospace, "SF Mono", Menlo, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, sans-serif;
      padding: 24px;
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 4px; }
    h1 span { color: var(--ok); }
    .sub { color: var(--dim); font-size: 0.875rem; margin-bottom: 20px; }
    .sub a { color: var(--ok); text-decoration: none; }
    .sub a:hover { text-decoration: underline; }
    .cards {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      min-width: 140px;
    }
    .card .label { font-size: 0.75rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.04em; }
    .card .value { font-size: 1.5rem; font-weight: 600; margin-top: 4px; }
    .card .value.ok { color: var(--ok); }
    .card .value.bad { color: var(--bad); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--dim); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .pill {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 100px;
      text-transform: uppercase;
    }
    .pill.ok { background: #3ed9c422; color: var(--ok); }
    .pill.bad { background: #e85d4c22; color: var(--bad); }
    .err { color: var(--warn); font-family: var(--mono); font-size: 0.8rem; max-width: 420px; word-break: break-word; }
    .time { color: var(--dim); font-family: var(--mono); font-size: 0.8rem; white-space: nowrap; }
    #status-line { margin-top: 16px; color: var(--dim); font-size: 0.8rem; }
    #status-line.error { color: var(--bad); }
    h2 { font-size: 0.9rem; font-weight: 600; margin: 24px 0 10px; color: var(--dim); }
    .muted { color: var(--dim); font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>breathe<span>.</span>live monitor</h1>
  <p class="sub">
    Polls <a href="/api/health" target="_blank" rel="noopener">/api/health</a>
    every 5s · <span id="updated">—</span>
  </p>
  <div class="cards">
    <div class="card">
      <div class="label">API</div>
      <div class="value" id="api-ok">—</div>
    </div>
    <div class="card">
      <div class="label">Vehicles in hub</div>
      <div class="value" id="vehicles">—</div>
    </div>
    <div class="card">
      <div class="label">Vehicle feeds OK</div>
      <div class="value" id="feeds-ok">—</div>
    </div>
    <div class="card">
      <div class="label">Satellites (TLE)</div>
      <div class="value" id="sat-tle">—</div>
    </div>
    <div class="card">
      <div class="label">Road segments</div>
      <div class="value" id="road-segments">—</div>
    </div>
  </div>

  <h2>Vehicle feeds</h2>
  <table>
    <thead>
      <tr>
        <th>Feed</th>
        <th>Status</th>
        <th>Count</th>
        <th>Last success</th>
        <th>Last error</th>
      </tr>
    </thead>
    <tbody id="feeds"></tbody>
  </table>

  <h2>Map overlays</h2>
  <p class="muted">Satellites and road traffic (not in the vehicle WebSocket hub).</p>
  <table>
    <thead>
      <tr>
        <th>Layer</th>
        <th>Status</th>
        <th>Count</th>
        <th>Last success</th>
        <th>Last error</th>
      </tr>
    </thead>
    <tbody id="overlays"></tbody>
  </table>
  <p id="status-line"></p>
  <script>
    const feedsEl = document.getElementById('feeds');
    const overlaysEl = document.getElementById('overlays');
    const statusLine = document.getElementById('status-line');
    const OVERLAY_FEEDS = new Set(['celestrak', 'bison_fute']);

    function fmtTime(iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString('en-GB', { hour12: false });
      } catch {
        return iso;
      }
    }

    function row(name, ok, count, lastSuccessAt, lastError) {
      return \`
        <tr>
          <td><code>\${name}</code></td>
          <td><span class="pill \${ok ? 'ok' : 'bad'}">\${ok ? 'ok' : 'error'}</span></td>
          <td>\${count}</td>
          <td class="time">\${fmtTime(lastSuccessAt)}</td>
          <td class="err">\${lastError ? lastError : '—'}</td>
        </tr>
      \`;
    }

    function render(data) {
      document.getElementById('api-ok').textContent = data.ok ? 'OK' : 'DOWN';
      document.getElementById('api-ok').className = 'value ' + (data.ok ? 'ok' : 'bad');
      document.getElementById('vehicles').textContent = String(data.vehicles ?? 0);

      const sat = data.satellites || {};
      const road = data.road || {};
      document.getElementById('sat-tle').textContent = String(sat.tleObjects ?? 0);
      document.getElementById('sat-tle').className = 'value ' + (sat.ok ? 'ok' : 'bad');
      document.getElementById('road-segments').textContent = String(road.segments ?? 0);
      document.getElementById('road-segments').className = 'value ' + (road.ok ? 'ok' : 'bad');

      const allFeeds = (data.feeds || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const vehicleFeeds = allFeeds.filter((f) => !OVERLAY_FEEDS.has(f.name));
      const okN = vehicleFeeds.filter((f) => f.ok).length;
      document.getElementById('feeds-ok').textContent = okN + ' / ' + vehicleFeeds.length;
      document.getElementById('feeds-ok').className = 'value ' + (okN === vehicleFeeds.length ? 'ok' : 'bad');

      const overlayRows = [];
      overlayRows.push(row('satellites (celestrak)', sat.ok, sat.tleObjects ?? 0, sat.lastSuccessAt, sat.lastError));
      const groups = sat.groups || {};
      for (const g of ['stations', 'starlink', 'gps-ops', 'weather']) {
        const info = groups[g];
        if (!info) continue;
        overlayRows.push(row('  tle:' + g, info.count > 0, info.count, info.cachedAt, info.count === 0 ? 'not cached' : null));
      }
      overlayRows.push(row('road (bison_fute)', road.ok, road.segments ?? 0, road.lastSuccessAt, road.lastError));
      overlaysEl.innerHTML = overlayRows.join('');

      feedsEl.innerHTML = vehicleFeeds.map((f) => row(f.name, f.ok, f.vehicleCount ?? 0, f.lastSuccessAt, f.lastError)).join('');

      document.getElementById('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour12: false });
      statusLine.textContent = road.source ? 'Road source: ' + road.source : '';
      statusLine.className = '';
    }

    async function poll() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        render(await res.json());
      } catch (err) {
        statusLine.textContent = 'Failed to load /api/health: ' + (err && err.message ? err.message : err);
        statusLine.className = 'error';
      }
    }

    poll();
    setInterval(poll, 5000);
  </script>
</body>
</html>`
