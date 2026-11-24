#!/usr/bin/env node
// The tax bot, RUN — on a fork. worker/index.js splits real money every ten
// minutes and had never been run anywhere but in production: every change to
// it was proved by reading. This starts anvil on the current block, gives a
// throwaway key 0.1 BNB (the bot's own key is never read; a key made here
// holds nothing on any real chain), points the worker's BSC_RPC_URL at
// 127.0.0.1 and its KV at a Map, and calls the SAME scheduled() Cloudflare
// calls — against PancakeSwap's real router and the real $BOB and $BOBAI pairs.
//
// What it holds the run against:
//   the split      creator, DeFi agent and Giggle pot receive exactly their bps of what was available
//   the legs       every transaction of the log entry is in a block with status success
//   the burns      the dead address holds more of both tokens by what the log says; the wallet keeps none
//   the minimum    the $BOBAI swap's amountOutMin is 95% of what ARRIVES (97% of the quote), not of the gross quote
//   the remainder  the wallet is left with its gas reserve, less the gas it spent
//   the heartbeat  written, and the lock released
// and, offline, the helpers lifted from both files: a receipt wait that throws is
// asked again, a reverted receipt is a failure, an error is logged without its RPC URL.
//
// Needs anvil (~/.foundry/bin) and BSC_RPC_KEYED_URL_2 in .env, like lp-fork-test.mjs.
//   node scripts/buyback-fork-test.mjs
import 'dotenv/config';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, createTestClient, http, parseAbi, parseEther, formatEther, decodeFunctionData } from 'viem';
import { bsc } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8547, LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.BSC_RPC_KEYED_URL_2 || process.env.BSC_RPC_KEYED_URL_1 || process.env.BSC_ARCHIVE_RPC_URL;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');

let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const workerSrc = fs.readFileSync(path.join(ROOT, 'worker', 'index.js'), 'utf8');
const fallbackSrc = fs.readFileSync(path.join(ROOT, 'buyback-bot.js'), 'utf8');

