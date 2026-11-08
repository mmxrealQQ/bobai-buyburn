// ARABIC A-Z checker (2026-11-08): every /ar/ page on a host, desktop and phone. FAIL when
//  (1) a text the page shows has no Arabic entry (window.__arMiss, after the page drew its live figures and was scrolled),
//  (2) English words still stand on the page (a text node with Latin words that are not glossary names),
//  (3) the Arabic page is wider than the screen, or its header is taller than the English one (layout must stay),
//  (4) ar.js did not run.
// Writes the misses to temp/i18n/todo.json (for the next translation batch).
// Usage: node ar-check.mjs <origin> [path ...]   (default: every page)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const [base0, ...args] = process.argv.slice(2);
const base = (base0 || 'https://arabic.bobai-dashboard.pages.dev').replace(/\/$/, '');
const ALL = ['/', '/classic', '/token', '/faq', '/pop', '/scanner', '/registry', '/list', '/services', '/defi', '/library', '/whitepaper', '/advantage', '/session', '/source', '/roadmap', '/archive', '/screener', '/board', '/connect', '/jobs', '/pass', '/pancakeswap', '/venus', '/settle', '/set-and-earn', '/nft'];
const PAGES = args.length ? args : ALL;
const NOAR = (new Function( // the list as core.js builds it (comments and + inside), evaluated, not pattern-matched
fs.readFileSync('D:/ai/fourmeme/dashboard/i18n/core.js', 'utf8').match(/export const NOAR = ([\s\S]*?);\n/)[0].replace('export const', 'const') + '\nreturn NOAR;')());
const GLOSS = /^(BOBAI|BOB|BNB|BSC|LP|NFTs?|DeFi|UTC|CAKE|USDT|USD|AI|API|MCP|A2A|ERC|PancakeSwap|Pancake|Four\.Meme|Giggle|Academy|Brain|Plaza|Board|Pop|Terminal|Screener|Brainmap|Classic|Telegram|GitHub|Cloudflare|Workers|Liq|Liquidity|Boost|II|III|Build|On|Venus|Mandate|Binance|Web3|WC|ROT|EN|CZ|x402|ETH|OK|ID|json|burns|md|txt|llms|Claude|Cursor|Brainrot|BOBAIs|Studio|Agent|Era|Copy|Base|Keel|Marque|Pokter|Glama|Smithery|Bitquery|Moralis|BscScan|DexScreener|CoinGecko|CoinMarketCap|CMC)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9880 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-arc-' + port;
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
const LOOK = `(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += innerHeight * 0.8) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
  scrollTo(0, 0); await new Promise((r) => setTimeout(r, 1500));
  const gloss = ${GLOSS}, eng = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const p = n.parentElement; if (!p || p.closest(${JSON.stringify(NOAR)})) continue;
    const words = (n.nodeValue.replace(/https?:\\/\\/\\S+|0x[0-9a-fA-F….]+|\\$[A-Z]+/g, '').match(/[A-Za-z][A-Za-z'’-]{2,}/g) || []).filter((x) => !gloss.test(x));
    if (words.length && !/[\\u0600-\\u06FF]/.test(n.nodeValue) && !(window.__arHas && window.__arHas(n.nodeValue))) eng.add(n.nodeValue.replace(/\\s+/g, ' ').trim().slice(0, 120));
  }
  const nav = document.querySelector('nav, header, .bp-top');
  return { ready: window.__arReady, miss: [...(window.__arMiss || [])], eng: [...eng], wide: document.documentElement.scrollWidth > innerWidth + 1, navH: nav ? Math.round(nav.getBoundingClientRect().height) : 0 };
})()`;
const SIZES = [[1440, 900, 1, false], [390, 844, 3, true]];
let bad = 0; const todo = {};
for (const p of PAGES) for (const [w, h, dpr, mob] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: mob });
  await send('Page.navigate', { url: base + p + '?r=' + Date.now() }); await sleep(p === '/' || p === '/classic' ? 9000 : 5000);
  const en = await ev(`(() => { const nav = document.querySelector('nav, header, .bp-top'); return nav ? Math.round(nav.getBoundingClientRect().height) : 0; })()`);
  await send('Page.navigate', { url: base + '/ar' + (p === '/' ? '/' : p) + '?r=' + Date.now() }); await sleep(p === '/' || p === '/classic' ? 12000 : 7000);
  const r = await ev(LOOK) || {};
  const fails = [];
  if (r.ready !== true) fails.push('ar.js did not run (' + r.ready + ')');
  if (r.miss?.length) fails.push(r.miss.length + ' texts without Arabic');
  if (r.eng?.length) fails.push(r.eng.length + ' English texts left');
  if (r.wide) fails.push('wider than the screen');
  if (en && r.navH > en + 2) fails.push(`header ${r.navH}px vs English ${en}px`);
  if (fails.length) bad++;
  console.log(`${fails.length ? 'FAIL' : 'PASS'}  /ar${p === '/' ? '/' : p} ${w}px${fails.length ? ': ' + fails.join(' · ') : ''}`);
  for (const t of [...(r.miss || []), ...(r.eng || [])]) (todo[p] = todo[p] || new Set()).add(t);
}
fs.writeFileSync('D:/ai/fourmeme/temp/i18n/todo.json', JSON.stringify(Object.fromEntries(Object.entries(todo).map(([k, v]) => [k, [...v]])), null, 1));
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
