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
// (heights1024) every page's height on a phone (390 px) and its widest overflow, to find where shortening pays
const PAGES = ['/classic', '/scanner', '/registry', '/board', '/services', '/defi', '/nft/', '/settle', '/venus', '/jobs', '/pass', '/set-and-earn', '/faq', '/whitepaper', '/library', '/join'];
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const p of PAGES) {
  await send('Page.navigate', { url: base + p + (p.includes('?') ? '&' : '?') + 'r=' + Date.now() }); await sleep(6000);
  const r = await ev(`({ h: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth - innerWidth, title: document.title.slice(0, 40) })`);
  console.log(String(r?.h).padStart(6), 'px', r?.wide > 1 ? `WIDE +${r.wide}` : '', p, '·', r?.title);
}
console.log(errs.length ? 'script errors: ' + [...new Set(errs)].slice(0, 5).join(' | ') : 'script errors: none');
ws.close(); ch.kill(); process.exit(0);
