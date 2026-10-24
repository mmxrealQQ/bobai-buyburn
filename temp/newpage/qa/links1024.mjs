// LINKS1024 (2026-10-24, operator: "wenn ich auf the Brain Board clicke im Brain Plaza geht kein Link auf"; "du musst Detailfehler von alleine finden").
// Every link on the main pages, after their scripts ran, and what each answers. Ours (brainonbnb.com, agent.brainonbnb.com)
// must answer 2xx (a redirect is followed); outside sites may answer 2xx/3xx, or 401/403/405/429 (a bot wall, not a dead link).
import { spawn } from 'node:child_process';
import os from 'node:os';
const PAGES = ['/', '/board', '/registry', '/services', '/settle', '/defi', '/token', '/jobs', '/scanner', '/faq', '/whitepaper', '/library', '/source', '/classic', '/agent/363709', '/nft', '/roadmap'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9960 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-lc-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = {};
let cur = '';
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') (errs[cur] = errs[cur] || []).push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const found = new Map();   // url -> [pages]
for (const p of PAGES) {
  cur = p;
  await send('Page.navigate', { url: 'https://brainonbnb.com' + p }); await sleep(7000);
  const hrefs = await ev(`[...document.querySelectorAll('a[href]')].map(a=>a.href)`) || [];
  for (const h of hrefs) {
    if (!/^https?:/.test(h)) continue;
    const u = h.replace(/#.*$/, '');
    if (!found.has(u)) found.set(u, new Set());
    found.get(u).add(p);
  }
}
ws.close(); ch.kill();
const ours = (u) => /^https:\/\/(www\.)?(agent\.)?brainonbnb\.com\b/.test(u);
const urls = [...found.keys()];
console.log(`${PAGES.length} pages, ${urls.length} distinct links (${urls.filter(ours).length} ours)`);
const bad = [];
const check = async (u) => {
  const own = ours(u);
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(u, { method: 'GET', redirect: 'follow', headers: { 'user-agent': own ? 'brainonbnb-linkcheck' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' }, signal: AbortSignal.timeout(25000) });
      // /tip answers 402 by design: a pay link for agents (x402)
      // (2026-10-24) a checkup page answers 429 by design past 20 different agents a day from one address — this checker
      // opens every agent's checkup the board links
      const ok = own ? (r.status >= 200 && r.status < 300) || (r.status === 402 && u.includes('/tip')) || (r.status === 429 && /\/board\/agent\/\d+$/.test(u)) : (r.status < 400 || [401, 403, 405, 429].includes(r.status));
      if (ok) return;
      if (a === 1) bad.push([r.status, u]);
    } catch (e) { if (a === 1) bad.push(['ERR ' + String(e.name || e).slice(0, 30), u]); }
    await sleep(800);
  }
};
for (let i = 0; i < urls.length; i += 8) await Promise.all(urls.slice(i, i + 8).map(check));
for (const [s, u] of bad.sort((a, b) => (ours(b[1]) - ours(a[1])))) console.log(`${ours(u) ? 'OURS ' : 'OUT  '} ${String(s).padEnd(10)} ${u}  <- ${[...found.get(u)].join(' ')}`);
console.log(bad.length ? `${bad.length} links not answering as they should` : 'every link answers');
console.log('script errors:', Object.keys(errs).length ? JSON.stringify(errs) : 'none');
process.exit(bad.length || Object.keys(errs).length ? 1 : 0);
