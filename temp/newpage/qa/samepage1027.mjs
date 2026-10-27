// SAME-PAGE LINKS IN A WINDOW (2026-10-27, after the Brain Board's double ×). Every page the front page opens in its
// page window, loaded as the window loads it (?embed=1): a link that leads to the SAME page with another query reloads
// it, and in the window a reload is one more step the × walks back first — to what looks like the same page. Lists every
// such link (visible, same tab, left click); exit 1 when any is found. Hash-only links (#…) do not reload and are fine.
// usage: node samepage1027.mjs [base] [--list]   (default https://brainonbnb.com)
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'https://brainonbnb.com').replace(/\/$/, '');
const PAGES = ['/scanner', '/registry', '/services', '/defi', '/nft/', '/library', '/whitepaper', '/advantage', '/session', '/source', '/token', '/faq', '/roadmap', '/archive', '/list', '/screener', '/board', '/jobs', '/settle', '/venus', '/pass', '/set-and-earn', '/pancakeswap'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9800 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-same-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--user-agent=brainonbnb-test', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
// a link counts when it would reload this page: same origin, same path, a different query, opened in this tab
const SCAN = `JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>{
  const h=a.getAttribute('href');let u;try{u=new URL(h,location.href)}catch{return null}
  if(u.origin!==location.origin||a.target==='_blank'||a.hasAttribute('download'))return null;
  if(a.hasAttribute('data-inplace'))return null;   // the page handles the click itself, no reload (the board's agents, 27.10.)
  const norm=p=>p.replace(/\\.html$/,'').replace(/\\/$/,'')||'/';
  if(norm(u.pathname)!==norm(location.pathname))return null;
  const q=new URLSearchParams(u.search);q.delete('embed');const here=new URLSearchParams(location.search);here.delete('embed');
  if(q.toString()===here.toString())return null;   // only the hash differs: no reload
  return {href:h,text:(a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60),visible:!!(a.offsetWidth||a.offsetHeight)}
}).filter(Boolean))`;
let found = 0;
for (const p of PAGES) {
  await send('Page.navigate', { url: base + p + (p.includes('?') ? '&' : '?') + 'embed=1' });
  await sleep(7000);
  const links = JSON.parse((await ev(SCAN)) || '[]');
  const uniq = [...new Map(links.map((l) => [l.href, l])).values()];
  if (!uniq.length) { console.log(`ok    ${p}`); continue; }
  found += uniq.length;
  console.log(`FOUND ${p}: ${uniq.length}`);
  for (const l of uniq.slice(0, process.argv.includes('--list') ? 99 : 6)) console.log(`        ${l.visible ? '' : '(hidden) '}${l.href}  "${l.text}"`);
}
ws.close(); ch.kill(); await sleep(800);
console.log(found ? `\n${found} same-page link(s)` : '\nnone');
process.exit(found ? 1 : 0);
