#!/usr/bin/env node
// The DeFi agent's money paths, RUN — on a local copy of BNB Chain.
//
// The self-test (lp-agent.mjs --self-test) pins the rules and drives the plan
// functions over a chain that answers from a table. What it cannot do is send:
// whether the position manager takes a one-sided mint at these minimums,
// whether the router fills a "sell all of it", whether a merge and a re-set go
// through in one breath — that was only ever known after the agent had done
// it with the operator's capital. Several of those paths have never run
// (2026-09-18: the re-set upward, the merge, growing a reserve the price is
// in, finishing a re-set whose mint failed beside the reserve, selling the
// profit share of a re-set downward out of the fee token).
//
// This script forks the chain with anvil at the current block, takes the DeFi
// wallet's place by impersonation — NO KEY is read, nothing can reach the real
// chain: every transaction goes to 127.0.0.1 — moves the pool's price with a
// made-up whale, and runs the SAME execute functions the worker runs
// (shared/lp-agent.js) against PancakeSwap's real contracts and the agent's
// real positions. After each path it reads the chain and checks what must hold.
//
// Needs: anvil (foundry; ~/.foundry/bin/anvil.exe or ANVIL=…), and an RPC that
// serves historical state in BSC_RPC_KEYED_URL_2 (.env) — a fork reads state
// at its block for minutes, and the public endpoints prune it within seconds.
//
//   node scripts/lp-fork-test.mjs            every path
//   node scripts/lp-fork-test.mjs --only up  one of: up, down, reserve, resume
import 'dotenv/config';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, createTestClient, http, parseAbi, parseEther, formatEther, encodeFunctionData } from 'viem';
import { bsc } from 'viem/chains';
import {
  ADDR, ABI, readPosition, readPool, heldIds, healLadder, positionSide, unwindCalls,
  planRebalance, executeRebalance, planLadder, executeLadder, planIncrease, executeIncrease,
} from '../shared/lp-agent.js';

const PORT = 8546, LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.BSC_RPC_KEYED_URL_2 || process.env.BSC_RPC_KEYED_URL_1 || process.env.BSC_ARCHIVE_RPC_URL;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
const only = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : null; })();
const LP = ADDR.LP_WALLET, CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', WHALE = '0x00000000000000000000000000000000000f00d1';
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)', 'function deposit() payable']);
const NPM = parseAbi(['function multicall(bytes[] data) payable returns (bytes[] results)', 'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256,uint256)']);

if (!FORK_URL) { console.error('No archive RPC in .env (BSC_RPC_KEYED_URL_2). A fork needs state at its block for minutes; the public endpoints prune it within seconds.'); process.exit(2); }
if (!fs.existsSync(ANVIL)) { console.error(`anvil not found at ${ANVIL} — install foundry, or set ANVIL=…`); process.exit(2); }

let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--auto-impersonate', '--silent', '--no-rate-limit', '--gas-price', '100000000', '--block-base-fee-per-gas', '0'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });

const chain = { ...bsc, rpcUrls: { default: { http: [LOCAL] } } };
const pub = createPublicClient({ chain, transport: http(LOCAL, { timeout: 120000 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(LOCAL, { timeout: 120000 }) });
const walletOf = (address) => createWalletClient({ account: address, chain, transport: http(LOCAL, { timeout: 120000 }) });
// The agent's wallet, with one difference from production that belongs to the
// fork and not to the agent: every transaction is sent with a fixed gas limit
// instead of anvil's own estimate.
const lpWallet = (() => {
  const w = walletOf(LP);
  if (process.env.FORK_GAS === '0') return w;   // FORK_GAS=0: anvil's own estimate, which is too tight for the manager's multicall (burn refunds) — measured 2026-09-18, the same call runs on the real chain
  const write = w.writeContract.bind(w);
  // 700k covers the largest call (a mint across ticks). The fork answers
  // eth_gasPrice with 1 gwei where the chain clears at 0.05, so a limit set
  // generously would not fit inside the agent's 0.003 BNB gas reserve after a
  // few transactions — on the real chain the limit is the node's estimate.
  w.writeContract = (req) => write({ ...req, gas: 700000n });
  return w;
})();
const bal = (token, who) => pub.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [who] });
const sendAs = async (from, req) => { const h = await walletOf(from).writeContract({ ...req, account: from, chain, gas: 25000000n /* the whale crosses hundreds of ticks in one swap */ }); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== 'success') throw new Error('setup transaction reverted'); return r; };

for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(500); } }
const forkBlock = await pub.getBlockNumber();
console.log(`forked BNB Chain at block ${forkBlock} — every transaction below goes to ${LOCAL} and nowhere else\n`);

