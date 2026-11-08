// Arabic A-Z: Brain Pop on /ar/ — the start window (both tabs), then one run with a few taps; lists every text without
// Arabic (window.__arMiss) and English left in the game window. Player names stay as written (translate="no").
// Usage: node pop-check.mjs [origin]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const base = (process.argv[2] || 'https://arabic.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9960 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-popc-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '/ar/?pop=play&r=' + Date.now() }); await sleep(16000);
const click = (re) => ev(`(() => { const b = [...document.querySelectorAll('#bt button, #bt [role=tab], #bt a')].find((x) => ${re}.test(x.textContent) && x.offsetParent); if (b) b.click(); return b ? b.textContent.trim().slice(0, 40) : null; })()`);
const t1 = await click('/HOW TO PLAY|كيف تلعب|📖/'); await sleep(1500);
const t2 = await click('/▶ PLAY|العب|▶/'); await sleep(1500);
const nameSet = await ev(`(() => { const i = document.querySelector('#bt input[type=text], #bt .br-pp input'); if (!i) return false; i.value = 'ArCheck_' + (Date.now() % 1000); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const go = await ev(`(() => { const b = document.querySelector('#bt .br-pp-go'); if (b) b.click(); return b ? b.textContent.trim().slice(0, 30) : null; })()`); await sleep(5000);
// a few taps in the middle of the arena while the round runs
for (let k = 0; k < 25; k++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500 + (k * 37) % 400, y: 300 + (k * 53) % 300, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500 + (k * 37) % 400, y: 300 + (k * 53) % 300, button: 'left', clickCount: 1 }); await sleep(400); }
await sleep(3000);
const miss = (await ev('[...(window.__arMiss || [])]')) || [];
fs.writeFileSync('D:/ai/fourmeme/temp/i18n/pop-miss.json', JSON.stringify(miss, null, 1));
console.log(`tabs: ${t1} / ${t2}; name ${nameSet}; play ${go}; ${miss.length} texts without Arabic`);
console.log(miss.slice(0, 60).join('\n'));
ws.close(); ch.kill(); process.exit(0);
