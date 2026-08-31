// Scanning a SECOND token on /scanner, driven the way a visitor drives it.
//
// The page keeps the scanned address in the field, which is right — it is the
// answer to "what am I looking at". It also meant that scanning anything else
// started with deleting forty-two characters by hand, and the field is far
// above the fold once a result is drawn. Three affordances now exist for that:
// a cross inside the field, a button under the result, and select-on-click.
//
// This check does not ask whether they render. It asks whether the page is
// really back to its starting state afterwards and whether a second scan then
// runs — a clear that only wipes the input while leaving the old result, the
// old ?token= in the URL, or a dead Scan button looks fixed and is not.
//
// Usage:
//   node scripts/dashboard-check/scanner-rescan.mjs
//   node scripts/dashboard-check/scanner-rescan.mjs --self-test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9347);
const SELFTEST = process.argv.includes('--self-test');
const FIRST = process.env.TOKEN || '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';  // CAKE
const SECOND = '0x245c386dcfed896f5c346107596141e5edcbffff';                      // BOBAI
const BASE = process.env.BASE || 'https://brainonbnb.com';
// A fresh key every run: Cloudflare caches per key, and a stale scanner.js is
// exactly how a fixed page keeps reporting the old bug.
const url = (t) => `${BASE}/scanner?token=${t}&probe=${Math.floor(Math.random() * 1e9)}`;

