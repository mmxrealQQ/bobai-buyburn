// (jobsfold1024, 2026-10-24) /jobs on a phone: the ranking shows its first ten rows (our own row always in view) and
// "Show all N (M more)" opens the rest; nothing wider than the screen. 390 and 1440 px.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-jb-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: base + '/jobs?r=' + Date.now() }); await sleep(8000);
  const r = await ev(`(() => { const rows = [...document.querySelectorAll('#jb-rows .rc-row')], vis = rows.filter((e) => e.checkVisibility());
    const ours = rows.filter((e) => e.classList.contains('jb-ours')), b = document.querySelector('#jb-rows + .rc-more');
    return { all: rows.length, vis: vis.length, oursVis: ours.length ? ours.every((e) => e.checkVisibility()) : null, btn: b ? b.textContent : null, total: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  const extra = r.oursVis && r.vis > 10 ? r.vis - 10 : 0;
  say(r.all > 12 && r.vis <= 11 && r.vis >= 10 && r.btn === `Show all ${r.all} (${r.all - r.vis} more)`, `${w}px: ${r.vis} of ${r.all} rows in view, "${r.btn}"${extra ? ' (our row beyond the ten)' : ''}`);
  say(r.oursVis !== false, `${w}px: our own row is in view`);
  if (w < 500) say(r.total < 3400, `${w}px: the page is ${r.total} px (was 5,170)`);
  say(!r.wide, `${w}px: nothing wider than the screen`);
  const all = await ev(`(async () => { document.querySelector('#jb-rows + .rc-more').click(); await new Promise((r) => setTimeout(r, 200)); return [...document.querySelectorAll('#jb-rows .rc-row')].filter((e) => e.checkVisibility()).length; })()`);
  say(all === r.all, `${w}px: the button shows all ${all}`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
