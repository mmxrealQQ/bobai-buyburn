// THE ECOSYSTEM, A TO Z (2026-10-14, operator: "optimise everything, above all the ecosystem — function and layout, A to
// Z"). Every page a visitor can reach, on a phone and a wide screen, loaded in a real browser and read after it settled:
//   load       the page answers 200
//   script     no exception and no console error on the page
//   requests   no request to our own origins failed (4xx/5xx)
//   overflow   nothing pushes the page wider than the screen
//   images     no image that finished loading is broken
//   text       no "NaN", "undefined", "[object Object]", "Infinity" or "null%" where a figure should be
// usage: node scripts/dashboard-check/ecosystem-az.mjs [base=https://brainonbnb.com]   PAGES=/,/defi  SIZES=390x844m,1440x900
// exit 1 on any FAIL. One headless Chrome, pages in turn (a 4 GB laptop).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const PAGES = (process.env.PAGES || '/,/classic,/scanner,/registry,/screener,/services,/defi,/nft,/brainscreener/,/worldcup/,/game/,/token,/faq,/roadmap,/library,/archive,/advantage,/session,/set-and-earn,/source,/whitepaper,/agent/302257,/list').split(',');
const SIZES = (process.env.SIZES || '390x844m,1440x900').split(',');
const SETTLE = Number(process.env.SETTLE || 9000);
const OURS = /(^|\.)brainonbnb\.com$|bobai-dashboard\.pages\.dev$|bobai-lab\.pages\.dev$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-az-'));
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; let errs = [], bad = [], docStatus = null, docUrl = '';
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0].slice(0, 160));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console: ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160));
  if (d.method === 'Network.responseReceived') { const r = d.params.response, u = new URL(r.url);
    if (d.params.type === 'Document' && r.url.startsWith(docUrl.split('?')[0].replace(/\/$/, ''))) docStatus = docStatus ?? r.status;
    if (r.status >= 400 && OURS.test(u.hostname)) bad.push(r.status + ' ' + u.pathname.slice(0, 90)); } };
const ev = async (src) => (await send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
let pass = 0, fail = 0;
const say = (ok, what, more = '') => { if (!ok || process.env.VERBOSE) console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
for (const s of SIZES) {
  const [w, h] = s.replace('m', '').split('x').map(Number), mob = s.endsWith('m');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
  for (const p of PAGES) {
    const tag = `[${w}] ${p}`; errs = []; bad = []; docStatus = null; docUrl = BASE + p;
    await send('Page.navigate', { url: BASE + p });
    await sleep(SETTLE);
    // scroll once to the bottom and back, so lazy blocks and images get their turn
    await ev('(async()=>{const H=document.documentElement.scrollHeight;for(let y=0;y<H;y+=innerHeight){scrollTo(0,y);await new Promise(r=>setTimeout(r,120))}scrollTo(0,0)})()'); await sleep(1500);
    const g = await ev(`(()=>{const t=document.body?document.body.innerText:'';const junk=(t.match(/\\bNaN\\b|\\bundefined\\b|\\[object Object\\]|\\bInfinity\\b|\\bnull%/g)||[]);
      const ctx=junk.length?t.slice(Math.max(0,t.search(/\\bNaN\\b|\\bundefined\\b|\\[object Object\\]|\\bInfinity\\b|\\bnull%/)-60),t.search(/\\bNaN\\b|\\bundefined\\b|\\[object Object\\]|\\bInfinity\\b|\\bnull%/)+40).replace(/\\n/g,' '):'';
      const imgs=[...document.images].filter(i=>i.complete&&i.naturalWidth===0&&i.getAttribute('src')&&!i.src.startsWith('data:')).map(i=>i.getAttribute('src').slice(0,80));
      const nav=performance.getEntriesByType('navigation')[0];
      return {sw:document.documentElement.scrollWidth,iw:innerWidth,junk:junk.length,ctx,imgs,len:t.length,status:nav?nav.responseStatus:null}})()`);
    const st = g && g.status ? g.status : docStatus; // the browser's own record of the page's answer
    say(st === 200, tag + ' load', 'status ' + st);
    say(!errs.length, tag + ' script', errs.slice(0, 3).join(' | '));
    say(!bad.length, tag + ' requests', [...new Set(bad)].slice(0, 4).join(' | '));
    say(g && g.sw <= g.iw + 1, tag + ' overflow', g ? g.sw + ' px wide on a ' + g.iw + ' px screen' : 'no reading');
    say(g && !g.imgs.length, tag + ' images', g ? g.imgs.slice(0, 3).join(' | ') : '');
    say(g && !g.junk, tag + ' text', g ? g.junk + 'x: …' + g.ctx + '…' : '');
  }
}
console.log(`ecosystem-az: ${pass} PASS, ${fail} FAIL (${PAGES.length} pages × ${SIZES.length} sizes)`);
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} } process.exit(fail ? 1 : 0);