// ── offline: the helpers, lifted from the file as they stand ────────────────
console.log('the helpers (offline)');
{
  const block = (text) => text.slice(text.indexOf('async function waitMined('), text.indexOf('async function swapAndBurn('));
  ok('both bots carry the same helpers, to the letter', block(workerSrc).length > 500 && block(workerSrc) === block(fallbackSrc));
  const swap = (text) => text.slice(text.indexOf('async function swapAndBurn('), text.indexOf('async function sleep('));
  ok('and the same swap-and-burn', swap(workerSrc).length > 500 && swap(workerSrc) === swap(fallbackSrc));
  const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff', BOB = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
  // parseEther: the 808.41 keep (2026-10-08) sits in this block
  const lifted = new Function('BOBAI_TOKEN', 'sleep', 'parseEther', `${block(workerSrc)}; return { waitMined, mined, say, minOutFor };`)(BOBAI, async () => {}, parseEther);
  ok('$BOBAI: the 3% the token keeps comes off the quote first, then the 5%', lifted.minOutFor(1000000n, BOBAI) === 921500n && lifted.minOutFor(1000000n, BOBAI.toUpperCase().replace('0X', '0x')) === 921500n);
  ok('$BOB has no transfer tax: 95% of the quote, as before', lifted.minOutFor(1000000n, BOB) === 950000n);
  // The transport: the first node, the public ones behind it, in order; alone on a fork.
  const tBlock = (text) => text.slice(text.indexOf('const FALLBACK_RPCS'), text.indexOf('async function waitMined('));
  const mk = new Function('http', 'fallback', `${tBlock(workerSrc)}; return { rpcTransport, FALLBACK_RPCS };`)((u) => ({ http: u }), (list, opts) => ({ list, opts }));
  const t = mk.rpcTransport('https://keyed.example/abc');
  ok('the keyed node is asked first and the public ones stand behind it, in order, never ranked', tBlock(workerSrc) === tBlock(fallbackSrc) && t.list.length === 4 && t.list[0].http === 'https://keyed.example/abc' && t.opts.rank === false);
  ok('a node named twice is asked once, and a fork has no second node', mk.rpcTransport(mk.FALLBACK_RPCS[0]).list.length === 3 && mk.rpcTransport('http://127.0.0.1:8547', 'none').http === 'http://127.0.0.1:8547');
  ok('the lock outlives the ten minutes between two ticks', /lock-buyback'[^\n]*expirationTtl: 900/.test(workerSrc) && /crons = \["\*\/10 \* \* \* \*"\]/.test(fs.readFileSync(path.join(ROOT, 'worker', 'wrangler.toml'), 'utf8')));
  // The fallback script beside a living worker.
  const hb = new Function(`${fallbackSrc.slice(fallbackSrc.indexOf('function heartbeatIsFresh('), fallbackSrc.indexOf('async function workerHeartbeat('))}; return heartbeatIsFresh;`)();
  const at = Date.parse('2026-09-18T12:45:00Z');
  ok('the fallback script refuses while the worker\'s heartbeat is fresh, and runs when there is none', hb({ buyback: '2026-09-18T12:40:57Z' }, at) === true && hb({ buyback: '2026-09-18T12:20:00Z' }, at) === false && hb(null, at) === false && hb({ buyback: 'x' }, at) === false && hb({ buyback: '2026-09-18T14:00:00Z' }, at) === false);
  ok('and it asks before it reads the key', fallbackSrc.indexOf('heartbeatIsFresh(health)') < fallbackSrc.indexOf('process.env.BUYBACK_PRIVATE_KEY ||'));
  // The liquidity hand script: its wallet, its receipts, its hour.
  const liqSrc = fs.readFileSync(path.join(ROOT, 'add-liquidity-safe.js'), 'utf8');
  const liq = new Function(`${liqSrc.slice(liqSrc.indexOf('function mustSucceed('), liqSrc.indexOf('function sleep('))}; return { mustSucceed, inSweepWindow };`)();
  const threw = (fn) => { try { fn(); return false; } catch { return true; } };
  ok('the liquidity script stops on a reverted or missing receipt, and only then', threw(() => liq.mustSucceed({ status: 'reverted' }, 'x')) && threw(() => liq.mustSucceed(null, 'x')) && liq.mustSucceed({ status: 'success', blockNumber: 5n }, 'x').blockNumber === 5n && (liqSrc.match(/mustSucceed\(await publicClient\.waitForTransactionReceipt/g) || []).length === 4 && !/^\s+await publicClient\.waitForTransactionReceipt/m.test(liqSrc));
  const min = (m) => new Date(Date.UTC(2026, 8, 18, 4, m, 30));
  ok('it does not start across the dev sweep\'s full hour (55 to 02), and does at any other minute', [55, 59, 0, 2].every((m) => liq.inSweepWindow(min(m))) && [3, 4, 30, 54].every((m) => !liq.inSweepWindow(min(m))));
  ok('and it runs on the creator wallet only, asked before anything is read from the chain', liqSrc.indexOf('does not open the creator wallet') > 0 && liqSrc.indexOf('does not open the creator wallet') < liqSrc.indexOf('createPublicClient({'));
  let asked = 0;
  const slow = { waitForTransactionReceipt: async () => { throw new Error('timed out at https://bsc-mainnet.example/v1/SECRETKEY'); }, getTransactionReceipt: async () => (++asked < 3 ? null : { status: 'success', blockNumber: 1n }) };
  const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
  const rc = await lifted.waitMined(slow, '0xabc');
  const never = await lifted.waitMined({ ...slow, getTransactionReceipt: async () => null }, '0xabc');
  let reverted = null, none = null;
  try { await lifted.mined({ waitForTransactionReceipt: async () => ({ status: 'reverted' }) }, '0xabc', 'swap'); } catch (e) { reverted = e.message; }
  try { await lifted.mined({ ...slow, getTransactionReceipt: async () => null }, '0xabc', 'creator share'); } catch (e) { none = e.message; }
  console.log = log;
  ok('a receipt wait that throws is asked again, and the receipt that then comes counts', rc && rc.status === 'success' && asked === 3);
  ok('a transaction nobody can find is given up as unknown, not as done', never === null && /no receipt/.test(none || ''));
  ok('a reverted receipt is a failure', /reverted/.test(reverted || ''));
  ok('an error is logged without the RPC URL and its key', lines.some((l) => l.includes('[rpc]')) && !lines.some((l) => l.includes('SECRETKEY')) && lifted.say(new Error('x https://a.b/c?key=1 y')) === 'x [rpc] y');

  // The log append: a KV that fails must not cost the line of a run whose money moved.
  const devSrc = fs.readFileSync(path.join(ROOT, 'worker-dev-buyback', 'index.js'), 'utf8');
  const app = (text) => text.slice(text.indexOf("const UNLOGGED = 'unlogged:';"), text.indexOf('\n}\n', text.indexOf('async function kvAppend(')) + 3);
  ok('both workers carry the same log append, to the letter', app(workerSrc).length > 800 && app(workerSrc) === app(devSrc) && !/LOGS\.put\(logKey/.test(devSrc));
  const kvAppend = new Function(`${app(workerSrc)}; return kvAppend;`)();
  const store = new Map(); let failPuts = 0, failBig = false;
  const LOGS = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { if (failPuts > 0) { failPuts--; throw new Error('KV PUT failed: 500'); } if (failBig && !k.startsWith('unlogged:')) throw new Error('KV PUT failed: 500'); store.set(k, v); },
    delete: async (k) => { store.delete(k); },
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
  const read = (k) => JSON.parse(store.get(k) || '[]');
  console.log = () => {};
  store.set('burns.json', JSON.stringify([{ time: '2026-09-18T23:10:19.132Z', totalBnb: '1' }]));
  failPuts = 2;
  const third = await kvAppend({ LOGS }, 'burns.json', { time: '2026-09-19T01:00:00.000Z', totalBnb: '2' }, 0);
  const afterRetry = read('burns.json');
  failBig = true;
  const parkedRun = await kvAppend({ LOGS }, 'burns.json', { time: '2026-09-19T02:00:00.000Z', totalBnb: '3' }, 0);
  const whileParked = { log: read('burns.json').length, keys: [...store.keys()].filter((k) => k.startsWith('unlogged:')) };
  failBig = false;
  await kvAppend({ LOGS }, 'dev-buyback-log.json', { time: '2026-09-19T02:30:00.000Z' }, 0);   // another log leaves it alone
  const otherLog = [...store.keys()].filter((k) => k.startsWith('unlogged:')).length;
  const next = await kvAppend({ LOGS }, 'burns.json', { time: '2026-09-19T03:00:00.000Z', totalBnb: '4' }, 0);
  const healed = read('burns.json');
  const clearedKey = ![...store.keys()].some((k) => k.startsWith('unlogged:burns'));
  await kvAppend({ LOGS }, 'burns.json', { time: '2026-09-19T03:00:00.000Z', totalBnb: '4' }, 0);   // the same entry again
  const afterSame = read('burns.json').length;
  store.set('burns.json', '{"not":"an array"}');
  const broken = await kvAppend({ LOGS }, 'burns.json', { time: '2026-09-19T04:00:00.000Z' }, 0);
  console.log = log;
  ok('a put that fails twice is tried a third time, and the line is there once', third === true && afterRetry.length === 2 && afterRetry[1].totalBnb === '2');
  ok('an entry that cannot be written is parked under its own key, the log untouched', parkedRun === false && whileParked.log === 2 && whileParked.keys.length === 1 && whileParked.keys[0] === 'unlogged:burns.json:2026-09-19T02:00:00.000Z' && otherLog === 1);
  ok('the next append carries it in, oldest first, and clears the key', next === true && healed.map((e) => e.totalBnb).join() === '1,2,3,4' && clearedKey);
  ok('nothing goes in twice, and a stored log that is no array is never overwritten', afterSame === 4 && broken === false && store.get('burns.json') === '{"not":"an array"}' && store.has('unlogged:burns.json:2026-09-19T04:00:00.000Z'));

  // The lock: KV lost a delete without an error on 4 of 237 ticks, and the next tick was skipped.
  const left = workerSrc.slice(workerSrc.indexOf('function lockIsLeftOver('), workerSrc.indexOf('export default {'));
  const leftOver = new Function(`${left}; return lockIsLeftOver;`)();
  const L = '2026-11-01T15:10:46.941Z';
  ok('a lock older than the heartbeat is a finished run\'s, and the tick goes on', leftOver(L, '2026-11-01T15:10:47.208Z') === true);
  ok('a lock newer than the heartbeat is a run still going, and with none it is too', leftOver(L, '2026-11-01T15:01:00.000Z') === false && leftOver(L, null) === false && leftOver(L, 'x') === false);
  ok('the tick asks it before it skips, and writes the heartbeat before the delete', /if \(!lockIsLeftOver\(lock, heartbeat\)\) \{\s+console\.log\(`Previous run still active[^\n]+\n\s+return;/.test(workerSrc) && workerSrc.indexOf("put('heartbeat-buyback'") < workerSrc.indexOf("delete('lock-buyback')"));
  ok('/health names what is parked', /unlogged: parked/.test(workerSrc) && /list\(\{ prefix: UNLOGGED \}\)/.test(workerSrc));

  // The liquidity add rests between boosts; what it will do when the next one starts.
  const liqBlock = (text) => text.slice(text.indexOf('function liqMins('), text.indexOf('\n}\n', text.indexOf('async function addLiquidityAndBurn(')) + 3);
  const lb = liqBlock(workerSrc);
  ok('both bots carry the same liquidity add, to the letter', lb.length > 4000 && lb === liqBlock(fallbackSrc));
  const liqMins = new Function(`${lb.slice(0, lb.indexOf('async function addLiquidityAndBurn('))}; return liqMins;`)();
  const E = 10n ** 18n;
  const few = liqMins(1000n * E, 2n * E, 1000000n * E, 1000n * E), many = liqMins(1000n * E, E / 2n, 1000000n * E, 1000n * E);
  ok('its minimums are 95% of what the router will use: all the tokens when they are the short side', few.tokenUsed === 1000n * E && few.bnbUsed === E && few.tokenMin === 950n * E && few.bnbMin === (E * 95n) / 100n);
  ok('and all the BNB when that is the short side; a pair without reserves gets no add', many.bnbUsed === E / 2n && many.tokenUsed === 500n * E && many.tokenMin === 475n * E && many.bnbMin === (E / 2n * 95n) / 100n && liqMins(E, E, 0n, E) === null);
  {
    // The hand script's add carries the same function, to the letter, and no zero minimum (2026-09-19).
    const handSrc = fs.readFileSync(path.join(ROOT, 'add-liquidity-safe.js'), 'utf8');
    const fnOf = (text) => text.slice(text.indexOf('function liqMins('), text.indexOf('\n}\n', text.indexOf('function liqMins(')) + 3);
    ok('the liquidity hand script sizes its minimums with the bot\'s own liqMins, to the letter, and sends no 0', fnOf(handSrc).length > 300 && fnOf(handSrc) === fnOf(workerSrc) && !/const minToken = 0n|const minBnb = 0n/.test(handSrc) && /args: \[BOBAI_TOKEN, LIQUIDITY_BOBAI, minToken, minBnb, account\.address, deadline\]/.test(handSrc) && /const minToken = mins\.tokenMin;/.test(handSrc) && /const minBnb = mins\.bnbMin;/.test(handSrc));
    ok('… and nothing else of it moved: keep 808.41, three chunks, 2% on the swap, the creator wallet, the sweep window', /KEEP_BOBAI = parseEther\('808\.41'\)/.test(handSrc) && /SLIPPAGE_PERCENT = 2;/.test(handSrc) && /SWAP_CHUNKS = 3;/.test(handSrc) && /return m >= 55 \|\| m < 3;/.test(handSrc) && /0x15Ba17075ef5E0736292b030e3715d9100fe3d38/.test(handSrc));
  }
  ok('no minimum of 0, no approval beyond the balance, the chunk minimum knows the transfer tax, every receipt is looked at', !/tokenBalance, 0n, 0n/.test(lb) && /args: \[PANCAKE_ROUTER_V2, tokenBalance\],/.test(lb) && !/tokenBalance \* 2n/.test(lb) && /minOutFor\(amountsOut\[1\], tokenAddress\)/.test(lb) && !/waitForTransactionReceipt/.test(lb) && (lb.match(/await mined\(/g) || []).length === 4 && !/e\.message/.test(lb));
}

// ── the run, on the fork ────────────────────────────────────────────────────
if (process.argv.includes('--offline')) { console.log(`\n${n - failed}/${n} checks pass (offline only)`); process.exit(failed ? 1 : 0); }
if (!FORK_URL) { console.error('No archive RPC in .env (BSC_RPC_KEYED_URL_2).'); process.exit(2); }
if (!fs.existsSync(ANVIL)) { console.error(`anvil not found at ${ANVIL}`); process.exit(2); }
const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--no-rate-limit', '--gas-price', '100000000', '--block-base-fee-per-gas', '0'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });

const chain = { ...bsc, rpcUrls: { default: { http: [LOCAL] } } };
const pub = createPublicClient({ chain, transport: http(LOCAL, { timeout: 120000 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(LOCAL, { timeout: 120000 }) });
for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(500); } }
const forkBlock = await pub.getBlockNumber();

const key = generatePrivateKey(), bot = privateKeyToAccount(key).address;
await test.setBalance({ address: bot, value: parseEther('0.1') });
const kv = new Map();
const env = {
  BUYBACK_PRIVATE_KEY: key,
  BSC_RPC_URL: LOCAL,
  BSC_RPC_FALLBACKS: 'none',   // a fork has no second node; nothing of this run may reach a real one
  LOGS: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) },
};
const addr = (name) => (workerSrc.match(new RegExp(`const ${name} = '(0x[0-9a-fA-F]{40})'`)) || [])[1];
const CREATOR = addr('CREATOR_WALLET'), LPA = addr('LP_AGENT_WALLET'), POT = addr('PRIZE_POOL_WALLET'), BOB = addr('BOB_TOKEN'), BOBAI = addr('BOBAI_TOKEN'), DEAD = addr('DEAD_ADDRESS');
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const bal = (a) => pub.getBalance({ address: a });
const tok = (t, a) => pub.readContract({ address: t, abi: ERC20, functionName: 'balanceOf', args: [a] });
const before = { creator: await bal(CREATOR), lpa: await bal(LPA), pot: await bal(POT), deadBob: await tok(BOB, DEAD), deadBobai: await tok(BOBAI, DEAD), block: await pub.getBlockNumber() };

console.log(`\nthe run (fork of block ${forkBlock}, throwaway wallet ${bot})`);
// The worker is an ES module in a folder node reads as CommonJS (wrangler does not care, node does):
// the text that was read above is run from a copy with the right extension, inside the repo so 'viem' resolves.
const copy = path.join(ROOT, 'temp', 'buyback-worker-fork.mjs');
fs.mkdirSync(path.dirname(copy), { recursive: true });
fs.writeFileSync(copy, `${workerSrc}\nexport { addLiquidityAndBurn, swapAndBurn };\n`);   // the liquidity add and the burn are asked for by name further down
const workerModule = await import(pathToFileURL(copy).href);
const worker = workerModule.default;
const log = console.log; const out = []; console.log = (...a) => out.push(a.join(' '));
try { await worker.scheduled({}, env, {}); } finally { console.log = log; }

const entries = JSON.parse(kv.get('burns.json') || '[]'), e = entries[0] || {};
// TODAY'S LEGS BY TODAY'S SPLIT (2026-11-20, A-Z: this first run uses the real clock and still asked for the DeFi agent's and
// the Giggle pot's sends after both ended on Nov 20 — it failed, then crashed on a receipt of null before the Nov 20 and
// Dec 1 sections could run). Until Nov 20 seven legs; Nov 20 -> Dec 1 the five of 1/1/1; from Dec 1 no $BOB legs.
const T0 = Date.now(), OLD = T0 < Date.parse('2026-11-20T00:01:00Z'), BOBLEG = T0 < Date.parse('2026-12-01T00:01:00Z');
const LEGS = ['creatorTx', ...(BOBLEG ? ['bobSwapTx', 'bobBurnTx'] : []), 'bobaiSwapTx', 'bobaiBurnTx', ...(OLD ? ['lpAgentTx', 'giggleTx'] : [])];
ok('one entry went into the burn log, with every leg of today\'s split', entries.length === 1 && LEGS.every((k) => /^0x[0-9a-f]{64}$/.test(e[k] || '')), Object.keys(e).filter((k) => /Tx$/.test(k)).join(', ') || out.slice(-3).join(' / '));
if (entries.length === 1 && LEGS.every((k) => /^0x[0-9a-f]{64}$/.test(e[k] || ''))) {
  const receipts = await Promise.all(LEGS.map((k) => pub.getTransactionReceipt({ hash: e[k] })));
  ok('every one of them is in a block with status success', receipts.every((r) => r.status === 'success'));
  const available = parseEther('0.1') - parseEther('0.003');
  const split = (out.find((l) => /BOBAI burn \d+/.test(l)) || '').trim();
  const bpsOf = (re) => BigInt((out.join('\n').match(re) || [])[1] || -1);
  const cBps = bpsOf(/Creator:\s+\S+ BNB \((\d+) bps\)/), lBps = bpsOf(/LP agent:\s+\S+ BNB \((\d+) bps\)/), gBps = bpsOf(/Giggle pot:\s+\S+ BNB \((\d+) bps\)/);
  const got = { creator: (await bal(CREATOR)) - before.creator, lpa: (await bal(LPA)) - before.lpa, pot: (await bal(POT)) - before.pot };
  // from Nov 20 the DeFi agent and the pot have no slice: they must receive nothing (no "LP agent" / "Giggle pot" line to read)
  ok('creator, DeFi agent and Giggle pot received exactly their bps of what was available', got.creator === (available * cBps) / 300n && (OLD ? got.lpa === (available * lBps) / 300n && got.pot === (available * gBps) / 300n : got.lpa === 0n && got.pot === 0n), `${formatEther(got.creator)} / ${formatEther(got.lpa)} / ${formatEther(got.pot)} BNB at ${cBps}/${lBps}/${gBps} bps — ${split}`);
  const burnedBob = (await tok(BOB, DEAD)) - before.deadBob, burnedBobai = (await tok(BOBAI, DEAD)) - before.deadBobai;
  ok('the dead address holds more $BOB by what the log says, and the wallet keeps none', burnedBob === parseEther(e.bobBurned) && (await tok(BOB, bot)) === 0n, `${Number(e.bobBurned).toFixed(0)} BOB`);
  // the wallet keeps 808.41 $BOBAI and burns only what is above it (operator, 2026-10-08: KEEP_TOKENS / spendable)
  const keptBobai = await tok(BOBAI, bot);
  ok('the $BOBAI burn arrives at the dead address (a transfer there is not taxed), and the wallet keeps exactly 808.41', burnedBobai > 0n && burnedBobai <= parseEther(e.bobaiBurned) && burnedBobai * 100n >= parseEther(e.bobaiBurned) * 96n && keptBobai === parseEther('808.41'), `${Number(e.bobaiBurned).toFixed(0)} BOBAI sent, ${Number(formatEther(burnedBobai)).toFixed(0)} arrived at dead, ${formatEther(keptBobai)} kept`);
  // The minimum the swap asked for, against what arrived.
  const ROUTER = parseAbi(['function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable']);
  const minOf = async (hash) => decodeFunctionData({ abi: ROUTER, data: (await pub.getTransaction({ hash })).input }).args[0];
  const minBobai = await minOf(e.bobaiSwapTx), minBob = await minOf(e.bobSwapTx);
  // what ARRIVED is what was burned plus the 808.41 the fresh wallet kept out of it (2026-11-20: with a third of the split
  // instead of 0.8% the kept 808.41 is a larger share of the buy, and "burned" alone read 4.28% of room)
  const gotBobai = parseEther(e.bobaiBurned) + keptBobai, gotBob = parseEther(e.bobBurned);
  const room = (g, m) => Number(((g - m) * 100000n) / g) / 1000;
  ok('the $BOBAI swap leaves 5% of room against what ARRIVES (it was 2.06%)', room(gotBobai, minBobai) > 4.9 && room(gotBobai, minBobai) < 5.1, `${room(gotBobai, minBobai).toFixed(2)}% between minimum and received`);
  ok('the $BOB swap leaves its 5% as before', room(gotBob, minBob) > 4.9 && room(gotBob, minBob) < 5.1, `${room(gotBob, minBob).toFixed(2)}%`);
  const left = await bal(bot);
  // exact (2026-10-10): the gas of every transaction the wallet sent in the run, read off the fork's blocks — a fixed
  // floor (0.0025) failed the day the run grew legs, without saying whether anything was wrong
  let gasPaid = 0n, sent = 0;
  for (let b = before.block + 1n; b <= await pub.getBlockNumber(); b++) {
    for (const tx of (await pub.getBlock({ blockNumber: b, includeTransactions: true })).transactions) {
      if (tx.from.toLowerCase() !== bot.toLowerCase()) continue;
      const rc = await pub.getTransactionReceipt({ hash: tx.hash }); gasPaid += rc.gasUsed * rc.effectiveGasPrice; sent++;
    }
  }
  // at least the reserve less that gas, at most the reserve (what an add's router hands back stays on the wallet:
  // 10.10. 0.000533 BNB above reserve − gas with Liq Boost III on)
  ok('the wallet is left with its gas reserve, less no more than the gas its own transactions paid', left >= parseEther('0.003') - gasPaid && left <= parseEther('0.003') && left > 0n, `${formatEther(left)} BNB left, ${sent} transactions paid ${formatEther(gasPaid)} BNB of gas`);
}
ok('the heartbeat is written and the lock released', !!kv.get('heartbeat-buyback') && !kv.has('lock-buyback'));

// A second tick finds nothing to split and sends nothing.
const nonce = await pub.getTransactionCount({ address: bot });
console.log = (...a) => out.push(a.join(' '));
try { await worker.scheduled({}, env, {}); } finally { console.log = log; }
ok('a second tick finds the wallet under its threshold and sends nothing', (await pub.getTransactionCount({ address: bot })) === nonce && JSON.parse(kv.get('burns.json')).length === 1);

// NOV 20 → DEC 1 (2026-11-18): Liq Boost III, the DeFi agent's share and the Giggle pot all end at Nov 20 00:01; for
// eleven days the plain 1/1/1 runs. Its first real run is the night of the 20th, so it is run here first, the same way.
console.log('\nthe run on Nov 20, 2026 (standard 1/1/1)');
{
  const key3 = generatePrivateKey(), bot3 = privateKeyToAccount(key3).address;
  await test.setBalance({ address: bot3, value: parseEther('0.1') });
  const kv3 = new Map();
  const env3 = { ...env, BUYBACK_PRIVATE_KEY: key3, LOGS: { get: async (k) => (kv3.has(k) ? kv3.get(k) : null), put: async (k, v) => { kv3.set(k, v); }, delete: async (k) => { kv3.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv3.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) } };
  const c0 = await bal(CREATOR), l0 = await bal(LPA), p0 = await bal(POT), deadBob0 = await tok(BOB, DEAD), deadBobai0 = await tok(BOBAI, DEAD);
  const realNow = Date.now; const out3 = [];
  // inside the Nov 20 window, but never behind the fork's own block time (the swaps' deadlines are Date.now() + 300 s)
  Date.now = () => Math.min(Math.max(realNow(), Date.parse('2026-11-20T00:02:00Z')), Date.parse('2026-12-01T00:00:00Z')); console.log = (...a) => out3.push(a.join(' '));
  try { await worker.scheduled({}, env3, {}); } finally { console.log = log; Date.now = realNow; }
  const said = out3.join('\n'), e3 = JSON.parse(kv3.get('burns.json') || '[]')[0] || {};
  const avail3 = parseEther('0.1') - parseEther('0.003');
  ok('Nov 20: the split is 100 BOBAI burn / 100 BOB burn / 100 creator, "Standard 1/1/1", no other slice', /Active phases: Standard 1\/1\/1/.test(said) && /BOBAI burn 100\s+\|\s+BOB burn 100\s+\|\s+Creator 100/.test(said) && !/BOBAI liq |LP agent |Giggle pot |WC26 pool |BOB liq /.test(said), (said.match(/Active phases:[^\n]*/) || [''])[0] + ' · ' + (said.match(/BOBAI burn \d+[^\n]*/) || [''])[0]);
  ok('Nov 20: the DeFi agent and the Giggle pot receive nothing, no liquidity is added', (await bal(LPA)) === l0 && (await bal(POT)) === p0 && !e3.lpAgentTx && !e3.giggleTx && !kv3.get('bobai-liq-log.json'));
  ok('Nov 20: the creator receives exactly a third of what was available', (await bal(CREATOR)) - c0 === (avail3 * 100n) / 300n, formatEther((await bal(CREATOR)) - c0));
  ok('Nov 20: $BOB and $BOBAI are both bought and burned, the log holds both burns', /^0x[0-9a-f]{64}$/.test(e3.bobBurnTx || '') && /^0x[0-9a-f]{64}$/.test(e3.bobaiBurnTx || '') && (await tok(BOB, DEAD)) > deadBob0 && (await tok(BOBAI, DEAD)) > deadBobai0);
  ok('Nov 20: the wallet keeps its gas reserve and no more', (await bal(bot3)) <= parseEther('0.003') && (await bal(bot3)) > 0n, formatEther(await bal(bot3)));
}

// FROM DEC 1 (operator, 2026-10-28): the BOB-burn 1% is BOBAI liquidity for good. The same worker, a fresh throwaway
// wallet, its clock set to Dec 1 00:02 UTC for the one run (Date.now is what the windows read; restored after).
console.log('\nthe run on Dec 1, 2026 (BOBAI liquidity for good)');
{
  const key2 = generatePrivateKey(), bot2 = privateKeyToAccount(key2).address;
  await test.setBalance({ address: bot2, value: parseEther('0.1') });
  const kv2 = new Map();
  const env2 = { ...env, BUYBACK_PRIVATE_KEY: key2, LOGS: { get: async (k) => (kv2.has(k) ? kv2.get(k) : null), put: async (k, v) => { kv2.set(k, v); }, delete: async (k) => { kv2.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv2.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) } };
  const c0 = await bal(CREATOR), deadBob0 = await tok(BOB, DEAD), deadBobai0 = await tok(BOBAI, DEAD);
  const realNow = Date.now; const out2 = [];
  Date.now = () => Date.parse('2026-12-01T00:02:00Z'); console.log = (...a) => out2.push(a.join(' '));
  try { await worker.scheduled({}, env2, {}); } finally { console.log = log; Date.now = realNow; }
  const said = out2.join('\n'), e2 = JSON.parse(kv2.get('burns.json') || '[]')[0] || {}, liq2 = JSON.parse(kv2.get('bobai-liq-log.json') || '[]');
  const avail2 = parseEther('0.1') - parseEther('0.003');
  ok('the split is 100 BOBAI burn / 0 BOB burn / 100 creator / 100 BOBAI liq, the phase named', /BOBAI burn 100\s+\|\s+BOB burn 0\s+\|\s+Creator 100/.test(said) && /BOBAI liq\s+100/.test(said) && /BOBAI liq for good/.test(said), (said.match(/BOBAI burn \d+[^\n]*/) || [''])[0]);
  ok('no $BOB is bought or burned: no swap tried, nothing in the log, the dead address holds no more', !/Buying & Burning \$BOB /.test(said) && !e2.bobSwapTx && !e2.bobBurned && (await tok(BOB, DEAD)) === deadBob0);
  ok('the creator receives exactly a third of what was available', (await bal(CREATOR)) - c0 === (avail2 * 100n) / 300n, formatEther((await bal(CREATOR)) - c0));
  const lr = liq2[0] || {};
  const lrc = liq2.length === 1 ? await Promise.all([lr.addLiqTx, lr.lpBurnTx].map((h) => pub.getTransactionReceipt({ hash: h }).catch(() => null))) : [];
  ok('a third goes into BOBAI/BNB liquidity, the add and the LP burn in blocks with status success', liq2.length === 1 && lrc.length === 2 && lrc.every((r) => r?.status === 'success') && Math.abs(Number(lr.bnb) - Number(formatEther(avail2 / 3n))) < 0.0005, `${lr.bnb} BNB · ${lr.lpBurned} LP burned`);
  ok('$BOBAI is still bought and burned', /^0x[0-9a-f]{64}$/.test(e2.bobaiBurnTx || '') && (await tok(BOBAI, DEAD)) > deadBobai0);
}

// ── WHAT IS OWED (Liste B 1, 2026-11-24): a run whose legs fail after the creator is paid, then the next run ─────────
// The router is made to refuse everything for the first run (its code replaced by a bare revert): the creator is paid its
// third, the BOBAI burn and the BOBAI liquidity fail before any BNB leaves, and both are written down as owed. Then the
// router is back and new tax arrives: the creator gets a third of the NEW tax only, the owed BNB goes to its own legs, and
// nothing is owed after. Before this, the second run split the stranded BNB again and the creator was paid twice.
console.log('\nwhat is owed (a run whose legs failed, then the next one)');
{
  const ROUTER = addr('PANCAKE_ROUTER_V2');
  const key4 = generatePrivateKey(), bot4 = privateKeyToAccount(key4).address;
  await test.setBalance({ address: bot4, value: parseEther('0.1') });
  const kv4 = new Map();
  const env4 = { ...env, BUYBACK_PRIVATE_KEY: key4, LOGS: { get: async (k) => (kv4.has(k) ? kv4.get(k) : null), put: async (k, v) => { kv4.set(k, v); }, delete: async (k) => { kv4.delete(k); }, list: async ({ prefix }) => ({ keys: [...kv4.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) } };
  const code = await pub.getCode({ address: ROUTER });
  const realNow = Date.now, dec1 = () => Date.parse('2026-12-01T00:02:00Z');
  const run = async () => { const o = []; Date.now = dec1; console.log = (...a) => o.push(a.join(' ')); try { await worker.scheduled({}, env4, {}); } finally { console.log = log; Date.now = realNow; } return o.join('\n'); };
  // run 1: the router refuses
  await test.setCode({ address: ROUTER, bytecode: '0x60006000fd' });
  const c0 = await bal(CREATOR);
  const said1 = await run();
  const avail1 = parseEther('0.1') - parseEther('0.003'), toCreator1 = (await bal(CREATOR)) - c0;
  const owed1 = JSON.parse(kv4.get('buyback-owed') || '{}'), owedSum1 = Object.values(owed1).reduce((a, v) => a + BigInt(v), 0n);
  ok('run 1, the router refusing: the creator is paid its third', toCreator1 === (avail1 * 100n) / 300n, formatEther(toCreator1));
  ok('and the two legs that failed before spending are owed exactly what they did not get', Object.keys(owed1).sort().join() === 'bobaiBurn,bobaiLiq' && owedSum1 === avail1 - (avail1 * 100n) / 300n, JSON.stringify(owed1));
  ok('the run says what is owed to the next one', /Owed to the next run: .*bobaiLiq/.test(said1));
  // run 2: the router is back, new tax has arrived
  await test.setCode({ address: ROUTER, bytecode: code });
  const newTax = parseEther('0.03');
  await test.setBalance({ address: bot4, value: (await bal(bot4)) + newTax });
  const b2 = await bal(bot4), c1 = await bal(CREATOR), deadBobai1 = await tok(BOBAI, DEAD);
  const said2 = await run();
  const avail2 = b2 - parseEther('0.003'), base2 = avail2 - owedSum1, toCreator2 = (await bal(CREATOR)) - c1;
  ok('run 2: the creator gets a third of what is NOT owed — not a third of the stranded BNB again', toCreator2 === (base2 * 100n) / 300n && toCreator2 < (avail2 * 100n) / 300n, `${formatEther(toCreator2)} (a plain third of all would be ${formatEther((avail2 * 100n) / 300n)})`);
  ok('it names the owed BNB it pays first', /Owed from earlier runs: /.test(said2));
  const e4 = JSON.parse(kv4.get('burns.json') || '[]').at(-1) || {}, liq4 = JSON.parse(kv4.get('bobai-liq-log.json') || '[]').at(-1) || {};
  ok('the owed BNB went to its legs: $BOBAI bought and burned, BOBAI liquidity added', /^0x[0-9a-f]{64}$/.test(e4.bobaiBurnTx || '') && (await tok(BOBAI, DEAD)) > deadBobai1 && Number(liq4.bnb) > Number(formatEther(owed1.bobaiLiq ? BigInt(owed1.bobaiLiq) : 0n)), JSON.stringify({ liq: liq4.bnb, owedLiq: owed1.bobaiLiq }));
  ok('the log entry carries what it paid of the owed', e4.owedPaidBnb === formatEther(owedSum1), e4.owedPaidBnb);
  ok('and nothing is owed after', JSON.stringify(JSON.parse(kv4.get('buyback-owed') || '{}')) === '{}', kv4.get('buyback-owed'));
}

// ── the liquidity add, which rests between boosts, same fork ────────────────
console.log('\nthe liquidity add (dormant path, called by name)');
{
  const PAIR = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const ALLOW = parseAbi(['function allowance(address owner, address spender) view returns (uint256)']);
  const ADD = parseAbi(['function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable']);
  const DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';   // WBNB Deposit(dst, wad): the BNB the router really used
  const ROUTER_ADDR = (workerSrc.match(/const PANCAKE_ROUTER_V2 = '(0x[0-9a-fA-F]{40})'/) || [])[1];
  for (const [name, token, pair] of [['$BOBAI', BOBAI, addr('BOBAI_WBNB_PAIR')], ['$BOB', BOB, addr('BOB_WBNB_PAIR')]]) {
    const k = generatePrivateKey(), acct = privateKeyToAccount(k);
    await test.setBalance({ address: acct.address, value: parseEther('0.05') });
    const wallet = createWalletClient({ account: acct, chain, transport: http(LOCAL, { timeout: 120000 }) });
    const deadLp = await pub.readContract({ address: pair, abi: PAIR, functionName: 'balanceOf', args: [DEAD] });
    const lines = []; console.log = (...a) => lines.push(a.join(' '));
    let res = null;
    try { res = await workerModule.addLiquidityAndBurn(wallet, pub, acct, parseEther('0.04'), token, pair, name); } finally { console.log = log; }
    ok(`${name}: three chunks bought, liquidity added, LP burned`, !!res && /^0x[0-9a-f]{64}$/.test(res.addLiqTx || '') && /^0x[0-9a-f]{64}$/.test(res.lpBurnTx || ''), res ? `${res.lpBurned} LP` : lines.slice(-2).join(' / '));
    if (!res) continue;
    const [addRc, burnRc, addTx] = await Promise.all([pub.getTransactionReceipt({ hash: res.addLiqTx }), pub.getTransactionReceipt({ hash: res.lpBurnTx }), pub.getTransaction({ hash: res.addLiqTx })]);
    const burned = (await pub.readContract({ address: pair, abi: PAIR, functionName: 'balanceOf', args: [DEAD] })) - deadLp;
    ok(`${name}: both in a block with status success, the dead address holds the LP and the wallet none`, addRc.status === 'success' && burnRc.status === 'success' && burned === parseEther(res.lpBurned) && burned > 0n && (await pub.readContract({ address: pair, abi: PAIR, functionName: 'balanceOf', args: [acct.address] })) === 0n);
    const a = decodeFunctionData({ abi: ADD, data: addTx.input }).args;
    const dep = addRc.logs.find((l) => l.topics[0] === DEPOSIT);
    const usedBnb = dep ? BigInt(dep.data) : 0n;
    ok(`${name}: the add went out with minimums — 95% of the tokens and 95% of the BNB the router then used`, a[2] === (a[1] * 95n) / 100n && a[2] > 0n && a[3] === (usedBnb * 95n) / 100n && a[3] > 0n && usedBnb <= addTx.value, `${formatEther(a[3])} of ${formatEther(usedBnb)} BNB used, ${formatEther(addTx.value - usedBnb)} came back`);
    // A-Z 2026-11-21: the buy is the share the reserves leave room for — of the 0.04 BNB slice, what the router does not take
    // (it stays on the wallet and was split a third each next run) is now under 1%, not the ~1.6% of the half-and-half buy
    const unused = addTx.value - usedBnb;
    ok(`${name}: the BNB the add did not use is under 1% of the slice (the buy was the share the reserves say)`, unused >= 0n && unused * 100n < parseEther('0.04'), `${formatEther(unused)} BNB unused of 0.04`);
    const allowance = await pub.readContract({ address: token, abi: ALLOW, functionName: 'allowance', args: [acct.address, ROUTER_ADDR] });
    // $BOBAI: the wallet keeps its 808.41 (operator, 2026-10-08); $BOB keeps nothing
    const kept = await tok(token, acct.address), keep = token.toLowerCase() === BOBAI.toLowerCase() ? parseEther('808.41') : 0n;
    ok(`${name}: nothing stays approved and the wallet keeps ${keep ? 'exactly 808.41' : 'no token'}`, allowance === 0n && kept === keep, `allowance ${allowance}, ${formatEther(kept)} kept`);
  }
}

// ── the burn takes only what its own swap bought (2026-11-16, Liste B) ──────
// A wallet already holding $BOBAI above the kept 808.41 — what a liquidity add that failed after its buy leaves — then
// runs the burn: the tokens it held stay, only what the burn's swap brought goes to dead. The same on the code before
// the change (git HEAD) burns the tokens it held too: the check sees the fault it is there for.
console.log('\nthe burn takes only what its own swap bought (tokens a failed add left stay)');
{
  const SWAP = parseAbi(['function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable']);
  const ROUTER_ADDR = (workerSrc.match(/const PANCAKE_ROUTER_V2 = '(0x[0-9a-fA-F]{40})'/) || [])[1];
  const WBNB_ADDR = (workerSrc.match(/const WBNB = '(0x[0-9a-fA-F]{40})'/) || [])[1];
  const leftover = async (mod) => {
    const k = generatePrivateKey(), acct = privateKeyToAccount(k);
    await test.setBalance({ address: acct.address, value: parseEther('0.05') });
    const wallet = createWalletClient({ account: acct, chain, transport: http(LOCAL, { timeout: 120000 }) });
    // the tokens a failed add left behind: bought straight from the router, never burned
    const h = await wallet.writeContract({ address: ROUTER_ADDR, abi: SWAP, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [0n, [WBNB_ADDR, BOBAI], acct.address, BigInt(Math.floor(Date.now() / 1000) + 600)], value: parseEther('0.01') });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    if (rc.status !== 'success') throw new Error('the setup purchase reverted — no leftover to test with');
    const held = await tok(BOBAI, acct.address), dead0 = await tok(BOBAI, DEAD);
    if (held <= parseEther('808.41')) throw new Error(`the setup purchase left only ${formatEther(held)} BOBAI`);
    const lines = []; console.log = (...a) => lines.push(a.join(' '));
    let res = null;
    try { res = await mod.swapAndBurn(wallet, pub, acct, parseEther('0.01'), BOBAI, 'BOBAI'); } finally { console.log = log; }
    return { held, left: await tok(BOBAI, acct.address), burned: (await tok(BOBAI, DEAD)) - dead0, res, lines };
  };
  const now = await leftover(workerModule);
  ok('the tokens held before the burn stay on the wallet; only the swap\'s own purchase goes to dead', !!now.res && now.left >= now.held && now.burned > 0n && now.burned <= parseEther(now.res.amount),
    `held ${Number(formatEther(now.held)).toFixed(0)}, left ${Number(formatEther(now.left)).toFixed(0)}, burned ${Number(formatEther(now.burned)).toFixed(0)} BOBAI`);
  // the code before (git HEAD), same fork, same steps
  let headSrc = null; try { headSrc = execSync('git show HEAD:worker/index.js', { cwd: ROOT, maxBuffer: 1e8 }).toString(); } catch { /* not in a repo */ }
  if (headSrc && !/ONLY WHAT THIS SWAP BOUGHT IS BURNED/.test(headSrc)) {
    const headCopy = path.join(ROOT, 'temp', 'buyback-worker-fork-head.mjs');
    fs.writeFileSync(headCopy, `${headSrc}\nexport { swapAndBurn };\n`);
    const old = await leftover(await import(pathToFileURL(headCopy).href));
    ok('… and the code before burned them with it (the check sees the fault)', !!old.res && old.left === parseEther('808.41') && old.left < old.held,
      `held ${Number(formatEther(old.held)).toFixed(0)}, left ${Number(formatEther(old.left)).toFixed(0)} BOBAI`);
  }
}

// ── the liquidity hand script, same fork ────────────────────────────────────
console.log('\nthe liquidity hand script (add-liquidity-safe.js: a copy, on a throwaway wallet)');
{
  const liqSrc = fs.readFileSync(path.join(ROOT, 'add-liquidity-safe.js'), 'utf8');
  const k = generatePrivateKey(), acct = privateKeyToAccount(k);
  // The copy differs from the script in four places and no other: it reads no
  // .env (this test has the real keys in its own environment — the child gets
  // an environment of its own, written out below, with the throwaway key and
  // the fork's URL and nothing else), the creator wallet's place is taken by
  // the throwaway one, the hour is never the sweep's, the record goes to temp/.
  const runsCopy = path.join(ROOT, 'temp', 'liq-runs-fork.json'), scriptCopy = path.join(ROOT, 'temp', 'add-liquidity-fork.js');
  const realRuns = fs.readFileSync(path.join(ROOT, 'dashboard', 'liq-runs.json'), 'utf8');
  fs.writeFileSync(runsCopy, JSON.stringify({ dev: { burns: 0 }, runs: [] }));
  const copySrc = liqSrc
    .replace("require('dotenv').config();", '')
    .replace(/const CREATOR_WALLET = '0x[0-9a-fA-F]{40}';/, `const CREATOR_WALLET = '${acct.address}';`)
    .replace('return m >= 55 || m < 3;', 'return false;')
    .replace("require('path').join(__dirname, 'dashboard', 'liq-runs.json')", JSON.stringify(runsCopy));
  const safeCopy = !/dotenv/.test(copySrc) && copySrc.includes(acct.address) && !/0x15Ba17075ef5E0736292b030e3715d9100fe3d38/i.test(copySrc) && copySrc.includes('liq-runs-fork.json') && !copySrc.includes("'dashboard', 'liq-runs.json'");
  ok('the copy reads no .env, knows only the throwaway wallet and writes its record to temp/', safeCopy);
  if (safeCopy) {
    fs.writeFileSync(scriptCopy, copySrc);
    // BOBAI for the wallet the way anyone gets it: bought through the router, on the fork.
    await test.setBalance({ address: acct.address, value: parseEther('0.06') });
    const wallet = createWalletClient({ account: acct, chain, transport: http(LOCAL, { timeout: 120000 }) });
    const BUY = parseAbi(['function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable']);
    const ROUTER_ADDR = (workerSrc.match(/const PANCAKE_ROUTER_V2 = '(0x[0-9a-fA-F]{40})'/) || [])[1], WBNB_ADDR = addr('WBNB'), PAIR_ADDR = addr('BOBAI_WBNB_PAIR');
    const buy = await wallet.writeContract({ address: ROUTER_ADDR, abi: BUY, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [0n, [WBNB_ADDR, BOBAI], acct.address, BigInt(Math.floor(Date.now() / 1000) + 600)], value: parseEther('0.05'), gas: 400000n });
    await pub.waitForTransactionReceipt({ hash: buy });
    const had = await tok(BOBAI, acct.address);
    const LP = parseAbi(['function balanceOf(address) view returns (uint256)']);
    const deadLp0 = await pub.readContract({ address: PAIR_ADDR, abi: LP, functionName: 'balanceOf', args: [DEAD] });
    const { spawnSync } = await import('node:child_process');
    const run = spawnSync(process.execPath, [scriptCopy], { cwd: path.join(ROOT, 'temp'), encoding: 'utf8', timeout: 300000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '', PRIVATE_KEY: k, BSC_RPC_URL: LOCAL } });
    const said = `${run.stdout || ''}${run.stderr || ''}`;
    ok('the script runs to its end: three chunks sold, liquidity added, LP burned', run.status === 0 && /Liquidity added in block/.test(said) && /BURNED [0-9.]+ LP tokens/.test(said), run.status === 0 ? `${Number(formatEther(had)).toFixed(0)} BOBAI in hand` : said.split('\n').filter(Boolean).slice(-3).join(' / '));
    const rec = JSON.parse(fs.readFileSync(runsCopy, 'utf8')).runs[0];
    if (run.status === 0 && rec) {
      const ADD = parseAbi(['function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable']);
      const [tx, rc, burnRc] = await Promise.all([pub.getTransaction({ hash: rec.addLiqTx }), pub.getTransactionReceipt({ hash: rec.addLiqTx }), pub.getTransactionReceipt({ hash: rec.lpBurnTx })]);
      const a = decodeFunctionData({ abi: ADD, data: tx.input }).args;
      const dep = rc.logs.find((l) => l.topics[0] === '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c');   // WBNB Deposit: the BNB the router really used
      const usedBnb = dep ? BigInt(dep.data) : 0n;
      ok('the add went out with minimums, not with 0 and 0: the BNB minimum is to the wei 95% of what the router then used', a[2] > 0n && a[3] > 0n && a[3] === (usedBnb * 95n) / 100n && usedBnb <= tx.value, `min ${formatEther(a[3])} of ${formatEther(usedBnb)} BNB used; ${formatEther(tx.value - usedBnb)} BNB came back`);
      ok('… and the BOBAI minimum is 95% of what the router takes of the amount offered — never more than was offered', a[2] <= (a[1] * 95n) / 100n && a[2] >= (a[1] * 80n) / 100n, `min ${Number(formatEther(a[2])).toFixed(0)} of ${Number(formatEther(a[1])).toFixed(0)} BOBAI offered`);
      ok('it says so before it sends', /Min BOBAI accepted: [0-9.]+ \(95%\)/.test(said) && /Min BNB accepted:   [0-9.]+ \(95%\)/.test(said) && !/accepted: 0 /.test(said));
      const deadLp1 = await pub.readContract({ address: PAIR_ADDR, abi: LP, functionName: 'balanceOf', args: [DEAD] });
      ok('both receipts are success, the dead address holds the LP the record names, the wallet none — and the 808.41 BOBAI it keeps', rc.status === 'success' && burnRc.status === 'success' && deadLp1 - deadLp0 === parseEther(rec.lp) && (await pub.readContract({ address: PAIR_ADDR, abi: LP, functionName: 'balanceOf', args: [acct.address] })) === 0n && (await tok(BOBAI, acct.address)) === parseEther('808.41'), `${formatEther(await tok(BOBAI, acct.address))} BOBAI left`);
      // its gas money stays (2026-10-23, operator: "0.003 behalten"): run #153 put all but 0.001 into the pool and left
      // the wallet under its 0.0015 floor; now 0.003 is held back, less only the gas of the burn after the add
      const cur = said.match(/Current BNB balance: ([0-9.]+)/)?.[1], offered = said.match(/BNB for liquidity:\s+([0-9.]+)/)?.[1];
      ok('the wallet keeps its gas money: the BNB offered to the pool is its balance less exactly 0.003, and the add sent no more', cur && offered && parseEther(cur) - parseEther(offered) === parseEther('0.003') && tx.value === parseEther(offered), `${cur} - ${offered}`);
      // the small run after a big one (2026-11-01, operator: "d38 muss auch exakt 808.41 uebrig haben"): a rest of the
      // size #158 left and d38's own 0.00299 BNB, where the sale alone does not pay the add: the reserve is touched, to
      // 0.002 at the most, and not one wei of BOBAI stays over the 808.41
      await wallet.writeContract({ address: ROUTER_ADDR, abi: BUY, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [0n, [WBNB_ADDR, BOBAI], acct.address, BigInt(Math.floor(Date.now() / 1000) + 600)], value: parseEther('0.0008'), gas: 400000n }).then((hash) => pub.waitForTransactionReceipt({ hash }));
      await test.setBalance({ address: acct.address, value: parseEther('0.00298730915') });
      const small = spawnSync(process.execPath, [scriptCopy], { cwd: path.join(ROOT, 'temp'), encoding: 'utf8', timeout: 300000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '', PRIVATE_KEY: k, BSC_RPC_URL: LOCAL } });
      const bnbAfter = await pub.getBalance({ address: acct.address });
      ok('a small rest on the wallet\'s own gas money: exactly 808.41 BOBAI left, the BNB not under the floor less the burn\'s gas', small.status === 0 && (await tok(BOBAI, acct.address)) === parseEther('808.41') && bnbAfter > parseEther('0.0019'), small.status === 0 ? `${formatEther(await tok(BOBAI, acct.address))} BOBAI, ${formatEther(bnbAfter)} BNB left` : `${small.stdout}${small.stderr}`.split('\n').filter(Boolean).slice(-3).join(' / '));
    }
    ok('the real dashboard/liq-runs.json was not touched by any of it', fs.readFileSync(path.join(ROOT, 'dashboard', 'liq-runs.json'), 'utf8') === realRuns);
  }
}

// ── the dev sweep, same fork ────────────────────────────────────────────────
console.log('\nthe dev sweep (80% / 4 / 4 / 4 / 4 / 2 / 2; builder #5 removed 2026-10-10, back 2026-11-09 on the operator\'s word)');
{
  const devSrc = fs.readFileSync(path.join(ROOT, 'worker-dev-buyback', 'index.js'), 'utf8');
  const twin = fs.readFileSync(path.join(ROOT, 'dev-buyback.js'), 'utf8');
  const loop = (t) => t.slice(t.indexOf('  let personalTxHash;'), t.indexOf('  // Step 3: Log'));
  ok('the worker and its local twin carry the same send loop', loop(devSrc).length > 400 && loop(devSrc) === loop(twin));
  const dAddr = (name) => (devSrc.match(new RegExp(`const ${name} = '(0x[0-9a-fA-F]{40})'`)) || [])[1];
  // builder #5 (0xa295…fBB2) is back since 2026-11-09 (operator: "set the builder back as he was"): 80% and six builders
  const who = ['PERSONAL_WALLET', 'BUILDER_1', 'BUILDER_2', 'BUILDER_3', 'BUILDER_4', 'BUILDER_5', 'BUILDER_6'].map(dAddr);
  const pct = [80n, 4n, 4n, 4n, 4n, 2n, 2n];
  const devCopy = path.join(ROOT, 'temp', 'dev-worker-fork.mjs');
  fs.writeFileSync(devCopy, devSrc);
  const dev = (await import(pathToFileURL(devCopy).href)).default;
  // opts (2026-11-21): the same wallet and store again, a balance to set — for what a builder is owed across runs
  const runDev = async (opts = {}) => {
    const k = opts.k || generatePrivateKey(), w = privateKeyToAccount(k).address, store = opts.store || new Map();
    await test.setBalance({ address: w, value: opts.value ?? parseEther('0.103') });
    const b0 = await Promise.all(who.map(bal));
    const keep = console.log; console.log = () => {};
    try { await dev.scheduled({}, { PRIVATE_KEY: k, BSC_RPC_URL: LOCAL, LOGS: { get: async (x) => (store.has(x) ? store.get(x) : null), put: async (x, v) => { store.set(x, v); }, delete: async (x) => { store.delete(x); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((x) => x.startsWith(prefix)).map((name) => ({ name })) }) } }, {}); } finally { console.log = keep; }
    const b1 = await Promise.all(who.map(bal));
    return { got: b1.map((v, i) => v - b0[i]), log: JSON.parse(store.get('dev-buyback-log.json') || '[]'), left: await bal(w), store, k, w };
  };
  const A = parseEther('0.1');
  const clean = await runDev();
  const builders = [1, 2, 3, 4, 5, 6].map((i) => (A * pct[i]) / 100n);
  ok('a clean run pays every builder its percent and the rest to the first wallet', builders.every((v, i) => clean.got[i + 1] === v) && clean.got[0] === A - builders.reduce((x, y) => x + y, 0n), clean.got.map((v) => formatEther(v)).join(' / '));
  ok('builder #5 is back (operator, 2026-11-09): 0xa295…fBB2 in the code and paid its 2%, the first wallet 80%', who[5] === '0xa2953b3A35B19fb0078A85A6C87b37F43C14fBB2' && clean.got[5] === (A * 2n) / 100n && clean.got[0] === A - (A * 20n) / 100n, clean.got.map((v) => formatEther(v)).join(' / '));
  ok('and the log carries all seven hashes and no failure', clean.log.length === 1 && Object.keys(clean.log[0].txs || {}).length === 7 && (clean.log[0].failed || []).length === 0);
  // Builder #3 turns into a contract that refuses BNB: its transfer reverts.
  await test.setCode({ address: who[3], bytecode: '0x60006000fd' });
  const hurt = await runDev();
  ok('one builder\'s transfer reverting leaves the other five paid in full (they were not, before)', hurt.got[3] === 0n && [1, 2, 4, 5, 6].every((i) => hurt.got[i] === (A * pct[i]) / 100n) && hurt.got[0] === clean.got[0], hurt.got.map((v) => formatEther(v)).join(' / '));
  ok('only the failed share waits on the wallet, and the log names it', hurt.left > parseEther('0.0065') && hurt.left < parseEther('0.0071') && hurt.log.length === 1 && hurt.log[0].failed.length === 1 && /#3/.test(hurt.log[0].failed[0]) && Object.keys(hurt.log[0].txs).length === 6, `${formatEther(hurt.left)} BNB left, failed: ${(hurt.log[0] || {}).failed}`);
  ok('the heartbeat is written and the lock released', !!hurt.store.get('heartbeat-dev') && !hurt.store.has('lock-dev'));
  // WHAT A BUILDER IS OWED IS PAID FIRST (2026-11-21): the next run split the failed share again (80% of it to the first wallet)
  const owedNow = JSON.parse(hurt.store.get('dev-owed') || '{}'), share3 = (A * pct[3]) / 100n;
  ok('the failed share is written down as owed to that builder', owedNow[who[3].toLowerCase()] === String(share3), JSON.stringify(owedNow));
  await test.setCode({ address: who[3], bytecode: '0x' });
  const B = parseEther('0.05'), again = await runDev({ k: hurt.k, store: hurt.store, value: parseEther('0.003') + share3 + B });
  const shares = [1, 2, 3, 4, 5, 6].map((i) => (B * pct[i]) / 100n);
  ok('the next run pays builder #3 what it was owed on top of its new share, and splits only the new BNB', again.got[3] === share3 + shares[2] && [1, 2, 4, 5, 6].every((i) => again.got[i] === shares[i - 1]) && again.got[0] === B - shares.reduce((x, y) => x + y, 0n), again.got.map((v) => formatEther(v)).join(' / '));
  ok('and nothing is owed any more', !again.store.has('dev-owed'));
  // A LIQUIDITY RUN IS NOT SWEPT AWAY (2026-11-21): more than 808.41 $BOBAI on the wallet = a run waiting or under way
  const hk = generatePrivateKey(), hw = privateKeyToAccount(hk).address, hstore = new Map();
  await test.impersonateAccount({ address: DEAD }); await test.setBalance({ address: DEAD, value: parseEther('1') });
  await createWalletClient({ chain, transport: http(LOCAL), account: DEAD }).writeContract({ address: BOBAI, abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [hw, parseEther('50000')] });
  await test.stopImpersonatingAccount({ address: DEAD });
  const held = await runDev({ k: hk, store: hstore });
  ok('with BOBAI for a liquidity run on the wallet the sweep sends nothing and notes since when it waits', held.got.every((v) => v === 0n) && !!hstore.get('dev-hold-since') && held.log.length === 0, held.got.map((v) => formatEther(v)).join(' / '));
  hstore.set('dev-hold-since', String(Date.now() - 7 * 3600e3));
  const late = await runDev({ k: hk, store: hstore, value: held.left });
  ok('after 6 hours it sweeps anyway (BOBAI left lying does not stop the creator share for good)', late.got[0] > 0n && late.log.length === 1);
}

console.log(`\n${n - failed}/${n} checks pass on the fork of block ${forkBlock}`);
stop();
process.exit(failed ? 1 : 0);
