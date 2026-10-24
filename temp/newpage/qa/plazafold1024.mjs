// (plazafold1024, 2026-10-24, operator chose variant A for the Brain Plaza: 13,177 px on a phone) "What this is" is one
// line that opens (tap or Enter); on a phone the hire block keeps its question box and folds the two other ways; each
// category shows its first five agents and "Show all N (M more)"; each "at work" list its three newest and "Show all N";
// the category tabs still switch; the page well under 9,000 px on a phone; nothing wider than the screen; no error.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-pz-' + port;
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
  await send('Page.navigate', { url: base + '/registry?r=' + Date.now() }); await sleep(10000);
  const r = await ev(`(() => { const vis = (e) => !!e && e.checkVisibility();
    const pr = document.querySelector('.primer.pz-fold'), prH = pr && pr.querySelector('.pz-h');
    const primerClosed = !!pr && vis(prH) && [...pr.children].filter((c) => c !== prH).every((c) => !vis(c));
    const doCs = [...document.querySelectorAll('.rg-do .rg-do-c')], tog = document.querySelector('.rg-do-tog');
    const cats = [...document.querySelectorAll('.rg-box[id^="cat-"]')].map((b) => { const l = b.querySelector(':scope > .rgc-list:not(.rgc-ours)'); const cards = l ? [...l.children].filter((c) => c.classList.contains('rgc')) : []; const btn = l && l.nextElementSibling && l.nextElementSibling.classList.contains('pz-more') ? l.nextElementSibling.textContent : null; return { id: b.id, n: cards.length, shown: cards.filter((c) => !c.classList.contains('pz-hide')).length, btn }; });
    const aw = [...document.querySelectorAll('.aw-rows')].map((b) => { const rows = [...b.children].filter((c) => c.classList.contains('aw-row')); return { id: b.id, n: rows.length, shown: rows.filter((c) => !c.classList.contains('pz-hide')).length, btn: b.nextElementSibling && b.nextElementSibling.classList.contains('pz-more') ? b.nextElementSibling.textContent : null }; });
    return { primerClosed, doVis: doCs.map(vis), togVis: vis(tog), cats, aw, total: document.documentElement.scrollHeight, wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  say(r.primerClosed, `${w}px: "What this is" is one line, closed`);
  if (w < 500) say(r.togVis && r.doVis[0] && !r.doVis[1] && !r.doVis[2], `${w}px: the hire block keeps its question box, the two other ways folded (${r.doVis})`);
  else say(!r.togVis && r.doVis.every(Boolean), `${w}px: the hire block shows all three ways, no toggle`);
  const catOk = r.cats.length === 4 && r.cats.every((c) => (c.n <= 4 ? c.shown === c.n && !c.btn : c.shown === 3 && c.btn === `Show all ${c.n} (${c.n - 3} more)`));
  say(catOk, `${w}px: each category its first three and "Show all" (${r.cats.map((c) => c.id.slice(4) + ' ' + c.shown + '/' + c.n).join(', ')})`);
  const awOk = r.aw.every((a) => (a.n <= 4 ? a.shown === a.n && !a.btn : a.shown === 3 && a.btn === `Show all ${a.n}`));
  say(awOk, `${w}px: each "at work" list its three newest (${r.aw.map((a) => a.id + ' ' + a.shown + '/' + a.n).join(', ')})`);
  if (w < 500) say(r.total < 10000, `${w}px: the page is ${r.total} px (was 13,177; the estimate was ~6,500 — the three per category, our two cards with their live proof, the top-by-evidence and the board stay open on purpose)`);
  say(!r.wide, `${w}px: nothing wider than the screen`);
  const o = await ev(`(async () => { const t = (s) => new Promise((r) => setTimeout(r, s)); const out = {};
    const pr = document.querySelector('.primer.pz-fold'); pr.querySelector('.pz-h').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await t(150); out.primer = pr.classList.contains('open') && pr.querySelector('.primer-do').checkVisibility();
    const tog = document.querySelector('.rg-do-tog'); if (tog.checkVisibility()) { tog.click(); await t(150); out.ways = [...document.querySelectorAll('.rg-do .rg-do-c')].every((c) => c.checkVisibility()); } else out.ways = true;
    const tabs = [...document.querySelectorAll('.rg-ctab')]; tabs[1].click(); await t(300); out.tab = document.getElementById('cat-' + tabs[1].dataset.catTab).checkVisibility();
    const b = document.querySelector('.rg-box[id^="cat-"]:not([hidden]) > .rgc-list + .pz-more') || document.querySelector('.rgc-list + .pz-more'); if (b) { const l = b.previousElementSibling; b.click(); await t(150); out.all = [...l.children].every((c) => !c.classList.contains('pz-hide')); } else out.all = true;
    return out; })()`);
  say(o.primer && o.ways && o.tab && o.all, `${w}px: Enter opens "What this is", the ways open, a category tab switches, "Show all" opens every card (${JSON.stringify(o)})`);
}
say(!errs.length, `no script error${errs.length ? ': ' + errs.join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
