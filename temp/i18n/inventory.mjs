// Arabic A-Z (8.11.2026) step 1: every visible English text on every page, as the browser shows it after load.
// Numbers, amounts, addresses and times become placeholders so "12 h ago" and "3 h ago" count once.
// Usage: node inventory.mjs [origin]  -> temp/i18n/inventory.json + a summary
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const PAGES = ['/', '/classic', '/token', '/faq', '/pop', '/scanner', '/registry', '/list', '/services', '/defi', '/library', '/whitepaper',
  '/advantage', '/session', '/source', '/roadmap', '/archive', '/screener', '/board', '/connect', '/jobs', '/pass', '/pancakeswap', '/venus',
  '/settle', '/set-and-earn', '/agent', '/nft', '/buy'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9800 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-inv-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// every text node (also in closed windows: hidden text is still text to translate) + the attributes a reader sees
const GRAB = `(() => {
  const out = [], skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'svg', 'SVG']);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const p = n.parentElement; if (!p || p.closest('script,style,noscript,code,pre,svg')) continue; const t = n.nodeValue.replace(/\\s+/g, ' ').trim(); if (/[A-Za-z]{2}/.test(t)) out.push(t); }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],img[alt]')) for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const t = (el.getAttribute(a) || '').trim(); if (/[A-Za-z]{2}/.test(t)) out.push(t); }
  out.push(document.title); const d = document.querySelector('meta[name=description]'); if (d) out.push(d.content);
  return out;
})()`;
const norm = (t) => t.replace(/0x[0-9a-fA-F]{6,}/g, '{addr}').replace(/0x[0-9a-fA-F]{2,}…[0-9a-fA-F]{2,}/g, '{addr}').replace(/[$≈~]?\d[\d,.]*\s?[KMBk%]?/g, '{n}');
const all = new Map(), per = {};
for (const p of PAGES) {
  await send('Page.navigate', { url: base + p + (p.includes('?') ? '&' : '?') + 'r=' + Date.now() }); await sleep(p === '/' || p === '/classic' ? 14000 : 7000);
  const got = (await ev(GRAB)) || []; const keys = new Set(got.map(norm));
  per[p] = { texts: keys.size, words: [...keys].reduce((s, k) => s + k.split(/\s+/).length, 0) };
  for (const k of keys) { const e = all.get(k) || { pages: [] }; e.pages.push(p); all.set(k, e); }
  console.log(p, per[p].texts, 'texts', per[p].words, 'words');
}
const list = [...all.entries()].map(([t, e]) => ({ t, pages: e.pages }));
fs.writeFileSync(new URL('./inventory.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), base, per, list }, null, 1));
const words = list.reduce((s, x) => s + x.t.split(/\s+/).length, 0);
console.log(`\nunique texts ${list.length}, words ${words}`);
ws.close(); ch.kill(); process.exit(0);