// The agent's own record and width verdict, as the worker reads them.
const rec = await fetch('https://agent.brainonbnb.com/lp/agent?format=json').then((r) => r.json());
const win = await fetch('https://agent.brainonbnb.com/lp/windows?format=json').then((r) => r.json());
const record = win.verdict, POOL = String(win.pool || rec.pool).toLowerCase();
const LADDER0 = { main: String(rec.ladder.main), reserve: rec.ladder.reserve == null ? null : String(rec.ladder.reserve) };
console.log(`ladder on record: main #${LADDER0.main}, reserve #${LADDER0.reserve}; pool ${POOL}; pick ±${record?.earnings_pick?.width}%\n`);

// A whale with all the BNB and CAKE it needs, and an approval for the router.
await test.setBalance({ address: WHALE, value: parseEther('2000000') });
await test.setBalance({ address: LP, value: (await pub.getBalance({ address: LP })) + parseEther('0.05') });   // gas for the paths, as the tax flow refills it
await sendAs(WHALE, { address: ADDR.WBNB, abi: ERC20, functionName: 'deposit', value: parseEther('1000000') });
let cakeRich = null;
for (const h of ['0x45c54210128a065de780c4b0df3d16664f7f859e', '0x5692db8177a81a6c6afc8084c2976c9933ec1bab', '0xa5f8c5dbd5f286960b9d90548680ae5ebff07652', '0x0ed7e52944161450477ee417de9cd3a859b14fd0']) {
  const b = await bal(CAKE, h); if (!cakeRich || b > cakeRich.b) cakeRich = { h, b };
}
await test.setBalance({ address: cakeRich.h, value: parseEther('1') });
await sendAs(cakeRich.h, { address: CAKE, abi: ERC20, functionName: 'transfer', args: [WHALE, cakeRich.b / 2n] });
for (const t of [ADDR.WBNB, CAKE]) await sendAs(WHALE, { address: t, abi: ERC20, functionName: 'approve', args: [ADDR.V3_SWAP_ROUTER, (1n << 256n) - 1n] });

const sqrtX96AtTick = (t) => BigInt(Math.floor(Math.pow(1.0001, t / 2) * 2 ** 96));
const pos0 = await readPosition(pub, LP, LADDER0);
const FEE = Number(pos0.pos[4]);
// The whale trades until the pool's price stands at `tick`: one swap with a
// price limit, so it stops exactly there whatever the depth is.
async function pushPriceTo(tick) {
  const now = (await readPool(pub, pos0.pos)).tick;
  const up = tick > now;   // CAKE is token0, WBNB token1: buying CAKE with WBNB raises the tick
  const [tokenIn, tokenOut] = up ? [ADDR.WBNB, CAKE] : [CAKE, ADDR.WBNB];
  const amountIn = await bal(tokenIn, WHALE);
  await sendAs(WHALE, { address: ADDR.V3_SWAP_ROUTER, abi: ABI.V3_ROUTER, functionName: 'exactInputSingle', args: [{ tokenIn, tokenOut, fee: FEE, recipient: WHALE, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: sqrtX96AtTick(tick) }] });
  return (await readPool(pub, pos0.pos)).tick;
}
const valueOf = async (ladder) => {
  const p = await readPosition(pub, LP, ladder);
  const info = await readPool(pub, p.pos || pos0.pos);
  const price = info.sqrtP ** 2;
  const side = (x) => (x ? positionSide(x.pos, info.sqrtP, false).valueBnb : 0);
  const loose = (Number(await bal(ADDR.WBNB, LP)) + Number(await bal(CAKE, LP)) * price) / 1e18;
  return { main: p.pos ? side(p) : 0, reserve: side(p.reserve), loose, native: Number(formatEther(await pub.getBalance({ address: LP }))), tick: info.tick, p };
};
const total = (v) => v.main + v.reserve + v.loose + v.native;
const BOBAI = ADDR.BOBAI;

// What the worker's rebalance step does, in its order: the merge first when the
// ladder plan says so, then the re-set — with the ladder record kept in hand.
async function workerRebalance(ladder, { expectMerge = null } = {}) {
  const plan = await planRebalance(pub, LP, { record, pool: POOL, ladder });
  if (plan.no) return { plan, refused: plan.no };
  const txs = [];
  let merged = null;
  if (plan.summary.reserve) {
    const lp2 = await planLadder(pub, LP, { record, ladder });
    if (lp2.act === 'merge') { merged = await executeLadder(pub, lpWallet, lpWallet.account, lp2, () => {}, { txs }); ladder.reserve = null; }
    if (expectMerge != null) ok(`the ladder plan ${expectMerge ? 'merges the reserve first' : 'leaves the reserve where it is'}`, (lp2.act === 'merge') === expectMerge, `act ${lp2.act}: ${lp2.why}`);
  }
  const done = await executeRebalance(pub, lpWallet, lpWallet.account, plan, () => {}, { txs });
  if (done.new_position) ladder.main = String(done.new_position);
  return { plan, done, merged, txs };
}

