// (nftswipe1024, 2026-10-24, operator chose variant A for /nft/: 7,957 px on a phone) on a phone each tier's seven
// collection cards are one row to swipe, the fifth peeking in; every picture is there; a tap still opens the large
// card; the tiers stay one a row (two across was tried: text ran together); nothing wider than the screen; at 1440 px
// the collection is the grid it was.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-nft-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: base + '/nft/?r=' + Date.now() }); await sleep(8000);
  const r = await ev(`(() => { const rows = [...document.querySelectorAll('.collection-grid')];
    const g = rows[0], cards = g ? [...g.children] : [], box = g ? g.getBoundingClientRect() : null;
    const inView = cards.filter((c) => { const b = c.getBoundingClientRect(); return b.left >= box.left - 1 && b.right <= box.right + 1; }).length;
    const peek = cards.some((c) => { const b = c.getBoundingClientRect(); return b.left < box.right && b.right > box.right + 1; });
    const tiers = [...(document.getElementById('tier-grid')?.children || [])].map((e) => Math.round(e.getBoundingClientRect().left));
    return { rows: rows.length, perRow: rows.map((x) => x.children.length), scroll: g ? g.scrollWidth > g.clientWidth : false, flex: g ? getComputedStyle(g).display : '', inView, peek, imgs: document.querySelectorAll('.coll-card img').length,
      tierCols: tiers.length ? new Set(tiers).size : 0, total: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  if (w < 500) {
    say(r.rows > 0 && r.perRow.every((n) => n === 7) && r.flex === 'flex' && r.scroll, `${w}px: ${r.rows} rows of 7 cards, each a row to swipe`);
    say(r.inView === 4 && r.peek, `${w}px: four cards in view, the fifth peeking in`);
    say(r.total < 7400, `${w}px: the page is ${r.total} px (was 7,957)`);
  } else say(r.flex === 'grid' && !r.scroll, `${w}px: the collection is the grid it was`);
  say(r.imgs === r.rows * 7, `${w}px: every picture is there (${r.imgs})`);
  say(r.tierCols === 1, `${w}px: the tiers stay one a row`);
  say(!r.wide, `${w}px: nothing wider than the screen`);
  const lb = await ev(`(async () => { document.querySelector('.coll-card').click(); await new Promise((r) => setTimeout(r, 600)); const l = document.getElementById('lbx'); return !!l && (l.classList.contains('open') || l.checkVisibility()); })()`);
  say(lb, `${w}px: a tap on a card opens it large`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
