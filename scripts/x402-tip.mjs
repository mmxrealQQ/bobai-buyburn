// Tip our own agent over x402, the way a stranger's agent would: read the 402 of /tip, pay the amount in USD1 by
// direct transfer, repeat the request with the transaction hash, get the thank-you back.
//
// WHY THIS EXISTS
// The voluntary tip (agent.brainonbnb.com/tip, 2026-09-26) has its refusals pinned by the smoke test without money.
// The path that takes money can only be proved by paying, and that is what this does, once, on demand — plan by
// default, `--confirm` to spend. The payer is the NFT relayer, as in x402-buy-answer.mjs: a project wallet with BNB
// to spare, listed in OWN_WALLETS, so the tip is recorded as our own test and never as a stranger's money.
//
// Usage:
//   node scripts/x402-tip.mjs                      # plan: 0.10
//   node scripts/x402-tip.mjs --usd 0.1 --confirm  # pay it
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, formatUnits, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';
const AGENT = 'https://agent.brainonbnb.com';
const A = (s) => getAddress(s.toLowerCase());
const ROUTER = A('0x10ED43C718714eb63d5aA57B78B54704E256024E');
const WBNB = A('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USD1 = A('0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d');
const MAX_SPEND_BNB = parseEther('0.001');
const MIN_REMAINING = parseEther('0.02');
const MAX_TIP = 200000000000000000n; // 0.20: this script tests the path, it does not donate
const ROUTER_ABI = [
  { name: 'getAmountsIn', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'swapExactETHForTokens', type: 'function', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256[]' }] },
];
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const confirm = process.argv.includes('--confirm');
const usd = arg('--usd', '0.1');
const die = (why) => { console.error(`\n  refused: ${why}`); process.exit(1); };

// 1. The terms, from the 402 itself — never from a number typed here.
const url = `${AGENT}/tip?usd=${encodeURIComponent(usd)}`;
const termsRes = await fetch(url);
const terms = await termsRes.json().catch(() => ({}));
if (termsRes.status !== 402) die(`expected a 402 with terms, got ${termsRes.status}: ${JSON.stringify(terms).slice(0, 200)}`);
const direct = (terms.accepts || []).find((a) => a.extra && a.extra.assetTransferMethod === 'direct-transfer');
if (!direct) die('the 402 offers no direct-transfer scheme');
const payTo = A(direct.payTo), price = BigInt(direct.maxAmountRequired);
if (A(direct.asset) !== USD1) die(`the 402 asks for ${direct.asset}, not USD1`);
if (price > MAX_TIP) die(`the 402 asks ${formatUnits(price, 18)} USD1, more than this script will pay`);

console.log(`Tip BOBAI over x402\n\n  amount    ${formatUnits(price, 18)} USD1  ->  ${payTo}\n  terms     ${terms.what}`);
const key = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!key) die('NFT_RELAYER_PRIVATE_KEY is not in .env');
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const [bnb, held] = await Promise.all([
  pub.getBalance({ address: account.address }),
  pub.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
]);
console.log(`  from      ${account.address}  (NFT relayer): ${formatEther(bnb)} BNB, ${formatUnits(held, 18)} USD1`);
const needSwap = held < price;
let spend = 0n;
if (needSwap) {
  const target = price + 20000000000000000n;
  const amountsIn = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsIn', args: [target, [WBNB, USD1]] });
  spend = (amountsIn[0] * 103n) / 100n;
  if (spend > MAX_SPEND_BNB) die(`the top-up swap would need ${formatEther(spend)} BNB, over the ${formatEther(MAX_SPEND_BNB)} ceiling`);
  if (bnb - spend < MIN_REMAINING) die(`that would leave the relayer under ${formatEther(MIN_REMAINING)} BNB, and it mints NFTs`);
  console.log(`  1. swap   ${formatEther(spend)} BNB -> ~${formatUnits(target, 18)} USD1 (the wallet is short)`);
}
console.log(`  ${needSwap ? '2' : '1'}. pay    ${formatUnits(price, 18)} USD1 -> ${payTo}`);
console.log(`  ${needSwap ? '3' : '2'}. ask    GET /tip?usd=${usd} with PAYMENT-SIGNATURE: <tx>`);
if (!confirm) { console.log('\n  plan only. Nothing was sent. Re-run with --confirm to do it.'); process.exit(0); }

if (needSwap) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  console.log('\n  swapping...');
  const swapTx = await wallet.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [price, [WBNB, USD1], account.address, deadline], value: spend, gas: 500000n });
  const sr = await pub.waitForTransactionReceipt({ hash: swapTx });
  if (sr.status !== 'success') die(`the swap failed: ${swapTx}`);
  console.log(`  swap ok   ${swapTx}`);
}
console.log('\n  paying...');
const payTx = await wallet.writeContract({ address: USD1, abi: ERC20_ABI, functionName: 'transfer', args: [payTo, price], gas: 150000n });
const pr = await pub.waitForTransactionReceipt({ hash: payTx });
if (pr.status !== 'success') die(`the payment failed: ${payTx}`);
console.log(`  paid ok   ${payTx}\n\n  asking...`);
// The service reads receipts from public nodes; give them a moment.
let res = null, ans = null;
for (let i = 0; i < 6; i++) {
  res = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': payTx } });
  ans = await res.json().catch(() => ({}));
  if (res.status !== 402 || !/not found/.test(ans.reason || '')) break;
  await new Promise((r) => setTimeout(r, 4000));
}
console.log(`\n  HTTP ${res.status}\n  ${JSON.stringify(ans, null, 2).split('\n').join('\n  ')}`);
if (res.status !== 200) process.exitCode = 1;
else console.log('\n  the tip is in the x402 wallet; the DeFi agent\'s next daily sweep takes it into its pool.');
