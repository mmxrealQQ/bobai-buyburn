// What a page actually costs to open, counted request by request.
//
// Nothing here measured this. The layout audit checks that things sit in the
// right place, the smoke test checks that endpoints answer, and neither of them
// notices a page that ships the same 30 KB twice or pulls a module it never
// calls. Page weight is the kind of debt that only ever grows, because no test
// fails when it does.
//
// It also settles arguments. The backlog claimed the scanner "downloads the
// same 32 KB twice" because the fee-tier worker bundles a module the page also
// loads. That is a claim about the browser, and the browser is the thing to
// ask — a module bundled into a worker never reaches it. Reasoning about a
// build graph is how you end up optimising something that was never sent.
//
//   node scripts/dashboard-check/page-weight.mjs                 /scanner
//   node scripts/dashboard-check/page-weight.mjs --page=registry another page
//   node scripts/dashboard-check/page-weight.mjs --json
//
// The page is named WITHOUT a leading slash on purpose. Git Bash rewrites a
// bare "/registry" argument into "C:/Program Files/Git/registry" before node
// ever sees it, so the first version of this script silently measured its
// default page and printed the default page's name — a measurement that looked
// right and answered a question nobody asked.
//
// Reports transfer size (what crossed the wire, compressed) alongside resource
// size (what the browser ended up holding), because the two answer different
// questions and quoting one for the other is how a page looks half its weight.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDir } from '../lib/scratch.mjs';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT || 9351);
const PATHNAME = (() => {
  const a = process.argv.find((x) => x.startsWith('--page='));
  if (!a) return '/scanner';
  const v = a.slice(7).replace(/^\/+/, '');
  return '/' + v;
})();
const AS_JSON = process.argv.includes('--json');
const W = Number(process.env.W || 1280);
// A fresh query key per run: Cloudflare caches per key, and measuring a page
// that came back from cache measures the cache.
const URL = `https://brainonbnb.com${PATHNAME}${PATHNAME.includes('?') ? '&' : '?'}probe=${Math.floor(Math.random() * 1e9)}`;

const profile = scratchDir('pageweight-');
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
const requests = new Map();   // requestId -> { url, type }
const finished = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') {
    requests.set(m.params.requestId, { url: m.params.request.url, type: m.params.type });
  }
  if (m.method === 'Network.responseReceived') {
    const r = requests.get(m.params.requestId);
    if (r) { r.type = m.params.type || r.type; r.status = m.params.response.status; r.fromCache = m.params.response.fromDiskCache; }
  }
  if (m.method === 'Network.loadingFinished') {
    const r = requests.get(m.params.requestId);
    // A resource served from cache reports zero bytes over the wire. That is
    // true and it is not the page's weight: two runs of this script differed by
    // 24 KB purely because one of them found styles.css in the memory cache.
    // Cached hits are counted separately and labelled, never as free.
    if (r) finished.push({ ...r, transfer: m.params.encodedDataLength || 0, cached: !!r.fromCache || (m.params.encodedDataLength || 0) === 0 });
  }
  if (m.method === 'Network.loadingFailed') {
    const r = requests.get(m.params.requestId);
    // A failed request is reported, not dropped. A page that quietly 404s a
    // module weighs less and works worse, and only one of those is visible in a
    // byte count.
    if (r) finished.push({ ...r, transfer: 0, failed: m.params.errorText });
  }
};
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL });

// Wait for quiet rather than for a timer: "five seconds passed" and "the page
// finished loading" are different claims, and the first one changes answer
// depending on the day.
let last = 0, stable = 0;
for (let i = 0; i < 60; i++) {
  await wait(400);
  if (finished.length === last) { if (++stable >= 5) break; } else { stable = 0; last = finished.length; }
}

