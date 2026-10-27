// EVERY APP CARD OPENS IN THE WINDOW (2026-10-27, operator: "das neue PancakeSwap-Tool kommt nicht im Popup"): the front
// page opens a page in its window only when brain.js and embed.js list it (PAGES); /pancakeswap was not listed and left
// the page instead. Clicks every same-site card of the 04 window (apps and "for every agent") on the Brain page and
// wants each one in the page window, framed at its own path, with its name in the title bar.
// usage: node popup1027.mjs [base]   (default https://brainonbnb.com)   exit 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9840 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-popup-' + port;
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, '--user-agent=brainonbnb-test', 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const until = async (x, ms = 15000) => { for (let t = 0; t < ms; t += 300) { if (await ev(x)) return true; await sleep(300); } return false; };
await send('Page.navigate', { url: base + '/?r=' + Date.now() });
await until(`document.querySelectorAll('#w04 a.ec').length > 0`);
await sleep(1500);
const hrefs = JSON.parse(await ev(`JSON.stringify([...new Set([...document.querySelectorAll('#w04 a.ec')].map(a=>a.getAttribute('href')).filter(h=>h&&!/^(https?:)?\\/\\//.test(h)&&!h.startsWith('#')))])`));
say(hrefs.includes('/pancakeswap'), `the 04 window holds the PancakeSwap card (${hrefs.length} same-site cards)`);
for (const h of hrefs) {
  await ev(`(()=>{const x=document.querySelector('#wpage .bw-x');const w=document.getElementById('wpage');if(w&&!w.hidden&&x)x.click()})()`);
  await sleep(500);
  const before = await ev('location.href');
  await ev(`document.querySelector('#w04 a.ec[href="${h}"]').click()`);
  const path = new URL(h, base).pathname.replace(/\/$/, '');
  const ok = await until(`(()=>{const w=document.getElementById('wpage'),f=w&&w.querySelector('.pg-f');if(!w||w.hidden||!f)return false;
    let p='';try{p=f.contentWindow.location.pathname}catch{};p=(p||new URL(f.getAttribute('src')||'',location.href).pathname).replace(/\\/$/,'').replace(/\\.html$/,'');
    return p==='${path}'})()`, 12000);
  const stayed = (await ev('location.href')).split('#')[0].split('?')[0] === before.split('#')[0].split('?')[0];
  const title = await ev(`document.querySelector('#wpage .pg-t')?.textContent||''`);
  say(ok && stayed && title && title !== 'Page', `${h} opens in the window ("${title}")${stayed ? '' : ' — the front page was left'}`);
}
ws.close(); ch.kill(); await sleep(800);
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
