// CARD 04 BRAIN POP CHECK (2026-11-06, operator: "then the ecosystem, number one"): the daily game is the 7th app of the
// Ecosystem card: live with today's #1, its logo opens the game in the terminal on the same page (from the standard
// terminal too), and on 1 Dec it leaves by itself (data-until).
// usage: node card04pop.mjs [base=https://golive.bobai-dashboard.pages.dev]   SIZES=1440x900,390x844m
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev').replace(/\/$/, '');
const SIZES = (process.env.SIZES || '1440x900,390x844m').split(',');
const SHOTS = process.env.SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = path.join(import.meta.dirname, 'prof-' + port);
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}; let logs = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 240));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 240));
  if (d.method === 'Network.responseReceived' && d.params.response.status >= 400 && /\/terminal\//.test(d.params.response.url)) logs.push('HTTP ' + d.params.response.status + ' ' + d.params.response.url.slice(0, 140)); };
const ev = async src => { const r = await send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
let pass = 0, fail = 0;
const say = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const waitFor = async (src, ms = 20000) => { for (let t = 0; t < ms; t += 300) { if (await ev(src)) return true; await sleep(300); } return false; };
const tap = async (x, y, mob) => { if (mob) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); } };
for (const sz of SIZES) {
  const mob = sz.endsWith('m'), [w, h] = sz.replace('m', '').split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(1000);
  await ev(`localStorage.setItem('bt-br','0'); localStorage.setItem('bt-pop-pid','f00d' + '0'.repeat(12)); 1`); /* the standard terminal: the logo must turn brainrot on itself */
  logs = []; await send('Page.navigate', { url: BASE + '/?t=' + Date.now() });
  const got = await waitFor(`!!document.querySelector('[data-open="w04"] .cv-app[data-pop]') && document.querySelector('[data-open="w04"] .cv-app[data-pop]').dataset.live === 'up'`, 30000);
  const S = JSON.parse(await ev(`JSON.stringify({ apps: (window.__card04 && window.__card04.state()) || [], count: (document.querySelector('[data-open="w04"] .bw-v')||{}).textContent || '' })`));
  const pop = S.apps.find(a => a.n === 'Brain Pop') || {};
  say(got && pop.live === 'up' && /^(#1 today .+ ROT · \d+ playing|Daily top 10 · nobody yet today, be first)$/.test(pop.fact || '') && /^7 apps/.test(S.count), `${sz} rule 1: Brain Pop is the 7th app in 04, live, with today's #1`, JSON.stringify({ pop, count: S.count }));
  const p = JSON.parse(await ev(`(()=>{const a=document.querySelector('[data-open="w04"] .cv-app[data-pop]');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`));
  await sleep(600); const p2 = JSON.parse(await ev(`(()=>{const r=document.querySelector('[data-open="w04"] .cv-app[data-pop]').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`)); void p;
  await tap(p2.x, p2.y, mob);
  const opened = await waitFor(`!!document.querySelector('#bt .br-pp-go') && document.querySelector('#bt .bt-win').classList.contains('br-on') `, 30000);
  const url = await ev('location.pathname + location.search');
  say(opened && !/pop=/.test(url), `${sz} rule 2: the logo opens the game in the terminal on this page`, JSON.stringify({ opened, url }));
  say(logs.length === 0, `${sz} rule 3: no console error, no failed request`, logs.slice(0, 3).join(' | '));
}
console.log(`card04pop: ${pass} PASS, ${fail} FAIL`);
ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
