// Arabic A-Z: the dictionary KEYS a page needs, exactly as core.js makes them (figures/amounts/addresses -> {n}).
// Loads the English page in headless Chrome, waits, reads every text node + the attributes a reader sees + title +
// meta description, and lists the keys that ar.json does not have yet.
// Usage: node keys.mjs <origin> <path> [path...]   -> prints JSON {path: [missing keys]} and writes temp/i18n/todo.json
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const [base0, ...paths] = process.argv.slice(2);
const base = base0.replace(/\/$/, '');
const core = fs.readFileSync('D:/ai/fourmeme/dashboard/i18n/core.js', 'utf8').replace(/^export /gm, '');
const dict = JSON.parse(fs.readFileSync('D:/ai/fourmeme/dashboard/i18n/ar.json', 'utf8')).t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9840 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-keys-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const GRAB = `(() => { ${core}
  const out = new Set(), SKIP = 'script,style,noscript,code,pre,textarea,svg,[translate="no"],.notranslate,[data-noar],#bt';
  const add = (t) => { const k = keyOf(t); if (k) out.add(k.key); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const p = n.parentElement; if (p && !p.closest(SKIP)) add(n.nodeValue); }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],img[alt]')) if (!el.closest(SKIP)) for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v) add(v); }
  add(document.title); for (const s of ['meta[name=description]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]']) { const m = document.querySelector(s); if (m) add(m.content); }
  return [...out];
})()`;
const res = {};
for (const p of paths) {
  await send('Page.navigate', { url: base + p + (p.includes('?') ? '&' : '?') + 'r=' + Date.now() }); await sleep(p === '/' || p === '/classic' ? 14000 : 8000);
  const keys = (await ev(GRAB)) || [];
  res[p] = keys.filter((k) => dict[k] == null);
  console.error(p, keys.length, 'keys,', res[p].length, 'missing');
}
fs.writeFileSync('D:/ai/fourmeme/temp/i18n/keys-todo.json', JSON.stringify(res, null, 1));
ws.close(); ch.kill(); process.exit(0);
