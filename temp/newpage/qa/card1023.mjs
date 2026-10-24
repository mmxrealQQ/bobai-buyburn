// RETIRED 2026-10-24: the board card left block 04's 'For every agent' row and became one of the apps (c95c55b,
// 0aeb882) — held by tile04.mjs (the Brain page's tile) and eco5.mjs (Classic's six cards) now.
console.log('RETIRED: see tile04.mjs and eco5.mjs'); process.exit(0);
// 04 THE PLAZA BOARD CARD (operator, 2026-10-23, variant A): a fourth card in "For every agent on BNB Chain" on Classic
// and on the Brain page — its name, one sentence, the live figure from the board ("N threads · M open", recomputed
// from agent.brainonbnb.com/board), the link /board; four across at 1440, two at 1100, one at 390; the three other
// cards and the LATEST line still there; nothing wider than the screen.
// usage: node card1023.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9880 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-card-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const b = await (await fetch('https://agent.brainonbnb.com/board?limit=1')).json();
const want = `${b.total.toLocaleString('en-US')} ${b.total === 1 ? 'thread' : 'threads'} · ${b.open.toLocaleString('en-US')} open`;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const READ = `JSON.stringify((()=>{const box=document.querySelector('.ec-every');if(!box)return null;const cards=[...box.querySelectorAll('.ecg .ec')];const c=cards.find(x=>x.getAttribute('href')==='/board');if(!c)return {n:cards.length};
  // in a closed window (the Brain page's 04 until it is opened) nothing has a position: read the grid's own columns
  const shown=cards.every(x=>x.getBoundingClientRect().width>0), gtc=getComputedStyle(box.querySelector('.ecg')).gridTemplateColumns;
  const cols=/^repeat\\((\\d+)/.test(gtc)?Number(gtc.match(/^repeat\\((\\d+)/)[1]):gtc.trim().split(/\\s+/).length;
  const tops=shown?[...new Set(cards.map(x=>Math.round(x.getBoundingClientRect().top)))]:Array.from({length:Math.ceil(cards.length/cols)});
  return {n:cards.length,h:c.querySelector('h3')?.textContent,p:c.querySelector('p')?.textContent,live:c.querySelector('[data-eclive="board"]')?.textContent,rows:tops.length,others:cards.map(x=>x.getAttribute('href')).join(' '),latest:!!box.querySelector('[data-eclatest]'),over:document.documentElement.scrollWidth>innerWidth+1}})())`;
for (const [page, label] of [['/classic', 'Classic'], ['/', 'Brain']]) {
  for (const [W, H, rows] of [[1440, 900, 1], [1100, 900, 2], [390, 844, 4]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
    await send('Page.navigate', { url: base + page + '?r=' + Date.now() });
    let r = null;
    for (let i = 0; i < 25; i++) { await sleep(1000); r = JSON.parse((await ev(READ)) || 'null'); if (r && r.live === want) break; }
    const tag = `${label} ${W}px`;
    if (!r || !r.h) { say(false, `${tag}: the Plaza Board card is in block 04 (${JSON.stringify(r)})`); continue; }
    say(r.n === 4 && r.h === 'Plaza Board' && /Bugs, fixes and help between AI agents/.test(r.p) && r.others === '/settle /venus /scanner /board', `${tag}: four cards, the board's name, sentence and link`);
    say(r.live === want, `${tag}: live figure "${r.live}" (wants "${want}")`);
    say(r.rows === rows, `${tag}: ${rows === 1 ? 'four across' : rows === 2 ? 'two rows of two' : 'one a row'} (${r.rows} rows)`);
    say(r.latest && !r.over, `${tag}: the LATEST line still there, nothing wider than the screen`);
  }
}
ws.close(); ch.kill(); await sleep(600);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
