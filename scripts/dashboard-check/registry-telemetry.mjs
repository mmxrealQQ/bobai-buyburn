// Checks that the live-telemetry lines on /registry actually reach the reader.
//
// The generated HTML carrying data-tele proves nothing: the values arrive from
// agent.brainonbnb.com after load, and every way that can fail — CSP blocking
// the origin, a CORS header missing, the snapshot being cold, the script
// throwing on one row and abandoning the rest — leaves a page that looks
// perfectly fine and shows no live state at all. So this reads what the browser
// ended up with, not what the generator wrote.
//
// It also asserts the honest cases: the two reference agents that publish no
// state must SAY so, not render blank. A blank line there is indistinguishable
// from our poller being broken, which is the misreading this whole feature
// exists to prevent.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Port and profile carry the pid: an abandoned run used to hold both and make
// the next one fail with a message about neither.
const PORT = 9400 + (process.pid % 120);
const URL = 'https://brainonbnb.com/registry?probe=' + Math.floor(Math.random() * 1e9);

const profile = mkdtempSync(join(tmpdir(), `cdp-tele-${process.pid}-`));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,1400', '--hide-scrollbars', '--no-first-run',
], { stdio: 'ignore' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await wait(300);
  }
  throw new Error('chrome did not come up');
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

// Console errors are collected: a script that throws mid-loop fills some rows
// and silently drops the rest, which reads as "those agents have no state".
const consoleErrors = [];
await send('Runtime.enable');
await send('Log.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
    consoleErrors.push(m.params.entry.text);
  }
});

await send('Page.enable');
await send('Page.navigate', { url: URL });

// Wait for the fetch to land rather than for a fixed time: a fixed sleep either
// wastes seconds or reports a false negative on a slow morning.
const SLOTS = `document.querySelectorAll('tr[data-tele] .rg-live').length`;
const FILLED = `[...document.querySelectorAll('tr[data-tele] .rg-live')].filter(function(n){return !n.hidden}).length`;
let filled = 0;
for (let i = 0; i < 30; i++) {
  await wait(1000);
  filled = await evaluate(FILLED);
  if (filled > 0 && filled === await evaluate(SLOTS)) break;
}

const READ = `(() => {
  const out = [];
  document.querySelectorAll('tr[data-tele]').forEach((tr) => {
    const live = tr.querySelector('.rg-live');
    const box = tr.closest('.rg-box');
    out.push({
      key: tr.getAttribute('data-tele'),
      section: box ? box.id.replace(/^cat-/, '') : '',
      agent: (tr.querySelector('b') || {}).textContent || '',
      text: live ? live.textContent.replace(/\\s+/g, ' ').trim() : null,
      hidden: live ? !!live.hidden : null,
    });
  });
  return out;
})()`;

const rows = await evaluate(READ);

ws.close();
chrome.kill();

// --- verdict ---------------------------------------------------------------
const problems = [];
if (!rows.length) problems.push('no row on the page carries data-tele — the generator did not emit any');

for (const r of rows) {
  if (r.text === null) { problems.push(`${r.key}: no .rg-live element in the row`); continue; }
  if (r.hidden || !r.text) { problems.push(`${r.key} (${r.section}): live line never filled — the fetch did not reach this row`); continue; }
  if (!/checked/.test(r.text)) problems.push(`${r.key}: live line carries no age. A live figure without its age is worse than none.`);
}

// The two silent reference agents must say they are silent.
for (const key of ['bnb-lp', 'bnb-grid']) {
  const r = rows.find((x) => x.key === key);
  if (!r) continue;
  if (!/publishes no live state|did not answer|no live state/.test(r.text || '')) {
    problems.push(`${key}: measured as publishing no live state, but the page does not say so — it reads as our poller being broken`);
  }
}

// And the ones that do publish must show a value, not just "answering".
for (const key of ['bnb-guardian', 'bnb-yield']) {
  const r = rows.find((x) => x.key === key);
  if (!r) continue;
  if (/^\s*answering/.test(r.text || '')) {
    problems.push(`${key}: answered with a document but no surfaced field. Check SURFACE against what it actually returns.`);
  }
}

for (const key of ['own:302257', 'own:302258']) {
  const r = rows.find((x) => x.key === key);
  if (!r) { problems.push(`${key}: our own agent has no live row on the page`); continue; }
  if (/not answering/.test(r.text || '')) problems.push(`${key}: our own agent reports itself as not answering`);
}

console.log(`\n${rows.length} rows carry live telemetry, ${rows.filter((r) => r.text && !r.hidden).length} rendered\n`);
for (const r of rows) {
  console.log(`  ${r.key.padEnd(14)} ${r.section.padEnd(20)} ${r.text || '(EMPTY)'}`);
}
if (consoleErrors.length) {
  console.log(`\n${consoleErrors.length} console error(s):`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`  ${e.slice(0, 200)}`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ every telemetry row rendered, carries its age, and states honestly what it found');
