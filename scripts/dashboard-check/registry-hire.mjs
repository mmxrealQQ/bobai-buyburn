// Drives the hire panel on /registry in a real browser, up to the wallet.
//
// The point of the panel is that a person can hire an agent without writing a
// script, and every part of that claim can fail invisibly: the dialog element
// may not open, the negotiation may not reach the broker, the quote may come
// back without the escrow calls, or the steps may render with no button.
// Nothing about any of those shows up in the generated HTML, so the page is
// driven rather than inspected.
//
// It deliberately stops before sending a transaction. Everything up to that
// point is free and idempotent — negotiating a quote costs nobody anything —
// and a check that spends money to prove it works is not a check anybody will
// run twice.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9560 + (process.pid % 120);
const URL = 'https://brainonbnb.com/registry?probe=' + Math.floor(Math.random() * 1e9);

const profile = mkdtempSync(join(tmpdir(), `cdp-hire-${process.pid}-`));
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

const consoleErrors = [];
await send('Runtime.enable');
await send('Log.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') consoleErrors.push(m.params.entry.text);
});

await send('Page.enable');
await send('Page.navigate', { url: URL });
// Wait for the SCRIPT, not for the markup. The buttons are static HTML and
// exist while the page is still parsing — a check that waits for them clicks
// before the handler at the bottom of the body has been attached, gets
// nothing, and reports a broken panel on a page that is fine. That false
// alarm cost a round of debugging on working code.
for (let i = 0; i < 40; i++) {
  await wait(500);
  const ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('.rg-hirebtn')`);
  if (ready) break;
}
await wait(400);

const problems = [];
const buttons = await evaluate(`[...document.querySelectorAll('.rg-hirebtn')].map(b=>({id:b.getAttribute('data-hire'),name:b.getAttribute('data-name'),cat:b.getAttribute('data-cat')}))`);
if (!buttons?.length) problems.push('no hire button on the page at all');

// Every one of the four categories has to offer at least one hireable agent.
// "All four, equally deep" is the stated bar, and a category with nothing to
// hire is the category that fails it.
const cats = new Set((buttons || []).map((b) => b.cat));
for (const c of ['rebalancing', 'grid-trading', 'yield-optimization', 'health-factor']) {
  if (!cats.has(c)) problems.push(`${c}: no hireable agent offered in this category`);
}

// Open the panel on one of our own agents and negotiate for real.
const OURS = (buttons || []).find((b) => b.id === '302258') || (buttons || [])[0];
let quote = null;
if (OURS) {
  await evaluate(`document.querySelector('.rg-hirebtn[data-hire="${OURS.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
  await wait(300);
  const openNow = await evaluate(`document.getElementById('rg-hire').open === true`);
  if (!openNow) problems.push('the hire dialog did not open on click');

  const seeded = await evaluate(`document.getElementById('rg-hire-task').value.length > 0`);
  if (!seeded) problems.push('the task box opened empty — nothing to negotiate with');

  await evaluate(`document.getElementById('rg-hire-quote').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    if (await evaluate(`!!document.getElementById('rg-stepwrap')`)) break;
    if (await evaluate(`/rg-err/.test(document.getElementById('rg-hire-msg').className)`)) break;
  }
  quote = await evaluate(`(() => {
    const m = document.getElementById('rg-hire-msg');
    const w = document.getElementById('rg-stepwrap');
    return {
      err: /rg-err/.test(m.className),
      msg: m.textContent.replace(/\\s+/g,' ').trim().slice(0,200),
      steps: w ? w.querySelectorAll('.rg-step').length : 0,
      sendButtons: w ? w.querySelectorAll('button[data-step]').length : 0,
      wallet: (document.getElementById('rg-wallet')||{}).textContent || '',
      quoteLine: (document.querySelector('#rg-hire-steps .rg-msg')||{}).textContent || '',
    };
  })()`);

  if (quote.err) problems.push(`negotiation failed in the page: ${quote.msg}`);
  // Five is what ERC-8183 costs. Fewer means the broker changed shape and the
  // panel is quietly showing a partial flow.
  if (quote.steps !== 5) problems.push(`expected 5 escrow steps, the panel rendered ${quote.steps}`);
  if (!/\d/.test(quote.quoteLine)) problems.push('the quote line shows no price');
  // Headless Chrome has no wallet, and the panel must say so rather than
  // rendering dead buttons.
  if (!/No wallet found/i.test(quote.wallet)) problems.push('with no wallet present the panel did not say so');
  if (quote.sendButtons !== 5) problems.push(`expected a send button per step, found ${quote.sendButtons}`);
}

ws.close();
chrome.kill();

console.log(`\n${buttons?.length || 0} hire buttons across ${cats.size} categories`);
for (const b of buttons || []) console.log(`  ${String(b.id).padEnd(8)} ${b.cat.padEnd(20)} ${b.name}`);
if (quote) {
  console.log(`\nnegotiated in-page for #${OURS.id}:`);
  console.log(`  quote   ${quote.quoteLine.replace(/\s+/g, ' ').trim().slice(0, 150)}`);
  console.log(`  steps   ${quote.steps} rendered, ${quote.sendButtons} sendable`);
  console.log(`  wallet  ${quote.wallet.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
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
console.log('\n✓ a person can open the panel, negotiate a real quote and see all five escrow steps');
