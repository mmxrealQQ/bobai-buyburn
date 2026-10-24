// 04 ECOSYSTEM, fewer and current (operator, 2026-10-19: "übersichtlicher, weniger, dafür das richtige und aktuell"):
// five cards (DeFi Agent, Pool Scanner, Brain Plaza, Agent Services, NFT Buy Drops), the three side apps as one line
// under them ("Also built here"), each link answering and its logo loaded; the Services card says other agents pay
// (no "first income" any more), no "Eight apps" anywhere; the Brain page's 04 tile shows the five logos and
// "5 apps & tools"; a side app opened from the line gets its own logo in the window's head, not the BOBAI logo.
// usage: node eco5.mjs [base]   (default the go-live preview)   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
const base = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 40), prof = process.cwd() + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
// six since 2026-10-24 (0aeb882, c95c55b): the Brain Board moved into the apps, in two rows of three at 1440 px
const CARDS = ['/scanner', '/registry', '/board', '/services', '/defi', '/nft/'];
const ALSO = ['/brainscreener/', '/game/', '/worldcup/'];

for (const [W, H, mob] of [[1440, 900, 0], [390, 844, 1]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mob });
  // Classic: the block itself
  await send('Page.navigate', { url: base + '/classic?r=' + Date.now() }); await sleep(5000);
  await ev(`document.querySelectorAll('.ec-also img,.ec img').forEach(i=>{i.loading='eager'});document.getElementById('ecosystem')?.scrollIntoView()`); await sleep(2500);
  await sleep(4000);   // the live figures arrive after the page
  const c = JSON.parse(await ev(`JSON.stringify({cards:[...document.querySelectorAll('.ecg:not(.ecg3):not(.ecg4) a.ec')].map(a=>new URL(a.href).pathname),
    tops:[...document.querySelectorAll('.ecg:not(.ecg3):not(.ecg4) a.ec')].map(a=>Math.round(a.getBoundingClientRect().top)),
    lens:[...document.querySelectorAll('.ecg:not(.ecg3):not(.ecg4) a.ec p')].map(p=>p.textContent.trim().length),
    live:Object.fromEntries([...document.querySelectorAll('.ecg:not(.ecg3):not(.ecg4) [data-eclive]')].map(e=>[e.dataset.eclive,e.textContent.trim()])),
    also:[...document.querySelectorAll('.ec-more a.ec-also')].map(a=>({p:new URL(a.href).pathname,img:(a.querySelector('img')||{}).naturalWidth||0,t:a.textContent.trim()})),
    label:(document.querySelector('.ec-more>span')||{}).textContent||'', services:(document.querySelector('.ecg:not(.ecg3):not(.ecg4) a.ec[href="/services"] p')||{}).textContent||'',
    text:document.body.innerText, wide:document.documentElement.scrollWidth<=innerWidth+1})`));
  say(JSON.stringify([...c.cards].sort()) === JSON.stringify([...CARDS].sort()), `${W} classic: the six cards (${c.cards.join(', ')})`);
  say(c.label === 'Also built here' && JSON.stringify(c.also.map((a) => a.p)) === JSON.stringify(ALSO), `${W} classic: the line names the three side apps (${c.also.map((a) => a.t).join(' · ')})`);
  say(c.also.length === 3 && c.also.every((a) => a.img > 0), `${W} classic: each side app's logo is loaded (${c.also.map((a) => a.img).join('/')})`);
  // one sentence, one live figure a card (operator, 19.10.: "viel einfacher, viel weniger, dafür das wichtigste")
  say(c.lens.length === 6 && Math.max(...c.lens) <= 80, `${W} classic: one short sentence a card (${c.lens.join('/')} characters)`);
  if (W >= 1400) say(new Set(c.tops).size === 2 && c.tops.filter((t) => t === c.tops[0]).length === 3, `${W} classic: two rows of three (${c.tops.join('/')})`);
  const L = c.live;
  say(/^[\d,]+ agents answer$/.test(L.plaza || '') && /^[\d,]+ answers paid by agents$/.test(L.services || '') && /^CAKE\/BNB (in|out of) range/.test(L.defi || '') && /^[\d,]+ of 1,925 minted$/.test(L.nft || '') && !!L.scanner,
    `${W} classic: each card's live figure ("${Object.values(L).join('" · "')}")`);
  say(!/first income/.test(c.text), `${W} classic: nothing promises a "first income"`);
  say(!/Eight apps/.test(c.text), `${W} classic: no "Eight apps"`);
  say(c.wide, `${W} classic: nothing runs sideways`);
  // Brain page: the 04 tile and a window opened from the line
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(12000);
  const t = JSON.parse(await ev(`JSON.stringify({apps:[...document.querySelectorAll('button[data-open="w04"] .cv-app')].map(a=>a.textContent.trim()),v:(document.querySelector('[data-open="w04"] .bw-v')||{}).textContent||''})`));
  say(t.apps.length === 6 && t.v === '6 apps & tools', `${W} brain: the 04 tile shows six logos (${t.apps.join(', ')}) and "${t.v}"`);
  const opened = await ev(`(()=>{const a=document.querySelector('#w04 a.ec-also[href="brainscreener/"]');if(!a)return 'no link in the window';a.click();return 'ok'})()`);
  let head = '';
  for (let k = 0; k < 15 && !/brainscreener/.test(head); k++) { await sleep(800); head = await ev(`(()=>{const w=document.getElementById('wpage');const i=w&&w.querySelector('.pg-k img');return (w&&!w.hidden?'open ':'closed ')+(i?i.getAttribute('src'):'(svg or none)')})()`) || ''; }
  say(opened === 'ok' && /^open .*ico-brainscreener/.test(head), `${W} brain: brainScreener from the line opens its window with its own logo (${opened}; ${head})`);
}
ws.close(); ch.kill(); await sleep(800); try { (await import('node:fs')).rmSync(prof, { recursive: true, force: true }); } catch {}
for (const p of ALSO) { const r = await fetch(base + p, { redirect: 'manual' }); say(r.status === 200, `${p} answers (${r.status})`); }
console.log(fails ? `FAIL  ${fails}` : 'PASS  04 is six cards and one line, current, every link and logo working');
process.exit(fails ? 1 : 0);
