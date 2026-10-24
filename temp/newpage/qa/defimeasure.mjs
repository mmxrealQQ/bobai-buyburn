// (defimeasure, 2026-10-24) what fills /defi on a phone: each child of its parts with its height and first words
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const W = Number(process.argv[3] || 390);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-dm-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 844, deviceScaleFactor: 1, mobile: W < 500 });
await send('Page.navigate', { url: base + (process.argv[4]||'/defi')+'?r=' + Date.now() }); await sleep(9000);
const rows = await ev(`(() => { const out = ['total ' + document.documentElement.scrollHeight];
  for (const id of ${JSON.stringify((process.argv[5] || 'portfolio,series,steps,yours').split(','))}) { const el = document.getElementById(id); if (!el) continue; out.push('#' + id + ' ' + el.offsetHeight);
    for (const c of el.children) if (c.offsetHeight > 40) out.push('   ' + String(c.offsetHeight).padStart(5) + ' ' + c.tagName + '.' + String(c.className).split(' ')[0] + ' ' + (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 100)); }
  return out; })()`);
console.log((rows || ['nothing read']).join('\n'));
ws.close(); ch.kill(); process.exit(0);
