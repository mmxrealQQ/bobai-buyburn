// the front page's 04 tile and Classic's Block 04 on a given origin: six apps, the Brain Board among them with its live
// fact, the "for every agent" row three cards; no script error; nothing wider than the screen.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-t4-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
// (svcmeasure) how tall /services is at 390 px, and which parts make it so
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: base + '/services?r=' + Date.now() }); await sleep(8000);
console.log(JSON.stringify(await ev(`(() => { const rows = []; const main = document.querySelector('main') || document.body;
  const walk = (el, d) => { for (const c of el.children) { const h = c.offsetHeight; if (h < 150) continue; const lab = (c.id ? '#' + c.id : '') + (c.className ? '.' + String(c.className).split(' ')[0] : '') + ' ' + (c.querySelector('h2,h3')?.textContent.trim().slice(0, 50) || ''); rows.push('  '.repeat(d) + h + 'px ' + c.tagName + ' ' + lab); if (d < 2) walk(c, d + 1); } };
  walk(main, 0); return { total: document.documentElement.scrollHeight, rows }; })()`), null, 1));
ws.close(); ch.kill(); process.exit(0);
