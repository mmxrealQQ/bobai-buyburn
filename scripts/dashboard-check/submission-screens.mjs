// Captures the submission screenshots to files via headless Chrome + CDP.
// Usage: node scripts/dashboard-check/submission-screens.mjs  (writes temp/submission-screens/, gitignored)
// Images are written to disk only and never read back (project rule).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('temp/submission-screens');
fs.mkdirSync(OUT, { recursive: true });
const PAGES = [
  ['home', 'https://brainonbnb.com/'],
  ['registry', 'https://brainonbnb.com/registry'],
  ['scanner', 'https://brainonbnb.com/scanner?token=0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'],
  ['advantage', 'https://brainonbnb.com/advantage'],
  ['session', 'https://brainonbnb.com/session'],
  ['services', 'https://brainonbnb.com/services'],
  ['status', 'https://agent.brainonbnb.com/status'],
  ['defi', 'https://brainonbnb.com/defi'],
  ['lp-agent', 'https://agent.brainonbnb.com/lp/agent'],
  ['lp-windows', 'https://agent.brainonbnb.com/lp/windows'],
];
const port = 9400 + (process.pid % 100);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('exit', () => { try { chrome.kill(); } catch {} });

async function cdp() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, ws };
}

const { send, ws } = await cdp();
await send('Page.enable'); await send('Runtime.enable');
for (const [name, url] of PAGES) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(12000); // the pages fill from the chain after load
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' });
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}-1440.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`${name}: ${url}`);
}
ws.close(); chrome.kill();
console.log(`written to ${OUT}`);
