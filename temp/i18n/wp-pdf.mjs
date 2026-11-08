// Arabic A-Z: the whitepaper PDF in Arabic, printed by Chrome from the Arabic whitepaper page itself (its own print
// styles), so the PDF says exactly what /ar/whitepaper says. Writes dashboard/whitepaper-ar.pdf.
// Usage: node wp-pdf.mjs [origin]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const base = (process.argv[2] || 'https://arabic.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9950 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-wp-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: base + '/ar/whitepaper?r=' + Date.now() }); await sleep(12000);
const ready = (await send('Runtime.evaluate', { expression: 'window.__arReady === true && (window.__arMiss ? window.__arMiss.size : 0)', returnByValue: true })).result.result.value;
if (ready === false) { console.error('ar.js did not run'); process.exit(1); }
const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4 });
const buf = Buffer.from(r.result.data, 'base64');
fs.writeFileSync('D:/ai/fourmeme/dashboard/whitepaper-ar.pdf', buf);
const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`whitepaper-ar.pdf: ${Math.round(buf.length / 1024)} KB, ${pages} pages, ${ready} texts without Arabic on the page`);
ws.close(); ch.kill(); process.exit(0);