// Resource sizes come from the page itself: the Performance API knows what the
// browser decompressed, which the protocol's encodedDataLength does not say.
const perf = await send('Runtime.evaluate', {
  expression: `JSON.stringify(performance.getEntriesByType('resource').map(e => ({ name: e.name, decoded: e.decodedBodySize, transfer: e.transferSize })))`,
  returnByValue: true, awaitPromise: true,
});
let decoded = new Map();
try {
  for (const e of JSON.parse(perf.result?.result?.value || '[]')) decoded.set(e.name, e.decoded || 0);
} catch { /* the page may block it; transfer sizes still stand */ }

ws.close();
chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds the profile briefly */ }

const own = finished.filter((r) => r.url.startsWith('https://brainonbnb.com'));
const third = finished.filter((r) => !r.url.startsWith('https://brainonbnb.com') && r.url.startsWith('http'));
const totalTransfer = finished.reduce((s, r) => s + r.transfer, 0);
const cachedHits = finished.filter((r) => r.cached && !r.failed && (decoded.get(r.url) || 0) > 0);
const totalDecoded = [...decoded.values()].reduce((s, v) => s + v, 0);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

// The question the backlog asked: is any file fetched more than once, or are
// two different files carrying the same payload?
const bySize = new Map();
for (const r of own) {
  if (!r.transfer) continue;
  const k = String(r.transfer);
  bySize.set(k, [...(bySize.get(k) || []), r.url]);
}
const suspects = [...bySize.entries()]
  .filter(([, urls]) => urls.length > 1 && new Set(urls.map((u) => u.split('?')[0])).size > 1)
  .map(([size, urls]) => ({ size: Number(size), urls }));
const repeats = [...new Map(own.map((r) => [r.url, r])).keys()].length !== own.length;

if (AS_JSON) {
  console.log(JSON.stringify({
    page: PATHNAME, measured_at: new Date().toISOString(),
    requests: finished.length, transfer_bytes: totalTransfer, decoded_bytes: totalDecoded,
    resources: finished.map((r) => ({ url: r.url, type: r.type, status: r.status, transfer: r.transfer, decoded: decoded.get(r.url) || null, failed: r.failed || null })),
  }, null, 2));
} else {
  console.log(`Page weight — ${PATHNAME}\n`);
  console.log(`  ${finished.length} requests · ${kb(totalTransfer)} over the wire · ${kb(totalDecoded)} once unpacked`);
  if (cachedHits.length) console.log(`  ${cachedHits.length} served from cache and therefore free THIS time, not free on a first visit: ${cachedHits.map((r) => r.url.replace('https://brainonbnb.com', '')).join(', ')}`);
  console.log(`  ${own.length} from this origin · ${third.length} from elsewhere\n`);
  const rows = own.slice().sort((a, b) => b.transfer - a.transfer).slice(0, 14);
  for (const r of rows) {
    const d = decoded.get(r.url);
    const path = (r.url.replace('https://brainonbnb.com', '') || '/') + (r.cached && !r.failed ? '  (from cache)' : '');
    console.log(`  ${kb(r.transfer).padStart(9)} ${(d ? kb(d) : '').padStart(10)}  ${r.failed ? 'FAILED ' : ''}${path.slice(0, 70)}`);
  }
  if (third.length) {
    console.log('\n  from other origins:');
    for (const r of third.slice(0, 6)) console.log(`  ${kb(r.transfer).padStart(9)} ${' '.padStart(10)}  ${r.url.slice(0, 70)}`);
  }
  const failed = finished.filter((r) => r.failed);
  if (failed.length) {
    console.log('\n  requests that did not complete:');
    for (const r of failed) console.log(`    ${r.url.slice(0, 80)} — ${r.failed}`);
  }
  console.log('');
  if (suspects.length) {
    console.log('  two different files came back the same size — possibly the same payload twice:');
    for (const s of suspects) console.log(`    ${kb(s.size)}: ${s.urls.map((u) => u.replace('https://brainonbnb.com', '')).join(' , ')}`);
  } else if (repeats) {
    console.log('  a URL was requested more than once.');
  } else {
    console.log('  nothing fetched twice, and no two files share a size.');
  }
}
