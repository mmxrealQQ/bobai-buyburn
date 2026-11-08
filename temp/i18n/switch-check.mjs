// Arabic A-Z: the EN | ع switch, both ways, and the remembered choice. On an English page: the switch is there, ع leads
// to the same page under /ar/; an English page opened afterwards goes to its Arabic twin by itself; EN on an Arabic page
// goes back and stays English. Phone widths: the header keeps one row (no wrap).
// Usage: node switch-check.mjs [origin]
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://arabic.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9990 + Math.floor(Math.random() * 9), prof = os.tmpdir() + '/prof-sw-' + port + Date.now();
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const go = async (p, wait = 6000) => { await send('Page.navigate', { url: base + p }); await sleep(wait); return ev('location.pathname'); };
await go('/token');
say(await ev(`!!document.querySelector('.ar-sw a[data-lang=ar]')`), 'English /token has the switch');
await ev(`document.querySelector('.ar-sw a[data-lang=ar]').click()`); await sleep(6000);
say((await ev('location.pathname')) === '/ar/token', 'ع leads to /ar/token: ' + (await ev('location.pathname')));
say((await ev(`document.documentElement.lang`)) === 'ar', 'the page says lang="ar"');
say((await go('/faq')) === '/ar/faq', 'the choice is remembered: /faq opens as ' + (await ev('location.pathname')));
await ev(`document.querySelector('.ar-sw a[data-lang=en]').click()`); await sleep(6000);
say((await ev('location.pathname')) === '/faq', 'EN leads back to /faq: ' + (await ev('location.pathname')));
say((await go('/token')) === '/token', 'and English is remembered: /token stays ' + (await ev('location.pathname')));
for (const [w, h] of [[344, 882], [390, 844], [768, 1024]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  for (const p of ['/ar/', '/']) {
    await go(p + '?r=' + Date.now(), 9000);
    const r = await ev(`(() => { const s = document.querySelector('.ar-sw'); const hd = s && (s.closest('header, nav, .bp-top, .bp-head') || s.parentElement); if (!s) return null; const a = s.getBoundingClientRect(), b = hd.getBoundingClientRect(); return { on: a.width > 0 && a.right <= innerWidth + 1, oneRow: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
    say(r && r.on && r.oneRow && !r.wide, `${w}px ${p}: switch inside the screen and the header ${JSON.stringify(r)}`);
  }
}
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
