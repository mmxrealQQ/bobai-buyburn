#!/usr/bin/env node
// Opens the liquidity position this project's own tools chose.
//
// PLAN BY DEFAULT. Run without --confirm it reads the chain, prints every
// transaction it would send with the exact amounts, and moves nothing. That is
// the same shape as gas-refill.mjs, the burn scripts and the reputation writes,
// and it is not politeness: the failure mode of a script that acts on sight is
// that it acts on the day you meant to look.
//
// WHAT IT DOES, in order
//   1. wrap the BNB the position needs into WBNB
//   2. buy the other side on PancakeSwap V2
//   3. approve both tokens to the V3 position manager
//   4. mint the position at the ticks the plan named
//
// The decision — which pool, which tier, which width, how much of each token —
// is not made here. It comes from scripts/lib/lp-decision.mjs, the same module
// lp-plan.mjs prints, so that what was read and what gets signed are the same
// decision rather than two runs of the same reasoning minutes apart.
//
// Usage:
//   node scripts/lp-open.mjs [--usd 50]              plan only
//   node scripts/lp-open.mjs [--usd 50] --confirm    send it
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { decide, V3_POSITION_MANAGER, V2_ROUTER } from './lib/lp-decision.mjs';

const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const CONFIRM = process.argv.includes('--confirm');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : d;
};
const USD = Number(arg('--usd', 50)) || 50;

// Slippage on the acquisition leg only. The position itself is minted with
// minimums derived from what the swap actually returned, so this number never
// silently becomes the size of the position.
const SLIPPAGE_BPS = 100n; // 1%
// One gwei, matching how every other wallet in this repo is planned. BSC sits
// far below it; a position sized on a quiet chain is stranded by a busy hour.
const GAS_PRICE = 1_000_000_000n;

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function deposit() payable',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
const ROUTER = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[])',
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[])',
]);
const NPM = parseAbi([
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
]);

const pub = createPublicClient({ chain: bsc, transport: http(RPC) });

const key = process.env.LP_PRIVATE_KEY;
if (!key) {
  console.error('No LP_PRIVATE_KEY in .env. Create the wallet first: node scripts/create-lp-wallet.mjs');
  process.exit(2);
}
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });

const fmt = (n, d = 6) => Number(n).toFixed(d);
console.log(`Liquidity wallet ${account.address}`);

const out = await decide({ usd: USD });
const w = out.winner;
if (!w) {
  console.log('\nThe tools found nowhere worth putting it. Nothing to open.');
  out.tools.cleanup();
  process.exit(0);
}

// THE SAFETY RAIL THAT MATTERS MOST HERE.
//
// A token that taxes transfers breaks every amount in this plan: the pool
// receives less than was sent, the mint takes a different ratio than it was
// given, and the position ends up somewhere other than where it was measured.
// Our own scanner measures the tax from executed trades rather than reading a
// label, so it is asked, and a non-zero answer stops the run.
const { C } = out.tools;
const target = w.tokenIsZero ? w.token0 : w.token1;
const tax = await C.measureTax(target, w.pool, w.tokenIsZero, 'v3').catch(() => ({ ok: false, reason: 'not measurable' }));
if (tax.ok && ((tax.buy || 0) > 0.0005 || (tax.sell || 0) > 0.0005)) {
  console.log(`\nREFUSING: ${w.symbol} charges a transfer tax (buy ${((tax.buy || 0) * 100).toFixed(2)}%, sell ${((tax.sell || 0) * 100).toFixed(2)}%).`);
  console.log('Every amount in this plan assumes what is sent is what arrives. It would not be.');
  out.tools.cleanup();
  process.exit(1);
}

const bal = await pub.getBalance({ address: account.address });
const quoteIsWbnb = (w.tokenIsZero ? w.token1 : w.token0) === WBNB;
if (!quoteIsWbnb) {
  console.log('\nREFUSING: the quote side of this pool is not WBNB, and this script only knows how to');
  console.log('assemble a position out of BNB. Nothing here is wrong; it is simply not built for that pair yet.');
  out.tools.cleanup();
  process.exit(1);
}

// How much BNB the whole thing needs: the quote side of the position, plus what
// the other side costs to buy, plus the acquisition slippage, plus gas.
const needQuoteRaw = w.tokenIsZero ? w.amount1Raw : w.amount0Raw;
const needTokenRaw = w.tokenIsZero ? w.amount0Raw : w.amount1Raw;
const path = [WBNB, target];
const quoted = await pub.readContract({
  address: V2_ROUTER, abi: ROUTER, functionName: 'getAmountsOut',
  args: [10n ** 18n, path],
});
// BNB per unit of the token, from the router that will actually do the swap.
const perBnb = Number(formatUnits(quoted[1], w.tokenIsZero ? w.dec0 : w.dec1));
const buyBnb = perBnb > 0 ? Number(formatUnits(needTokenRaw, w.tokenIsZero ? w.dec0 : w.dec1)) / perBnb : 0;
const buyRaw = BigInt(Math.ceil(buyBnb * 1.02 * 1e18));   // 2% headroom on the acquisition
const gasBudget = GAS_PRICE * 1_400_000n;                  // wrap+approve+swap+2 approvals+mint
const totalNeeded = needQuoteRaw + buyRaw + gasBudget;