const profile = mkdtempSync(join(tmpdir(), 'rescan-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
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
const until = async (expr, tries = 90) => {
  for (let i = 0; i < tries; i++) { await wait(500); if (await ev(expr) === true) return true; }
  return false;
};

const problems = [];
const note = [];
const size = (w, h) => send('Emulation.setDeviceMetricsOverride',
  { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });

await send('Page.enable'); await send('Runtime.enable');
await size(1280, 900);
await send('Page.navigate', { url: url(FIRST) });

// Markup in the document, not drawn by the script, so it is present before
// anything loads and it swallows every click until it is dismissed.
await until(`!!document.getElementById('wip-ok')`, 40);
await ev(`(document.getElementById('wip-ok')||{click(){}}).click()`);

const hasResult = `(()=>{const o=document.getElementById('sc-out');return !o.hidden&&o.children.length>0})()`;
const gotFirst = await until(hasResult);
if (!gotFirst) problems.push('the first scan never produced a result — nothing else here can be judged');

// The state a visitor is in when they want a different token.
const after = await ev(`(()=>{
  const vis = el => !!el && !el.hidden && el.getBoundingClientRect().width > 0;
  const inp = document.getElementById('sc-in');
  const cross = document.getElementById('sc-clear');
  const field = document.querySelector('.sc-field');
  return {
    value: inp.value,
    symbol: (document.querySelector('.hd-t h2')||{}).textContent || null,
    again: vis(document.getElementById('sc-again')),
    cross: vis(cross),
    teaser: vis(document.getElementById('sc-what')),
    padRight: parseFloat(getComputedStyle(inp).paddingRight),
    crossW: cross ? cross.getBoundingClientRect().width : 0,
    crossInField: !!(cross && field) && cross.getBoundingClientRect().right <= field.getBoundingClientRect().right + 1,
  };
})()`);

if (after?.__error) problems.push(`the page threw while being read: ${after.__error}`);
else if (gotFirst) {
  note.push(`first scan: ${after.symbol} · field holds ${String(after.value).slice(0, 10)}…`);
  if (!after.again) problems.push('no "Scan another token" button under a finished result');
  if (!after.cross) problems.push('no clear cross in the field although the field holds an address');
  if (after.teaser) problems.push('the empty-state teaser is still on screen next to a result');
  // The cross sits on top of the input. If the input does not reserve room for
  // it, it covers the last characters of the address it is meant to clear.
  if (after.crossW && after.padRight < after.crossW + 4) {
    problems.push(`the clear cross is ${Math.round(after.crossW)}px wide but the field reserves only ${Math.round(after.padRight)}px — it covers the address`);
  }
  if (after.crossW && !after.crossInField) problems.push('the clear cross hangs outside the input field');
}

// Press it, and demand the starting state back — all of it.
await ev(`(document.getElementById('sc-again-btn')||{click(){}}).click()`);
await wait(600);
const reset = await ev(`(()=>{
  const vis = el => !!el && !el.hidden && el.getBoundingClientRect().width > 0;
  const o = document.getElementById('sc-out');
  return {
    value: document.getElementById('sc-in').value,
    out: vis(o) && o.children.length > 0,
    err: vis(document.getElementById('sc-err')),
    teaser: vis(document.getElementById('sc-what')),
    again: vis(document.getElementById('sc-again')),
    cross: vis(document.getElementById('sc-clear')),
    token: new URLSearchParams(location.search).get('token'),
    focused: document.activeElement === document.getElementById('sc-in'),
    goLabel: document.getElementById('sc-go').textContent.trim(),
    goDisabled: document.getElementById('sc-go').disabled,
  };
})()`);

if (reset?.__error) problems.push(`the page threw after the reset: ${reset.__error}`);
else {
  if (reset.value !== '') problems.push(`the field still holds "${reset.value}" after "Scan another token"`);
  if (reset.out) problems.push('the previous result is still on screen after the reset');
  if (reset.err) problems.push('an error box survived the reset');
  if (!reset.teaser) problems.push('the empty state did not come back — the page is blank instead of explaining itself');
  if (reset.again) problems.push('the "Scan another token" button is still there with nothing to scan again');
  if (reset.cross) problems.push('the clear cross is still there over an empty field');
  // The trap the reset exists to avoid: a reload would otherwise re-scan a
  // token that is no longer anywhere on the screen.
  if (reset.token) problems.push(`the URL still carries ?token=${reset.token} after the reset — a reload scans the old token`);
  if (!reset.focused) problems.push('the cursor was not put in the field, so the next paste needs a click first');
  if (reset.goDisabled || reset.goLabel !== 'Scan') problems.push(`the Scan button is left as "${reset.goLabel}"${reset.goDisabled ? ' and disabled' : ''}`);
}

// And the point of the whole thing: a second token really scans.
await ev(`(()=>{const i=document.getElementById('sc-in');i.value=${JSON.stringify(SECOND)};
  i.dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('sc-go').click();})()`);
const gotSecond = await until(hasResult);
if (!gotSecond) problems.push('the second scan never produced a result — the reset left the page unable to scan');
else {
  const sym = await ev(`(document.querySelector('.hd-t h2')||{}).textContent`);
  note.push(`second scan: ${sym}`);
  if (sym && after?.symbol && sym === after.symbol) {
    problems.push(`the second scan still shows ${sym} — the old result was never replaced`);
  }
}

// 390px, where the row becomes a column and the cross has to stay off the
// Scan button rather than landing on top of it.
await size(390, 780);
await wait(500);
const phone = await ev(`(()=>{
  const doc = document.documentElement;
  const cross = document.getElementById('sc-clear');
  const go = document.getElementById('sc-go');
  const c = cross ? cross.getBoundingClientRect() : null;
  const g = go.getBoundingClientRect();
  return {
    overflow: doc.scrollWidth - doc.clientWidth,
    overlap: !!c && !(c.right <= g.left || c.left >= g.right || c.bottom <= g.top || c.top >= g.bottom),
    crossVisible: !!c && c.width > 0,
    goWidth: Math.round(g.width),
  };
})()`);
if (phone?.__error) problems.push(`the page threw at 390px: ${phone.__error}`);
else {
  if (phone.overflow > 1) problems.push(`the page scrolls sideways by ${phone.overflow}px at 390px`);
  if (phone.overlap) problems.push('the clear cross sits on top of the Scan button at 390px');
  note.push(`390px: Scan button ${phone.goWidth}px wide, cross ${phone.crossVisible ? 'visible' : 'hidden'}`);
}

// ── Self-test ──────────────────────────────────────────────────────────────
// Every rule above is worth exactly as much as its ability to fire. Each case
// is pinned in BOTH directions: the healthy state must read clean, and the
// sabotage must be seen. A rule that only ever answers "true" proves nothing,
// and a rule that stays quiet here would stay quiet on a real regression.
// Runs last, because the setups deliberately wreck the page.
if (SELFTEST) {
  await size(1280, 900);
  const OUT = `document.getElementById('sc-out')`;
  const cases = [
    ['a result left on screen after the reset',
      `(()=>{const o=${OUT};o.hidden=true;o.textContent='';return 1})()`,
      `(()=>{const o=${OUT};o.hidden=false;o.appendChild(document.createElement('div'));return 1})()`,
      hasResult],
    ['the old ?token= left in the URL',
      `history.replaceState(null,'',location.pathname)`,
      `history.replaceState(null,'','?token=0xdead')`,
      `!!new URLSearchParams(location.search).get('token')`],
    ['the empty state never coming back',
      `document.getElementById('sc-what').hidden=false`,
      `document.getElementById('sc-what').hidden=true`,
      `(()=>{const e=document.getElementById('sc-what');return !(!!e&&!e.hidden&&e.getBoundingClientRect().width>0)})()`],
    ['the clear cross covering the address',
      `document.getElementById('sc-in').style.paddingRight=''`,
      `document.getElementById('sc-in').style.paddingRight='0px'`,
      `parseFloat(getComputedStyle(document.getElementById('sc-in')).paddingRight) < 20`],
  ];
  let seen = 0;
  for (const [what, healthy, sabotage, detect] of cases) {
    await ev(healthy); await wait(150);
    const quietWhenWell = await ev(detect) !== true;
    await ev(sabotage); await wait(150);
    const loudWhenBroken = await ev(detect) === true;
    if (!quietWhenWell) problems.push(`SELF-TEST: the check reports "${what}" even on a healthy page`);
    if (!loudWhenBroken) problems.push(`SELF-TEST: the check cannot see ${what}`);
    if (quietWhenWell && loudWhenBroken) seen++;
    await ev(`history.replaceState(null,'',location.pathname)`);
  }
  note.push(`self-test: ${seen}/${cases.length} rules pinned in both directions`);
}

console.log('\nScanner — scanning a second token');
for (const n of note) console.log(`  ${n}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  x ${p}`);
  console.log(`\n${problems.length} problem(s).`);
  process.exitCode = 1;
} else {
  console.log('\nno problems.');
}

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds the profile briefly */ }
