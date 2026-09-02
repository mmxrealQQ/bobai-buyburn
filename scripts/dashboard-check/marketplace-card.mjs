// Is the marketplace card actually styled in the browser, or is it raw text?
//
// The failure this catches: styles.css was extended but its ?v= was not
// bumped, so every visitor kept the cached stylesheet and got an unstyled
// block — numbers running into their labels, no button, no card. The HTML was
// perfect and the page looked broken, which is exactly the class of bug that
// no amount of reading the source finds.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9930 + (process.pid % 60);
// The counted marketplace card lives on /classic since 2026-09-02; the homepage offers the marketplace as one of three tool panels.
const URL = 'https://brainonbnb.com/?p=' + Math.floor(Math.random() * 1e9);
const profile = mkdtempSync(join(tmpdir(), `cdp-card-${process.pid}-`));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1280,1400', '--no-first-run'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) return (await r.json()).webSocketDebuggerUrl; } catch {}
    await wait(300);
  }
  throw new Error('no chrome');
}
const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (me, pa = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: me, params: pa })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'THREW ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL });
for (let i = 0; i < 40; i++) { await wait(500); if (await ev(`document.readyState==='complete'`)) break; }
for (let i = 0; i < 20; i++) { await wait(700); if (await ev(`(document.getElementById('mkt-hire')||{}).textContent !== '–'`)) break; }

const problems = [];
const style = await ev(`(() => {
  const c = document.querySelector('.mkt');
  if (!c) return null;
  const cs = getComputedStyle(c);
  const num = c.querySelector('.mkt-nums b');
  const lab = c.querySelector('.mkt-nums span');
  const go  = c.querySelector('.mkt-go');
  const r = c.getBoundingClientRect();
  return {
    radius: cs.borderRadius,
    border: cs.borderTopWidth,
    // The tell: if the stylesheet did not load, the label is inline and sits
    // on the same line as the number instead of underneath it.
    labelDisplay: lab ? getComputedStyle(lab).display : null,
    numDisplay: num ? getComputedStyle(num).display : null,
    numSize: num ? getComputedStyle(num).fontSize : null,
    goDisplay: go ? getComputedStyle(go).display : null,
    goRadius: go ? getComputedStyle(go).borderRadius : null,
    gridCols: getComputedStyle(c.querySelector('.mkt-nums')).gridTemplateColumns,
    width: Math.round(r.width),
  };
})()`);

if (!style) problems.push('no .mkt card on the page');
else {
  if (style.labelDisplay !== 'block') problems.push(`labels are ${style.labelDisplay}, not block — the stylesheet did not reach the browser (bump styles.css?v=)`);
  if (style.numDisplay !== 'block') problems.push(`numbers are ${style.numDisplay}, not block`);
  if (style.border === '0px') problems.push('the card has no border — unstyled');
  if (style.radius === '0px') problems.push('the card has no radius — unstyled');
  if (style.goDisplay === 'inline') problems.push('the call to action is plain inline text, not a button');
  if (!/px/.test(style.gridCols || '')) problems.push(`the number row is not a grid: ${style.gridCols}`);
}

// The tile that duplicated this card must be gone, and only one link in the
// block should point at the marketplace headline.
const dupes = await ev(`document.querySelectorAll('#agents a[href="/registry"]').length`);
const tileGone = await ev(`!document.getElementById('ag-census')`);
if (!tileGone) problems.push('the duplicated Brain Plaza tile is still on the page');

console.log('\ncard styling as the browser sees it:');
console.log(JSON.stringify(style, null, 2));
console.log(`\nlinks to /registry inside the Agents block: ${dupes}`);
console.log(`duplicate tile removed: ${tileGone}`);

ws.close(); chrome.kill();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ the card is styled, the numbers stack under their labels, the duplicate is gone');
