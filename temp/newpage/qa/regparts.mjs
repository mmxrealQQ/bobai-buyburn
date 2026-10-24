// (regparts, 2026-10-24) /registry on a phone: each big block, its first words, and inside the open category tab
// how many rows and how tall each kind of child is
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-rp-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: base + '/registry?r=' + Date.now() }); await sleep(9000);
const rows = await ev(`(() => { const out = []; const sec = document.querySelector('.page .sec');
  for (const c of sec.children) { if (c.offsetHeight < 100) continue; out.push(String(c.offsetHeight).padStart(5) + ' ' + c.tagName + (c.id ? '#' + c.id : '') + '.' + String(c.className).split(' ')[0] + ' — ' + (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 110));
    if (c.offsetHeight > 800) for (const k of c.children) if (k.offsetHeight > 60) out.push('        ' + String(k.offsetHeight).padStart(5) + ' ' + k.tagName + '.' + String(k.className).split(' ')[0] + ' (' + k.children.length + ' children) — ' + (k.innerText || '').replace(/\\s+/g, ' ').slice(0, 90)); }
  return out; })()`);
console.log((rows || ['nothing']).join('\n'));
ws.close(); ch.kill(); process.exit(0);
