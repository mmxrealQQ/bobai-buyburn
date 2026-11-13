// THE CHART ON A PHONE (2026-11-13, operator: "on the phone the chart still loads a bit slowly"): chartboot.mjs on a
// phone — 390x844, CPU 4x slower, 150 ms latency. Before: the module, three.js and its passes asked one after another,
// then candles + price from public nodes (live 9.7 / 13.2 s = FAIL). Now preloaded + asked in the head (6.7-7.0 s).
// Prints the resource timings. PASS: price and chart within 8.5 s of navigation on every run.
// usage: RUNS=3 node chartphone.mjs [url]   (run alone: a second Chrome beside it skews the times)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6, uploadThroughput: 0.75e6 });
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
  const pr = await send('Runtime.evaluate', { expression: `JSON.stringify(performance.getEntriesByType('resource').filter(e=>/terminal\\.js|candles|styles|brain\\.js|ledger|price|stats/.test(e.name)).map(e=>[e.name.replace(/^https?:\\/\\/[^/]+/,'').slice(0,50),Math.round(e.startTime),Math.round(e.responseEnd),e.transferSize]).concat([['DCL',0,Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),0]]))`, returnByValue: true });
  console.log(pr.result?.result?.value);
  ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
  const ok = chart > 0 && price > 0 && chart <= 8.5 && price <= 8.5;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  run ${run}: price ${price || '-'} s, chart candles ${chart || '-'} s, timeline swaps ${hist || '-'} s`);
}
process.exit(fails ? 1 : 0);
