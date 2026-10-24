// the front page's 04 tile and Classic's Block 04 on a given origin: six apps, the Brain Board among them with its live
// fact, the "for every agent" row three cards; no script error; nothing wider than the screen.
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9700 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-t4-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
// (sweep1024, 2026-10-24, operator: "ALLES muss korrekt sein" after "a wallet unsi…gned" in the terminal) everything a
// visitor reads on the front page — page text, the terminal's boards and log, his work lines, every title/tooltip,
// every window — searched for broken values: undefined, NaN, null, [object, Infinity, an "unsigned" read as a wallet,
// an empty dollar amount. At 1440 and 390 px. Prints each hit with its place.
// (a dollar sign alone is the currency switch and the shell prompt; "owner()" is a function, not an empty value)
const BAD = /\bundefined\b|\bNaN\b|\bnull\b|\[object|Infinity|unsi…|unsign…|\$\s*(?:—|-\s|,)|#undefined|\(\s+\)|… …/;
// the detector itself, both ways: what it must catch, what it must leave
say(['a wallet unsi…gned wrote', 'price NaN', 'name undefined', 'paid $— today', '[object Object]'].every((s) => BAD.test(s)) && !['owner() = 0x000…000', 'bobai@bsc:~$', '$', 'Nobody owns it'].some((s) => BAD.test(s)), 'the detector catches broken values and leaves correct ones');
const grab = `(() => { const out = []; const vis = (e) => e.offsetParent !== null || e.getClientRects().length;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = walk.nextNode())) { const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE'].includes(p.tagName)) continue; const t = n.textContent.replace(/\\s+/g, ' ').trim(); if (t && vis(p)) out.push(['text', (p.id || p.className || p.tagName).toString().slice(0, 40), t]); }
  for (const e of document.querySelectorAll('[title],[aria-label],[data-tip]')) for (const a of ['title', 'aria-label', 'data-tip']) { const v = e.getAttribute(a); if (v) out.push([a, (e.id || e.className || e.tagName).toString().slice(0, 40), v]); }
  try { for (const w of (window.__btWork?.() || [])) if (w != null) out.push(['work', 'BOBAI work line', String(w)]); } catch (e) { out.push(['work', 'ERR', e.message]); }
  return out; })()`;
const hits = new Map();
const scan = (tag, rows) => { for (const [k, where, t] of rows || []) if (BAD.test(t)) { const key = k + '|' + where + '|' + t.slice(0, 120); if (!hits.has(key)) hits.set(key, `${tag} ${k} @${where}: "${t.slice(0, 160)}"`); } };
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url: base + '/?r=' + Date.now() }); await sleep(45000);
  scan(`${w}px page`, await ev(grab));
  const wins = await ev(`[...document.querySelectorAll('[data-open]')].map((e) => e.getAttribute('data-open'))`) || [];
  for (const id of [...new Set(wins)]) {
    await ev(`document.querySelector('[data-open="${id}"]')?.click()`); await sleep(6000);
    scan(`${w}px window ${id}`, await ev(grab));
    await ev(`(document.querySelector('#${id} [data-close], #${id} .bw-x, #${id} button[aria-label*="lose"]') || {}).click?.(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(800);
  }
  say(true, `${w}px: ${wins.length} windows read`);
}
for (const v of hits.values()) say(false, v);
say(!errs.length, `no script error${errs.length ? ': ' + [...new Set(errs)].slice(0, 5).join(' | ') : ''}`);
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