async function scenario(name, key, fn) {
  if (only && only !== key) return;
  const snap = await test.snapshot();
  console.log(`\n${name}`);
  try { await fn(); } catch (e) { ok('the path ran to its end', false, String(e.shortMessage || e.message || e).slice(0, 300)); }
  await test.revert({ id: snap });
}

// ---------------------------------------------------------------------------
await scenario('RE-SET UPWARD — the price leaves above the main range: the reserve merges, one range below the price, all WBNB, no trade of the capital', 'up', async () => {
  const ladder = { ...LADDER0 };
  const hi = Number(pos0.pos[6]);
  const tick = await pushPriceTo(hi + 150);
  const before = await valueOf(ladder);
  ok('the whale moved the price above the range', tick >= hi + 100, `tick ${tick}, range top ${hi}`);
  const bobai0 = await bal(BOBAI, LP);
  const r = await workerRebalance(ladder, { expectMerge: LADDER0.reserve != null });
  if (r.refused) return ok('the plan re-sets', false, r.refused);
  ok('the plan is one-sided, below the price', r.plan.oneSided === 'above' && r.done.one_sided === 'below_price', `ticks ${r.done.new_ticks}`);
  const ids = await heldIds(pub, LP);
  ok('one position is left, and it is the new one — read off the mint receipt', ids.length === 1 && ids[0] === String(r.done.new_position), `held ${ids.join(', ')}`);
  const after = await valueOf(ladder);
  ok('the new range sits beside the price as it was AT THE MINT (20-29 ticks under it)', after.tick - r.done.new_ticks[1] >= 20 && after.tick - r.done.new_ticks[1] < 30, `tick ${after.tick}, range top ${r.done.new_ticks[1]}`);
  ok('the capital went back in whole: nothing of it is loose in the wallet', after.loose < 0.0005 * total(after), `${after.loose.toFixed(6)} BNB loose of ${total(after).toFixed(4)}`);
  ok('the fees the old range paid in CAKE were sold in full — the sale that asked for more than the wallet held before 2026-09-18', (await bal(CAKE, LP)) < 10n ** 15n, `CAKE left ${formatEther(await bal(CAKE, LP))}; swap ${r.done.swap ? JSON.stringify(r.done.swap).slice(0, 120) : 'none'}`);
  ok('the value is the same before and after, less gas and the fee share', Math.abs(total(after) + (r.done.bobai_bnb || 0) - total(before)) < 0.002 * total(before), `${total(before).toFixed(5)} → ${total(after).toFixed(5)} BNB (+ ${r.done.bobai_bnb || 0} into $BOBAI)`);
  ok('the profit share bought $BOBAI, held in the wallet', !(r.done.bobai_bnb > 0) || (await bal(BOBAI, LP)) > bobai0, `fees folded ${r.done.fees_folded_bnb}, into $BOBAI ${r.done.bobai_bnb}${r.done.fees_forward_why ? ' — ' + r.done.fees_forward_why : ''}`);
  console.log(`       ${r.txs.length} transactions: ${r.txs.map((t) => t.label.split(' ').slice(0, 3).join(' ')).join(' · ')}`);
});

