// BRAINROT CHECK (2026-11-05). The look is the surroundings only, full chaos, with a switch to turn it off.
// Rules, at several window sizes:
//   1  the layer, the sky and the flash are there, the window wears br-on, the switch shows inside the title row's window
//   2  everything of the look lies UNDER the figure, the labels and every window: z-index 1, no pointer events
//   3  a MEGA moment brings creatures and a caption; every creature picture loaded (no broken image)
//   4  the switch turns it off (layer empty, br-on gone) and STAYS IN SIGHT; the choice survives a reload; one more click
//      brings it back
//   5  ?br=0 leaves no trace (no layer, no switch); the season is 5 Nov until 1 Dec 2026 00:00 UTC
//   6  no console error, no failed terminal request
//   7  the look keeps at least 70% of the page's frame rate with chaos running (on/off by turns, medians)
// usage: node brainrot.mjs [base=https://bobai-lab.pages.dev]   SIZES=1440x900,1280x720,390x844m   SHOTS=<dir>
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://bobai-lab.pages.dev').replace(/\/$/, '');
const SIZES = (process.env.SIZES || '1440x900,1280x720,1024x768,390x844m').split(',');
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
const go = async (q, w, h, mob) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  logs = []; await send('Page.navigate', { url: BASE + '/?' + q + '&t=' + Date.now() });
};
const settled = async () => { for (let i = 0; i < 80; i++) { await sleep(500);
  if (await ev(`(()=>{const c=document.querySelector('#bt .mdc');return !!(c&&!c.hidden&&c.getBoundingClientRect().width)})()`)) return true; } return false; };
const shot = async name => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(r.result.data, 'base64')); };

