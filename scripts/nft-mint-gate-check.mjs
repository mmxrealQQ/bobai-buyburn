#!/usr/bin/env node
// One NFT per buy (2026-10-23, operator: "the whale buy of 16:46 shows twice, with two NFTs — it was one buy"; then
// "es soll einfach nicht mehr passieren"). Buy 0x7380aa63… was minted twice, #209 and #210, by two runs of
// worker-nft-mint that overlapped and read the same stale KV. This holds the two guards (MintGate, a Durable Object):
//   the lock   two runs started together: exactly one runs; a run's lock is freed when it ends, also when it throws;
//              a stranger's unlock frees nothing; a crashed run's lease runs out
//   the mark   a minted buy is marked with its mint tx and read back in any case; the run asks before it mints and
//              marks right after the receipt; a gate that cannot be asked means no mint this run (a late NFT, never two)
// Offline, in memory. Part of self-tests.mjs.   node scripts/nft-mint-gate-check.mjs
import path from 'node:path'; import fs from 'node:fs'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const M = await import(pathToFileURL(path.join(ROOT, 'worker-nft-mint', 'index.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more && !ok ? ' — ' + more : '')); ok ? pass++ : fail++; };

// the Durable Object on an in-memory storage, its requests one after another as the runtime's input gate keeps them
const mem = new Map();
const storage = { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, structuredClone(v)); }, delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => mem.delete(x)); }, list: async ({ prefix = '' } = {}) => new Map([...mem].filter(([k]) => k.startsWith(prefix))) };
const gate = new M.MintGate({ storage });
let chain = Promise.resolve();
const stub = { fetch: (u) => { const run = chain.then(() => gate.fetch(new Request(u))); chain = run.catch(() => {}); return run; } };
const env = { MINT_GATE: { idFromName: () => 'mint', get: () => stub } };

// the lock
const [a, b] = await Promise.all([M.lockRun(env), M.lockRun(env)]);
is('two runs started together: exactly one gets the lock', [a.ok, b.ok].filter(Boolean).length === 1, JSON.stringify([a, b]));
const holder = a.ok ? a : b;
await M.unlockRun(env, 'not-the-holder');
is('an unlock by another run frees nothing', !(await M.lockRun(env)).ok);
await M.unlockRun(env, holder.run);
const again = await M.lockRun(env);
is('the holder\'s unlock frees it for the next run', again.ok);
mem.set('lock', Date.now() - 1);
is('a crashed run\'s lease runs out (15 minutes), then a run may start', (await M.lockRun(env)).ok);
mem.delete('lock'); mem.delete('lock_run');

// the scheduled wrapper: locked -> no run; a run that throws still frees the lock
const W = M.default; const real = W.runMint; let runs = 0;
W.runMint = async () => { runs++; };
mem.set('lock', Date.now() + 60000); mem.set('lock_run', 'other');
await W.scheduled({}, env, {});
is('while another run holds the lock, a scheduled run does nothing', runs === 0);
mem.delete('lock'); mem.delete('lock_run');
W.runMint = async () => { runs++; throw new Error('boom'); };
await W.scheduled({}, env, {}).catch(() => {});
is('a run that throws frees the lock all the same', runs === 1 && !(mem.get('lock') > Date.now()));
let overlap = 0, inside = 0;
W.runMint = async () => { inside++; overlap = Math.max(overlap, inside); await new Promise((r) => setTimeout(r, 30)); inside--; };
await Promise.all([W.scheduled({}, env, {}), W.scheduled({}, env, {}), W.scheduled({}, env, {})]);
is('three cron firings at once: never two runs inside at the same time', overlap === 1, `overlap ${overlap}`);
const failing = { MINT_GATE: { idFromName: () => 'mint', get: () => ({ fetch: async () => { throw new Error('gate down'); } }) } };
runs = 0; W.runMint = async () => { runs++; };
await W.scheduled({}, failing, {});
is('a gate that cannot be asked: no run this minute', runs === 0);
W.runMint = real;

// the mark
const BUY = '0x7380AA63500086355C6F25330FC669327A356A788FEF8AB5F13D0C6EA3C6D62A';
is('a buy not minted reads as null', (await M.mintedFor(env, BUY)) === null);
await M.markMinted(env, BUY, '0xa9e7d185');
const m = await M.mintedFor(env, BUY.toLowerCase());
is('a minted buy is marked with its mint tx and read back in any case', m && m.mintTx === '0xa9e7d185');
let threw = false; try { await M.mintedFor(failing, BUY); } catch { threw = true; }
is('asking a gate that is down throws (the run then bails and retries; it never mints blind)', threw);
is('no gate bound (a local run): every buy reads as not minted, the run is not locked', (await M.mintedFor({}, BUY)) === null && (await M.lockRun({})).ok);

// the run asks before it mints, marks right after the receipt, and bails when the gate cannot be asked
const src = fs.readFileSync(path.join(ROOT, 'worker-nft-mint', 'index.js'), 'utf8');
const body = src.slice(src.indexOf('async runMint(env)'));
const iAsk = body.indexOf('await mintedFor(env, txHash)'), iSend = body.indexOf("functionName: 'mintTo'"), iRc = body.indexOf('waitForTransactionReceipt({ hash: mintTxHash'), iMark = body.indexOf('await markMinted(env, txHash, mintTxHash)'), iDrop = body.indexOf("env.KV.put('recent_drops'");
is('in the run: ask the gate, then mint, then the receipt, then the mark, then the drop ledger', iAsk > 0 && iAsk < iSend && iSend < iRc && iRc < iMark && iMark < iDrop, JSON.stringify({ iAsk, iSend, iRc, iMark, iDrop }));
is('a gate that cannot be asked about a buy stops the scan there (bailed, retried next run)', /catch \(e\) \{ console\.error\(`\[gate\] could not ask about[^]*?bailed = true; break outer; \}/.test(body));
is('a buy already marked is skipped and marked processed, never minted', /if \(already\) \{[^\n]*processed\.add\(txHash\); continue; \}/.test(body));
const toml = fs.readFileSync(path.join(ROOT, 'worker-nft-mint', 'wrangler.toml'), 'utf8');
is('the worker binds the gate (MINT_GATE -> MintGate, with its migration)', /name = "MINT_GATE"\s+class_name = "MintGate"/.test(toml) && /new_sqlite_classes = \["MintGate"\]/.test(toml));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
