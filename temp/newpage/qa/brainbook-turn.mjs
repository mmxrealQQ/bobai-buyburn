// The Brainbook's pages turn (22.11.): the next/prev buttons, the arrow keys and a swipe each move the book one spread
// (desktop) or one page (phone); the counter follows; the buttons are disabled at the ends; a neuron click opens its
// page; no script error. Usage: node temp/newpage/qa/brainbook-turn.mjs [origin]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9450 + Math.floor(Math.random() * 40), prof = (process.env.TEMP || '/tmp') + '/bobai-prof-' + port;
process.on('exit', () => { try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 3 }); } catch {} });
const ORIGIN = process.argv[2] || 'https://brainonbnb.com';
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description?.slice(0, 160)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const state = async () => JSON.parse(await ev(`JSON.stringify({pn:document.getElementById('pn').textContent,vis:[...document.querySelectorAll('#bk-in > .pg:not(.end)')].map((p,i)=>getComputedStyle(p).display!=='none'?i:null).filter(x=>x!==null),prev:document.getElementById('prev').disabled,next:document.getElementById('next').disabled})`));
for (const [W, H, mob] of [[1440, 900, false], [390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: mob });
  await send('Page.navigate', { url: ORIGIN + '/brainbook?t=' + Date.now() }); await sleep(6000);
  const step = mob ? 1 : 2, s0 = await state();
  say(JSON.stringify(s0.vis) === JSON.stringify(mob ? [0] : [0, 1]) && s0.prev && !s0.next, `${W}px opens at the title page (${s0.pn}), prev disabled`);
  await ev(`document.getElementById('next').click()`); await sleep(1300);
  const s1 = await state(); say(s1.vis[0] === step, `${W}px next turns to page ${step} (${s1.pn})`);
  await ev(`dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft'}))`); await sleep(1300);
  const s2 = await state(); say(s2.vis[0] === 0, `${W}px ArrowLeft turns back (${s2.pn})`);
  const r = JSON.parse(await ev(`JSON.stringify(document.getElementById('bk').getBoundingClientRect())`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + r.width * .7, y: r.y + 80, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + r.width * .2, y: r.y + 80, button: 'left', clickCount: 1 });
  await sleep(1300); const s3 = await state(); say(s3.vis[0] === step, `${W}px a swipe to the left turns forward (${s3.pn})`);
  for (let i = 0; i < 6; i++) { await ev(`document.getElementById('next').click()`); await sleep(1100); }
  const s4 = await state(); say(s4.next && !s4.prev, `${W}px at the end next is disabled (${s4.pn})`);
  const last = await ev(`[...document.querySelectorAll('#bk-in > .pg:not(.end)')].filter(p=>getComputedStyle(p).display!=='none').some(p=>p.classList.contains('wait'))`);
  say(last, `${W}px the last page is the one waiting for an agent`);
  // the contents on the title page open an agent's page (the neurons in the book take no click: the pages turn)
  await ev(`document.getElementById('prev').click()`); for (let i = 0; i < 6; i++) { await ev(`document.getElementById('prev').click()`); await sleep(500); }
  await sleep(800);
  const picked = await ev(`(()=>{const a=document.querySelector('#toc a[data-go="3"]');if(!a)return '';a.click();return a.textContent.trim()})()`);
  await sleep(1200); const s5 = await state();
  say(!!picked && s5.vis.includes(3), `${W}px the contents open "${picked}" at its page (${s5.pn})`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
console.log(bad ? `FAIL ${bad}` : 'PASS  the Brainbook turns'); ws.close(); ch.kill(); await sleep(800); process.exit(bad ? 1 : 0);
