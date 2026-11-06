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
for (const sz of SIZES) {
  const mob = sz.endsWith('m'), [w, h] = sz.replace('m', '').split('x').map(Number), innerW = w;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  await send('Page.navigate', { url: BASE + '/robots.txt' }); await sleep(1200);
  await ev(`localStorage.removeItem('bt-br'); localStorage.setItem('bt-pop-pid','f00d' + [...crypto.getRandomValues(new Uint8Array(6))].map(b=>b.toString(16).padStart(2,'0')).join('')); localStorage.setItem('bt-br-tut','1'); 1`);
  logs = []; await send('Page.navigate', { url: BASE + '/?br=1&t=' + Date.now() }); await stay(mob);
  await waitFor(`!!document.querySelector('#bt .br-pbtn') && getComputedStyle(document.querySelector('#bt .br-pbtn')).display !== 'none'`, 20000); await sleep(2500);
  const b1 = await click('#bt .br-pbtn', mob);
  const opened = await waitFor(`!!document.querySelector('#bt .br-pp-go')`, 20000);
  const P1 = opened ? JSON.parse(await ev(`(()=>{const c=document.querySelector('#bt .br-pp-c');return JSON.stringify({head:c.querySelector('b').textContent,name:(c.querySelector('.br-pp-me i')||{}).textContent||''})})()`)) : {};
  await shot('daily-intro-' + sz);
  say(!!b1 && b1.top && opened && /^BRAIN POP 6\.9 · DAY \d+$/.test(P1.head || '') && (P1.name || '').length >= 3 /* a random name or the player's own, remembered */, `${sz} rule 1: the DAILY button opens the game's window`, JSON.stringify({ b1, P1 }));
  // 12 (operator 6.11.): an own name, typed and brainrotted, still shows the name; the prize line in English
  await click('#bt .br-pp-own', mob); await waitFor(`!document.querySelector('#bt .br-pp-nm').hidden`, 5000);
  await ev(`(()=>{const i=document.querySelector('#bt .br-pp-nm input');i.value='';i.focus();return 1})()`); await send('Input.insertText', { text: 'mmx_QQ' });
  await click('#bt .br-pp-rot', mob); await sleep(500);
  const N12 = JSON.parse(await ev(`JSON.stringify({ name: document.querySelector('#bt .br-pp-me i').textContent, prize: document.querySelector('#bt .br-pp-prize').textContent, box: document.querySelector('#bt .br-pp-nm').hidden })`));
  await click('#bt .br-pp-re', mob); await sleep(300); const N12b = await ev(`document.querySelector('#bt .br-pp-me i').textContent`);
  say(N12.name.includes('mmx_QQ') && N12.name !== 'mmx_QQ' && N12.box && N12b.includes('mmx_QQ') && N12b !== N12.name && /NOOO+THING/.test(N12.prize) && !/NIII|German/.test(N12.prize), `${sz} rule 12: an own name is brainrotted and stays recognisable; the prize line is English`, JSON.stringify({ ...N12, reroll: N12b }));
  // 16 (6.11.: PLAY slid under the fold of a long window): PLAY is in sight and on top without scrolling
  const goSeen = JSON.parse(await ev(`(()=>{const b=document.querySelector('#bt .br-pp-go'),r=b.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({inView:r.top>=0&&r.bottom<=innerHeight,top:h===b||b.contains(h)})})()`));
  say(goSeen.inView && goSeen.top, `${sz} rule 16: PLAY is in sight without scrolling`, JSON.stringify(goSeen));
  await click('#bt .br-pp-go', mob);
  const live =await waitFor(`window.__btBr.pop().live`, 12000);
  // 14 (operator 6.11.): during the run the log does not grow and a station opens no window (desktop: a mouse hovers)
  if (!mob) {
    const box = JSON.parse(await ev(`(()=>{const t=document.querySelector('#bt .term').getBoundingClientRect(),s=[...document.querySelectorAll('#bt .br-st')].map(e=>e.getBoundingClientRect()).find(r=>r.width>20);return JSON.stringify({tx:t.left+t.width/2,ty:t.top+t.height/2,th:Math.round(t.height),sx:s?s.left+s.width/2:0,sy:s?s.top+s.height/2:0})})()`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.tx, y: box.ty }); await sleep(500);
    const th2 = await ev(`Math.round(document.querySelector('#bt .term').getBoundingClientRect().height)`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.sx, y: box.sy }); await sleep(500);
    const det = await ev(`document.querySelector('#bt-detail')?.classList.contains('on')||false`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    say(th2 === box.th && !det, `${sz} rule 14: in the run the log keeps its size and a station opens no window`, JSON.stringify({ before: box.th, hovered: th2, detail: det }));
  }
  // during the minute (2.0): the arena is there, square, inside the window; aim at what is in it (never at a rug), one
  // deliberate miss in an empty corner; nothing of the look's own flies; the clock goes on; a streak fires a power itself
  let taps = 0, foreign = 0, planned = 0, snap = { pops: 0, score: null }, missed = null, banner = false, square = null; const s = {}; const clk0 = await ev(`(document.querySelector('#bt-clk')||{}).textContent||''`);
  const tEnd = Date.now() + 58000;
  while (Date.now() < tEnd) {
    const a = JSON.parse(await ev(`JSON.stringify({ aim: window.__btBr.aim(), own: [...document.querySelectorAll('#bt .br > .br-r')].filter(e=>!e.classList.contains('bit')).length, ban: !!document.querySelector('#bt .br-wban.on') })`));
    foreign = Math.max(foreign, a.own); banner = banner || a.ban;
    if (a.aim) {
      const B = a.aim.box; square = square || { w: Math.round(B.width), h: Math.round(B.height), inside: B.left >= 0 && B.right <= innerW && B.top >= 0 };
      planned = Math.max(planned, a.aim.alive.length);
      if (missed === null && Date.now() > tEnd - 50000) { // one miss: the emptiest corner
        const corners = [[30, 30], [970, 30], [30, 970], [970, 970]].map(([x, y]) => [x, y, Math.min(...a.aim.alive.map(c => Math.hypot(c[2] - x, c[3] - y) - c[4] * 3), 9999)]).sort((p, q) => q[2] - p[2]);
        const before = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop())`)); await tap(B.left + corners[0][0] / 1000 * B.width, B.top + corners[0][1] / 1000 * B.height, mob); await sleep(120);
        const after = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop())`)); missed = { before: before.misses, after: after.misses, combo: after.combo };
      } else {
        const ok = a.aim.alive.filter(c => !c[1] && c[2] > 40 && c[2] < 960 && c[3] > 40 && c[3] < 960), tgt = ok.find(c => c[5] === 'pop') || ok[0]; /* the still ones first, as a person takes the easy shots */
        if (tgt) { await tap(B.left + tgt[2] / 1000 * B.width, B.top + tgt[3] / 1000 * B.height, mob); taps++; }
      }
    }
    const now1 = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop())`)); if (now1.run) snap = now1; /* the last state while the run still goes */
    if (!s.midShot && Date.now() > tEnd - 28000) { s.midShot = 1; await shot('daily-mid-' + sz); }
    await sleep(160);
  }
  const clk1 = await ev(`(document.querySelector('#bt-clk')||{}).textContent||''`); await shot('daily-run-' + sz);
  const cur = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop())`)), mid = cur.run ? cur : snap;
  say(live && planned > 0 && foreign === 0 && square && Math.abs(square.w - square.h) <= 2 && square.w >= 200 && square.inside, `${sz} rule 2: a run plays the day's creatures in a square arena, nothing else flies`, JSON.stringify({ live, planned, foreign, square }));
  say(mid.pops > 10 && taps > 0 && clk0 !== clk1, `${sz} rule 3: aimed taps pop them, the terminal goes on`, JSON.stringify({ taps, pops: mid.pops, misses: mid.misses, clk0, clk1 }));
  say(!!missed && missed.after === missed.before + 1 && missed.combo === 0, `${sz} rule 3b: a tap on nothing is a miss and breaks the streak`, JSON.stringify(missed));
  say(mid.powers >= 1 && banner, `${sz} rule 3c: a clean streak fires a super power by itself (with its banner)`, JSON.stringify({ powers: mid.powers, banner }));
  const done = await waitFor(`!!(window.__btBr.pop().last) && !window.__btBr.pop().run`, 20000);
  const res = JSON.parse(await ev(`JSON.stringify(window.__btBr.pop().last)`)) || {}; await shot('daily-result-' + sz);
  const resTxt = await ev(`(document.querySelector('#bt .br-pp-c b')||{}).textContent||''`);
  say(done && Math.round(res.score * 1e7) === mid.score && resTxt === p7(res.score) + ' ROT' && res.ranked === false && String(res.name).includes('mmx_QQ'), `${sz} rule 4: the server counts what the terminal counted`, JSON.stringify({ server: res.score, terminal: mid.score, resTxt, ranked: res.ranked, drops: res.drops }));
  // 7 (operator 6.11.): DAILY and OVERALL, the daily board for every day of the season, top 10, the prizes, the player code
  await waitFor(`!!document.querySelector('#bt .br-pp-days span') && !/…/.test(document.querySelector('#bt .br-pp-board').textContent)`, 15000);
  const B1 = JSON.parse(await ev(`(()=>{const q=s=>document.querySelector('#bt '+s);return JSON.stringify({tabs:[...document.querySelectorAll('#bt .br-pp-tabs button')].map(b=>b.textContent).join('|'),day:q('.br-pp-days span')?.textContent,back:q('[data-dd="-1"]')?.disabled,code:q('.br-pp-code')?.textContent||'',next:q('.br-pp-next')?.textContent||''})})()`));
  // 13 (6.11., the ecosystem): the result names the brain behind the game, with the counted buy link (buy:pop)
  const buyHref = await ev(`document.querySelector('#bt .br-pp-bob a')?.getAttribute('href')||''`);
  const buyRes = buyHref ? await fetch(BASE + buyHref, { redirect: 'manual', headers: { 'sec-purpose': 'prefetch' } }) : null; /* a prefetch is never counted as a click */
  say(buyHref === '/buy?from=pop' && buyRes && buyRes.status === 302 && /pancakeswap\.finance\/swap\?outputCurrency=0x245c/.test(buyRes.headers.get('location') || ''), `${sz} rule 13: the result shows $BOBAI with the counted buy link`, JSON.stringify({ buyHref, status: buyRes && buyRes.status, to: buyRes && (buyRes.headers.get('location') || '').slice(0, 60) }));
  // 8 (6.11. later): a reason to come back — the next daily counted down
  say(/^(Next daily in \d+ h \d+ min\.|Last day of the season\.) New creatures/.test(B1.next), `${sz} rule 8: the result counts down to the next daily`, B1.next);
  await click('#bt [data-sc="all"]', mob); await waitFor(`/SEASON/.test(document.querySelector('#bt .br-pp-days')?.textContent||'') && !/…/.test(document.querySelector('#bt .br-pp-board')?.textContent||'…')`, 15000);
  const B2 = await ev(`document.querySelector('#bt .br-pp-days')?.textContent||''`); await shot('daily-overall-' + sz);
  say(B1.tabs === 'DAILY|OVERALL' && /^DAY \d+ · \d+ NOV/.test(B1.day || '') && /^[0-9A-F]{8}$/.test(B1.code) && B1.code === res.code && /SEASON/.test(B2), `${sz} rule 7: DAILY and OVERALL, the day shown, the player code`, JSON.stringify({ B1, B2 }));
  // the challenge link
  await send('Page.navigate', { url: BASE + '/?pop=' + res.run + '&t=' + Date.now() }); await stay(mob);
  const chOpen = await waitFor(`!!document.querySelector('#bt .br-pp-ch')`, 20000);
  const chTxt = chOpen ? await ev(`document.querySelector('#bt .br-pp-ch').textContent`) : '';
  await click('#bt .br-pp-go', mob); await waitFor(`window.__btBr.pop().live`, 12000); await sleep(4000);
  const hudTxt = await ev(`(document.querySelector('#bt .br-hud')||{}).textContent||''`); await shot('daily-ghost-' + sz);
  say(chOpen && chTxt.includes(res.name) && chTxt.includes(p7(res.score)) && /GHOST \d/.test(hudTxt), `${sz} rule 5: the challenge link opens the challenger and the ghost runs along`, JSON.stringify({ chTxt: chTxt.slice(0, 90), hudTxt }));
  // 9: a post's link (?pop=play) asks, then opens the game itself, no challenger
  await send('Page.navigate', { url: BASE + '/?pop=play&t=' + Date.now() }); await stay(mob);
  const playOpen = await waitFor(`!!document.querySelector('#bt .br-pp-go')`, 20000), playCh = await ev(`!!document.querySelector('#bt .br-pp-ch')`);
  say(playOpen && !playCh, `${sz} rule 9: ?pop=play opens the game right away`, JSON.stringify({ playOpen, playCh }));
  // 11 (operator 6.11. later): the standard terminal stays clean — no PLAY button with ROT off (the Ecosystem app and
  // ?pop=play still lead to the game, card04pop.mjs and rule 9)
  await ev(`localStorage.setItem('bt-br','0'); 1`); await send('Page.navigate', { url: BASE + '/?t=' + Date.now() });
  await waitFor(`!!window.__btBr`, 30000); await sleep(3000);
  const std = JSON.parse(await ev(`(()=>{const b=document.querySelector('#bt .br-pbtn'),w=document.querySelector('#bt .bt-win');return JSON.stringify({on:w.classList.contains('br-on'),shown:!!b&&getComputedStyle(b).display!=='none'})})()`));
  say(!std.on && !std.shown, `${sz} rule 11: with ROT off the standard terminal shows no PLAY button`, JSON.stringify(std));
  await ev(`window.__btBr.set(false); 1`);
  say(logs.length === 0, `${sz} rule 6: no console error, no failed terminal request`, logs.slice(0, 3).join(' | '));
}
// 10: our own runs leave the game's counts alone (they would fake the funnel)
{ const st = await (await fetch(BASE + '/api/pop/stats')).json(), d = new Date().toISOString().slice(0, 10), now = st.days?.[d] || {};
  const was = STATS0[d] || {}, same = ['opened', 'started', 'finished'].every(k => (now[k] || 0) === (was[k] || 0));
  say(same, 'rule 10: our check runs are not counted as players (unless a real visitor played meanwhile — then rerun)', JSON.stringify({ before: was, after: now })); }
console.log(`brainpop-daily: ${pass} PASS, ${fail} FAIL`);
ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
