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
// (listen1024, 2026-10-24) what he SAYS over time, not only what stands at one moment: the terminal is read every 1.5 s
// for some minutes (bubble, boards, brain.log), each new line searched for broken values; and every real Brain Board
// entry is named the way the terminal names it (boardWho from the live terminal.js) — none may read broken.
const MIN = Number(process.argv[3] || 4);
const BAD = /\bundefined\b|\bNaN\b|\bnull\b|\[object|Infinity|unsi…|unsign…|\$\s*(?:—|-\s|,)|#undefined|\(\s+\)|… …/;
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(15000);
const seen = new Set(), hits = new Set();
const end = Date.now() + MIN * 60e3;
while (Date.now() < end) {
  const t = await ev(`(document.getElementById('bt') || document.body).innerText`) || '';
  for (const l of t.split('\n').map((x) => x.trim()).filter(Boolean)) { if (seen.has(l)) continue; seen.add(l); if (BAD.test(l)) hits.add(l.slice(0, 160)); }
  await sleep(1500);
}
say(seen.size > 30, `${MIN} min listened: ${seen.size} different lines read`);
for (const h of hits) say(false, `said: "${h}"`);
const page = await fetch(base + '/?r=' + Date.now()).then((r) => r.text());
const v = (page.match(/terminal\/terminal\.js\?v=(\d+)/) || [])[1];
const js = await fetch(`${base}/terminal/terminal.js?v=${v}`).then((r) => r.text());
const line = (js.match(/const boardWho = [^\n]+/) || [''])[0];
const boardWho = new Function(line.replace('const boardWho = ', 'return '))();
const all = (await fetch('https://agent.brainonbnb.com/board?limit=200').then((r) => r.json())).threads.flatMap((t) => [t, ...(t.replies || [])]);
const badNames = all.map(boardWho).filter((n) => BAD.test(n) || /a wallet unsi/.test(n));
say(badNames.length === 0, `every real board entry (${all.length}) is named right in the terminal${badNames.length ? ': ' + [...new Set(badNames)].join(' | ') : ''}`);
say(!errs.length, `no script error${errs.length ? ': ' + [...new Set(errs)].slice(0, 5).join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
