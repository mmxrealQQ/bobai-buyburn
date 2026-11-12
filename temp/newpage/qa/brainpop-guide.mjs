// BRAIN POP GUIDE CHECK (2026-11-06, operator: "a guide in the start window: what each of the 7 does, how combos work, in detail; PLAY in the middle, HOW TO PLAY right")
// usage: node brainpop-guide.mjs [base=https://golive.bobai-dashboard.pages.dev]   SIZES=1440x900,390x844m   SHOTS=<dir>
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
const p7 = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 7, maximumFractionDigits: 7 }); // a 6.9 score
const say = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const waitFor = async (src, ms = 20000) => { for (let t = 0; t < ms; t += 300) { if (await ev(src)) return true; await sleep(300); } return false; };
const shot = async name => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(r.result.data, 'base64')); };
// a real tap: the browser's own input at the middle of the element (touch on a phone)
const tap = async (x, y, mob) => { if (mob) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); } };
const click = async (sel, mob) => { const p = JSON.parse(await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'null';e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width)return 'null';const x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({x,y,top:!!h&&(h===e||e.contains(h))})})()`)); if (p) await tap(p.x, p.y, mob); return p; };
const stay = async mob => { if (!(await waitFor(`!!document.querySelector('#bt .br-ask-yes')`, 40000))) return; for (let k = 0; k < 5 && await ev(`!!document.querySelector('#bt .br-ask-yes')`); k++) { await click('#bt .br-ask-yes', mob); await sleep(700); } };
const STATS0 = (await (await fetch(BASE + '/api/pop/stats')).json().catch(() => ({}))).days || {};
const E = await import(BASE + '/terminal/pop-engine.mjs?t=' + Date.now()).catch(() => import('../../terminal-site/terminal/pop-engine.mjs'));
for (const sz of SIZES) {
  const mob = sz.endsWith('m'), [w, h] = sz.replace('m', '').split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(1200);
  await ev(`localStorage.removeItem('bt-br'); localStorage.setItem('bt-pop-pid','f00d' + [...crypto.getRandomValues(new Uint8Array(6))].map(b=>b.toString(16).padStart(2,'0')).join('')); localStorage.setItem('bt-br-tut','1'); 1`);
  logs = []; await send('Page.navigate', { url: BASE + '/?br=1&t=' + Date.now() }); await stay(mob);
  await waitFor(`!!document.querySelector('#bt .br-pbtn') && getComputedStyle(document.querySelector('#bt .br-pbtn')).display !== 'none'`, 20000); await sleep(2500);
  await click('#bt .br-pbtn', mob);
  const opened = await waitFor(`!!document.querySelector('#bt .br-pp-tab')`, 20000);
  // 1: the header — title left, PLAY in the middle, HOW TO PLAY right (on a phone: the title above, the two tabs side by side)
  const H = opened ? JSON.parse(await ev(`(()=>{const q=s=>document.querySelector(s).getBoundingClientRect(),t=q('#bt .br-pp-hd>b'),p=q('#bt [data-tab=play]'),g=q('#bt [data-tab=guide]'),c=q('#bt .br-pp-c');return JSON.stringify({t:[t.left,t.top,t.right],p:[p.left,p.top,p.right],g:[g.left,g.top,g.right],c:[c.left,c.right],on:document.querySelector('#bt [data-tab=play]').classList.contains('on'),cols:!document.querySelector('#bt .br-pp-cols').hidden,guide:document.querySelector('#bt .br-pp-guide').hidden})})()`)) : {};
  const mid = H.c ? (H.c[0] + H.c[1]) / 2 : 0, pm = H.p ? (H.p[0] + H.p[2]) / 2 : 0;
  const lay = mob ? H.p && H.p[1] > H.t[1] && Math.abs(H.p[1] - H.g[1]) < 4 && H.g[0] > H.p[2] - 2 : H.p && Math.abs(pm - mid) < 60 && H.t[2] <= H.p[0] + 2 && H.g[0] >= H.p[2] && H.g[2] <= H.c[1];
  await shot('guide-play-' + sz);
  say(opened && lay && H.on && H.cols && H.guide, `${sz} rule 1: the start window opens on PLAY: title left, PLAY in the middle, HOW TO PLAY right`, JSON.stringify(H));
  // 2: HOW TO PLAY shows the guide, the play page hides; every station with its picture and the engine's own number
  await click('#bt [data-tab=guide]', mob); await waitFor(`!!document.querySelector('#bt .br-pp-guide .br-gd-r')`, 10000); await sleep(400);
  const G = JSON.parse(await ev(`(()=>{const g=document.querySelector('#bt .br-pp-guide');const imgs=[...g.querySelectorAll('img')];return JSON.stringify({vis:!g.hidden&&g.getBoundingClientRect().height>200,cols:document.querySelector('#bt .br-pp-cols').hidden,on:document.querySelector('#bt [data-tab=guide]').classList.contains('on'),text:g.textContent,imgs:imgs.length,broken:imgs.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),play:!!document.querySelector('#bt .br-pp-go')})})()`));
  // the day's own rule since 9.11. (rulesFor: one die for every day), the base numbers only when the engine has none
  const RL = E.rulesFor ? E.rulesFor(new Date().toISOString().slice(0, 10)) : null;
  const st = E.WEAPONS.every((x, i) => G.text.includes(x.name + ' · every ' + (RL ? RL.need[i] : x.need) + ' hits'));
  // 12.11.: a creature's worth in the points the score shows (the engine multiplies by 100), not the raw 8/5/25/120
  const worth = /small creatures 800, big ones 500/.test(G.text) && /Worth 2,500/.test(G.text) && /worth 12,000/.test(G.text);
  const must = ['THE GOAL', 'POINTS PER POP', 'STREAK AND MULTIPLIER', 'COMBOS', 'SUPER', 'MEGA', 'GOD MODE', 'THE 7 STATIONS', 'by itself', 'A MISS', 'THE RUG', 'OCTOPUS', 'SNAIL', 'THE BOSS', 'CONTROLS', E.MISS_COST + ' points', 'up to x10', 'prize pool'].filter(k => !G.text.includes(k));
  await shot('guide-guide-' + sz);
  say(worth, `${sz} rule 2b: a creature is worth the points the score shows (800 / 500 / 2,500 / 12,000)`);
  say(G.vis && G.cols && G.on && st && !must.length && !/undefined|NaN|null/.test(G.text) && G.imgs >= 11 && !G.broken.length && G.play, `${sz} rule 2: HOW TO PLAY shows the whole guide (the 7 stations with the engine's numbers, combos, don'ts, creatures), PLAY stays`, JSON.stringify({ ...G, text: G.text.length, st, missing: must }));
  // 3: back to PLAY: the play page again, the guide hidden; PLAY in sight
  await click('#bt [data-tab=play]', mob); await sleep(300);
  const B = JSON.parse(await ev(`(()=>{const b=document.querySelector('#bt .br-pp-go'),r=b.getBoundingClientRect(),hh=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({cols:!document.querySelector('#bt .br-pp-cols').hidden,guide:document.querySelector('#bt .br-pp-guide').hidden,go:r.top>=0&&r.bottom<=innerHeight&&(hh===b||b.contains(hh))})})()`));
  say(B.cols && B.guide && B.go, `${sz} rule 3: PLAY brings the play page back, PLAY in sight`, JSON.stringify(B));
  // 5 (6.11. evening): the sound switch sits by the crosshair (on a phone too) and toggles; SHARE THE GAME is in the start window
  const S5 = JSON.parse(await ev(`(()=>{const b=document.querySelector('#bt .br-pp-l .br-pp-xh .br-pp-snd'),s=document.querySelector('#bt .br-pp-b .br-pp-shg');return JSON.stringify({snd:b?b.textContent:null,top:!!document.querySelector('#bt .br-pp-c>.br-pp-snd'),share:s?s.textContent:null})})()`));
  if (S5.snd) await click('#bt .br-pp-l .br-pp-snd', mob); await sleep(200); const S5b = await ev(`document.querySelector('#bt .br-pp-l .br-pp-snd').textContent`); if (S5.snd) await click('#bt .br-pp-l .br-pp-snd', mob);
  say(/ON|OFF/.test(S5.snd || '') && !S5.top && S5b !== S5.snd && /SHARE THE GAME/.test(S5.share || ''), `${sz} rule 5: SOUND next to the crosshair toggles; SHARE THE GAME in the start window`, JSON.stringify({ ...S5, after: S5b }));
  // 6 (6.11. evening, operator: "I wanted to play as BOBAI: not allowed — every name is allowed"): BOBAI is taken and PLAY starts
  if (await ev(`document.querySelector('#bt .br-pp-nm').hidden`)) await click('#bt .br-pp-own', mob); await waitFor(`!document.querySelector('#bt .br-pp-nm').hidden`, 5000);
  await ev(`(()=>{const i=document.querySelector('#bt .br-pp-nm input');i.value='';i.focus();return 1})()`); await send('Input.insertText', { text: 'BOBAI' });
  const fs6 = await ev(`getComputedStyle(document.querySelector('#bt .br-pp-nm input')).fontSize`);
  await click('#bt .br-pp-go', mob); const started = await waitFor(`document.querySelector('#bt .br-pp').hidden && !!document.querySelector('#bt .br-arena:not([hidden])')`, 15000);
  const W6 = JSON.parse(await ev(`JSON.stringify({sw:document.documentElement.scrollWidth,w:innerWidth,sx:scrollX,msg:(document.querySelector('#bt .br-pp-nm small')||{}).textContent||''})`));
  say(started && fs6 === '16px' && W6.sw <= W6.w && W6.sx === 0, `${sz} rule 6: the name BOBAI is allowed and PLAY starts; the name box is 16px (no phone zoom), nothing wider than the screen`, JSON.stringify({ started, fs6, ...W6 }));
  say(!logs.length, `${sz} rule 4: no console error, no failed terminal request`, logs.slice(0, 4).join(' | '));
}
console.log(`brainpop-guide: ${pass} PASS, ${fail} FAIL`);
ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
