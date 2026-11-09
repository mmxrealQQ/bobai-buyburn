// (timetravel, 2026-11-09, operator: "the ecosystem that runs 24/7 and forever") — the pages read the clock in the
// browser: countdowns, phase rows, seasons. This moves the page's clock (Date shifted) to the days after every switch
// still ahead and reads what a visitor would read, for words that have gone stale: a date in the past still spoken of
// as ahead ("until Nov 20", "ends Nov 30", "from Dec 1"), a countdown at 0 or below, NaN, undefined, Invalid Date.
// Server-rendered text keeps the real clock and is not judged here. Usage: node timetravel.mjs [origin] [--only=<iso>]
import { spawn } from 'node:child_process';
import os from 'node:os';
const base = (process.argv.find((a) => a.startsWith('http')) || 'https://brainonbnb.com').replace(/\/$/, '');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), port = 9800 + Math.floor(Math.random() * 30), prof = os.tmpdir() + '/prof-tt-' + port;
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
let tab; for (let i = 0; i < 40 && !tab; i++) { await sleep(500); try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
let script = null;
async function at(iso) {
  if (script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
  script = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const D = Date, off = Date.parse('${iso}') - D.now();
    class S extends D { constructor(...a) { a.length ? super(...a) : super(D.now() + off); } static now() { return D.now() + off; } }
    globalThis.Date = S; })();` })).result?.identifier;
}
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "until Nov 20", "ends Nov 30", "from Dec 1", "until 30 Nov", "before 20 November": a date spoken of as ahead
const AHEAD = /\b(until|till|ends?|ending|from|starts?|starting|before|on|by)\s+(?:(\d{1,2})\s+([A-Z][a-z]{2,8})|([A-Z][a-z]{2,8})\s+(\d{1,2}))\b(?!,? 20(2[0-5]))/g;
function stale(text, now) {
  const out = [];
  for (const line of text.split('\n')) {
    const l = line.trim(); if (!l) continue;
    if (/\bNaN\b|\bundefined\b|Invalid Date|\bnull\b(?! *[a-z])/.test(l)) out.push('broken value: ' + l.slice(0, 140));
    if (/(?:^|[^\d.])(?:-\d+|0) ?(?:d|days?) (?:left|to go|to the kids)/i.test(l)) out.push('countdown at 0 or below: ' + l.slice(0, 140));
    for (const m of l.matchAll(AHEAD)) {
      const mon = MON[(m[3] || m[4] || '').slice(0, 3).toLowerCase()], day = +(m[2] || m[5]); if (mon == null || !(day >= 1 && day <= 31)) continue;
      // the year the page means: 2026 for Sep-Dec (this season), never a date of next year
      const t = Date.UTC(2026, mon, day, 23, 59);
      // a row of the tax schedule ("until Jun 4, 2026", a cell of its own) and a start that holds for good are history, not ahead
      if (/^(until|from)\s+\S+\s+\d{1,2},\s*20\d\d$/.test(l) || /for good/.test(l)) continue;
      if (t < now - 86400e3 && !/\b(was|were|ran|ended|closed|took|got|archive|paid|donated|collected|history|from .* to )/i.test(l)) out.push(`"${m[0]}" spoken of as ahead: ${l.slice(0, 160)}`);
    }
  }
  return [...new Set(out)];
}
const INSTANTS = ['2026-11-20T08:00:00Z', '2026-11-30T20:00:00Z', '2026-12-01T06:00:00Z', '2026-12-25T12:00:00Z', '2027-06-01T12:00:00Z'].filter((x) => !only || x === only);
const PAGES = ['/', '/classic', '/token', '/pop', '/defi'];
for (const iso of INSTANTS) {
  await at(iso); const now = Date.parse(iso);
  for (const p of PAGES) {
    await send('Page.navigate', { url: base + p + (p.includes('?') ? '&' : '?') + 'r=' + Date.now() }); await sleep(p === '/' ? 15000 : 9000);
    const t = (await ev('document.body ? document.body.innerText : ""')) || '';
    const s = stale(t, now);
    say(t.length > 200 && s.length === 0, `${iso.slice(0, 10)} ${p}: ${t.length} chars${s.length ? '\n        ' + s.slice(0, 8).join('\n        ') : ''}`);
  }
}
ws.close(); ch.kill(); console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
