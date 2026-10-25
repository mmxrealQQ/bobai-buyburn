// (refund1025, 2026-10-25, A-Z pass: the terminal showed every settle but never a refund) REPLAY 24H on a fresh visit:
// when the replayed day holds a refund run (money back to clients of jobs nobody delivered, /settle/public refunds), the
// stage shows MONEY BACK and the log a REFUND line. Watches the stage (.moment) and the log text while the replay runs.
// usage: node refund1025.mjs [base]   exit 1 on FAIL; SKIP when the last 24 h hold no refund
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const st = await fetch('https://agent.brainonbnb.com/settle/public').then((r) => r.json()).catch(() => null);
const since = Date.now() - 24 * 3600e3;
const runs = new Set((st?.refunds?.log || []).filter((d) => d.refunded && d.tx && Date.parse(d.at) >= since).map((d) => d.at));
if (!runs.size) { console.log('SKIP  no refund run in the last 24 h, nothing to replay'); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 200), prof = import.meta.dirname + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(12000);
await ev("document.getElementById('bt-rp').click()");
let seen = false, logged = false;
for (let t = 0; t < 420; t += 1) {
  await sleep(1000);
  if (!seen) seen = await ev("[...document.querySelectorAll('.moment')].some(m => /MONEY BACK/.test(m.textContent))");
  if (t > 10 && t % 3 === 0 && !(await ev("!!document.querySelector('#bt-live.rp')"))) break;
}
// the replay writes no past event into the log by design ("the log is the visit", 28.9.); what it does show is the mark on
// the chart and the timeline, whose text is ecoText — read from the page's own event list
logged = await ev("JSON.stringify((window.__btEcoMarks ? window.__btEcoMarks() : []).filter(m => m[0] === 'refund').map(m => m[1]))");
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
say(seen, `the stage showed MONEY BACK for the refund run(s) of the last 24 h (${[...runs].join(', ')})`);
const marks = JSON.parse(logged || '[]');
say(marks.length >= runs.size && marks.every((t) => /^gave \$[\d.,]+ back to \d+ clients?: \d+ jobs? nobody delivered$/.test(t)), `the chart and timeline marks name each refund run: ${marks.join(' | ') || 'none'}`);
console.log(fails ? `FAIL  ${fails}` : 'PASS  the money back plays in the replay');
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
process.exit(fails ? 1 : 0);
