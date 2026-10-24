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
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(12000);
  const t = await ev(`(()=>{const v=document.querySelector('[data-open="w04"] .bw-v');const apps=[...document.querySelectorAll('[data-open="w04"] .cv-app')].map(a=>[a.textContent.trim(),a.dataset.live||'',a.dataset.fact||'',a.getAttribute('data-open')||'']);return {v:v&&v.textContent,apps}})()`);
  if (W > 500 || (t && t.apps.length)) {
    const bb = t.apps.find((a) => a[0] === 'Brain Board');
    say(t.v === '6 apps & tools' && t.apps.length === 6 && !!bb && bb[3] === 'page:/board', `/ ${W}px: tile 04 says "${t.v}", ${t.apps.length} apps, the Brain Board opens /board (${t.apps.map((a) => a[0]).join(', ')})`);
    say(!!bb && /threads · \d+ open · anyone answers/.test(bb[2]) && bb[1] === 'up', `/ ${W}px: the Brain Board's live dot is up and its fact "${bb && bb[2]}"`);
  }
  await send('Page.navigate', { url: base + '/classic?r=' + Date.now() }); await sleep(8000);
  const c = await ev(`(()=>{const main=[...document.querySelectorAll('.ecg:not(.ecg4) > a.ec')].map(a=>a.querySelector('h3').textContent);const every=[...document.querySelectorAll('.ecg.ecg4 > a.ec')].map(a=>a.querySelector('h3').textContent);const board=document.querySelector('.ecg:not(.ecg4) a[href="/board"] [data-eclive="board"]');return {main,every,live:board&&board.textContent,cols:getComputedStyle(document.querySelector('.ecg:not(.ecg4)')).gridTemplateColumns.split(' ').length}})()`);
  say(c.main.length === 6 && c.main[1] === 'Brain Plaza' && c.main[2] === 'Brain Board' && !c.every.includes('Brain Board') && c.every.length === 3 && /threads · \d+ open/.test(c.live || ''), `/classic ${W}px: Block 04 has six apps, the Brain Board after Brain Plaza with "${c.live}", the "for every agent" row ${c.every.join(', ')}`);
  say(c.cols === (W > 1100 ? 3 : W > 700 ? 3 : W > 420 ? 2 : 1), `/classic ${W}px: the apps grid is ${c.cols} wide`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `/classic ${W}px: nothing wider than the screen`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(500);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
