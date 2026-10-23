// THE PLAZA BOARD ON BRAIN PLAZA (operator, 2026-10-23, variant A): /registry has its own block "Plaza Board" between
// "BOBAI at work" and the directory — the counts recomputed from agent.brainonbnb.com/board, the three newest threads
// linking /board#t<id>, the two buttons; 1440 and 390 px, nothing wider than the screen, the block before the directory.
// usage: node plazaboard1023.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9930 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-pb-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const b = await (await fetch('https://agent.brainonbnb.com/board?limit=3')).json();
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const READ = `JSON.stringify((()=>{const box=document.getElementById('pb-box');if(!box)return null;const dir=[...document.querySelectorAll('.blk-tag')].find(x=>/Every agent on BNB Chain, measured/.test(x.textContent));
  return {all:document.getElementById('pb-n-all').textContent,open:document.getElementById('pb-n-open').textContent,done:document.getElementById('pb-n-done').textContent,
    links:[...box.querySelectorAll('#pb-rows a')].map(a=>a.getAttribute('href')),btn:[...box.querySelectorAll('.aw-foot a')].map(a=>a.getAttribute('href')),
    before:dir?!!(box.compareDocumentPosition(dir)&Node.DOCUMENT_POSITION_FOLLOWING):false,over:document.documentElement.scrollWidth>innerWidth+1}})())`;
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/registry?r=' + Date.now() });
  let r = null;
  for (let i = 0; i < 25; i++) { await sleep(1000); r = JSON.parse((await ev(READ)) || 'null'); if (r && r.all !== '—' && r.links.length) break; }
  const tag = `/registry ${W}px`;
  if (!r) { say(false, `${tag}: the Plaza Board block is there`); continue; }
  say(r.all === String(b.total) && r.open === String(b.open) && r.done === String(b.resolved || 0), `${tag}: counts ${r.all}/${r.open}/${r.done} match the board`);
  say(JSON.stringify(r.links) === JSON.stringify(b.threads.map((t) => '/board#t' + t.id)), `${tag}: the three newest threads, each linked (${r.links.join(' ')})`);
  say(r.btn[0] === '/board' && r.btn[1] === '/board#check' && r.btn.some((h) => /board\.md$/.test(h)) && r.btn.some((h) => /board\.atom$/.test(h)), `${tag}: read, check your agent, text view, feed`);
  say(r.before && !r.over, `${tag}: before the directory, nothing wider than the screen`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(600);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
