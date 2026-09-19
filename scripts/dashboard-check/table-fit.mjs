// Every log table on the homepage, on a phone: does it end inside its box?
//
// Each table sits in a .txw box that scrolls sideways when the table is wider
// than it. The page itself never scrolls then, so the layout audit — which asks
// whether the PAGE overflows — sees nothing: on 2026-09-19 Live Burns was 22px
// wider than its box at 390px and the only table the operator had to swipe; the
// archived liquidity tables ran 39px over at 320px. This opens the live page in
// a real browser at each width, opens the archives, waits for the burn rows and
// measures every table against its box.
//
//   node scripts/dashboard-check/table-fit.mjs                 430, 390, 375, 360, 340, 320
//   WIDTHS=390,360 node scripts/dashboard-check/table-fit.mjs
//   SELFTEST=1 node scripts/dashboard-check/table-fit.mjs      a table is forced wide first; the run passes only if that is reported
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9377);
const WIDTHS = (process.env.WIDTHS || '430,390,375,360,340,320').split(',').map(Number).filter(Boolean);
const SELFTEST = process.env.SELFTEST === '1';
const SITE = process.env.SITE || 'https://brainonbnb.com/';

const profile = mkdtempSync(join(tmpdir(), 'tablefit-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch { /* not up yet */ } if (!wsUrl) await wait(300); }
if (!wsUrl) { console.error('chrome did not start'); process.exit(2); }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');

const problems = [];
for (const W of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `${SITE}?probe=${Math.floor(Math.random() * 1e9)}` });
  let loaded = false;
  for (let i = 0; i < 50; i++) { await wait(500); if (await ev(`document.querySelectorAll('#tx-body tr').length > 2`)) { loaded = true; break; } }
  if (!loaded) { problems.push(`${W}px: the burn rows never arrived — nothing was measured`); continue; }
  await ev(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  if (SELFTEST) await ev(`(() => { const c = document.querySelector('#tx-body td'); if (c) { c.style.whiteSpace = 'nowrap'; c.textContent = 'x'.repeat(90); } })()`);
  await wait(700);
  const R = await ev(`(() => ({ tables: [...document.querySelectorAll('.txw')].map(w => { const t = w.querySelector('table'); return { body: t.querySelector('tbody')?.id || '?', box: Math.round(w.clientWidth), table: Math.round(t.scrollWidth), over: Math.round(w.scrollWidth - w.clientWidth), rows: t.querySelectorAll('tbody tr').length }; }), page: document.documentElement.scrollWidth - document.documentElement.clientWidth }))()`);
  const line = R.tables.map((t) => `${t.body} ${t.table}/${t.box}`).join('  ');
  console.log(`${String(W).padStart(4)}px  ${line}`);
  if (R.tables.length < 5) problems.push(`${W}px: only ${R.tables.length} tables found, five were expected`);
  for (const t of R.tables) if (t.over > 1) problems.push(`${W}px: ${t.body} is ${t.over}px wider than its box (${t.table} in ${t.box})`);
  if (R.page > 1) problems.push(`${W}px: the page scrolls sideways by ${R.page}px`);
}

if (SELFTEST) {
  const caught = problems.filter((p) => /tx-body is \d+px wider/.test(p)).length;
  console.log(caught === WIDTHS.length ? `\nself-test passed: the table forced wide was reported at all ${WIDTHS.length} widths.` : `\nSELF-TEST FAILED: reported at ${caught} of ${WIDTHS.length} widths.`);
  process.exitCode = caught === WIDTHS.length ? 0 : 1;
} else if (problems.length) {
  console.log(''); for (const p of problems) console.log(`  x ${p}`);
  console.log(`\n${problems.length} problem(s).`); process.exitCode = 1;
} else console.log('\nevery table ends inside its box.');

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds the profile briefly */ }
