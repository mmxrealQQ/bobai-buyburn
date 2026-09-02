// The honeypot line on /scanner, pinned in both directions.
//
// The scanner marks a token "Honeypot" when GoPlus's sell simulation failed
// (is_honeypot === "1"), says "Sellability not checked" when GoPlus returned
// no such field, and says nothing when the field is "0". That branch had never
// been seen with a real honeypot: on 2 September, 330 tokens through GoPlus
// and 40 fresh pairs through a live sell simulation produced not one analysed
// honeypot — GoPlus does not analyse a token minutes old, which is exactly
// when a honeypot is dangerous. So the wild will not test this line for us.
//
// This does. It loads the live page, imports the page's own module instance
// (same URL, so nothing runs twice), hands the card renderer three GoPlus
// answers, and reads back what it drew. A renderer that draws the red chip
// for "1", the grey "not checked" for a missing field and nothing for "0" is
// pinned; one that draws the red chip for everything, or for nothing, fails.
// The live result for $BOBAI is read too: it must carry no Honeypot chip.
//
// Usage:
//   node scripts/dashboard-check/scanner-honeypot.mjs
//   node scripts/dashboard-check/scanner-honeypot.mjs --self-test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9349);
const SELFTEST = process.argv.includes('--self-test');
const TOKEN = process.env.TOKEN || '0x245c386dcfed896f5c346107596141e5edcbffff'; // BOBAI
const BASE = process.env.BASE || 'https://brainonbnb.com';
const url = `${BASE}/scanner?token=${TOKEN}&probe=${Math.floor(Math.random() * 1e9)}`;

const profile = mkdtempSync(join(tmpdir(), 'hp-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) return (await r.json()).webSocketDebuggerUrl; }
    catch { /* not up yet */ }
    await wait(300);
  }
  throw new Error('chrome did not start');
}
const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || 'eval failed' };
  return r.result?.result?.value;
};
const until = async (expr, tries = 90) => { for (let i = 0; i < tries; i++) { await wait(500); if (await ev(expr) === true) return true; } return false; };

const problems = [];
const notes = [];
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url });
  await until(`!!document.getElementById('wip-ok')`, 40);
  await ev(`(document.getElementById('wip-ok')||{click(){}}).click()`);
  const gotResult = await until(`(()=>{const o=document.getElementById('sc-out');return !o.hidden&&o.children.length>0})()`);
  if (!gotResult) problems.push('the live scan never produced a result');

  // What the renderer draws for each answer. Read as data: chip state + label.
  const drawn = await ev(`(async()=>{
    const src = document.querySelector('script[type="module"][src*="scanner.js"]').src;
    const m = await import(src);
    if (typeof m.flagsCard !== 'function') return { __missing: true };
    const read = (card) => [...card.querySelectorAll('.f')].map((f) => ({ state: [...f.classList].find((c) => c.startsWith('f-')).slice(2), label: f.querySelector('b').textContent }));
    const full = { owner_address: '0x0000000000000000000000000000000000000000', is_open_source: '1' };
    return {
      flagged: read(m.flagsCard({ ...full, is_honeypot: '1' }, true)),
      clean: read(m.flagsCard({ ...full, is_honeypot: '0' }, true)),
      unknown: read(m.flagsCard({ ...full }, true)),
      noGoplus: read(m.flagsCard({}, false)),
      live: read(document.getElementById('sc-out')),
    };
  })()`);

  if (drawn?.__error) problems.push(`the page threw: ${drawn.__error}`);
  else if (drawn?.__missing) problems.push('scanner.js does not export flagsCard — the renderer cannot be pinned');
  else {
    const has = (list, state, label) => list.some((c) => c.state === state && c.label === label);
    // The detector this file relies on, sabotaged both ways before it judges anything.
    if (SELFTEST) {
      const fake = [{ state: 'bad', label: 'Honeypot' }];
      if (!has(fake, 'bad', 'Honeypot')) problems.push('SELF-TEST: the detector cannot see a red Honeypot chip');
      if (has([{ state: 'ok', label: 'Honeypot' }], 'bad', 'Honeypot')) problems.push('SELF-TEST: the detector accepts a green chip as the red one');
      if (has([], 'bad', 'Honeypot')) problems.push('SELF-TEST: the detector sees a chip in an empty card');
      notes.push('self-test: detector pinned both ways');
    }
    if (!has(drawn.flagged, 'bad', 'Honeypot')) problems.push('is_honeypot "1" does not draw the red Honeypot chip');
    if (has(drawn.clean, 'bad', 'Honeypot')) problems.push('is_honeypot "0" draws the red Honeypot chip');
    if (has(drawn.clean, 'unk', 'Sellability not checked')) problems.push('is_honeypot "0" is reported as not checked');
    if (!has(drawn.unknown, 'unk', 'Sellability not checked')) problems.push('a missing is_honeypot field is not reported as "Sellability not checked"');
    if (has(drawn.unknown, 'bad', 'Honeypot')) problems.push('a missing is_honeypot field draws the red Honeypot chip — silence read as guilt');
    if (drawn.noGoplus.length) problems.push(`with no GoPlus answer the card still draws ${drawn.noGoplus.length} chip(s)`);
    if (gotResult && has(drawn.live, 'bad', 'Honeypot')) problems.push('the live $BOBAI result carries a Honeypot chip');
    if (gotResult && has(drawn.live, 'unk', 'Sellability not checked')) notes.push('live: GoPlus ran no sell simulation for $BOBAI today (not a defect — a fact about GoPlus)');
    notes.push(`flagged → ${drawn.flagged.map((c) => c.label).join(' · ')}`);
    notes.push(`clean → ${drawn.clean.map((c) => c.label).join(' · ') || '(no chips)'}`);
    notes.push(`unknown → ${drawn.unknown.map((c) => c.label).join(' · ')}`);
    notes.push(`live $BOBAI → ${drawn.live.map((c) => c.label).join(' · ') || '(no chips)'}`);
  }
} finally {
  try { ws.close(); } catch { /* closing */ }
  chrome.kill();
  await wait(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp profile */ }
}

console.log('\nScanner — the honeypot line');
for (const n of notes) console.log(`  ${n}`);
if (problems.length) { console.log(''); for (const p of problems) console.log(`  x ${p}`); console.log(`\n${problems.length} problem(s).`); process.exitCode = 1; }
else console.log('\nno problems.');
