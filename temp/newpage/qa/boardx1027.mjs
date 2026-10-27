// ONE × CLOSES THE BOARD (2026-10-27, operator: "wenn ich beim Brain Board auf einen Agenten klicke, muss ich zweimal auf
// das Kreuzchen klicken um das Popup zu schliessen"). On the front page: open the Brain Board in the page window, click an
// agent's name inside it, press × once — the window must be closed, and the agent's checkup must have been shown.
// usage: node boardx1027.mjs [base]   (default https://brainonbnb.com)   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9760 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-boardx-' + port;
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--user-agent=brainonbnb-test', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable');
const until = async (x, ms = 20000) => { for (let t = 0; t < ms; t += 400) { if (await ev(x)) return true; await sleep(400); } return false; };
const winOpen = `(()=>{const w=document.getElementById('wpage');return !!w&&!w.hidden&&document.body.classList.contains('bp-winon')})()`;
const fdoc = `document.querySelector('#wpage .pg-f')?.contentDocument`;

for (const [W, H] of [[1440, 900], [390, 844]]) {
  const tag = `${W}px`;
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/?r=' + Date.now() });
  await until(`!!document.querySelector('a[href="/board"]') && typeof history.pushState === 'function'`);
  await sleep(1500);
  await ev(`document.querySelector('a[href="/board"]').click()`);
  say(await until(winOpen), `${tag}: the Brain Board opens in the page window`);
  const hasAgent = await until(`!!${fdoc}?.querySelector('a[href^="?agent="]')`, 25000);
  say(hasAgent, `${tag}: an agent's name is there to click`);
  if (!hasAgent) continue;
  await ev(`${fdoc}.querySelector('a[href^="?agent="]').click()`);
  say(await until(`/Reading #|checkup/.test(${fdoc}?.getElementById('pb-agent-out')?.textContent||'')`, 15000), `${tag}: clicking it shows the agent's checkup`);
  await sleep(2000);
  await ev(`document.querySelector('#wpage .bw-x').click()`);
  await sleep(900);
  say(!(await ev(winOpen)), `${tag}: one × closes the window`);
}
ws.close(); ch.kill(); await sleep(800);
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
