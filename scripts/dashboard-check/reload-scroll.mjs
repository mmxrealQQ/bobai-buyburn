// Three things must hold at once after the reload fix:
//   1. a plain load starts at the top
//   2. a shared deep link (#library) still jumps to the section
//   3. reloading that same deep-linked page lands at the top, hash cleared
// The third is the bug; the first two are what must not break while fixing it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE = process.argv.includes('--local') ? 'http://127.0.0.1:8899' : 'https://brainonbnb.com';
const PORT = 9700 + (process.pid % 200);
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }

const tmp = path.join(process.env.TEMP || '.', 'test-scroll-' + process.pid);
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
  '--hide-scrollbars', '--no-first-run', '--disable-gpu',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0;
const pending = new Map();
const connect = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
      const t = await r.json();
      ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      };
      return;
    } catch { await sleep(400); }
  }
  throw new Error('could not reach Chrome on port ' + PORT);
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
const settle = async () => {
  for (let i = 0; i < 60; i++) { await sleep(250); if (await evaluate('document.readyState === "complete"')) break; }
  await sleep(2200); // the page fills late; shorter windows read as broken
};

await connect();
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulation', { enabled: true, maxTouchPoints: 5 });

const state = async () => evaluate(`({y: Math.round(scrollY), hash: location.hash})`);
let failed = 0;
const check = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

console.log(`\nReload behaviour on ${BASE}\n`);

await send('Page.navigate', { url: BASE });
await settle();
const plain = await state();
check('a plain load starts at the top', plain.y === 0, `scrollY = ${plain.y}`);

const libTop = await evaluate(`Math.round(document.getElementById('library').getBoundingClientRect().top + scrollY)`);

await send('Page.navigate', { url: BASE + '/#library' });
await settle();
const deep = await state();
check('a shared #library link still jumps there', deep.y > libTop - 400 && deep.y > 1000,
  `scrollY = ${deep.y}, library at ${libTop}`);

await send('Page.reload');
await settle();
const reloaded = await state();
check('reloading that page lands at the top', reloaded.y === 0, `scrollY = ${reloaded.y}`);
check('and the hash is gone from the address bar', reloaded.hash === '', `hash = "${reloaded.hash}"`);

// The guard must still hold: a visitor who is already reading is not yanked back.
await send('Page.navigate', { url: BASE });
for (let i = 0; i < 60; i++) { await sleep(250); if (await evaluate('document.readyState === "interactive" || document.readyState === "complete"')) break; }
await evaluate(`(() => { dispatchEvent(new TouchEvent('touchstart',{bubbles:true})); scrollTo(0, 4000); })()`);
await sleep(2500);
const reading = await state();
check('someone who scrolls right away is left alone', reading.y > 1000, `scrollY = ${reading.y}`);

console.log(`\n${failed ? failed + ' failed' : 'all four hold'}`);
cleanup();
process.exit(failed ? 1 : 0);
