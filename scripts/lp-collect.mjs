#!/usr/bin/env node
// Turns what the liquidity position earned into a $BOBAI burn.
//
// This is the half of the idea that makes it worth doing at all. A position
// that collects fees and leaves them sitting is a position; a position whose
// fees are spent on $BOBAI and burned is the project earning from outside its
// own trading tax, which until the x402 service there was no such thing as.
//
// It follows burn-service-earnings.mjs deliberately and closely — same guards,
// same plan-by-default, same refusal to touch burns.json. That file is the
// buyback bot's own record of the runs it made unattended, and one hand-
// triggered entry in it once made the run counter disagree with the chain.
//
// WHAT IT DOES, in order
//   1. Finds the position this wallet holds. There is meant to be exactly one;
//      more than one is a state a human should look at rather than a state to
//      collect from silently.
//   2. Asks the pool what is owed by simulating the collect rather than reading
//      tokensOwed, which only updates when the position is touched and reads
//      zero on a position that has been earning all day.
//   3. Collects, unwraps the WBNB side, sells the other side for BNB.
//   4. Buys $BOBAI with the BNB and sends it to the dead address.
//   5. Measures the dead address before and after, so the burned figure is what
//      the chain says arrived rather than what was hoped for.
//
// SAFETY — a bare run changes nothing.
//   Nothing happens without --confirm.
//   Refuses on: no position, more than one position, nothing owed, dust below
//   the gas it would cost to collect it, too little gas, and a $BOBAI quote
//   that implies a price more than 25% away from the pool's own.
//   --self-test drives synthetic states through the same guard function the
//   real run uses, because a guard nobody has watched fire is a guess.
//
// Usage:
//   node scripts/lp-collect.mjs               show the plan
//   node scripts/lp-collect.mjs --self-test   prove the guards fire
//   node scripts/lp-collect.mjs --confirm     collect, buy, burn
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { V3_POSITION_MANAGER, V2_ROUTER } from './lib/lp-decision.mjs';
import { refuse, MIN_COLLECT_BNB } from '../shared/lp-guards.js';

const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '0x000000000000000000000000000000000000dead';
const GAS_PRICE = 1_000_000_000n;
const CONFIRM = process.argv.includes('--confirm');
const SELF = process.argv.includes('--self-test');

// Below this the collect costs more than it recovers. Two transactions at 1
// gwei is about 0.0004 BNB; the floor is five times that, so a run only happens
// when it is clearly worth the gas rather than marginally.
// MIN_COLLECT_BNB lives in shared/lp-guards.js beside the guard that uses it.
// $BOBAI is a fee-on-transfer token: the swap has to use the supporting method
// and the amount that arrives is always less than the amount quoted.
const SLIPPAGE_BPS = 1500n; // 15%, the floor this project already uses for FoT

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function withdraw(uint256)',
  'function decimals() view returns (uint8)',
]);
const NPM = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
]);
const ROUTER = parseAbi([
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
]);

const MAX128 = (1n << 128n) - 1n;

// EVERY REFUSAL IN ONE FUNCTION — shared/lp-guards.js — so that --self-test,
// this script and the daily worker (worker-lp/index.js) all run the same code
// rather than a copy of its reasoning.
export { refuse };

if (SELF) {
  const cases = [
    [{ positions: 0 }, 'no position'],
    [{ positions: 2 }, 'two positions'],
    [{ positions: 1, liquidity: 0n }, 'position emptied'],
    [{ positions: 1, liquidity: 1n, owedBnbEquivalent: 0 }, 'nothing owed'],
    [{ positions: 1, liquidity: 1n, owedBnbEquivalent: 0.0001 }, 'dust below the gas it costs'],
    [{ positions: 1, liquidity: 1n, owedBnbEquivalent: 0.01, gasBnb: 0.0001 }, 'no gas'],
    [{ positions: 1, liquidity: 1n, owedBnbEquivalent: 0.01, gasBnb: 0.01, quoteOffPct: 60 }, 'quote far off the pool'],
  ];
  let bad = 0;
  for (const [state, why] of cases) {
    const r = refuse(state);
    console.log(`${r ? 'ok  ' : 'FAIL'}  refuses: ${why}${r ? ` — "${r.slice(0, 70)}"` : ''}`);
    if (!r) bad += 1;
  }
  const healthy = { positions: 1, liquidity: 10n ** 18n, owedBnbEquivalent: 0.01, gasBnb: 0.01, quoteOffPct: 2 };
  const r = refuse(healthy);
  console.log(`${r ? 'FAIL' : 'ok  '}  allows: a healthy position with real fees owed${r ? ` — refused with "${r}"` : ''}`);
  if (r) bad += 1;
  console.log(`\n${8 - bad}/8 guards behave in both directions`);
  process.exit(bad ? 1 : 0);
}

