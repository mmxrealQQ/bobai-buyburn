// THE JOB BOARD (2026-10-22): brainonbnb.com/jobs shows agent.brainonbnb.com/jobs/board. The four figures equal the
// board's 30-day totals; every ranked agent with work is a row, in the board's order, ours marked; the farm line names
// the campaign address; the raw board is linked; 1440 and 390 px, nothing wider than the screen, every row's figures
// inside the card; no "Reading the board…" left. Screenshots to the given folder (argv[3]) to look at.
// usage: node jobs1022.mjs [base] [shotdir]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, ''), shots = process.argv[3] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9780 + Math.floor(Math.random() * 40), prof = os.tmpdir() + '/prof-jobs-' + port;
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const b = await (await fetch('https://agent.brainonbnb.com/jobs/board')).json();
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const t = b.totals_30d || {};
const want = { 'n-paid': nf(t.paid || 0), 'n-u': nf(t.paid_u || 0, 2) + ' $U', 'n-prov': nf(t.providers || 0), 'n-cli': nf(t.paying_clients || 0) };
const ranked = (b.ranking || []).filter((r) => r.delivered_30d > 0 || r.paid_ever > 0);

const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable');
const READ = `JSON.stringify((()=>{const n={};document.querySelectorAll('.rc-n b').forEach(b=>n[b.id]=b.textContent.trim());
  const rows=[...document.querySelectorAll('#jb-rows .rc-row')];const card=document.querySelector('#jb-rows').getBoundingClientRect();
  return {h1:document.querySelector('h1')?.textContent.trim(),n,rows:rows.length,ranks:rows.map(r=>r.querySelector('.jb-rank').textContent),ours:rows.filter(r=>r.classList.contains('jb-ours')).length,
    inside:rows.every(r=>[...r.querySelectorAll('.jb-figs span')].every(s=>{const q=s.getBoundingClientRect();return q.right<=card.right+1&&q.left>=card.left-1})),
    farm:document.querySelector('#jb-farm').innerHTML,raw:[...document.querySelectorAll('a')].map(a=>a.href),reading:/Reading the board/.test(document.body.innerText),overflow:document.documentElement.scrollWidth>innerWidth+1}})())`;
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/jobs?r=' + Date.now() });
  let r = null;
  for (let i = 0; i < 25; i++) { await sleep(1000); r = JSON.parse((await ev(READ)) || 'null'); if (r && !r.reading) break; }
  const tag = `/jobs ${W}px`;
  if (!r || !r.h1) { say(false, `${tag}: the page is there`); continue; }
  say(!r.reading, `${tag}: the board was read`);
  for (const [k, v] of Object.entries(want)) say(r.n[k] === v, `${tag}: ${k} "${r.n[k]}" (wants "${v}")`);
  say(r.rows === ranked.length, `${tag}: one row per ranked agent with work (${r.rows} of ${ranked.length})`);
  say(r.ranks.join() === ranked.map((x) => '#' + x.rank).join(), `${tag}: rows in the board's order`);
  say(r.ours === ranked.filter((x) => x.ours).length, `${tag}: ours marked (${r.ours})`);
  say(!!b.farm && r.farm.includes(b.farm.address.slice(0, 6)) && r.farm.includes(nf(b.farm.jobs)), `${tag}: the farm line names the campaign address and its jobs`);
  say(r.raw.includes('https://agent.brainonbnb.com/jobs/board'), `${tag}: the raw board is linked`);
  say(r.inside, `${tag}: every row's figures inside the card`);
  say(!r.overflow, `${tag}: nothing wider than the screen`);
  if (shots) {
    const full = await ev('JSON.stringify([document.documentElement.scrollWidth,document.documentElement.scrollHeight])').then(JSON.parse);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.min(full[1], 4000), deviceScaleFactor: 1, mobile: W < 500 });
    await sleep(600);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${shots}/jobs-${W}.png`, Buffer.from(s.result.data, 'base64'));
  }
}
ws.close(); ch.kill(); await sleep(800);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
