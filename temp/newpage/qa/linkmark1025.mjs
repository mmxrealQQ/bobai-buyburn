// (linkmark1025, 2026-10-25, A-Z pass) a text link ends with its text: no drawn mark after it. From 5.9. to 25.10. the
// link system's arrow (styles.css ::after) never drew — its SVG namespace read https:// — and left an empty gap after
// every link; drawn at last it doubled the arrows already written ("tx ↗ →") and put one after every footer word. The
// operator knows the site without it, so it went. Checks every text link on the main pages at 1280 px.
// usage: node linkmark1025.mjs [base]   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const pages = ['/', '/pass', '/services', '/defi', '/jobs', '/settle', '/registry', '/board', '/scanner'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9700 + Math.floor(Math.random() * 200), prof = import.meta.dirname + '/prof-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
let fails = 0;
for (const p of pages) {
  await send('Page.navigate', { url: base + p + '?r=' + Date.now() }); await sleep(7000);
  const r = JSON.parse((await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>{const a=[...document.querySelectorAll('a:not([class])')].filter(x=>!x.querySelector('img,svg,picture'));const w=a.filter(x=>{const c=getComputedStyle(x,'::after');return c.content!=='none'&&c.content!=='normal'&&parseFloat(c.width)>0});return {n:a.length,w:w.length,ex:w.slice(0,3).map(x=>x.textContent.trim().slice(0,30))}})())` })).result.result.value);
  const ok = r.n > 0 && r.w === 0; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}: ${r.n} text links, ${r.w} with a drawn mark after them${r.w ? ' — ' + r.ex.join(' | ') : ''}`);
}
console.log(fails ? `FAIL  ${fails}` : 'PASS  no text link carries a drawn mark');
ws.close(); ch.kill(); for (let i = 0; i < 10; i++) { await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch {} }
process.exit(fails ? 1 : 0);
