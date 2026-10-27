// 04 FOR EVERY AGENT ON BNB CHAIN (operator, 2026-10-21, variant B): three cards under "Works with us" on Classic and
// in the Brain page's 04 window — Job Settler, Venus Agents, Pool Scan Pass — each with its name, one sentence, one
// live figure and one button. The figures are recomputed here from the same three sources and must match; the
// buttons must lead where they say; three in a row at 1440 px, one column at 390 px, nothing wider than the screen.
// usage: node every1021.mjs [base]   (default the go-live preview)   exit code 1 on any FAIL
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 40), prof = os.tmpdir() + '/prof-every-' + port;
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const J = async (u) => (await fetch(u)).json();
const [st, vw, sp, bd, pc] = await Promise.all([J('https://agent.brainonbnb.com/settle/public'), J('https://agent.brainonbnb.com/venus/work'), J('https://agent.brainonbnb.com/scan-pass'), J('https://agent.brainonbnb.com/board?limit=1'), J('https://agent.brainonbnb.com/board?type=library&q=pancakeswap&limit=1')]);
const nf = (n) => Number(n).toLocaleString('en-US');
const t = st.totals, acts = (vw.log || []).filter((x) => x.tx).length, price = String(sp.price || '').match(/^(\d+(?:\.\d+)?) USD1/);
const want = {
  settle: t && t.jobs > 0 ? `$${Number(t.released_u).toFixed(2)} released to ${nf(t.providers.length)} ${t.providers.length === 1 ? 'agent' : 'agents'}` : `${nf(st.waiting)} jobs watched · daily 21:15 UTC`,
  venus: acts > 0 ? `${nf(acts)} ${acts === 1 ? 'action' : 'actions'} on Venus so far` : vw.switched_on ? 'Switched on · daily 05:00 UTC' : 'Every day at 05:00 UTC',
  // the fourth card since 2026-10-23: the Plaza Board
  board: bd && bd.total > 0 ? `${nf(bd.total)} ${bd.total === 1 ? 'thread' : 'threads'} · ${nf(bd.open)} open` : 'Open to every agent',
  // the fourth card since 2026-10-27: the PancakeSwap tools, with the library's PancakeSwap fixes
  pancakeswap: pc && !pc.near && pc.matched > 0 ? `${nf(pc.matched)} PancakeSwap fixes · any token` : 'Any token · any V3 position',
  pass: price ? `1,000 free a day, then $${Number(price[1]).toFixed(2)} a day` : '1,000 free a day, then a day pass',
};
const HREF = { 'Job Settler': '/settle', 'Venus Agents': '/venus', 'Pool Scan Pass': '/scanner', 'Plaza Board': '/board', 'PancakeSwap Tools': '/pancakeswap' };

const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}; ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { returnByValue: true, expression: x })).result?.result?.value;
await send('Page.enable');
const READ = `JSON.stringify((()=>{const b=document.querySelector('.ec-every');if(!b)return null;
  const cards=[...b.querySelectorAll('a.ec')].map(a=>{const r=a.getBoundingClientRect();return {h:a.querySelector('h3')?.textContent.trim(),p:a.querySelector('p')?.textContent.trim(),live:a.querySelector('.ec-live')?.textContent.trim(),key:a.querySelector('.ec-live')?.dataset.eclive,href:a.getAttribute('href'),go:a.querySelector('.ec-go')?.textContent.trim(),top:Math.round(r.top),left:Math.round(r.left),w:Math.round(r.width)}});
  return {head:b.querySelector('.ec-every-h')?.textContent.trim(),cards,overflow:document.documentElement.scrollWidth>innerWidth+1}})())`;
for (const [page, label] of [['/classic', 'Classic'], ['/', 'Brain']]) {
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 500 });
    await send('Page.navigate', { url: base + page + '?r=' + Date.now() });
    let r = null;
    for (let i = 0; i < 30; i++) { await sleep(1000); r = JSON.parse((await ev(READ)) || 'null'); if (r && r.cards.every((c) => c.live === want[c.key])) break; }
    const tag = `${label} ${W}px`;
    if (!r) { say(false, `${tag}: the block "For every agent on BNB Chain" is there`); continue; }
    // three again since 2026-10-24 (c95c55b): the board card moved into the apps; four since 2026-10-27 (PancakeSwap Tools)
    say(r.head === 'For every agent on BNB Chain' && r.cards.length === 4, `${tag}: the heading and four cards`);
    for (const c of r.cards) {
      say(!!c.p && c.live === want[c.key], `${tag}: ${c.h} — "${c.live}" (wants "${want[c.key]}")`);
      say(c.href === HREF[c.h] && /→/.test(c.go || ''), `${tag}: ${c.h} button "${(c.go || '').replace(/\s+/g, ' ')}" -> ${c.href}`);
    }
    if (label === 'Classic') {
      const row = new Set(r.cards.map((c) => c.top)).size === 1, col = new Set(r.cards.map((c) => c.left)).size === 1;
      say(W > 700 ? row : col, `${tag}: ${W > 700 ? 'four in one row' : 'one column'} (tops ${r.cards.map((c) => c.top).join('/')}, lefts ${r.cards.map((c) => c.left).join('/')})`);
      say(!r.overflow, `${tag}: nothing wider than the screen`);
    }
  }
}
ws.close(); ch.kill(); await sleep(800);
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
