// THE APP BAR ON EVERY SUB-PAGE AND EVERY SCREEN (2026-11-03, operator: "so einfach wie pokter, marque, mandate").
// scripts/deploy-dashboard.mjs (ecoNav) writes one bar into every sub-page: logo, the six apps, the page's name.
// Each page is opened at a folded cover screen, phones, a foldable, iPads and desktops. FAIL when: the bar is missing,
// the page is wider than the screen, the bar is taller than one line, the left part runs into the buttons on the
// right, on a wide screen an app link wraps or is hidden, the open app is not lit exactly once, or on a narrow screen
// the "Apps" menu does not open inside the screen with all seven entries.
// usage: node ecobar.mjs [base]   (default https://brainonbnb.com)   exit 1 on any FAIL
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const PAGES = process.env.PAGES ? process.env.PAGES.split(',') : ['/scanner', '/registry', '/board', '/services', '/defi', '/token', '/faq', '/roadmap', '/archive', '/library', '/jobs', '/agent', '/advantage', '/list', '/pass', '/screener', '/venus', '/settle', '/session', '/set-and-earn', '/pancakeswap', '/nft/', '/does-not-exist']   // /nft/ since 3.11.: its own stylesheet, the bar from eco.css;
const APPS = ['/scanner', '/registry', '/board', '/services', '/defi', '/agent', '/nft/'];   // /agent is the Plaza's agent chart: Plaza is lit there
const SIZES = [[344, 882, 1], [360, 780, 1], [390, 844, 1], [430, 932, 1], [673, 841, 1], [768, 1024, 1], [1024, 768, 0], [1180, 820, 0], [1366, 768, 0], [1920, 1080, 0]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9400 + Math.floor(Math.random() * 400), prof = 'D:/ai/fourmeme/temp/newpage/qa/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
const JS = `(async()=>{const W=innerWidth,o={};const l=document.querySelector('.eco-l');if(!l)return JSON.stringify({missing:1});
const nav=document.querySelector('nav');o.navH=nav.getBoundingClientRect().height;o.sw=document.documentElement.scrollWidth;o.W=W;
const lr=l.getBoundingClientRect();const right=[...l.parentElement.children].filter(e=>e!==l);
o.gap=right.length?Math.min(...right.map(e=>e.getBoundingClientRect().left))-lr.right:99;
o.rightEdge=Math.max(...[...nav.querySelectorAll('a,summary')].map(e=>e.getBoundingClientRect().right));
const links=[...l.querySelectorAll('.eco-links a')].map(a=>({t:a.getBoundingClientRect().top,h:a.offsetParent!==null,w:a.getBoundingClientRect().width}));
o.linksShown=links.filter(x=>x.h&&x.w>0).length;o.linkTops=[...new Set(links.filter(x=>x.h).map(x=>Math.round(x.t)))].length;
o.lit=l.querySelectorAll('.eco-links a.on').length;
const here=l.querySelector('.eco-here');const hr=here.getBoundingClientRect();o.hereShown=here.offsetParent!==null&&hr.width>8;
const d=l.querySelector('.eco-m');o.appsShown=d.offsetParent!==null&&d.getBoundingClientRect().width>0;
if(o.appsShown){d.open=true;await new Promise(r=>setTimeout(r,250));const m=d.querySelector('.eco-menu').getBoundingClientRect();
o.menu={l:m.left,r:m.right,b:m.bottom,n:[...d.querySelectorAll('.eco-menu a')].filter(a=>a.getBoundingClientRect().height>20).length};d.open=false;}
return JSON.stringify(o)})()`;
let fails = 0, passes = 0;
const bad = (what) => { fails++; console.log('FAIL ' + what); };
for (const p of PAGES) {
  for (const [w, h, mob] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mob });
    await send('Page.navigate', { url: base + p + '?r=' + Date.now() });
    await sleep(3200);
    const r = await send('Runtime.evaluate', { expression: JS, awaitPromise: true, returnByValue: true, timeout: 20000 });
    let o; try { o = JSON.parse(r.result?.result?.value); } catch { bad(`${p} @${w}: page did not answer`); continue; }
    const at = `${p} @${w}x${h}`;
    if (o.missing) { bad(`${at}: no app bar`); continue; }
    const f0 = fails;
    if (o.sw > o.W + 1) bad(`${at}: page ${o.sw} px wide on a ${o.W} px screen`);
    if (o.navH > 62) bad(`${at}: bar ${o.navH} px tall (more than one line)`);
    if (o.gap < 6) bad(`${at}: the left part runs into the buttons (gap ${o.gap.toFixed(0)} px)`);
    if (o.rightEdge > o.W + 0.5) bad(`${at}: a bar button ends at ${o.rightEdge.toFixed(0)} px, past the screen`);
    if (w > 980) {
      if (o.linksShown !== 6 || o.linkTops !== 1) bad(`${at}: ${o.linksShown}/6 app links shown on ${o.linkTops} line(s)`);
      if (o.lit !== (APPS.includes(p) ? 1 : 0)) bad(`${at}: ${o.lit} app(s) lit`);
      if (!APPS.includes(p) && !o.hereShown) bad(`${at}: the page's own name is not shown`);
      if (o.appsShown) bad(`${at}: the phone menu shows on a wide screen`);
    } else {
      if (!o.appsShown) bad(`${at}: no Apps menu`);
      else if (o.menu.l < 0 || o.menu.r > o.W || o.menu.b > h || o.menu.n !== 7) bad(`${at}: menu ${JSON.stringify(o.menu)}`);
      if (o.linksShown) bad(`${at}: ${o.linksShown} app links squeezed into a narrow bar`);
      if (!o.hereShown) bad(`${at}: the page's own name is not shown`);
    }
    if (fails === f0) passes++;
  }
  console.log(`  ${p} done`);
}
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(600); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
console.log(`\n${passes} PASS, ${fails} FAIL (${PAGES.length} pages x ${SIZES.length} screens, ${base})`);
process.exit(fails ? 1 : 0);
