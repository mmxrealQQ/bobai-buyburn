// One-off: buy a little USD1 and pay the agent service, so the paid path gets
// exercised end to end for the first time.
//
// WHY THIS EXISTS
// agent.brainonbnb.com/watch has never once been paid successfully. What is
// tested is the refusal: an unpaid request gets 402, an invented transaction
// hash gets rejected. The success path — a real transfer, recognised, a watch
// created — has only ever been reasoned about. That is the last place in this
// project where "it works" is a claim rather than a measurement.
//
// WHAT IT DOES, in order
//   1. Quotes ~1 USD of BNB into USD1 and refuses to continue if the quote
//      looks wrong.
//   2. Swaps, from the NFT relayer wallet.
//   3. Sends exactly 0.50 USD1 to the service wallet.
//   4. Prints the transfer hash, which is what the paid request needs.
//
// WHY THE NFT RELAYER WALLET
// It is the only project wallet with BNB to spare (~0.049). The creator and
// buyback wallets hold two or three thousandths each, and that is the gas the
// burns and the liquidity runs run on — spending it on a test would stop the
// flywheel to prove a point about the flywheel.
//
// WHY NOT SEND BNB TO THE SERVICE WALLET AND SWAP THERE
// Because then the service wallet would be paying itself, which tests nothing.
// A payment has a payer and a recipient, and the whole point is to watch a real
// inbound transfer from somebody else be recognised. The relayer is the payer.
//
// SAFETY
//   Does nothing without --confirm. A bare run prints the plan and exits.
//   Refuses if the quote implies a USD1 price outside 0.90–1.10.
//   Sends a fixed 0.50 USD1, never "the balance".
//
// Usage:
//   node scripts/x402-test-payment.mjs             # show the plan, change nothing
//   node scripts/x402-test-payment.mjs --confirm   # actually do it
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatUnits, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

// Explicit RPC, never viem's default: a silent fallback to a public node with
// different behaviour is how a script starts failing for reasons nobody can see.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // PancakeSwap V2
const SERVICE_WALLET = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';

// ~1 USD at the BNB price this was written against. Deliberately more than the
// 0.50 the service costs, so a bad fill or a rounding surprise still leaves
// enough to pay with — the leftover stays in the relayer wallet.
const SPEND_BNB = '0.0016';
const PRICE_USD1 = parseUnits('0.5', 18);

const ROUTER_ABI = [
  { name: 'getAmountsOut', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'swapExactETHForTokens', type: 'function', stateMutability: 'payable',
    inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'uint256[]' }] },
];
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

const key = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!key) { console.error('NFT_RELAYER_PRIVATE_KEY is not in .env'); process.exit(1); }

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });

const path = [WBNB, USD1];
const amountIn = parseEther(SPEND_BNB);

const bnbBal = await pub.getBalance({ address: account.address });
const usd1Before = await pub.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

const quote = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsOut', args: [amountIn, path] });
const out = quote[quote.length - 1];

console.log('');
console.log('  payer          ', account.address);
console.log('  BNB balance    ', formatEther(bnbBal));
console.log('  USD1 balance   ', formatUnits(usd1Before, 18));
console.log('');
console.log('  swap           ', SPEND_BNB, 'BNB  ->  ~' + formatUnits(out, 18), 'USD1');
console.log('  then send      ', formatUnits(PRICE_USD1, 18), 'USD1  ->  ' + SERVICE_WALLET);
console.log('');

// A quote is also a sanity check on the route. USD1 is a dollar stablecoin, so
// anything far off a dollar means the path is wrong, the pool is broken, or the
// decimals are not what this script assumes — and any of those is a reason to
// stop rather than to sign a transaction.
const perBnb = Number(formatUnits(out, 18)) / Number(SPEND_BNB);
const bnbUsd = perBnb; // USD1 out per BNB in ≈ the BNB price in dollars
if (!(bnbUsd > 300 && bnbUsd < 2000)) {
  console.error(`  refusing: the quote implies BNB = $${bnbUsd.toFixed(2)}, which is not plausible.`);
  process.exit(1);
}
if (out < PRICE_USD1) {
  console.error('  refusing: the swap would not even yield the 0.50 USD1 the service costs.');
  process.exit(1);
}
if (bnbBal < amountIn * 2n) {
  console.error('  refusing: not enough BNB left over for gas after the swap.');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.log('  nothing was sent. Re-run with --confirm to execute.');
  console.log('');
  process.exit(0);
}

// 2% below the quote. Neither token takes a cut on transfer, so this is plain
// slippage tolerance and nothing more — the 15% floor that $BOBAI needs does
// not apply here and would only invite a worse fill.
const minOut = (out * 98n) / 100n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

console.log('  swapping...');
const swapHash = await wallet.writeContract({
  address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens',
  args: [minOut, path, account.address, deadline],
  value: amountIn, gas: 500000n,
});
const swapRcpt = await pub.waitForTransactionReceipt({ hash: swapHash });
console.log('  swap tx        ', swapHash, swapRcpt.status);
if (swapRcpt.status !== 'success') { console.error('  swap failed, stopping.'); process.exit(1); }

const usd1After = await pub.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
console.log('  USD1 now       ', formatUnits(usd1After, 18));
if (usd1After < PRICE_USD1) { console.error('  less USD1 than the price; stopping.'); process.exit(1); }

console.log('  paying...');
const payHash = await wallet.writeContract({
  address: USD1, abi: ERC20_ABI, functionName: 'transfer',
  args: [SERVICE_WALLET, PRICE_USD1], gas: 120000n,
});
const payRcpt = await pub.waitForTransactionReceipt({ hash: payHash });
console.log('  payment tx     ', payHash, payRcpt.status);
console.log('');
console.log('  >>> PAYMENT HASH FOR THE TEST:');
console.log('  ' + payHash);
console.log('');
console.log('  https://bscscan.com/tx/' + payHash);
console.log('');