for (const sz of SIZES) {
  const mob = sz.endsWith('m'), [w, h] = sz.replace('m', '').split('x').map(Number);
  await send('Runtime.evaluate', { expression: `try{localStorage.removeItem('bt-br')}catch{}` });
  await go('br=1', w, h, mob);
  if (!(await settled())) { say(false, `${sz} the terminal settled`); continue; }
  await sleep(1500);
  const st = JSON.parse(await ev(`(()=>{const W=document.querySelector('#bt .bt-win'),g=s=>W.querySelector(s),cs=e=>e&&getComputedStyle(e),sw=document.querySelector('#bt-br'),wr=W.getBoundingClientRect(),sb=sw&&sw.getBoundingClientRect();
    return JSON.stringify({layer:!!g('.br:not(.br-stl):not(.br-caps)'),sky:__btBr.sky(),flash:!!g('.br-flash'),on:W.classList.contains('br-on'),
      z:[g('.br:not(.br-stl):not(.br-caps)'),g('.br-flash')].map(e=>e?cs(e).zIndex+'/'+cs(e).pointerEvents:'none'),
      fig:cs(g('#bt-fig')||g('.fig')).zIndex,
      sw:!!sw&&sb.width>0&&sb.left>=wr.left-1&&sb.right<=wr.right+1&&sb.top>=wr.top-1&&cs(sw).opacity>0.5&&cs(sw).visibility!=='hidden'})})()`));
  say(st.layer && st.sky && st.flash && st.on && st.sw, `${sz} rule 1: layer, sky, flash, br-on and the switch in sight`, JSON.stringify(st));
  say(st.z.every(z => z === '1/none') && Number(st.fig) > 1, `${sz} rule 2: the look lies under the figure and every window (z 1, no pointer events)`, st.z.join(' ') + ' fig ' + st.fig);
  await ev(`__btBr.mega()`); await sleep(1200);
  const m = JSON.parse(await ev(`(()=>{const L=document.querySelector('#bt .br:not(.br-stl):not(.br-caps)'),imgs=[...L.querySelectorAll('img')];return JSON.stringify({crew:L.querySelectorAll('.br-r').length,caps:document.querySelectorAll('#bt .br-cap').length,broken:imgs.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src.split('/').pop())})})()`));
  say(m.crew > 0 && m.caps > 0, `${sz} rule 3: a MEGA moment brings creatures and a caption`, JSON.stringify(m));
  // 17-20 (operator, 5.11. night): no circle of the standard terminal at the stations; $BOB is the stick-figure builder,
  // not a brain; the disco ball is in sight (its own picture, after every costume, over the stage); the rocket snail stays
  // in sight at least 1.2 s
  await sleep(600);
  const s17 = JSON.parse(await ev(`(()=>{const L=document.querySelector('#bt .br-stl'),d=L&&L.querySelector('.br-disco'),b=d&&d.getBoundingClientRect(),st=L&&L.querySelector('.br-stage'),sb=st&&st.getBoundingClientRect(),kids=L?[...L.children]:[];
    return JSON.stringify({off:!!__btBr.circlesOff?.(),cos:__btBr.costumes?.()||[],ball:!!d&&b.width>20&&getComputedStyle(d).visibility!=='hidden'&&!!d.querySelector('img')?.naturalWidth,last:!!d&&kids.indexOf(d)===kids.length-1,
      rg:(()=>{const g=L&&L.querySelector('.br-ring'),r=g&&g.getBoundingClientRect();if(!g||!b)return null;return {w:Math.round(r.width),arcs:g.querySelectorAll('path,circle:not(.b)').length,seen:getComputedStyle(g).visibility!=='hidden',afterStage:kids.indexOf(g)>kids.indexOf(st),off:Math.round(Math.hypot(r.left+r.width/2-b.left-b.width/2,r.top+r.height/2-b.top-b.height/2)),inside:b.width<r.width*.9,scene:window.__btRing().some(x=>x[0])}})(),
      cover:!d?[]:[...L.querySelectorAll('.br-st')].filter(e=>{const q=e.getBoundingClientRect(),ix=Math.min(q.right,b.right)-Math.max(q.left,b.left),iy=Math.min(q.bottom,b.bottom)-Math.max(q.top,b.top);return ix>b.width*.3&&iy>b.height*.3}).map(e=>e.querySelector('img').src.split('/br/')[1].split('.')[0]),onStage:!!d&&!!sb&&b.left>=sb.left&&b.right<=sb.right&&b.top>=sb.top&&b.bottom<=sb.bottom})})()`));
  say(s17.off, `${sz} rule 17: no circle of the standard terminal at the stations`, JSON.stringify(s17.off));
  say(s17.cos.includes('burnB:stbobs') && !s17.cos.some(c => c.endsWith(':stbob')), `${sz} rule 18: $BOB is the stick-figure builder`, s17.cos.join(' '));
  say(s17.cover.length === 0, sz + ' rule 19b: no station creature stands on the disco ball (it steps aside of the ring)', s17.cover.join(' '));
  say(s17.ball && s17.last, `${sz} rule 19: the disco ball is in sight, over every costume`, JSON.stringify({ ball: s17.ball, last: s17.last }));
  // 21 (operator, 6.11.: "the ring is needed at the next buyback, on a phone it is gone; put the disco ball in the ring"):
  // the buyback ring is drawn on the layer over the stage, with its coloured arcs, and the ball sits in its middle
  const g = s17.rg; say(!!g && g.seen && g.w >= 28 && (g.arcs >= 1 || !g.scene) && g.afterStage && g.off <= 2 && g.inside, `${sz} rule 21: the buyback ring is over the stage, the disco ball in its middle`, JSON.stringify(g));
  const sn = await ev(`(async()=>{__btBr.snail?.();const w=ms=>new Promise(r=>setTimeout(r,ms));const W=document.querySelector('#bt .br:not(.br-stl):not(.br-caps)').getBoundingClientRect();let t0=0,t1=0;const s=performance.now();
    while(performance.now()-s<8000){await w(50);const e=[...document.querySelectorAll('#bt .br-r')].find(r=>r.dataset.n==='snail');if(!e){if(t0)break;continue}const q=e.getBoundingClientRect();if(q.right>W.left+20&&q.left<W.right-20){if(!t0)t0=performance.now();t1=performance.now()}}return Math.round(t1-t0)})()`);
  say(sn >= 1200, `${sz} rule 20: the rocket snail stays in sight long enough to be seen`, sn + ' ms');
  // 8: no caption reaches into the title row (measured where it stands: a caption in its first 0.36 s is still the
  // see-through slam-in at up to 3x its size — with more captions running since 5.11. night one was often caught there) (its buttons are half see-through: 1280x720, 5.11.)
  let worst = 999;
  for (let i = 0; i < 6; i++) {
    await ev(`__btBr.caption(${i % 2 ? 'true' : 'false'});__btBr.creature('bulb','pop')`); await sleep(700);
    worst = Math.min(worst, await ev(`(()=>{const hd=document.querySelector('#bt .hud');let b=0;for(const e of hd.children){const r=e.getBoundingClientRect();if(r.width&&r.height)b=Math.max(b,r.bottom)}let m=999;for(const c of document.querySelectorAll('#bt .br-cap')){const an=c.getAnimations()[0];if(an&&an.currentTime<360)continue;m=Math.min(m,c.getBoundingClientRect().top-b)}return Math.round(m)})()`));
  }
  say(worst >= -2, `${sz} rule 8: no caption reaches into the title row`, `closest ${worst} px below it`);
  // 11: nothing that STANDS somewhere lies behind him (operator 5.11.: "very many come behind BOBAI and you cannot see them"):
  // the director paused (set off/on gives 2.5 s before its first beat), pops, rises and captions, then every box against his body
  let behind = 0, seen = 0; const whoAll = [];
  for (let round = 0; round < 3; round++) {
    await ev(`__btBr.set(false);__btBr.set(true);for(const n of ['eyeball','banana','sock','dj','fridge','cactus'])__btBr.creature(n,'pop');__btBr.creature('sock','rise');__btBr.caption(false);__btBr.caption(true);__btBr.caption(false)`);
    // by the animations' own clock, not the wall's: a busy test page ran them 0.8 s behind, and a caption measured in its
    // first moment is still three times its size (the slam-in)
    for (let i = 0; i < 30; i++) { await sleep(150); if (await ev(`[...document.querySelectorAll('#bt .br-cap')].every(c=>{const a=c.getAnimations()[0];return !a||a.currentTime>=600})`)) break; }
    const r = JSON.parse(await ev(`(()=>{const F=document.querySelector('#bt #bt-fig')||document.querySelector('#bt .fig'),b=F.getBoundingClientRect(),bw=b.width*.62,f={l:b.left+(b.width-bw)/2,r:b.left+(b.width+bw)/2,t:b.top,b:b.bottom};
      const els=[...document.querySelectorAll('#bt .br-r:not(.bit)')].filter(e=>e.dataset.n!=='mini'); /* the winged brains fly and fall: they may pass behind him */let n=0;const who=[];for(const e of els){const q=e.getBoundingClientRect();const ix=Math.min(q.right,f.r)-Math.max(q.left,f.l),iy=Math.min(q.bottom,f.b)-Math.max(q.top,f.t);if(ix>12&&iy>12&&ix*iy>0.15*q.width*q.height){n++;who.push((e.dataset.t?'creature '+e.dataset.t:e.className+' '+e.textContent).slice(0,26)+' t'+Math.round((e.getAnimations()[0]||e.querySelector('*')?.getAnimations()[0]||{}).currentTime||0))}}return JSON.stringify({n,all:els.length,who})})()`));
    behind += r.n; seen += r.all; if (r.who.length) whoAll.push(...r.who);
  }
  // 12: the words lie ABOVE him (their own layer, z 2, after the figure), still under the labels and windows
  const cl = JSON.parse(await ev(`(()=>{const L=document.querySelector('#bt .br-caps'),F=document.querySelector('#bt #bt-fig');if(!L)return JSON.stringify({none:1});const cs=getComputedStyle(L);return JSON.stringify({z:cs.zIndex,pe:cs.pointerEvents,after:!!(F.compareDocumentPosition(L)&Node.DOCUMENT_POSITION_FOLLOWING),same:L.parentNode===F.parentNode,caps:L.querySelectorAll('.br-cap').length})})()`));
  say(cl.z === '2' && cl.pe === 'none' && cl.after && cl.same, `${sz} rule 12: the captions lie above BOBAI, under the labels`, JSON.stringify(cl));
  say(behind === 0, `${sz} rule 11: no creature that stands lies behind BOBAI`, `${behind} of ${seen} behind him` + (whoAll.length ? ': ' + whoAll.slice(0, 6).join(' | ') : ''));
  // 14: BRAIN POP — pops score, quick pops build a combo, the score chip shows, the kaiju takes six hits
  const gm = JSON.parse(await ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));__btBr.set(false);__btBr.set(true);__btBr.resetGame();
    const hit=r=>{const b=r.getBoundingClientRect(),i=r.querySelector('img');i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+b.width/2,clientY:b.top+b.height/2}))};
    for(let i=0;i<12&&document.querySelectorAll('#bt .br-r:not(.bit)').length<3;i++)__btBr.creature(['eyeball','banana','sock','dj','cactus','fridge'][i%6],'pop');await w(500);
    for(const r of [...document.querySelectorAll('#bt .br-r:not(.bit)')].slice(0,3))hit(r);await w(200);
    const g1=__btBr.game(),hud=document.querySelector('#bt .br-hud'),hs=hud&&getComputedStyle(hud);
    __btBr.kaiju();await w(1800);const k=[...document.querySelectorAll('#bt .br-r')].find(r=>r.dataset.n==='kaiju');let hits=0;
    if(k){for(let i=0;i<5;i++){hit(k);await w(80)}hits=k._popped?-1:1;hit(k);await w(100);}
    return JSON.stringify({score:g1.score,combo:g1.combo,hud:!!hud&&hud.classList.contains('on'),hudPe:hs&&hs.pointerEvents,kaiju:!!k,aliveAfter5:hits,popped:k?!!k._popped:null,score2:__btBr.game().score})})()`));
  say(gm.score >= 15 && gm.combo >= 3 && gm.hud && gm.hudPe === 'none' && gm.kaiju && gm.aliveAfter5 === 1 && gm.popped && gm.score2 > gm.score, `${sz} rule 14: BRAIN POP scores, combos, shows its chip, the kaiju takes six hits`, JSON.stringify(gm));
  await ev(`__btBr.resetGame()`);
  // 15: the look keeps to the scene: every layer ends where the chart strip (wide) or the view tabs (phone) begin
  const fit = JSON.parse(await ev(`(()=>{__btBr.fit();const W=document.querySelector('#bt .bt-win'),wr=W.getBoundingClientRect();let cut=wr.bottom;for(const e of [W.querySelector('.tl'),document.getElementById('bt-mtabs')]){if(!e)continue;const r=e.getBoundingClientRect();if(r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&r.top>wr.top+wr.height*.35)cut=Math.min(cut,r.top)}
    const lows=[...W.querySelectorAll('.br, .br-flash')].map(e=>e.className.replace(/br-?/g,'').trim()+':'+Math.round(wr.top+e.offsetTop+e.offsetHeight));return JSON.stringify({cut:Math.round(cut),lows})})()`));
  say(fit.lows.length >= 3 && fit.lows.every(b => +b.split(':').pop() <= fit.cut + 1), `${sz} rule 15: the look ends above the chart strip / the view tabs`, JSON.stringify(fit));
  // 13: every station of the split and the trades wear a creature on their own light, every bot a winged brain on its own
  const stc = JSON.parse(await ev(`(()=>{const L=document.querySelector('#bt .br-stl');if(!L)return JSON.stringify({none:1});const cs=getComputedStyle(L);
    const labs=[...document.querySelectorAll('#bt .lab')].filter(l=>l.getBoundingClientRect().width>0).length;
    const st=[...L.querySelectorAll('.br-st')].map(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}),bots=L.querySelectorAll('.br-bot').length;
    return JSON.stringify({z:cs.zIndex,pe:cs.pointerEvents,stations:__btBr.stations(),shown:st.filter(Boolean).length,bots,labs})})()`));
  say(stc.z === '1' && stc.pe === 'none' && stc.stations.length >= 6 && stc.shown === stc.stations.length && stc.bots === 5, `${sz} rule 13: stations, trades and bots in costume, under the labels`, JSON.stringify(stc));
  // 9: poke one — a creature under the pointer pops into tiny brains and says its name; the click reaches the creature
  await ev(`__btBr.set(false);__btBr.set(true);for(let i=0;i<6&&![...document.querySelectorAll('#bt .br-r')].some(x=>x.dataset.n==='fridge');i++)__btBr.creature('fridge','pop')`); await sleep(900);
  const pk = JSON.parse(await ev(`(async()=>{const r=[...document.querySelectorAll('#bt .br-r:not(.bit)')].reverse().find(x=>x.dataset.n==='fridge'&&!x._popped);if(!r)return JSON.stringify({none:1});const b=r.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;
    const top=document.elementFromPoint(x,y);const hit=!!(top&&top.closest('.br-r'));r.querySelector('img').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y}));
    await new Promise(z=>setTimeout(z,250));return JSON.stringify({hit,bits:document.querySelectorAll('#bt .br-r.bit').length,said:[...document.querySelectorAll('#bt .br-cap.sm')].some(c=>/FRIGORIFERO FENICOTTERO \\+\\d+/.test(c.textContent))})})()`));
  say(pk.bits >= 8 && pk.said, `${sz} rule 9: a poked creature pops into tiny brains and says its name`, JSON.stringify(pk));
  for (const n of ['octo', 'bulb', 'snail', 'kaiju']) await ev(`__btBr.creature('${n}','pop')`).catch(() => {});
  await sleep(1400); await shot(`br-${sz}`);
  const br = JSON.parse(await ev(`(()=>{const imgs=[...document.querySelectorAll('#bt .br img')];return JSON.stringify(imgs.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src.split('/').pop()))})()`));
  say(m.broken.length === 0 && br.length === 0, `${sz} rule 3b: every creature picture loads`, [...m.broken, ...br].join(', '));
  // 7: frame rate with the chaos running, on/off by turns
  if (!mob) {
    const fp = JSON.parse(await ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const fps=()=>new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<2500)requestAnimationFrame(f);else r(n/((performance.now()-t0)/1000))};requestAnimationFrame(f)});
      const on=[],off=[];for(let i=0;i<3;i++){__btBr.set(true);__btBr.conga();__btBr.caption(true);await w(400);on.push(await fps());__btBr.set(false);await w(400);off.push(await fps());}
      __btBr.set(true);const md=a=>a.sort((x,y)=>x-y)[1];return JSON.stringify({on:Math.round(md(on)),off:Math.round(md(off))})})()`));
    say(fp.on >= fp.off * 0.7, `${sz} rule 7: the chaos keeps the frame rate (${fp.on} fps on, ${fp.off} off)`);
  }
  // 4: off by the switch, stays in sight, survives a reload, back on
  await ev(`document.querySelector('#bt-br').click()`); await sleep(900);
  await sleep(800); // the cosmos fades out in 1.2 s
  const off = JSON.parse(await ev(`(()=>{const W=document.querySelector('#bt .bt-win'),sw=document.querySelector('#bt-br'),b=sw.getBoundingClientRect();return JSON.stringify({on:W.classList.contains('br-on'),sky:__btBr.sky(),kids:W.querySelector('.br:not(.br-stl):not(.br-caps)').children.length,sw:b.width>0&&getComputedStyle(sw).opacity>0.5,pressed:sw.getAttribute('aria-pressed')})})()`));
  say(!off.on && !off.sky && off.kids === 0 && off.sw && off.pressed === 'false', `${sz} rule 4: the switch turns it off and stays in sight`, JSON.stringify(off));
  await send('Page.navigate', { url: BASE + '/?br=1&t=' + Date.now() }); await settled(); await sleep(1200);
  const re = await ev(`document.querySelector('#bt .bt-win').classList.contains('br-on')+'/'+document.querySelector('#bt-br').getAttribute('aria-pressed')`);
  say(re === 'false/false', `${sz} rule 4b: off survives a reload`, re);
  await ev(`document.querySelector('#bt-br').click()`); await sleep(600);
  say(await ev(`document.querySelector('#bt .bt-win').classList.contains('br-on')`), `${sz} rule 4c: one more click brings it back`);
  say(logs.length === 0, `${sz} rule 6: no console error, no failed terminal request`, logs.slice(0, 4).join(' | '));
  await ev(`try{localStorage.removeItem('bt-br')}catch{}`);
}
// 16: HEALTH FIRST — a first visit (no choice stored, no ?br) sees the notice and nothing moves; "keep the standard" stays
// off and is remembered (no notice on reload); "turn brainrot on" switches it on
for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
  await go('x=1', w, h, mob); await sleep(300); await ev(`try{localStorage.removeItem('bt-br')}catch{}`);
  await send('Page.navigate', { url: BASE + '/?x=1&t=' + Date.now() }); await settled(); await sleep(1200);
  const a1 = JSON.parse(await ev(`(()=>{const n=document.querySelector('#bt .br-ask'),W=document.querySelector('#bt .bt-win'),b=n&&n.getBoundingClientRect(),wr=W.getBoundingClientRect();return JSON.stringify({ask:!!n&&b.width>0,inside:!!n&&b.left>=wr.left-1&&b.right<=wr.right+1,on:W.classList.contains('br-on'),moving:document.querySelectorAll('#bt .br-r').length,warn:/epilepsy/i.test(n?n.textContent:''),safeFirst:!!n&&!!n.querySelector('.br-ask-no')&&!!n.querySelector('.br-ask-yes')})})()`));
  say(a1.ask && a1.inside && !a1.on && a1.moving === 0 && a1.warn && a1.safeFirst, `${w} rule 16: a first visit sees the health notice and nothing moves`, JSON.stringify(a1));
  await ev(`document.querySelector('#bt .br-ask-no').click()`); await sleep(500);
  const a2 = await ev(`(()=>{let s=null;try{s=localStorage.getItem('bt-br')}catch{}return [!!document.querySelector('#bt .br-ask'),document.querySelector('#bt .bt-win').classList.contains('br-on'),s].join('/')})()`);
  await send('Page.navigate', { url: BASE + '/?x=1&t=' + Date.now() }); await settled(); await sleep(1200);
  const a3 = await ev(`[!!document.querySelector('#bt .br-ask'),document.querySelector('#bt .bt-win').classList.contains('br-on')].join('/')`);
  say(a2 === 'false/false/0' && a3 === 'false/false', `${w} rule 16b: "switch to the standard" stays off and is remembered`, a2 + ' | reload ' + a3);
  await ev(`try{localStorage.removeItem('bt-br')}catch{}`); await send('Page.navigate', { url: BASE + '/?x=1&t=' + Date.now() }); await settled(); await sleep(1200);
  await ev(`document.querySelector('#bt .br-ask-yes').click()`); await sleep(800);
  say(await ev(`document.querySelector('#bt .bt-win').classList.contains('br-on')&&!document.querySelector('#bt .br-ask')`), `${w} rule 16c: "stay in brainrot" switches it on`);
  // 16d (operator, 5.11. night: "on a reload the phone shows the washing machine at once — the notice should come again"):
  // after "stay", a reload asks again and nothing of the look shows before the answer (no costume, no layer)
  await send('Page.navigate', { url: BASE + '/?x=1&t=' + Date.now() });
  let early = 0; for (let i = 0; i < 20; i++) { await sleep(250); early += await ev(`document.querySelectorAll('#bt .br-st,#bt .br-r,#bt .br-stage').length`).catch(() => 0); }
  await settled(); await sleep(800);
  const a4 = await ev(`[!!document.querySelector('#bt .br-ask'),document.querySelector('#bt .bt-win').classList.contains('br-on'),document.querySelectorAll('#bt .br-st,#bt .br-r').length].join('/')`);
  say(a4 === 'true/false/0' && early === 0, `${w} rule 16d: after "stay" a reload asks again, nothing shows before the answer`, a4 + ' early ' + early);
  await ev(`try{localStorage.removeItem('bt-br')}catch{}`);
}
// 5: ?br=0 leaves no trace; the season
await go('br=0', 1440, 900, false); await settled(); await sleep(800);
say(await ev(`!document.querySelector('#bt .br')&&!document.querySelector('#bt-br')`), 'rule 5: ?br=0 leaves no layer and no switch');
// 10: his own brainrot lines: at least five, none names a move (the page's own LINE_MOVES are not exported: the words of
// his moves are checked against the list variety.mjs reads, __btLines, when there is one; else each line is spoken once)
await go('br=1', 1440, 900, false); await settled(); await sleep(1500);
const ln = JSON.parse(await ev(`JSON.stringify({n:__btBr.lines.length,eng:__btBr.lines.every(l=>/^[\\x20-\\x7E·—']+$/.test(l))})`));
say(ln.n >= 5 && ln.eng, 'rule 10: his brainrot lines: five or more, plain English', JSON.stringify(ln));
const season = await ev(`typeof __btBrSeason!=='function'?'none':JSON.stringify([Date.UTC(2026,10,4,23,59),Date.UTC(2026,10,5),Date.UTC(2026,10,30,23,59),Date.UTC(2026,11,1),Date.UTC(2027,10,10)].map(t=>__btBrSeason(t)))`);
say(season === '[false,true,true,false,false]', 'rule 5b: season = 5 Nov until 1 Dec 2026 00:00 UTC', season);
console.log(`brainrot: ${pass} PASS, ${fail} FAIL`);
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} } process.exit(fail ? 1 : 0);
