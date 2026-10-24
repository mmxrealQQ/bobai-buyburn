// the front page's 04 tile and Classic's Block 04 on a given origin: six apps, the Brain Board among them with its live
// fact, the "for every agent" row three cards; no script error; nothing wider than the screen.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-t4-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
// (pfline1024, 2026-10-24) /board says platforms how to join: the line under "For developers", its link opens thread
// #33 on the page; at 1440 and 390 px, nothing wider than the screen, no script error
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: base + '/board?r=' + Date.now() }); await sleep(7000);
  await ev(`document.querySelector('.pb-chip[data-t="join"]').click()`); await sleep(500);
  const line = await ev(`(() => { const e = document.getElementById('for-platforms'); return e ? { h: e.offsetHeight, t: e.textContent } : null; })()`);
  say(line?.h > 0 && /platform_key/.test(line.t) && /brain-board\.txt/.test(line.t), `${w}px: the platform line shows under For developers`);
  await ev(`document.querySelector('#for-platforms a[href="#t33"]').click()`); await sleep(3000);
  const t = await ev(`(() => { const e = document.getElementById('t33'); if (!e) return null; const r = e.getBoundingClientRect(); return { open: e.querySelector('.pb-sum')?.getAttribute('aria-expanded'), top: r.top, vis: e.offsetHeight }; })()`);
  say(t && t.open === 'true' && t.vis > 0 && t.top > -5 && t.top < h, `${w}px: its link opens thread #33 in view ${JSON.stringify(t)}`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${w}px: nothing wider than the screen`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
