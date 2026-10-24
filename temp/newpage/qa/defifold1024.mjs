// (defifold1024, 2026-10-24, operator chose variant A for /defi: 9,821 px on a phone) what went in, what it is worth and
// the range stay open; the second opinion, "For agents", "How it works" and "What it costs" are one line each and open on
// a tap (and with Enter); the day-by-day table shows five runs and a button for all; every BNB amount in the range
// still carries its dollars; the page under 6,000 px on a phone; nothing wider than the screen. 1440 and 390 px.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-df-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const FOLDS = { opinion: '#ag-opinion', agents: '.lpa', steps: '#steps', costs: '#yours .fold' };
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: base + '/defi?r=' + Date.now() }); await sleep(14000);
  const r = await ev(`(() => { const vis = (e) => !!e && e.checkVisibility();
    const folds = ${JSON.stringify(FOLDS)}, out = {};
    for (const [k, s] of Object.entries(folds)) { const f = document.querySelector(s); out[k] = { there: !!f, closed: !!f && !f.classList.contains('open') && [...f.children].slice(1).every((c) => !vis(c)), head: !!f && vis(f.firstElementChild) }; }
    const rows = [...document.querySelectorAll('#ag-lp-series tr')].filter(vis).length - 1, all = document.querySelectorAll('#ag-lp-series tr').length - 1;
    const more = document.getElementById('lp-series-more');
    const range = document.getElementById('ag-lp-range')?.innerText || '';
    const bnbs = (range.match(/[0-9.]+ BNB/g) || []).length, usds = (range.match(/\\$[0-9]/g) || []).length;
    return { out, rows, all, more: more && vis(more) ? more.textContent : null, card: vis(document.getElementById('defi-card')) && /PUT IN/i.test(document.getElementById('defi-card').innerText), rangeOpen: vis(document.getElementById('ag-lp-range')), bnbs, usds, total: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  for (const [k, v] of Object.entries(r.out)) say(v.there && v.closed && v.head, `${w}px: "${k}" is one line, closed`);
  say(r.card && r.rangeOpen, `${w}px: what went in, what it is worth and the range stay open`);
  say(r.bnbs > 0 && r.usds >= r.bnbs, `${w}px: the range's BNB amounts carry their dollars (${r.bnbs} BNB, ${r.usds} $)`);
  say(r.rows === 5 && r.all > 5 && r.more === `Show all ${r.all} runs`, `${w}px: the table shows 5 of ${r.all} runs and "${r.more}"`);
  if (w < 500) say(r.total < 6000, `${w}px: the page is ${r.total} px (was 9,821)`);
  say(!r.wide, `${w}px: nothing wider than the screen`);
  const o = await ev(`(async () => { const t = (s) => new Promise((r) => setTimeout(r, s)); const res = {};
    for (const [k, s] of Object.entries(${JSON.stringify(FOLDS)})) { const f = document.querySelector(s); f.firstElementChild.click(); await t(150); res[k] = f.classList.contains('open') && [...f.children].slice(1).some((c) => c.checkVisibility()) && f.firstElementChild.getAttribute('aria-expanded') === 'true'; }
    const f = document.querySelector('#steps'); f.firstElementChild.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await t(150); res.enterCloses = !f.classList.contains('open');
    document.getElementById('lp-series-more').click(); await t(150); res.allRows = [...document.querySelectorAll('#ag-lp-series tr')].filter((e) => e.checkVisibility()).length - 1;
    return res; })()`);
  say(o.opinion && o.agents && o.steps && o.costs, `${w}px: a tap opens each fold (${JSON.stringify(o)})`);
  say(o.enterCloses, `${w}px: Enter on a fold's first line closes it again`);
  say(o.allRows === r.all, `${w}px: the button shows all ${o.allRows} runs`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
