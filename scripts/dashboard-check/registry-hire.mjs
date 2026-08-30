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
      // The quote is four separate blocks - price and provider, where the
      // provider address came from, the refund rule, what the price is
      // denominated in - and textContent runs them together, which is why this
      // check used to print "...5963declared by the seller". That was the
      // reader, not the page. Measured instead of assumed: each block is
      // reported with its computed display and its top edge, so a stylesheet
      // that ever collapses them onto one line fails here rather than being
      // argued about from a smashed-together string.
      quoteBlocks: (() => {
        const box = document.querySelector('#rg-hire-steps .rg-msg');
        if (!box) return null;
        const out = [];
        const notes = [...box.querySelectorAll(':scope > .rg-note')];
        const headline = [...box.childNodes]
          .filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains('rg-note')))
          .map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim();
        out.push({ what: 'price and provider', top: Math.round(box.getBoundingClientRect().top),
                   display: 'block', text: headline.slice(0, 120) });
        for (const n of notes) {
          out.push({ what: (n.className || 'note').replace(/\\s+/g, ' '),
                     top: Math.round(n.getBoundingClientRect().top),
                     display: getComputedStyle(n).display,
                     text: n.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) });
        }
        return out;
      })(),
    };
  })()`);

  if (quote.err) problems.push(`negotiation failed in the page: ${quote.msg}`);
  // Five is what ERC-8183 costs. Fewer means the broker changed shape and the
  // panel is quietly showing a partial flow.
  if (quote.steps !== 5) problems.push(`expected 5 escrow steps, the panel rendered ${quote.steps}`);
  if (!/\d/.test(quote.quoteLine)) problems.push('the quote line shows no price');
  // The four blocks have to stack. An inline display, or two of them sharing a
  // top edge, is the address running into the sentence after it - the last
  // thing a buyer reads before opening a wallet, so it is worth an assertion
  // rather than an eyeball.
  const blocks = quote.quoteBlocks || [];
  if (blocks.length < 3) problems.push(`the quote rendered ${blocks.length} blocks, expected at least 3`);
  for (const b of blocks.slice(1)) {
    if (b.display === 'inline') problems.push(`quote block "${b.what}" is inline — it will run into the text before it`);
  }
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].top <= blocks[i - 1].top) {
      problems.push(`quote blocks share a line: "${blocks[i - 1].what}" and "${blocks[i].what}" both start at y=${blocks[i].top}`);
    }
  }
  // Headless Chrome has no wallet, and the panel must say so rather than
  // rendering dead buttons.
  if (!/No wallet found/i.test(quote.wallet)) problems.push('with no wallet present the panel did not say so');
  if (quote.sendButtons !== 5) problems.push(`expected a send button per step, found ${quote.sendButtons}`);
}

// ---- the path nobody was driving ------------------------------------------
// Everything above hires one of ours, which always answers. Six of the buttons
// on this page belong to agents that did not quote when the market was last
// asked, and clicking one of those is a thing a visitor will do first, not
// last: they are strangers' agents and they are listed among the rest on
// purpose. A dead-end click - a spinner that never resolves, or a verdict
// about somebody else's software with nothing to check it against - is the
// worst thing this panel can do, and it was untested.
//
// The agent is picked off the page rather than hardcoded: the row that says
// "did not quote when asked" renders immediately before its own button, so the
// set stays right when the next quote run changes it.
//
// The broker answers 502 when a seller cannot be reached, so driving this on
// purpose logs a console error every single time. Errors from here on are
// expected and are counted separately - a checker that reports the same
// message on every run has taught the reader to ignore its output.
const errorsBeforeFailDrive = consoleErrors.length;
let fail = null;
{
  const failing = await evaluate(`[...document.querySelectorAll('.rg-hirebtn')]
    .filter(b => b.previousElementSibling && b.previousElementSibling.className.indexOf('rg-weak') >= 0)
    .map(b => b.getAttribute('data-hire'))`);
  if (!failing?.length) {
    console.log('\nno non-quoting agent on the page to drive — skipped');
  } else {
    const pick = failing[0];
    await evaluate(`(function(){var d=document.getElementById('rg-hire'); if(d&&d.open) d.close();})()`);
    await wait(200);
    await evaluate(`document.querySelector('.rg-hirebtn[data-hire="${pick}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    await wait(300);
    await evaluate(`document.getElementById('rg-hire-quote').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    const t0 = Date.now();
    for (let i = 0; i < 45; i++) {
      await wait(1000);
      fail = await evaluate(`(function(){
        var m=document.getElementById('rg-hire-msg');
        var raw=document.getElementById('rg-hire-raw');
        var b=document.getElementById('rg-hire-quote');
        return { err: m.className.indexOf('rg-err')>=0,
                 msg: m.textContent.trim(),
                 rawShown: raw ? !raw.hidden : false,
                 tried: raw ? raw.textContent.split('\\n')[0] : '',
                 buttonBack: b ? !b.disabled : false };
      })()`);
      if (fail.err) break;
    }
    fail = { ...(fail || {}), id: pick, ms: Date.now() - t0 };
    if (!fail.err) {
      problems.push(`#${pick} did not quote and the panel never said so — it sat there for ${(fail.ms / 1000).toFixed(0)}s`);
    } else {
      // "no answer" is the fallback the panel prints when the broker sends
      // nothing usable. Reaching it means the reader learned nothing.
      if (/no answer$/i.test(fail.msg)) problems.push(`#${pick} failed with the generic fallback rather than a reason`);
      // The endpoint the broker actually tried. A verdict about a stranger's
      // agent that names no address cannot be checked by the person reading it.
      if (!fail.rawShown || fail.tried.indexOf('tried: ') !== 0) {
        problems.push(`#${pick} was declared unable to quote without showing the endpoint that was tried`);
      }
      if (!fail.buttonBack) problems.push(`#${pick} left the quote button disabled — the visitor cannot retry`);
    }
  }
}

ws.close();
chrome.kill();

console.log(`\n${buttons?.length || 0} hire buttons across ${cats.size} categories`);
for (const b of buttons || []) console.log(`  ${String(b.id).padEnd(8)} ${b.cat.padEnd(20)} ${b.name}`);
if (quote) {
  console.log(`\nnegotiated in-page for #${OURS.id}:`);
  // One line per rendered block, with the y it starts at. Printing the joined
  // textContent here is what made a correct page look broken.
  for (const b of quote.quoteBlocks || []) {
    console.log(`  y=${String(b.top).padStart(4)}  ${b.text}`);
  }
  console.log(`  steps   ${quote.steps} rendered, ${quote.sendButtons} sendable`);
  console.log(`  wallet  ${quote.wallet.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
}
if (fail && fail.id) {
  console.log(`\nan agent that does not answer, #${fail.id}:`);
  console.log(`  said it in ${(fail.ms / 1000).toFixed(1)}s`);
  console.log(`  ${fail.msg.replace(/\s+/g, ' ').slice(0, 140)}`);
  console.log(`  ${fail.tried || '(no endpoint shown)'}`);
}
const realErrors = consoleErrors.slice(0, errorsBeforeFailDrive);
const expectedErrors = consoleErrors.length - errorsBeforeFailDrive;
if (realErrors.length) {
  console.log(`\n${realErrors.length} console error(s):`);
  for (const e of realErrors.slice(0, 5)) console.log(`  ${e.slice(0, 200)}`);
}
if (expectedErrors) {
  console.log(`\n${expectedErrors} console error(s) from the deliberate failure drive — expected, the broker answers 502 for a seller it cannot reach`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ a person can open the panel, negotiate a real quote and see all five escrow steps');
