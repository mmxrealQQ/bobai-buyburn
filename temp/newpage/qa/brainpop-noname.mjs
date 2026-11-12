// BRAIN POP, THE FIRST RUN WITHOUT A SECOND STEP (12.11., the A-Z review: 5 came, 3 played on 11.11.; PLAY with nothing
// typed answered "Type your name first"):
//   1  a first visitor (never named) presses PLAY with nothing typed: the run starts, under the random name it showed
//   2  the "Type your name first" nudge never appears
//   3  the front page's Brain Pop card shows a live line from the game's own board (today's #1 or an empty board)
// Test player ids start with f00d (kept off every board).  usage: node brainpop-noname.mjs [base]
import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 400);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + path.join(import.meta.dirname, 'prof-' + port), 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}; const send = (m, p = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const ev = async s => (await send('Runtime.evaluate', { expression: s, returnByValue: true, awaitPromise: true })).result?.result?.value;
let pass = 0, fail = 0; const say = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(800);
// a first visitor: a test id, the tutorial seen, but NEVER named
await ev(`localStorage.clear(); localStorage.setItem('bt-pop-pid','f00d' + [...crypto.getRandomValues(new Uint8Array(6))].map(b=>b.toString(16).padStart(2,'0')).join('')); localStorage.setItem('bt-br-tut','1'); 1`);
await send('Page.navigate', { url: BASE + '/?pop=play&t=' + Date.now() });
for (let t = 0; t < 40 && !(await ev(`!!document.querySelector('#bt .br-ask-yes')`)); t++) await sleep(500);
await ev(`document.querySelector('#bt .br-ask-yes')?.click(); 1`);
for (let t = 0; t < 40 && !(await ev(`!!document.querySelector('#bt .br-pp-go')`)); t++) await sleep(500);
const before = await ev(`localStorage.getItem('bt-pop-named')`);
await ev(`(() => { const i = document.querySelector('#bt .br-pp-nm input'); if (i) i.value = ''; document.querySelector('#bt .br-pp-go').click(); return 1; })()`);
let live = false; for (let t = 0; t < 30 && !live; t++) { await sleep(300); live = !!(await ev(`!!(window.__btBr && window.__btBr.pop && window.__btBr.pop().live)`)); }
const nudge = await ev(`/Type your name first/.test(document.querySelector('#bt')?.textContent || '')`);
say(before !== '1' && live, 'rule 1: never named, PLAY with nothing typed starts the run', `named before: ${before}, live: ${live}`);
say(!nudge, 'rule 2: no "Type your name first" nudge');
// 3: the card on the front page (Classic carries the same block as the Brain page)
await send('Page.navigate', { url: BASE + '/classic?t=' + Date.now() });
let card = ''; for (let t = 0; t < 30; t++) { await sleep(500); card = await ev(`document.querySelector('[data-eclive="pop"]')?.textContent || ''`); if (/^#1 today|^Nobody on today/.test(card)) break; }
say(/^#1 today: .+ · [\d,]+ players?$|^Nobody on today’s board yet: be #1$/.test(card), 'rule 3: the Brain Pop card shows today\'s board, live', card);
console.log(`brainpop-noname: ${pass} PASS, ${fail} FAIL`); ch.kill(); process.exit(fail ? 1 : 0);
