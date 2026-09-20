#!/usr/bin/env node
// Is anything on the page invisible that should not be?
//
// This is the worst failure this site has ever had and the one nothing has
// guarded against since. Every block below the hero carries `.fi`, a script
// adds `.pre` to what starts below the fold, and an IntersectionObserver takes
// it off again as you scroll. On 2026-08-09 that arrangement left four blocks
// permanently at opacity 0 and the user's report was "loads the hero, then
// black". Three rounds of measuring FCP, LCP, idle load and waterfall all came
// back green, because none of them looks at whether the content arrived
// VISIBLE. A script existed for it once and lived only in a scratchpad, which
// is the same as not existing.
//
// What it checks, at every width the design breaks at:
//   · nothing inside the viewport is transparent after the page settles
//   · the safety net really does clear `.pre` from everything
//   · scrolling the page releases what was below the fold
//
// A NOTE ON WHY THIS CANNOT BE DONE THROUGH THE MCP BROWSER
// In that tab document.visibilityState is 'hidden', so transitions and
// animations freeze. `.fi` fades with a CSS transition, and a frozen transition
// reads back as opacity 0 through getComputedStyle — an untouched, working page
// reports as a broken one. Measured 2026-09-01 while checking exactly this.
// Headless Chrome, driven here, renders and settles like a real visit.
//
// Usage:
//   node scripts/dashboard-check/reveal.mjs            live site, every width
//   PAGE=/registry node scripts/dashboard-check/reveal.mjs
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDir } from '../lib/scratch.mjs';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9377);
const PAGE = process.env.PAGE || '/';
const SITE = process.env.SITE || 'https://brainonbnb.com';
const WIDTHS = (process.env.W || '390,768,1440').split(',').map(Number);

const profile = scratchDir('reveal-');
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

await send('Page.enable'); await send('Runtime.enable');

const problems = [];
const notes = [];

for (const W of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 700 });
  // A fresh query key per run: Cloudflare caches per key, and a stale app.js is
  // exactly how a fixed page kept reporting the old bug.
  await send('Page.navigate', { url: `${SITE}${PAGE}?reveal=${Math.floor(Math.random() * 1e9)}` });
  await wait(3500);

  const top = await ev(`(() => {
    const els = [...document.querySelectorAll('.fi')];
    const inView = els.filter(e => { const b = e.getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0 && b.height > 0; });
    const dim = inView.filter(e => parseFloat(getComputedStyle(e).opacity) < 0.9);
    return {
      total: els.length,
      inView: inView.length,
      dim: dim.map(e => (e.className || '').split(' ').slice(0, 3).join('.') + ' :: ' + (e.innerText || '').trim().slice(0, 50)),
    };
  })()`);
  if (top?.__error) { problems.push(`${W}px: the page threw while being read — ${top.__error}`); continue; }
  notes.push(`${W}px: ${top.total} fade-in blocks, ${top.inView} in the first screen`);
  for (const d of top.dim) problems.push(`${W}px: visible but transparent on load — ${d}`);

  // Now the rest of the page, the way somebody meets it: scroll to the bottom,
  // let the observer work, and demand that nothing is left hidden. The safety
  // net alone should guarantee this, so a failure here is a failure of the last
  // line of defence rather than of the observer.
  const bottom = await ev(`(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise(r => setTimeout(r, 120));
    }
    scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1200));
    const els = [...document.querySelectorAll('.fi')];
    const stuck = els.filter(e => parseFloat(getComputedStyle(e).opacity) < 0.9);
    return {
      stillPre: els.filter(e => e.classList.contains('pre')).length,
      stuck: stuck.map(e => (e.className || '').split(' ').slice(0, 3).join('.') + ' :: ' + (e.innerText || '').trim().slice(0, 50)),
      height: document.body.scrollHeight,
    };
  })()`);
  if (bottom?.__error) { problems.push(`${W}px: the page threw while scrolling — ${bottom.__error}`); continue; }
  if (bottom.stillPre) problems.push(`${W}px: ${bottom.stillPre} block(s) still carry .pre after the whole page was scrolled — the safety net did not clear them`);
  for (const s of bottom.stuck) problems.push(`${W}px: still transparent after scrolling the whole page — ${s}`);
  notes.push(`${W}px: ${bottom.height}px of page scrolled, nothing left hidden`);
}

console.log(`\nReveal check — ${SITE}${PAGE}`);
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  x ' + p);
  console.log(`\n${problems.length} problem(s).`);
} else {
  console.log('\nnothing on the page is hidden that a visitor would be looking at.');
}

ws.close();
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows keeps a handle sometimes */ }
process.exitCode = problems.length ? 1 : 0;
