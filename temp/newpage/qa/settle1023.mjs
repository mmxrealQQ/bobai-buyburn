// /settle with the refunds, 2026-10-23 (operator: variant A): the block 'Money back to clients' — what it does, three
// numbers read from /settle/public's refunds, every refund or 'No refund yet', the rule naming public-refund.js — and the
// settle part unchanged. 1440 and 390 px, nothing wider than the screen.   usage: node settle1023.mjs [base]
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9820 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-se-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value;
await send('Page.enable');
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/settle?r=' + Date.now() }); await sleep(5000);
  const t = await ev('document.body.innerText');
  say(/Money back to clients/i.test(t) && /claimRefund/.test(t), `${W}px: the refund block, saying what it does`);
  say(['r-jobs', 'r-u', 'r-cl'].every((x) => true) && await ev(`['r-jobs','r-u','r-cl'].every(i=>{const v=document.getElementById(i);return v&&v.textContent.trim()!=='—'&&v.textContent.trim()!==''})`), `${W}px: its three numbers are read from the record`);
  say(await ev(`(()=>{const r=document.getElementById('rf-rows');return !!r&&!/Reading the record/.test(r.textContent)&&r.textContent.trim().length>0})()`), `${W}px: every refund (or 'No refund yet') listed`);
  say(/Refunded: a job that was paid for and never delivered/.test(t) && /public-refund\.js/.test(t), `${W}px: the rule names the refund and its code`);
  say(/jobs settled/i.test(t) && !/The record could not be read just now/.test(t), `${W}px: the settle part still reads`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${W}px: nothing wider than the screen`);
  // 2026-10-24: the newest ten of each list, the rest behind "Show all"
  const f = await ev(`(()=>{const v=(id)=>{const rows=[...document.getElementById(id).children].filter(r=>r.classList.contains('rc-row'));return [rows.length,rows.filter(r=>r.offsetHeight>0).length]};return {s:v('rc-rows'),r:v('rf-rows'),b:[...document.querySelectorAll('.rc-more')].map(b=>b.textContent)}})()`);
  say((f.s[0] <= 12 || f.s[1] === 10) && (f.r[0] <= 13 || f.r[1] <= 11) && f.b.length === (f.s[0] > 12 ? 1 : 0) + (f.r[0] > 13 ? 1 : 0) && f.b.every((t) => /^Show all \d+ \(\d+ more\)$/.test(t)), `${W}px: ten of each list shown, the rest behind "${f.b.join('", "')}" (settles ${f.s.join('/')}, refunds ${f.r.join('/')})`);
  await ev(`document.querySelectorAll('.rc-more').forEach(b=>b.click())`);
  say(await ev(`[...document.querySelectorAll('#rc-rows .rc-row, #rf-rows .rc-row')].every(r=>r.offsetHeight>0) && !document.querySelector('.rc-more')`), `${W}px: "Show all" shows every row`);
}
ws.close(); ch.kill();
const j = await fetch('https://agent.brainonbnb.com/settle/public').then((r) => r.json()).catch(() => null);
say(j?.refunds?.rule?.a_day === 40 && 'totals' in (j.refunds || {}), 'the record serves the refunds beside the settles');
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
