// (fields1025, 2026-10-25, A-Z pass) every form field on the main pages carries the site's own look: /list showed its
// alarm-webhook field in the browser's default (grey, square, cut short) because the page styled input[type=text] only.
// A visible field with an inset border, a white background or square corners is a FAIL. 1280 px.
// usage: node fields1025.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const pages = ['/list', '/join', '/pass', '/board', '/scanner', '/registry', '/defi', '/services', '/jobs'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9700 + Math.floor(Math.random() * 200), prof = import.meta.dirname + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
let fails = 0;
const FIELDS = "JSON.stringify((()=>{const f=[...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select')].filter(e=>e.getBoundingClientRect().width>0);return {n:f.length,bad:f.filter(e=>{const c=getComputedStyle(e);return c.borderTopStyle==='inset'||c.backgroundColor==='rgb(255, 255, 255)'||c.borderTopLeftRadius==='0px'}).map(e=>e.id||e.placeholder.slice(0,30))}})())";
for (const p of pages) {
  await send('Page.navigate', { url: base + p + '?r=' + Date.now() }); await sleep(7000);
  const r = JSON.parse((await send('Runtime.evaluate', { returnByValue: true, expression: FIELDS })).result.result.value);
  const ok = r.bad.length === 0; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}: ${r.n} fields${r.bad.length ? ' — in the browser default: ' + r.bad.join(' | ') : ''}`);
}
console.log(fails ? `FAIL  ${fails}` : 'PASS  every form field carries the site look');
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
process.exit(fails ? 1 : 0);