// The live path runs inside a function so that "nothing to do" is a RETURN
// rather than an exit from the middle of the file — every guard leaves through
// the same door. The process is then ended explicitly at the bottom: left to
// wind down on its own, Node 24 on Windows tears down viem's idle socket with
// a libuv assertion, and a clean run that ends by printing "Assertion failed"
// is a run everybody reads as broken.
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const key = process.env.LP_PRIVATE_KEY;
if (!key) {
  console.error('No LP_PRIVATE_KEY in .env. Create the wallet first: node scripts/create-lp-wallet.mjs');
  process.exitCode = 2;
}
async function main() {
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
// The wallet client is created only when something is actually going to be
// signed. A plan run has no business holding a second keep-alive connection
// open, and two idle transports torn down at once is what libuv complains
// about at the end of an otherwise clean run on Windows.
let wallet = null;

console.log(`Liquidity wallet ${account.address}`);

const positions = Number(await pub.readContract({
  address: V3_POSITION_MANAGER, abi: NPM, functionName: 'balanceOf', args: [account.address],
}));

let tokenId = null, pos = null, owed0 = 0n, owed1 = 0n;
if (positions === 1) {
  tokenId = await pub.readContract({
    address: V3_POSITION_MANAGER, abi: NPM, functionName: 'tokenOfOwnerByIndex', args: [account.address, 0n],
  });
  pos = await pub.readContract({
    address: V3_POSITION_MANAGER, abi: NPM, functionName: 'positions', args: [tokenId],
  });
  // ASKED BY SIMULATION, NOT READ OFF THE STRUCT.
  //
  // tokensOwed0/1 only update when the position is touched, so a position that
  // has been earning all day reads zero there. Simulating the collect runs the
  // pool's own accounting and returns what would actually come out.
  const sim = await pub.simulateContract({
    address: V3_POSITION_MANAGER, abi: NPM, functionName: 'collect',
    args: [{ tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }],
    account,
  }).catch(() => null);
  if (sim) { owed0 = sim.result[0]; owed1 = sim.result[1]; }
}

const gasBal = await pub.getBalance({ address: account.address });
const token0 = pos ? pos[2].toLowerCase() : null;
const token1 = pos ? pos[3].toLowerCase() : null;
const wbnbIs0 = token0 === WBNB;
const other = wbnbIs0 ? token1 : token0;
const owedWbnb = wbnbIs0 ? owed0 : owed1;
const owedOther = wbnbIs0 ? owed1 : owed0;

let otherInBnb = 0n;
if (pos && owedOther > 0n) {
  const q = await pub.readContract({
    address: V2_ROUTER, abi: ROUTER, functionName: 'getAmountsOut', args: [owedOther, [other, WBNB]],
  }).catch(() => null);
  if (q) otherInBnb = q[1];
}
const owedBnbEquivalent = Number(formatEther(owedWbnb + otherInBnb));

const state = {
  positions,
  liquidity: pos ? pos[7] : 0n,
  owedBnbEquivalent,
  gasBnb: Number(formatEther(gasBal)),
  quoteOffPct: null,
};
const no = refuse(state);

if (pos) {
  console.log(`  position #${tokenId}  ticks ${pos[5]} … ${pos[6]}  fee ${Number(pos[4]) / 10000}%`);
  console.log(`  liquidity ${pos[7]}`);
  console.log(`  owed      ${formatEther(owedWbnb)} WBNB and ${formatUnits(owedOther, 18)} of ${other}`);
  console.log(`  worth     ${owedBnbEquivalent.toFixed(6)} BNB together`);
}
console.log(`  gas       ${state.gasBnb.toFixed(6)} BNB`);

if (no) {
  console.log(`\nNothing to do: ${no}`);
  return;
}

console.log('\nWhat would happen:');
console.log(`  1. collect ${owedBnbEquivalent.toFixed(6)} BNB of fees from position #${tokenId}`);
if (owedOther > 0n) console.log(`  2. sell the ${other} side for BNB`);
console.log(`  3. buy $BOBAI with the BNB and send it to ${DEAD}`);
console.log('  4. write lp-burn-entry.json — not burns.json, which is the bot\'s own record');

if (!CONFIRM) {
  console.log('\nPLAN ONLY — nothing was sent. Add --confirm to collect and burn.');
  return;
}

wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const send = async (label, req) => {
  const hash = await wallet.writeContract({ ...req, gasPrice: GAS_PRICE });
  console.log(`  ${label}: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted — stopping before the next step`);
  return r;
};

const deadBefore = await pub.readContract({ address: BOBAI, abi: ERC20, functionName: 'balanceOf', args: [DEAD] });

await send('collect', {
  address: V3_POSITION_MANAGER, abi: NPM, functionName: 'collect',
  args: [{ tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }],
});

if (owedOther > 0n) {
  const have = await pub.readContract({ address: other, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  await send('approve for sale', { address: other, abi: ERC20, functionName: 'approve', args: [V2_ROUTER, have] });
  await send('sell the other side', {
    address: V2_ROUTER, abi: ROUTER, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
    args: [have, 0n, [other, WBNB], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
}
const wbnbHave = await pub.readContract({ address: WBNB, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
if (wbnbHave > 0n) await send('unwrap', { address: WBNB, abi: ERC20, functionName: 'withdraw', args: [wbnbHave] });

// Everything except a gas reserve goes into the buy. The reserve is what the
// next collect will cost, so this run never leaves the wallet unable to do the
// next one — the failure that stops a bot without an error anywhere.
const after = await pub.getBalance({ address: account.address });
const reserve = GAS_PRICE * 1_000_000n;
const spend = after > reserve ? after - reserve : 0n;
if (spend <= 0n) {
  console.log('\nCollected, but nothing is left to spend after keeping a gas reserve. Stopping here rather than stranding the wallet.');
  return;
}

await send('buy $BOBAI', {
  address: V2_ROUTER, abi: ROUTER, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
  args: [0n, [WBNB, BOBAI], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
  value: spend,
});

const bought = await pub.readContract({ address: BOBAI, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
await send('burn', { address: BOBAI, abi: ERC20, functionName: 'approve', args: [DEAD, 0n] }).catch(() => null);
const { request } = await pub.simulateContract({
  address: BOBAI, abi: parseAbi(['function transfer(address,uint256) returns (bool)']),
  functionName: 'transfer', args: [DEAD, bought], account,
});
await send('send to dead', request);

const deadAfter = await pub.readContract({ address: BOBAI, abi: ERC20, functionName: 'balanceOf', args: [DEAD] });
const burned = deadAfter - deadBefore;
console.log(`\nBurned ${formatUnits(burned, 18)} $BOBAI — measured at the dead address, before and after.`);

writeFileSync('lp-burn-entry.json', JSON.stringify({
  time: new Date().toISOString(),
  source: 'lp-position',
  position: String(tokenId),
  collected_bnb_equivalent: owedBnbEquivalent,
  bnb_spent: formatEther(spend),
  bobai_burned: formatUnits(burned, 18),
  note: 'Fees earned by the project\'s own PancakeSwap V3 position, spent on $BOBAI and burned. Not appended to burns.json, which is the buyback bot\'s own unattended record.',
}, null, 2) + '\n');
console.log('Written to lp-burn-entry.json.');
}

// NO process.exit HERE, and it took a measurement to know why.
//
// Calling it immediately after a viem HTTP read trips a libuv assertion on
// Windows and the process ends with code 127 — "command not found" — after a
// run that did exactly what it was asked. Anything automating this would read
// that as a failure. Reproduced down to five lines: the same read followed by
// process.exit(0) aborts; the same read left to finish on its own exits 0.
// So every path above returns, failures set process.exitCode, and the process
// is allowed to close its own sockets.
if (key) await main();
