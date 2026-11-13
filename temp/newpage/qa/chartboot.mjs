// THE CHART DOES NOT WAIT FOR THE TIMELINE (2026-11-13, operator: "sometimes the chart and the timeline in the terminal
// load slowly"): the candles come from the ledger in ~0.1 s, but were asked only after logs + chain + the hour of swaps
// read from public nodes (backfill, with a 3 s retry). Measures, from navigation, when the chart has candles and when the
// timeline has the hour of swaps. RUNS=n page loads (default 3). PASS: chart within 4 s of the price on every run.
// usage: RUNS=3 node chartboot.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUNS = +(process.env.RUNS || 3);
let fails = 0;
for (let run = 1; run <= RUNS; run++) {
  const port = 9400 + Math.floor(Math.random() * 400), prof = process.cwd() + '/prof-' + port;
  const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
  let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = {};
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const t0 = Date.now();
  await send('Page.navigate', { url: base + (base.includes('?') ? '&' : '?') + 'r=' + Date.now() });
  let price = 0, chart = 0, hist = 0;
  while (Date.now() - t0 < 60000 && !(chart && hist)) {
    await sleep(200);
    const r = await send('Runtime.evaluate', { expression: `JSON.stringify([window.__btPx?__btPx()[0]:0, window.__btPatterns?__btPatterns().rows:0, window.__btPx?__btPx()[2]:0])`, returnByValue: true });
    let v; try { v = JSON.parse(r.result?.result?.value || '[0,0,0]'); } catch { v = [0, 0, 0]; }
    const t = (Date.now() - t0) / 1000;
    if (!price && v[0] > 0) price = t;
    if (!chart && v[1] > 0) chart = t;
    if (!hist && v[2] > 0) hist = t;
  }
  ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
  const ok = chart > 0 && price > 0 && chart - price <= 4;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  run ${run}: price ${price || '-'} s, chart candles ${chart || '-'} s, timeline swaps ${hist || '-'} s`);
}
process.exit(fails ? 1 : 0);
