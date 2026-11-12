// FRIDAY THE 13TH (operator 12.11.): the $13 note shows on 13 Nov (UTC, 00:00-23:59) only — in the game's start window
// and on /pop — and never on the days around it. The browser's clock is moved (Date and Date.now) before the page loads:
//   1  12 Nov (or the real day, when it is not the 13th): no note
//   2  13 Nov, 00:00:30 UTC and 23:59:00 UTC: the note in the start window and on /pop, /pop's rule says "Every other day"
//   3  14 Nov, 00:00:30 UTC: no note again
// Test player ids start with f00d.  usage: node brainpop-f13.mjs [base]
import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 400);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + path.join(import.meta.dirname, 'prof-' + port), 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}; const send = (m, p = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const ev = async s => (await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true })).result?.result?.value;
let pass = 0, fail = 0; const say = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let clock = null;
const at = async (iso) => {
  if (clock) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clock });
  clock = iso ? (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const D = Date, off = D.parse('${iso}') - D.now(); class F extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])); } static now() { return D.now() + off; } } window.Date = F; })();` })).result.identifier : null;
};
const look = async (label) => {
  await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(600);
  await ev(`localStorage.clear(); localStorage.setItem('bt-pop-pid','f00d' + [...crypto.getRandomValues(new Uint8Array(6))].map(b=>b.toString(16).padStart(2,'0')).join('')); localStorage.setItem('bt-pop-named','1'); localStorage.setItem('bt-br-tut','1'); 1`);
  await send('Page.navigate', { url: BASE + '/?pop=play&t=' + Date.now() });
  for (let t = 0; t < 40 && !(await ev(`!!document.querySelector('#bt .br-ask-yes')`)); t++) await sleep(500);
  await ev(`document.querySelector('#bt .br-ask-yes')?.click(); 1`);
  for (let t = 0; t < 40 && !(await ev(`!!document.querySelector('#bt .br-pp-go')`)); t++) await sleep(500);
  const game = await ev(`(() => { const e = document.querySelector('#bt .br-pp-f13'); return e && e.offsetParent ? e.textContent : null; })()`);
  await send('Page.navigate', { url: BASE + '/pop?t=' + Date.now() }); await sleep(3500);
  const page = await ev(`(() => { const e = document.getElementById('pp-f13'); return e && !e.hidden ? e.textContent : null; })()`);
  const rule = await ev(`document.getElementById('pp-rule')?.textContent || ''`);
  return { game, page, rule, label };
};
const today = new Date().toISOString().slice(0, 10);
await at(today === '2026-11-13' ? '2026-11-12T12:00:00Z' : null);
let r = await look('today'); say(!r.game && !r.page && !/Every other day/.test(r.rule), `rule 1: ${today === '2026-11-13' ? '12 Nov' : today}: no $13 note`, JSON.stringify(r));
for (const iso of ['2026-11-13T00:00:30Z', '2026-11-13T23:59:00Z']) {
  await at(iso); r = await look(iso);
  say(/FRIDAY THE 13TH/.test(r.game || '') && /\$13 USDT/.test(r.game || '') && /\$13 USDT/.test(r.page || '') && /Every other day/.test(r.rule), `rule 2: ${iso}: the note in the start window and on /pop`, JSON.stringify(r).slice(0, 300));
}
await at('2026-11-14T00:00:30Z'); r = await look('14 Nov');
say(!r.game && !r.page && !/Every other day/.test(r.rule), 'rule 3: 14 Nov 00:00:30 UTC: the note is gone', JSON.stringify(r));
console.log(`brainpop-f13: ${pass} PASS, ${fail} FAIL`); ch.kill(); process.exit(fail ? 1 : 0);
