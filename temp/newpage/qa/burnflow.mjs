// A BURN, IN ONE FLOW (2026-10-17, operator after a live burn: "the animations and bubbles were not readable to the end,
// cut off or jumped straight to the next one instead of everything slowly in its place"): a burn played the way a live
// visitor gets it (__btTestBurnLive: the tax swap's answer, the run through the queue, the DeFi share after it), every
// frame recorded, then judged:
//   1 every bubble is typed to its last letter and stays readable after it (22 ms a letter + 2.6 s, like speak())
//   2 no take is left before its end (a clip that changes with more than 0.3 s left = cut)
//   3 every board stays up for its hold (the tier's 5.2-9 s) before another one replaces it
//   4 the bubble never lies over the board or its title · 5 a line never jumps up while it is read (2026-10-27)
// usage: node burnflow.mjs [url] [runs]   MOBILE=1 for a phone   GAP=12 (s from the tax swap to the run)
//   TALK=1: he says a line of his own 0.4 s before the run arrives (the cut found on the phone, every time)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/').replace(/\/?$/, '/'), RUNS = +(process.argv[3] || 1);
const MOB = process.env.MOBILE === '1', GAP = +(process.env.GAP || 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
// every frame: the bubble (shown, its text), the take (name, time, length), the board (title, up)
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__bf=[];(function f(){const b=document.querySelector('#bt .say'),m=document.querySelector('#bt .moment'),v=window.__btVid&&__btVid();
const seen=b&&b.classList.contains('on')&&+getComputedStyle(b).opacity>0.5,R=e=>e&&e.offsetParent!==null&&+getComputedStyle(e).opacity>0.3?e.getBoundingClientRect():null,bb=seen&&b.getBoundingClientRect(),hit=bb&&[m&&m.classList.contains('go')&&R(m.querySelector('.flip:not([hidden])')),m&&m.classList.contains('go')&&R(m.querySelector('.h'))].some(o=>o&&o.width&&bb.left<o.right-2&&bb.right>o.left+2&&bb.top<o.bottom-2&&bb.bottom>o.top+2);
if(hit)window.__bfHit=(window.__bfHit||0)+1;{const go=!!(m&&m.classList.contains('go'));if(seen){const tp=Math.round(bb.top),txt=b.textContent,pv=window.__bfSay,same=pv&&txt.startsWith(pv.txt.slice(0,20)),gt=go?tp:(same?pv.goTop:null);if(same&&!go&&pv.goTop!=null&&tp<pv.goTop-20){window.__bfJump=(window.__bfJump||0)+1;window.__bfSay={txt,top:tp,goTop:null}}else window.__bfSay={txt,top:tp,goTop:gt}}else window.__bfSay=null}
const r=[Math.round(performance.now()),seen?b.textContent:null,v?v[0]:null,v?v[1]:0,v?v[3]:0,m&&m.classList.contains('go')?(m.querySelector('.h')||{}).textContent:null];
const l=window.__bf[window.__bf.length-1];if(!l||r.slice(1).some((x,i)=>i!==2&&x!==l[i+1])||Math.abs(r[3]-l[3])>0.2)window.__bf.push(r);requestAnimationFrame(f)})();` });
await send('Emulation.setDeviceMetricsOverride', MOB ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '?hw=0&r=' + Date.now() });
await sleep(40000); // past the greeting
let fails = 0;
for (let k = 0; k < RUNS; k++) {
  const t0 = await ev('performance.now()');
  const what = await ev(`window.__btTestBurnLive ? window.__btTestBurnLive(${GAP}, ${process.env.TALK === "1"}) : 'NO HOOK'`);
  console.log(`run ${k + 1}: tax swap, then the burn after ${GAP} s, then: ${what}`);
  // SHOTS=<dir>: a picture every 0.6 s from the run's arrival for 22 s, to look at what the numbers say
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true }); await sleep(GAP * 1000 - 500);
    for (let i = 0; i < 37; i++) { const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.writeFileSync(`${process.env.SHOTS}/r${k}-${String(i).padStart(2, '0')}.jpg`, Buffer.from(s.result.data, 'base64')); await sleep(600); }
    await sleep(52000);
  } else await sleep(GAP * 1000 + 75000);
  const F = JSON.parse(await ev('JSON.stringify(window.__bf)')).filter((r) => r[0] >= t0);
  const out = [];
  // 1 bubbles: an episode is one line growing letter by letter; it ends when the bubble closes or a new line begins
  let ep = null; const eps = [];
  for (const [t, txt] of F) {
    if (txt && ep && txt.startsWith(ep.txt.slice(0, Math.min(ep.txt.length, txt.length))) && txt.length >= ep.txt.length) { if (txt.length > ep.txt.length) { ep.txt = txt; ep.full = t; } continue; }
    if (txt && ep && ep.txt.startsWith(txt)) continue; // the same line, a frame behind
    if (ep) { ep.end = t; eps.push(ep); ep = null; }
    if (txt) ep = { t, full: t, txt };
  }
  if (ep) { ep.end = F.at(-1)[0]; ep.open = true; eps.push(ep); }
  for (const e of eps) {
    const need = e.txt.length * 22 + 2600, shown = e.end - e.t, after = e.end - e.full;
    const ok = e.open || shown >= need - 300;
    if (!ok) fails++;
    out.push(`${ok ? 'PASS' : 'FAIL'} bubble ${(shown / 1000).toFixed(1)} s (needs ${(need / 1000).toFixed(1)}), ${(after / 1000).toFixed(1)} s after the last letter: "${e.txt.slice(0, 70)}${e.txt.length > 70 ? '…' : ''}"`);
  }
  // 1b his line about the burn is seen at all (it was hidden behind the board, 2026-10-17)
  const burnSeen = eps.some((e) => e.t - t0 >= GAP * 1000 - 500 && e.t - t0 < GAP * 1000 + 20000 && e.end - e.t >= 2500);
  if (!burnSeen) fails++; out.push(`${burnSeen ? 'PASS' : 'FAIL'} a line seen with the burn (2.5 s or more within 20 s of its arrival)`);
  // 2 takes: a change of take while the old one had more than 0.3 s left
  for (let i = 1; i < F.length; i++) {
    const [t, , c, ct, cd] = F[i], [, , p, pt, pd] = F[i - 1];
    if (c && p && c !== p) {
      const left = pd - pt, cut = left > 0.5 && !/^rest/.test(p);
      if (cut) fails++;
      if (!/^rest/.test(c) || cut) out.push(`${cut ? 'FAIL' : 'PASS'} take ${p} -> ${c} at +${((t - t0) / 1000).toFixed(1)} s (${left.toFixed(1)} s of ${p} left)`);
    }
  }
  // 3 boards: each title up for its hold
  let bd = null;
  for (const [t, , , , , h] of F) {
    if (h !== (bd && bd.h)) { if (bd && bd.h) { const s = (t - bd.t) / 1000, ok = s >= 5.0; if (!ok) fails++; out.push(`${ok ? 'PASS' : 'FAIL'} board "${bd.h}" up ${s.toFixed(1)} s`); } bd = { h, t }; }
  }
  // 4 the bubble never lies over the board or its title (frames where both show and touch)
  const hit = await ev('window.__bfHit||0'); await ev('window.__bfHit=0');
  if (hit) fails++; out.push(`${hit ? 'FAIL' : 'PASS'} bubble over the board or its title in ${hit} frames`);
  // 5 one line stays where it stands when the board goes (2026-10-27: it jumped up mid-sentence); growing while typed is not a jump
  const jump = await ev('window.__bfJump||0'); await ev('window.__bfJump=0');
  if (jump) fails++; out.push(`${jump ? 'FAIL' : 'PASS'} a line that jumps up while it is read: ${jump}`);
  for (const l of out) console.log('  ' + l);
}
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
console.log(fails ? `FAIL ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
