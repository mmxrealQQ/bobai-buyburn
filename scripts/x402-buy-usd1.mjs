// Buy a little USD1 with BNB on the NFT relayer wallet, then pay 0.50 USD1 to
// the x402 service wallet — the payment the B402 Bazaar wants to see before it
// will list us.
//
// WHY THIS EXISTS
// Binance's Bazaar indexes a paid endpoint after a settle call naming a real
// payment. Measured 2026-08-23: a settle with no payment attached is answered
// 202 and never appears. The creator, buyback, prize and service wallets hold
// no USD1 at all, so there was nothing to name. This produces one.
//
// WHY THE NFT RELAYER WALLET
// Same reason as scripts/fund-service-wallet.mjs: it is the only project wallet
// with BNB to spare. The creator, buyback, prize and service wallets hold two
// or three thousandths each, and that is the gas the burns and the liquidity
// runs run on — spending it here would stop the flywheel.
//
// THE SWAP IS SKIPPED IF IT IS NOT NEEDED
// Measured on the first run: the relayer already held 0.585 USD1, left over
// from earlier work. Buying more would have spent BNB to acquire something the
// wallet was already holding. A script that always does every step it can do is
// a script that costs money for no reason.
//
// WHY TWO TRANSACTIONS AND NOT ONE
// The swap could send its output straight to the service wallet and save a few
// cents of gas. It would also make the proof a transfer from a PancakeSwap
// pair, which is not what a payment looks like. Swapping first and then paying
// produces a plain wallet-to-wallet transfer of exactly the price — the same
// shape a real customer's payment has, and the same shape our own verifier
// reads. Clarity is worth two cents.
//
// AND SAY IT PLAINLY: this is us paying ourselves. It is not income. The
// figure on the site counts completed purchases and this is not one, so that
// number stays right — but the USD1 does land in the wallet the burn script
// empties by balance, so whoever burns next has to know 0.50 of it was ours.
//
// SAFETY — a bare run changes nothing
//   Does nothing without --confirm. A bare run prints the plan and exits.
//   Refuses if the router's price disagrees with the Chainlink feed by >5%
//     — the two are independent, and a pool that has been drained or is being
//     manipulated shows up as exactly that disagreement.
//   Refuses if the swap would need more than MAX_SPEND_BNB.
//   Refuses if it would leave the relayer below MIN_REMAINING; that wallet
//     mints NFTs on every $100+ buy and must not run dry.
//   amountOutMin is a hard floor, so a sandwich cannot hand us less than the
//     price we are about to pay.
//
// Usage:
//   node scripts/x402-buy-usd1.mjs             # show the plan
//   node scripts/x402-buy-usd1.mjs --confirm   # swap, then pay
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, formatUnits, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

// Explicit RPC, never viem's default: a silent fallback to a public node with
// different behaviour is how a script starts failing for reasons nobody can see.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const A = (s) => getAddress(s.toLowerCase());
const ROUTER = A('0x10ED43C718714eb63d5aA57B78B54704E256024E');
const WBNB = A('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USD1 = A('0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d');
const SERVICE_WALLET = A('0x690E950214980BC329823A2DB2fD90C06Bd54dE4');
const CHAINLINK_BNB_USD = A('0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE');

const PRICE = 500000000000000000n;   // 0.50 USD1 — the listed price
const TARGET = 560000000000000000n;  // buy a little over it, so rounding cannot leave us short
const MIN_OUT = 510000000000000000n; // hard floor on the swap
const MAX_SPEND_BNB = parseEther('0.0025');
const MIN_REMAINING = parseEther('0.02'); // BNB the relayer keeps for NFT mints
const MAX_FEED_AGE_S = 3600;
const MAX_FEED_DIVERGENCE = 0.05;

const ROUTER_ABI = [
  { name: 'getAmountsIn', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'getAmountsOut', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'swapExactETHForTokens', type: 'function', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256[]' }] },
];
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const FEED_ABI = [{
  name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
  outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
}];

const confirm = process.argv.includes('--confirm');

const key = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!key) {
  console.error('NFT_RELAYER_PRIVATE_KEY is not in .env.');
  process.exit(1);
}

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });

const stop = (why) => { console.error(`\n  refused: ${why}`); process.exit(1); };

console.log('Buy USD1, then pay the service wallet\n');
console.log(`  from   ${account.address}  (NFT relayer)`);
console.log(`  to     ${SERVICE_WALLET}  (x402 service wallet)`);