await scenario('RE-SET DOWNWARD — the price falls out of the main range into the reserve: one range above the price, all CAKE, and the profit share sold out of the CAKE fees', 'down', async () => {
  const ladder = { ...LADDER0 };
  const lo = Number(pos0.pos[5]);
  const tick = await pushPriceTo(lo - 150);
  const before = await valueOf(ladder);
  ok('the whale moved the price below the range', tick <= lo - 100, `tick ${tick}, range bottom ${lo}`);
  const bobai0 = await bal(BOBAI, LP);
  const r = await workerRebalance(ladder, { expectMerge: false });
  if (r.refused) return ok('the plan re-sets', false, r.refused);
  ok('the plan is one-sided, above the price', r.done.one_sided === 'above_price', `ticks ${r.done.new_ticks}`);
  const ids = await heldIds(pub, LP);
  ok('two positions are held: the new main range and the reserve that stood', ids.length === (LADDER0.reserve ? 2 : 1) && ids.includes(String(r.done.new_position)) && (!LADDER0.reserve || ids.includes(LADDER0.reserve)), `held ${ids.join(', ')}`);
  const after = await valueOf(ladder);
  ok('the new range sits 20-29 ticks above the price at the mint', r.done.new_ticks[0] - after.tick >= 20 && r.done.new_ticks[0] - after.tick < 30, `tick ${after.tick}, range bottom ${r.done.new_ticks[0]}`);
  ok('nothing of the capital is loose', after.loose < 0.0005 * total(after), `${after.loose.toFixed(6)} BNB loose`);
  ok('the profit share was bought although the fees came in CAKE (before 2026-09-18: "stays as capital")', !(r.done.fees_folded_bnb > 0.0002) || (r.done.bobai_bnb > 0 && (await bal(BOBAI, LP)) > bobai0), `fees folded ${r.done.fees_folded_bnb}, into $BOBAI ${r.done.bobai_bnb}, share sale ${r.done.share_swap ? 'yes' : 'no'}${r.done.fees_forward_why ? ' — ' + r.done.fees_forward_why : ''}`);
  ok('the value is the same before and after, less gas and the fee share', Math.abs(total(after) + (r.done.bobai_bnb || 0) - total(before)) < 0.002 * total(before), `${total(before).toFixed(5)} → ${total(after).toFixed(5)} BNB`);

  // … and BNB that arrives now joins the reserve the price is IN.
  if (LADDER0.reserve) {
    await test.setBalance({ address: LP, value: (await pub.getBalance({ address: LP })) + parseEther('0.06') });
    const lp3 = await planLadder(pub, LP, { record, ladder });
    ok('BNB arriving beside an all-CAKE main range grows the reserve', lp3.act === 'increase_reserve' && !lp3.no, `act ${lp3.act}: ${lp3.no || lp3.why}`);
    if (lp3.act === 'increase_reserve' && !lp3.no) {
      const liq0 = (await readPosition(pub, LP, ladder)).reserve.pos[7];
      const d = await executeLadder(pub, lpWallet, lpWallet.account, lp3, () => {}, { txs: [] });
      const liq1 = (await readPosition(pub, LP, ladder)).reserve.pos[7];
      ok('… through the ordinary increase, buying the side a range the price is in needs (a WBNB-only add reverted there)', liq1 > liq0 && Number(d.bnb_spent) > 0.05, `reserve side ${d.reserve_side}, liquidity ${liq0} → ${liq1}, spent ${d.bnb_spent} BNB, swap ${d.swap ? 'yes' : 'no'}`);
    }
  }
});

await scenario('A RE-SET WHOSE MINT FAILED BESIDE THE RESERVE — the main range is burnt, its CAKE lies loose: finished from the wallet, not sold into the reserve', 'resume', async () => {
  if (!LADDER0.reserve) return ok('needs a standing reserve', true, 'skipped: no reserve on record');
  const ladder = { ...LADDER0 };
  const lo = Number(pos0.pos[5]);
  await pushPriceTo(lo - 150);
  // The first half of a re-set, by hand: withdraw, collect, burn — and then nothing.
  const p = await readPosition(pub, LP, ladder);
  await sendAs(LP, { address: ADDR.V3_POSITION_MANAGER, abi: NPM, functionName: 'multicall', args: [unwindCalls(p.tokenId, p.pos[7], 0n, 0n, LP, BigInt(Math.floor(Date.now() / 1000) + 3600))] });
  const before = await valueOf(ladder);
  const seen = await readPosition(pub, LP, ladder);
  ok('the wallet reads as "no main range, the reserve rides along"', seen.positions === 0 && String(seen.reserve?.tokenId) === LADDER0.reserve && seen.main_missing === LADDER0.main);
  ok('the ladder is NOT closed while the capital lies loose', (await healLadder(pub, LP, { ...ladder })) === null, `${before.loose.toFixed(4)} BNB loose`);
  const inc = await planIncrease(pub, LP, null, ladder);
  ok('the increase step does not take the loose CAKE for a deposit', !!inc.no, inc.no);
  const r = await workerRebalance(ladder, { expectMerge: false });
  if (r.refused) return ok('the resume mints', false, r.refused);
  ok('the resume is one-sided on the token held, and trades nothing of the capital', r.plan.resume === true && r.done.one_sided === 'above_price' && !(r.done.swap && Number(r.done.swap.notional_bnb || 0) > 0.01 * before.loose), `swap ${r.done.swap ? JSON.stringify(r.done.swap).slice(0, 100) : 'none'}`);
  const ids = await heldIds(pub, LP);
  ok('the main range stands again beside the reserve, its id off the receipt', ids.length === 2 && ids.includes(LADDER0.reserve) && ids.includes(String(r.done.new_position)), `held ${ids.join(', ')}`);
  const after = await valueOf(ladder);
  ok('nothing is loose, and the value is what it was', after.loose < 0.0005 * total(after) && Math.abs(total(after) - total(before)) < 0.002 * total(before), `${total(before).toFixed(5)} → ${total(after).toFixed(5)} BNB, loose ${after.loose.toFixed(6)}`);
});

console.log(`\n${n - failed}/${n} checks pass on the fork of block ${forkBlock}`);
stop();
process.exit(failed ? 1 : 0);
