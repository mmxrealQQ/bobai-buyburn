#!/usr/bin/env node
// edgeRecord (dashboard/_worker.js, 2026-11-28): a record source the site writes into a page without a browser
// (/registry tiles, /agent/<id> summary) is kept 2 minutes and a day as a spare. Before it, the first reader after
// each expiry waited on the source, and a slow one (/buys, /chart over 2.5 s) left that reader "—".
//
// The function is read out of the worker's source and run against a fake edge cache and a fake fetch, so the test
// needs no network. Each case also runs against a MUTANT (the spare lookup taken out = the old behaviour) and must
// FAIL there where it says so — a check that cannot see the old bug proves nothing.
//
//   node scripts/edge-record-regressions.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const W = fs.readFileSync(path.join(ROOT, 'dashboard', '_worker.js'), 'utf8');
const m = W.match(/async function edgeRecord\(u, ctx, waitMs = \d+\) \{[\s\S]*?\n\}\n/);
if (!m) { console.log('FAIL  edgeRecord not found in dashboard/_worker.js'); process.exit(1); }
const SRC = m[0];
const MUTANT = SRC.replace(/const sp = await read\(await cache\.match\(spare\)[^\n]*\n/, 'const sp = null;\n');
if (MUTANT === SRC) { console.log('FAIL  the mutant could not be made (spare lookup line changed?)'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a fake caches.default keyed by URL; a fake fetch with a delay and a status per URL
function world({ cached = {}, source = {} }) {
  const store = new Map(Object.entries(cached).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts = [], waits = [];
  const caches = { default: {
    match: async (req) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
    put: async (req, res) => { const t = await res.text(); store.set(req.url, t); puts.push(req.url); },
  } };
  const fetch = async (u) => { const s = source[u] || { status: 0 }; await sleep(s.delay || 0); if (!s.status) throw new Error('down'); return new Response(s.status === 200 ? JSON.stringify(s.body) : 'x', { status: s.status }); };
  const ctx = { waitUntil: (p) => waits.push(p) };
  return { caches, fetch, ctx, store, puts, waits };
}
const make = (src, w) => new Function('caches', 'fetch', 'AbortSignal', `const GONE = '{"__status":404}';${src}; return edgeRecord;`)(w.caches, w.fetch, { timeout: () => undefined });

const U = 'https://agent.brainonbnb.com/buys', SP = 'https://agent.brainonbnb.com/buys?_spare=1';
const CASES = [
  { name: 'fresh copy at the edge: answered from it, the source not asked', mutantFails: false,
    w: () => world({ cached: { [U]: { n: 1 } }, source: { [U]: { status: 200, body: { n: 9 }, delay: 0 } } }),
    run: (f, w) => f(U, w.ctx, 50), ok: (r) => r.json?.n === 1 },
  { name: 'fast source, nothing cached: its answer, kept fresh AND as the spare', mutantFails: false,
    w: () => world({ source: { [U]: { status: 200, body: { n: 2 }, delay: 0 } } }),
    run: async (f, w) => { const r = await f(U, w.ctx, 200); await Promise.all(w.waits); return { r, w }; },
    ok: ({ r, w }) => r.json?.n === 2 && w.store.has(U) && w.store.has(SP) },
  { name: 'slow source, a spare from earlier: the spare (the old code gave the dash)', mutantFails: true,
    w: () => world({ cached: { [SP]: { n: 3 } }, source: { [U]: { status: 200, body: { n: 4 }, delay: 300 } } }),
    run: (f, w) => f(U, w.ctx, 50), ok: (r) => r.json?.n === 3 && r.spare === true },
  { name: 'slow source: it goes on in the background and renews fresh + spare for the next reader', mutantFails: false,
    w: () => world({ cached: { [SP]: { n: 3 } }, source: { [U]: { status: 200, body: { n: 4 }, delay: 120 } } }),
    run: async (f, w) => { await f(U, w.ctx, 30); await Promise.all(w.waits); return w; },
    ok: (w) => JSON.parse(w.store.get(U)).n === 4 && JSON.parse(w.store.get(SP)).n === 4 },
  { name: 'source down (5xx), a spare: the spare', mutantFails: true,
    w: () => world({ cached: { [SP]: { n: 5 } }, source: { [U]: { status: 503, delay: 0 } } }),
    run: (f, w) => f(U, w.ctx, 200), ok: (r) => r.json?.n === 5 },
  { name: 'a 404 stays a 404, a spare never covers it (an agent id nobody holds)', mutantFails: false,
    w: () => world({ cached: { [SP]: { n: 6 } }, source: { [U]: { status: 404, delay: 0 } } }),
    run: (f, w) => f(U, w.ctx, 200), ok: (r) => r.status === 404 && r.json == null },
  { name: 'a 404 is kept: the next reader gets the 404 at once, even with the source slow (/chart/999999999 took 3.2 s)', mutantFails: false,
    w: () => world({ source: { [U]: { status: 404, delay: 0 } } }),
    run: async (f, w) => { await f(U, w.ctx, 200); await Promise.all(w.waits); return { r: await f(U, w.ctx, 50), w }; },
    ok: ({ r, w }) => r.status === 404 && w.store.get(U) === '{"__status":404}' && w.store.get(SP) === '{"__status":404}' },
  { name: 'a 404 kept as the spare answers a slow source as a 404, not as a figure', mutantFails: true,
    w: () => world({ cached: { [SP]: { __status: 404 } }, source: { [U]: { status: 404, delay: 300 } } }),
    run: (f, w) => f(U, w.ctx, 50), ok: (r) => r.status === 404 && r.json == null },
  { name: 'a 404 replaces an older figure in the spare (an id that was deregistered is not shown as alive)', mutantFails: false,
    w: () => world({ cached: { [SP]: { n: 8 } }, source: { [U]: { status: 404, delay: 0 } } }),
    run: async (f, w) => { await f(U, w.ctx, 200); await Promise.all(w.waits); return w; },
    ok: (w) => w.store.get(SP) === '{"__status":404}' },
  { name: 'slow source, never answered here: no figure (the page stays as it was)', mutantFails: false,
    w: () => world({ source: { [U]: { status: 200, body: { n: 7 }, delay: 300 } } }),
    run: (f, w) => f(U, w.ctx, 50), ok: (r) => r.json == null },
];

let bad = 0;
for (const c of CASES) {
  let w = c.w(); const pass = c.ok(await c.run(make(SRC, w), w));
  w = c.w(); const mutPass = c.ok(await c.run(make(MUTANT, w), w));
  const good = pass && (c.mutantFails ? !mutPass : true);
  if (!good) bad++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${c.name}${c.mutantFails ? ` (mutant: ${mutPass ? 'passed, should fail' : 'fails, as it should'})` : ''}`);
}
console.log(bad ? `\n${bad} FAIL` : `\nedgeRecord: all ${CASES.length} PASS`);
process.exit(bad ? 1 : 0);
