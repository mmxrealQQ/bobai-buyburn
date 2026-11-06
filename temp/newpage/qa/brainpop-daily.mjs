// BRAIN POP DAILY CHECK (2026-11-06, operator: "a real highscore and real gameplay", "do 1 and 2"). A real run with real
// taps against the real server (pid f00d...: counted, never on the board), then the challenge link. At each size:
//   1  the DAILY button shows in brainrot and opens the game window (day number, a name, the board, START)
//   2  a run: 3-2-1, then only the day creatures (each with its plan number), none of the look own
//   3  real taps pop them; the clock and the terminal go on (the burn and liq part runs as always)
//   4  after the minute the server score equals the terminal score (not ranked: a check run)
//   5  the challenge link (?pop=<run>) asks, then opens the game with the challenger and the ghost runs along
//   6  no console error, no failed terminal request
//   7  DAILY and OVERALL boards, the day shown (pages through the season), the player code after a run
// usage: node brainpop-daily.mjs [base=https://golive.bobai-dashboard.pages.dev]   SIZES=1440x900,390x844m   SHOTS=<dir>
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
const shot = async name => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(r.result.data, 'base64')); };
// a real tap: the browser's own input at the middle of the element (touch on a phone)
const tap = async (x, y, mob) => { if (mob) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); } };
const click = async (sel, mob) => { const p = JSON.parse(await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'null';const r=e.getBoundingClientRect();if(!r.width)return 'null';const x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return JSON.stringify({x,y,top:!!h&&(h===e||e.contains(h))})})()`)); if (p) await tap(p.x, p.y, mob); return p; };
const stay = async mob => { if (await waitFor(`!!document.querySelector('#bt .br-ask-yes')`, 40000)) await click('#bt .br-ask-yes', mob); };
for (const sz of SIZES) {
  const mob = sz.endsWith('m'), [w, h] = sz.replace('m', '').split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(1200);
  await ev(`localStorage.setItem('bt-pop-pid','f00d' + [...crypto.getRandomValues(new Uint8Array(6))].map(b=>b.toString(16).padStart(2,'0')).join('')); localStorage.setItem('bt-br-tut','1'); 1`);
  logs = []; await send('Page.navigate', { url: BASE + '/?br=1&t=' + Date.now() }); await stay(mob);
  await waitFor(`!!document.querySelector('#bt .br-pbtn') && getComputedStyle(document.querySelector('#bt .br-pbtn')).display !== 'none'`, 20000); await sleep(2500);
  const b1 = await click('#bt .br-pbtn', mob);
  const opened = await waitFor(`!!document.querySelector('#bt .br-pp-go')`, 20000);
  const P1 = opened ? JSON.parse(await ev(`(()=>{const c=document.querySelector('#bt .br-pp-c');return JSON.stringify({head:c.querySelector('b').textContent,name:(c.querySelector('.br-pp-me i')||{}).textContent||''})})()`)) : {};
  await shot('daily-intro-' + sz);
  say(!!b1 && b1.top && opened && /^DAILY BRAIN POP #\d+$/.test(P1.head || '') && /^[A-Z]+ [A-Z]+ \d+$/.test(P1.name || ''), `${sz} rule 1: the DAILY button opens the game's window`, JSON.stringify({ b1, P1 }));
  await click('#bt .br-pp-go', mob);
  const live = await waitFor(`window.__btBr.pop().live`, 12000);
  // during the minute: tap what is there, look that only planned creatures fly, and that the clock goes on
  let taps = 0, foreign = 0, planned = 0; const clk0 = await ev(`(document.querySelector('#bt-clk')||{}).textContent||''`);
  const tEnd = Date.now() + 58000;
  while (Date.now() < tEnd) {
    const c = JSON.parse(await ev(`(()=>{const L=[...document.querySelectorAll('#bt .br > .br-r')].filter(e=>!e.classList.contains('bit'));const out={f:L.filter(e=>e.dataset.ri==null).length,p:L.length,t:null};
      for(const e of L){if(e.dataset.ri==null||e._popped)continue;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(x<5||y<5||x>innerWidth-5||y>innerHeight-5)continue;const hit=document.elementFromPoint(x,y);if(hit&&e.contains(hit)){out.t={x,y};break}}return JSON.stringify(out)})()`));
    foreign = Math.max(foreign, c.f); planned = Math.max(planned, c.p);
    if (c.t) { await tap(c.t.x, c.t.y, mob); taps++; }
    await sleep(350);
  }
  const clk1 = await ev(`(document.querySelector('#bt-clk')||{}).textContent||''`); await shot('daily-run-' + sz);
  const mid = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop())`));
  say(live && planned > 0 && foreign === 0, `${sz} rule 2: a run plays only the day's creatures`, JSON.stringify({ live, planned, foreign }));
  say(mid.pops > 0 && taps > 0 && clk0 !== clk1, `${sz} rule 3: real taps pop them, the terminal goes on`, JSON.stringify({ taps, pops: mid.pops, clk0, clk1 }));
  const done = await waitFor(`!!(window.__btBr.pop().last) && !window.__btBr.pop().run`, 20000);
  const res = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop().last)`)) || {}; await shot('daily-result-' + sz);
  const resTxt = await ev(`(document.querySelector('#bt .br-pp-c b')||{}).textContent||''`);
  say(done && res.score === mid.score && resTxt === Number(res.score).toLocaleString('en-US') + ' ROT' && res.ranked === false, `${sz} rule 4: the server counts what the terminal counted`, JSON.stringify({ server: res.score, terminal: mid.score, resTxt, ranked: res.ranked, drops: res.drops }));
  // 7 (operator 6.11.): DAILY and OVERALL, the daily board for every day of the season, top 10, the prizes, the player code
  await waitFor(`!!document.querySelector('#bt .br-pp-days span') && !/…/.test(document.querySelector('#bt .br-pp-board').textContent)`, 15000);
  const B1 = JSON.parse(await ev(`(()=>{const q=s=>document.querySelector('#bt '+s);return JSON.stringify({tabs:[...document.querySelectorAll('#bt .br-pp-tabs button')].map(b=>b.textContent).join('|'),day:q('.br-pp-days span')?.textContent,back:q('[data-dd="-1"]')?.disabled,code:q('.br-pp-code')?.textContent||''})})()`));
  await click('#bt [data-sc="all"]', mob); await waitFor(`/SEASON/.test(document.querySelector('#bt .br-pp-days')?.textContent||'') && !/…/.test(document.querySelector('#bt .br-pp-board')?.textContent||'…')`, 15000);
  const B2 = await ev(`document.querySelector('#bt .br-pp-days')?.textContent||''`); await shot('daily-overall-' + sz);
  say(B1.tabs === 'DAILY|OVERALL' && /^DAY \d+ · \d+ NOV/.test(B1.day || '') && /^[0-9A-F]{8}$/.test(B1.code) && B1.code === res.code && /SEASON/.test(B2), `${sz} rule 7: DAILY and OVERALL, the day shown, the player code`, JSON.stringify({ B1, B2 }));
  // the challenge link
  await send('Page.navigate', { url: BASE + '/?pop=' + res.run + '&t=' + Date.now() }); await stay(mob);
  const chOpen = await waitFor(`!!document.querySelector('#bt .br-pp-ch')`, 20000);
  const chTxt = chOpen ? await ev(`document.querySelector('#bt .br-pp-ch').textContent`) : '';
  await click('#bt .br-pp-go', mob); await waitFor(`window.__btBr.pop().live`, 12000); await sleep(4000);
  const hudTxt = await ev(`(document.querySelector('#bt .br-hud')||{}).textContent||''`); await shot('daily-ghost-' + sz);
  say(chOpen && chTxt.includes(res.name) && chTxt.includes(Number(res.score).toLocaleString('en-US')) && /GHOST \d/.test(hudTxt), `${sz} rule 5: the challenge link opens the challenger and the ghost runs along`, JSON.stringify({ chTxt: chTxt.slice(0, 90), hudTxt }));
  await ev(`window.__btBr.set(false); 1`);
  say(logs.length === 0, `${sz} rule 6: no console error, no failed terminal request`, logs.slice(0, 3).join(' | '));
}
console.log(`brainpop-daily: ${pass} PASS, ${fail} FAIL`);
ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