console.log(`\n${w.symbol}/BNB ${w.tier} — ±${w.width_pct}%, ticks ${w.tickLower} … ${w.tickUpper}`);
console.log(`  pool            ${w.pool}`);
console.log(`  position needs  ${fmt(Number(formatUnits(needTokenRaw, w.tokenIsZero ? w.dec0 : w.dec1)), 6)} ${w.symbol}`
  + ` and ${fmt(Number(formatEther(needQuoteRaw)), 6)} BNB`);
console.log(`  buying that     ~${fmt(buyBnb, 6)} BNB through PancakeSwap V2, 2% headroom, 1% slippage floor`);
console.log(`  gas budget      ${fmt(Number(formatEther(gasBudget)), 6)} BNB at 1 gwei`);
console.log(`  total needed    ${fmt(Number(formatEther(totalNeeded)), 6)} BNB`);
console.log(`  wallet holds    ${fmt(Number(formatEther(bal)), 6)} BNB`);

if (bal < totalNeeded) {
  const short = totalNeeded - bal;
  console.log(`\nNot enough. Send ${fmt(Number(formatEther(short)), 6)} BNB (about $${fmt(Number(formatEther(short)) * w.bnbUsd, 2)}) to:`);
  console.log(`  ${account.address}`);
  console.log('\nThen run this again. Nothing has moved.');
  out.tools.cleanup();
  process.exit(0);
}

const steps = [
  `1. wrap ${fmt(Number(formatEther(needQuoteRaw + buyRaw)), 6)} BNB into WBNB`,
  `2. approve WBNB to the V2 router`,
  `3. swap ~${fmt(buyBnb, 6)} WBNB for ${w.symbol}`,
  `4. approve ${w.symbol} and WBNB to the position manager`,
  `5. mint the position at ticks ${w.tickLower} … ${w.tickUpper}`,
];
console.log('\nWhat would happen:');
for (const s of steps) console.log('  ' + s);

if (!CONFIRM) {
  console.log('\nPLAN ONLY — nothing was sent. Add --confirm to open the position.');
  out.tools.cleanup();
  process.exit(0);
}

const send = async (label, req) => {
  const hash = await wallet.writeContract({ ...req, gasPrice: GAS_PRICE });
  console.log(`  ${label}: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted — stopping before the next step`);
  return r;
};

console.log('\nOpening.');
await send('wrap', { address: WBNB, abi: ERC20, functionName: 'deposit', value: needQuoteRaw + buyRaw });
await send('approve WBNB → router', { address: WBNB, abi: ERC20, functionName: 'approve', args: [V2_ROUTER, needQuoteRaw + buyRaw] });

const minOut = (needTokenRaw * (10000n - SLIPPAGE_BPS)) / 10000n;
await send('swap', {
  address: V2_ROUTER, abi: ROUTER, functionName: 'swapExactTokensForTokens',
  args: [buyRaw, minOut, path, account.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
});

// What actually arrived, not what was expected to. The mint is sized from the
// balances the wallet really holds — a swap that came back one percent short
// would otherwise revert the mint and leave the money in two half-positions.
const [haveTok, haveWbnb] = await Promise.all([
  pub.readContract({ address: target, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
  pub.readContract({ address: WBNB, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
]);
console.log(`  arrived: ${formatUnits(haveTok, w.tokenIsZero ? w.dec0 : w.dec1)} ${w.symbol}, ${formatEther(haveWbnb)} WBNB`);

await send(`approve ${w.symbol} → position manager`, { address: target, abi: ERC20, functionName: 'approve', args: [V3_POSITION_MANAGER, haveTok] });
await send('approve WBNB → position manager', { address: WBNB, abi: ERC20, functionName: 'approve', args: [V3_POSITION_MANAGER, haveWbnb] });

const amount0Desired = w.tokenIsZero ? haveTok : haveWbnb;
const amount1Desired = w.tokenIsZero ? haveWbnb : haveTok;
const receipt = await send('mint', {
  address: V3_POSITION_MANAGER, abi: NPM, functionName: 'mint',
  args: [{
    token0: w.token0, token1: w.token1, fee: Math.round(w.fee_pct * 10000),
    tickLower: w.tickLower, tickUpper: w.tickUpper,
    amount0Desired, amount1Desired,
    // Minimums at 95% of what is on hand. The mint takes only the ratio the
    // range needs and leaves the rest in the wallet, so these are a floor
    // against the price moving mid-transaction, not a target.
    amount0Min: (amount0Desired * 95n) / 100n,
    amount1Min: (amount1Desired * 95n) / 100n,
    recipient: account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  }],
});

console.log(`\nOpen. Block ${receipt.blockNumber}.`);
console.log('The position is an NFT held by this wallet. Its whole history is this wallet\'s history.');
console.log('Next: node scripts/lp-agent.mjs   (plan only, as always — the daily worker runs the same steps)');
out.tools.cleanup();
