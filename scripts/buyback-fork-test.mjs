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
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, createTestClient, http, parseAbi, parseEther, formatEther, decodeFunctionData } from 'viem';
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
  const lifted = new Function('BOBAI_TOKEN', 'sleep', `${block(workerSrc)}; return { waitMined, mined, say, minOutFor };`)(BOBAI, async () => {});
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
  LOGS: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
};
const addr = (name) => (workerSrc.match(new RegExp(`const ${name} = '(0x[0-9a-fA-F]{40})'`)) || [])[1];
const CREATOR = addr('CREATOR_WALLET'), LPA = addr('LP_AGENT_WALLET'), POT = addr('PRIZE_POOL_WALLET'), BOB = addr('BOB_TOKEN'), BOBAI = addr('BOBAI_TOKEN'), DEAD = addr('DEAD_ADDRESS');
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const bal = (a) => pub.getBalance({ address: a });
const tok = (t, a) => pub.readContract({ address: t, abi: ERC20, functionName: 'balanceOf', args: [a] });
const before = { creator: await bal(CREATOR), lpa: await bal(LPA), pot: await bal(POT), deadBob: await tok(BOB, DEAD), deadBobai: await tok(BOBAI, DEAD) };

console.log(`\nthe run (fork of block ${forkBlock}, throwaway wallet ${bot})`);
// The worker is an ES module in a folder node reads as CommonJS (wrangler does not care, node does):
// the text that was read above is run from a copy with the right extension, inside the repo so 'viem' resolves.
const copy = path.join(ROOT, 'temp', 'buyback-worker-fork.mjs');
fs.mkdirSync(path.dirname(copy), { recursive: true });
fs.writeFileSync(copy, workerSrc);
const worker = (await import(pathToFileURL(copy).href)).default;
const log = console.log; const out = []; console.log = (...a) => out.push(a.join(' '));
try { await worker.scheduled({}, env, {}); } finally { console.log = log; }

const entries = JSON.parse(kv.get('burns.json') || '[]'), e = entries[0] || {};
ok('one entry went into the burn log, with every leg of today\'s split', entries.length === 1 && ['creatorTx', 'bobSwapTx', 'bobBurnTx', 'bobaiSwapTx', 'bobaiBurnTx', 'lpAgentTx', 'giggleTx'].every((k) => /^0x[0-9a-f]{64}$/.test(e[k] || '')), Object.keys(e).filter((k) => /Tx$/.test(k)).join(', ') || out.slice(-3).join(' / '));
if (entries.length === 1) {
  const receipts = await Promise.all(['creatorTx', 'bobSwapTx', 'bobBurnTx', 'bobaiSwapTx', 'bobaiBurnTx', 'lpAgentTx', 'giggleTx'].map((k) => pub.getTransactionReceipt({ hash: e[k] })));
  ok('every one of them is in a block with status success', receipts.every((r) => r.status === 'success'));
  const available = parseEther('0.1') - parseEther('0.003');
  const split = (out.find((l) => /BOBAI burn \d+/.test(l)) || '').trim();
  const bpsOf = (re) => BigInt((out.join('\n').match(re) || [])[1] || -1);
  const cBps = bpsOf(/Creator:\s+\S+ BNB \((\d+) bps\)/), lBps = bpsOf(/LP agent:\s+\S+ BNB \((\d+) bps\)/), gBps = bpsOf(/Giggle pot:\s+\S+ BNB \((\d+) bps\)/);
  const got = { creator: (await bal(CREATOR)) - before.creator, lpa: (await bal(LPA)) - before.lpa, pot: (await bal(POT)) - before.pot };
  ok('creator, DeFi agent and Giggle pot received exactly their bps of what was available', got.creator === (available * cBps) / 300n && got.lpa === (available * lBps) / 300n && got.pot === (available * gBps) / 300n, `${formatEther(got.creator)} / ${formatEther(got.lpa)} / ${formatEther(got.pot)} BNB at ${cBps}/${lBps}/${gBps} bps — ${split}`);
  const burnedBob = (await tok(BOB, DEAD)) - before.deadBob, burnedBobai = (await tok(BOBAI, DEAD)) - before.deadBobai;
  ok('the dead address holds more $BOB by what the log says, and the wallet keeps none', burnedBob === parseEther(e.bobBurned) && (await tok(BOB, bot)) === 0n, `${Number(e.bobBurned).toFixed(0)} BOB`);
  ok('the $BOBAI burn arrives at the dead address (a transfer there is not taxed), and the wallet keeps none', burnedBobai > 0n && burnedBobai <= parseEther(e.bobaiBurned) && burnedBobai * 100n >= parseEther(e.bobaiBurned) * 96n && (await tok(BOBAI, bot)) === 0n, `${Number(e.bobaiBurned).toFixed(0)} BOBAI sent, ${Number(formatEther(burnedBobai)).toFixed(0)} arrived at dead`);
  // The minimum the swap asked for, against what arrived.
  const ROUTER = parseAbi(['function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable']);
  const minOf = async (hash) => decodeFunctionData({ abi: ROUTER, data: (await pub.getTransaction({ hash })).input }).args[0];
  const minBobai = await minOf(e.bobaiSwapTx), minBob = await minOf(e.bobSwapTx);
  const gotBobai = parseEther(e.bobaiBurned), gotBob = parseEther(e.bobBurned);
  const room = (g, m) => Number(((g - m) * 100000n) / g) / 1000;
  ok('the $BOBAI swap leaves 5% of room against what ARRIVES (it was 2.06%)', room(gotBobai, minBobai) > 4.9 && room(gotBobai, minBobai) < 5.1, `${room(gotBobai, minBobai).toFixed(2)}% between minimum and received`);
  ok('the $BOB swap leaves its 5% as before', room(gotBob, minBob) > 4.9 && room(gotBob, minBob) < 5.1, `${room(gotBob, minBob).toFixed(2)}%`);
  const left = await bal(bot);
  ok('the wallet is left with its gas reserve, less the gas of the run', left <= parseEther('0.003') && left > parseEther('0.0025'), `${formatEther(left)} BNB`);
}
ok('the heartbeat is written and the lock released', !!kv.get('heartbeat-buyback') && !kv.has('lock-buyback'));

// A second tick finds nothing to split and sends nothing.
const nonce = await pub.getTransactionCount({ address: bot });
console.log = (...a) => out.push(a.join(' '));
try { await worker.scheduled({}, env, {}); } finally { console.log = log; }
ok('a second tick finds the wallet under its threshold and sends nothing', (await pub.getTransactionCount({ address: bot })) === nonce && JSON.parse(kv.get('burns.json')).length === 1);

console.log(`\n${n - failed}/${n} checks pass on the fork of block ${forkBlock}`);
stop();
process.exit(failed ? 1 : 0);
