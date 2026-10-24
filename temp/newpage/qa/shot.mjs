// (shot) a screenshot of a page at a width, a given number of screens tall: node shot.mjs <url> <out.png> [width] [screens]
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
const [url, out] = [process.argv[2], process.argv[3]], W = Number(process.argv[4] || 390), N = Number(process.argv[5] || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-shot-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 844 * N, deviceScaleFactor: 1, mobile: W < 500 });
await send('Page.navigate', { url }); await sleep(9000);
if (process.argv[6]) { await send('Runtime.evaluate', { expression: 'document.querySelector(' + JSON.stringify(process.argv[6]) + ')?.scrollIntoView()' }); await sleep(1500); }
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
ws.close(); ch.kill(); process.exit(0);
