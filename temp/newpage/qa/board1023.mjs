// THE PLAZA BOARD PAGE (2026-10-23): brainonbnb.com/board shows every thread of agent.brainonbnb.com/board with its
// verified author; the chips, the search and the inbox field filter it as the API does; a thread is reachable by its
// anchor; 1440 and 390 px, nothing wider than the screen, no script error. Counts recomputed from the API.
// usage: node board1023.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9850 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-board-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const api = await (await fetch('https://agent.brainonbnb.com/board?limit=200')).json();
// 2026-10-26 (operator: 'Bibliothek zuerst'): the first view is the library — every thread but the notes
// the library (2026-10-26): no notes, and no checkup of a single agent (shared/plaza-board.js isCheckup)
const lib = api.threads.filter((t) => t.type !== 'note' && !(t.type === 'tip' && /^Checkup for /.test(t.title) && t.to !== 'all')), nLib = lib.length;
const n = (q) => fetch('https://agent.brainonbnb.com/board?limit=200&' + q).then((r) => r.json()).then((j) => j.threads.length);
const [nBug, nSearch, nPokter] = await Promise.all([n('type=bug'), n('q=57037'), n('to=pokter.xyz')]);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const count = () => ev(`new Promise(r=>setTimeout(()=>r(document.querySelectorAll('#pb-list .pb-t').length),1800))`);
for (const [W, H] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
  await send('Page.navigate', { url: base + '/board?r=' + Date.now() }); await sleep(4500);
  const tag = `/board ${W}px`;
  // 2026-10-25 (operator's pick b2ff28e): the board opens on All, newest activity first, the first 8 threads, then 20
  // more a click; one line each; a click opens a thread
  say((await count()) === Math.min(8, nLib) && (await ev(`document.querySelector('.pb-chip[data-f="type:library"]').getAttribute('aria-pressed')==='true'`)), `${tag}: opens on the Library, the first ${Math.min(8, nLib)} of ${nLib} (${api.total - nLib} notes apart)`);
  say((await ev(`document.getElementById('n-all').textContent`)) === String(api.total) && (await ev(`document.getElementById('n-open').textContent`)) === String(api.open), `${tag}: the counts match the board`);
  if (nLib > 8) {
    say((await ev(`document.getElementById('pb-more').textContent`)) === `Show ${nLib - 8} more` && !(await ev(`document.getElementById('pb-more').hidden`)), `${tag}: "Show ${nLib - 8} more"`);
    await ev(`document.getElementById('pb-more').click()`);
    say((await count()) === Math.min(28, nLib), `${tag}: Show more -> ${Math.min(28, nLib)}`);
  }
  const first = lib.find((t) => t.verified) || lib[0];
  say(await ev(`(()=>{const a=document.getElementById('t${first.id}');return !!a && a.innerText.includes(${JSON.stringify(first.title)}) && a.innerText.includes('✓#${first.agent}') && a.querySelector('.pb-more').hidden})()`), `${tag}: thread #${first.id}: one line with its title and its verified author, closed`);
  await ev(`document.querySelector('#t${first.id} .pb-sum').click()`);
  say(await ev(`(()=>{const a=document.getElementById('t${first.id}');return !a.querySelector('.pb-more').hidden && a.querySelector('.pb-sum').getAttribute('aria-expanded')==='true' && a.querySelector('.pb-more').innerText.length>20})()`), `${tag}: a click opens thread #${first.id} with its words`);
  await ev(`document.querySelector('.pb-chip[data-f="type:bug"]').click()`);
  say((await count()) === Math.min(20, nBug), `${tag}: chip Bugs -> ${nBug}`);
  await ev(`document.querySelector('.pb-chip[data-f="type:library"]').click()`);
  await ev(`(()=>{const i=document.getElementById('pb-q');i.value='57037';i.dispatchEvent(new Event('input'))})()`);
  say((await count()) === Math.min(20, nSearch), `${tag}: search 57037 -> ${nSearch}`);
  await ev(`(()=>{const i=document.getElementById('pb-q');i.value='';const t=document.getElementById('pb-to');t.value='pokter.xyz';t.dispatchEvent(new Event('input'))})()`);
  say((await count()) === Math.min(20, nPokter), `${tag}: inbox pokter.xyz -> ${nPokter}`);
  say(/board\.md/.test(await ev(`document.getElementById('join').textContent`)), `${tag}: For developers names the text view for any terminal`);
  await ev(`document.querySelector('[data-t="check"]').click()`);
  say(await ev(`!document.getElementById('check').hidden && document.getElementById('write').hidden`), `${tag}: the tab "Check an agent" shows its panel and hides Write`);
  await ev(`(()=>{document.getElementById('pb-agent').value='363709';document.getElementById('pb-agent-go').click()})()`);
  const chk = await ev(`new Promise(r=>{let n=0;const t=setInterval(()=>{const x=document.getElementById('pb-agent-out').innerText;if(/checkup/.test(x)||++n>40){clearInterval(t);r(x)}},500)})`);
  say(/DeFi Agent/.test(chk) && /checkup \d+\/\d+/.test(chk) && /quotes a price/.test(chk), `${tag}: Check your agent 363709 shows its checkup — "${chk.slice(0, 80).split(String.fromCharCode(10)).join(' ')}"`);
  // 2026-10-23 (variant A): its escrow in one line, linked to every job of its agentWallet
  const escLine = await ev(`(()=>{const e=document.getElementById('pb-escrow');return e?[e.innerText,e.querySelector('a')&&e.querySelector('a').href]:null})()`);
  say(!!escLine && /^Escrow 0x7380…: \d+ jobs sold · \$[0-9.]+ waiting release · \$[0-9.]+ waiting refund · settled by BOBAI \$[0-9.]+/.test(escLine[0]) && escLine[1] === 'https://agent.brainonbnb.com/escrow/for/0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', `${tag}: its escrow in one line with the link — "${escLine && escLine[0].slice(0, 90)}"`);
  say(!(await ev('document.documentElement.scrollWidth > innerWidth + 1')), `${tag}: nothing wider than the screen`);
  await send('Page.navigate', { url: base + '/board?r=' + Date.now() }); await sleep(4500);   // fresh: the steps above leave a search and an inbox set
  await ev(`document.querySelector('.pb-chip[data-f="status:open"]')?.click()`); await sleep(2500);
  say((await count()) === Math.min(8, api.open), `${tag}: Open -> the first ${Math.min(8, api.open)} of ${api.open} open threads`);
}
say(!errs.length, 'no script error ' + errs.slice(0, 2).join(' | '));
ws.close(); ch.kill(); await sleep(600);
console.log(bad ? `\n${bad} FAIL` : '\nall PASS');
process.exit(bad ? 1 : 0);
