// 390px check for the new depth pills: does anything overflow, do the buttons
// stay tappable, and do the bars keep a visible length in the simulated state?
import { spawn } from 'node:child_process';
import { scratchDir } from '../lib/scratch.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const URL = 'https://brainonbnb.com/?probe=' + Math.floor(Math.random() * 1e9);
const profile = scratchDir('cdp2-');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl; } catch {}
    await wait(300);
  }
  throw new Error('no chrome');
}
const ws = new WebSocket(await target());
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    console.log('EVAL ERROR:', r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
    return undefined;
  }
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: URL });
for (let i = 0; i < 30; i++) { await wait(1000); if (await ev(`(document.getElementById('lq-up1')||{}).textContent !== '--'`)) break; }
await ev(`document.querySelector('.lqsim').scrollIntoView({block:'center'})`);
await wait(600);

const PROBE = `(() => {
  const sim = document.querySelector('.lqsim');
  const btns = [...document.querySelectorAll('.lqsim-b')].map(b => {
    const r = b.getBoundingClientRect();
    return { t: b.textContent.trim(), w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.right.toFixed(1) };
  });
  const wrap = sim.getBoundingClientRect();
  const bars = [1, 6].map(n => {
    const e = document.getElementById('lq-bw' + n), p = e.parentElement.getBoundingClientRect();
    return +(p.width * new DOMMatrix(getComputedStyle(e).transform).a).toFixed(2);
  });
  const note = document.getElementById('lq-simn').getBoundingClientRect();
  return {
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    simBoxRight: +wrap.right.toFixed(1), viewport: window.innerWidth,
    simRows: +(wrap.height / 30).toFixed(2),
    btns, barPx: bars, noteH: +note.height.toFixed(1),
    anyButtonPastEdge: btns.some(b => b.x > window.innerWidth + 1.5),
    smallestTapTarget: Math.min(...btns.map(b => b.h)),
  };
})()`;

console.log('live  ', JSON.stringify(await ev(PROBE)));
await ev(`document.querySelector('.lqsim-b[data-mul="10"]').click()`);
await wait(500);
console.log('10x   ', JSON.stringify(await ev(PROBE)));
ws.close(); chrome.kill();