const path = [WBNB, USD1];
const [bnbBalance, usd1Before, feed] = await Promise.all([
  pub.getBalance({ address: account.address }),
  pub.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  pub.readContract({ address: CHAINLINK_BNB_USD, abi: FEED_ABI, functionName: 'latestRoundData' }),
]);

const needSwap = usd1Before < PRICE;

// The feed, checked for staleness before it is used for anything.
const feedPrice = Number(feed[1]) / 1e8;
const feedAge = Math.floor(Date.now() / 1000) - Number(feed[3]);
if (feedAge > MAX_FEED_AGE_S) stop(`the Chainlink answer is ${Math.round(feedAge / 60)} minutes old`);
if (!(feedPrice > 100 && feedPrice < 5000)) stop(`Chainlink says BNB is $${feedPrice}, which is not a price this script will act on`);

let spend = 0n;
if (needSwap) {
  const amountsIn = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsIn', args: [TARGET, path] });
  // Buffer over the exact input, because the pool moves between quote and block.
  spend = (amountsIn[0] * 103n) / 100n;
  if (spend > MAX_SPEND_BNB) stop(`the swap would need ${formatEther(spend)} BNB, over the ${formatEther(MAX_SPEND_BNB)} ceiling`);
  if (bnbBalance - spend < MIN_REMAINING) stop(`that would leave the relayer under ${formatEther(MIN_REMAINING)} BNB, and it mints NFTs`);

  // Two independent prices, held against each other. The router quote implies a
  // BNB price; the feed states one. A pool that has been drained or is being
  // manipulated shows up here and nowhere else.
  const impliedPrice = Number(formatUnits(TARGET, 18)) / Number(formatEther(amountsIn[0]));
  const divergence = Math.abs(impliedPrice - feedPrice) / feedPrice;
  if (divergence > MAX_FEED_DIVERGENCE)
    stop(`the pool implies BNB at $${impliedPrice.toFixed(2)} while Chainlink says $${feedPrice.toFixed(2)} — ${(divergence * 100).toFixed(1)}% apart`);
  console.log(`  pool implies      $${impliedPrice.toFixed(2)} per BNB`);
}

console.log(`\n  relayer holds     ${formatEther(bnbBalance)} BNB, ${formatUnits(usd1Before, 18)} USD1`);
console.log(`  BNB/USD           $${feedPrice.toFixed(2)} (Chainlink, ${feedAge}s old)`);
if (needSwap) {
  console.log(`\n  1. swap           ${formatEther(spend)} BNB  ->  at least ${formatUnits(MIN_OUT, 18)} USD1`);
  console.log(`     expected        ~${formatUnits(TARGET, 18)} USD1`);
  console.log(`  2. pay            ${formatUnits(PRICE, 18)} USD1  ->  ${SERVICE_WALLET}`);
  console.log(`\n  leaves the relayer at ~${formatEther(bnbBalance - spend)} BNB`);
} else {
  console.log(`\n  no swap needed — the wallet already holds ${formatUnits(usd1Before, 18)} USD1.`);
  console.log(`  1. pay            ${formatUnits(PRICE, 18)} USD1  ->  ${SERVICE_WALLET}`);
  console.log(`\n  BNB is untouched apart from gas.`);
}

if (!confirm) {
  console.log('\n  plan only. Nothing was sent. Re-run with --confirm to do it.');
  process.exit(0);
}

let usd1After = usd1Before;
if (needSwap) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  console.log('\n  swapping...');
  const swapTx = await wallet.writeContract({
    address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens',
    args: [MIN_OUT, path, account.address, deadline], value: spend, gas: 500000n,
  });
  const swapReceipt = await pub.waitForTransactionReceipt({ hash: swapTx });
  if (swapReceipt.status !== 'success') stop(`the swap failed: ${swapTx}`);
  usd1After = await pub.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
  console.log(`  swap ok   ${swapTx}`);
  console.log(`  received  ${formatUnits(usd1After - usd1Before, 18)} USD1`);
}

if (usd1After < PRICE) stop(`only ${formatUnits(usd1After, 18)} USD1 on the wallet, and the price is ${formatUnits(PRICE, 18)}`);

console.log('\n  paying...');
const payTx = await wallet.writeContract({
  address: USD1, abi: ERC20_ABI, functionName: 'transfer',
  args: [SERVICE_WALLET, PRICE], gas: 100000n,
});
const payReceipt = await pub.waitForTransactionReceipt({ hash: payTx });
if (payReceipt.status !== 'success') stop(`the payment failed: ${payTx}`);

console.log(`  paid ok   ${payTx}`);
console.log(`\n  proof for the Bazaar:\n\n    node scripts/b402-register.mjs --proof=${payTx} --live\n`);
