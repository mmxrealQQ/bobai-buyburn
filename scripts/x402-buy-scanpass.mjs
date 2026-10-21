// Buy a pool scan day pass ON THE SCAN, the way an x402 client past the free line would (2026-10-21): run a caller to
// the line, read the 51st scan's 402, pay 0.50 USD1 by direct transfer, repeat the scan with the transaction hash, and
// see the scan answered, the pass and the receipt in the headers, and the caller scan on with nothing to send.
//
// WHY THIS EXISTS
// Since 17ebaf8 the 51st REST scan is the pass's own 402 and a payment on the scan buys it. Every path without money
// is pinned by scripts/scan-quota-check.mjs; the one that takes money can only be proved by paying, once, on demand.
//
// WHO PAYS
// The NFT relayer wallet, as in x402-buy-answer.mjs: the only project wallet with BNB to spare. It holds no USD1, so a
// small swap tops it up first. Its $BOBAI is not touched (it keeps 808.41). This is us paying ourselves: the 0.50 USD1
// lands in the x402 income wallet like any customer's.
//
// The caller is a test name (x-hit-secret + x-scan-quota-key), so the address this runs from keeps its own day.
//
//   node scripts/x402-buy-scanpass.mjs              # plan: reads the 402, sends nothing
//   node scripts/x402-buy-scanpass.mjs --confirm    # swap, pay, repeat the scan
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, formatUnits, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';
const SITE = 'https://brainonbnb.com';
const A = (s) => getAddress(s.toLowerCase());
const ROUTER = A('0x10ED43C718714eb63d5aA57B78B54704E256024E');
const WBNB = A('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USD1 = A('0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d');
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
const MAX_SPEND_BNB = parseEther('0.0015');
const MIN_REMAINING = parseEther('0.02');
const ROUTER_ABI = [
  { name: 'getAmountsIn', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'swapExactETHForTokens', type: 'function', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256[]' }] },
];
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const confirm = process.argv.includes('--confirm');
const stop = (why) => { console.error(`\n  refused: ${why}`); process.exit(1); };

const SECRET = process.env.HIT_SECRET;
if (!SECRET) stop('HIT_SECRET is not in .env');
const key = 'buy-' + Math.random().toString(16).slice(2, 10);
const hdr = { accept: 'application/json', 'user-agent': 'bobai-scanpass-buy', 'x-hit-secret': SECRET, 'x-scan-quota-key': key };
const scan = (address, h = {}) => fetch(`${SITE}/api/pool-scan?address=${address}&r=${Math.random()}`, { headers: { ...hdr, ...h } });

// 1. The caller to the line (bad_address answers are cheap), then the 402 itself — the terms, never typed here.
for (let i = 0; i < 50; i++) await scan('0x1');
const over = await scan(CAKE), terms = await over.json().catch(() => ({}));
if (over.status !== 402 || !over.headers.get('payment-required')) stop(`expected the day pass's 402 on scan 51, got ${over.status}: ${JSON.stringify(terms).slice(0, 200)}`);
const direct = (terms.accepts || []).find((a) => a.extra?.assetTransferMethod === 'direct-transfer' && a.extra?.symbol !== 'BOBAI');
if (!direct) stop('the 402 offers no direct USD1 transfer');
const payTo = A(direct.payTo), price = BigInt(direct.maxAmountRequired);
if (A(direct.asset) !== USD1) stop(`the 402 asks for ${direct.asset}, not USD1`);
if (price > 600000000000000000n) stop(`the 402 asks ${formatUnits(price, 18)} USD1, more than this script will pay`);
console.log(`Buy a scan day pass on the scan (caller ${key})\n`);
console.log(`  402       ${terms.code}: ${terms.hint.slice(0, 110)}…`);
console.log(`  price     ${formatUnits(price, 18)} USD1  ->  ${payTo}`);

const pk = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!pk) stop('NFT_RELAYER_PRIVATE_KEY is not in .env');
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const [bnb, held] = await Promise.all([pub.getBalance({ address: account.address }), pub.readContract({ address: USD1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })]);
console.log(`  from      ${account.address}  (NFT relayer): ${formatEther(bnb)} BNB, ${formatUnits(held, 18)} USD1`);
const needSwap = held < price, target = price + 20000000000000000n;
let spend = 0n;
if (needSwap) {
  const amountsIn = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsIn', args: [target, [WBNB, USD1]] });
  spend = (amountsIn[0] * 103n) / 100n;
  if (spend > MAX_SPEND_BNB) stop(`the top-up swap would need ${formatEther(spend)} BNB, over the ${formatEther(MAX_SPEND_BNB)} ceiling`);
  if (bnb - spend < MIN_REMAINING) stop(`that would leave the relayer under ${formatEther(MIN_REMAINING)} BNB, and it mints NFTs`);
  console.log(`  1. swap   ${formatEther(spend)} BNB -> ~${formatUnits(target, 18)} USD1`);
}
console.log(`  ${needSwap ? 2 : 1}. pay    ${formatUnits(price, 18)} USD1 -> ${payTo}`);
console.log(`  ${needSwap ? 3 : 2}. scan   GET /api/pool-scan?address=${CAKE} with PAYMENT-SIGNATURE: <tx>`);
if (!confirm) { console.log('\n  plan only. Nothing was sent. Re-run with --confirm to do it.'); process.exit(0); }

if (needSwap) {
  const swapTx = await wallet.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [price, [WBNB, USD1], account.address, BigInt(Math.floor(Date.now() / 1000) + 300)], value: spend, gas: 300000n });
  const sr = await pub.waitForTransactionReceipt({ hash: swapTx });
  if (sr.status !== 'success') stop(`the swap failed: ${swapTx}`);
  console.log(`\n  swap ok   ${swapTx}`);
}
const payTx = await wallet.writeContract({ address: USD1, abi: ERC20_ABI, functionName: 'transfer', args: [payTo, price], gas: 150000n });
const pr = await pub.waitForTransactionReceipt({ hash: payTx });
if (pr.status !== 'success') stop(`the payment failed: ${payTx}`);
console.log(`  paid ok   ${payTx}`);

// 2. The scan repeated with the payment. The seller reads receipts from public nodes; give them a moment.
let res, body;
for (let i = 0; i < 6; i++) {
  res = await scan(CAKE, { 'PAYMENT-SIGNATURE': payTx });
  body = await res.json().catch(() => ({}));
  if (res.status !== 402 || !/not found/.test(body.reason || '')) break;
  await new Promise((r) => setTimeout(r, 4000));
}
const passHdr = res.headers.get('x-scan-pass'), receipt = res.headers.get('payment-response');
console.log(`\n  HTTP ${res.status}  ${res.status === 200 ? (body.pool?.pair || body.token?.symbol || Object.keys(body).slice(0, 4).join(',')) : JSON.stringify(body).slice(0, 300)}`);
console.log(`  X-Scan-Pass       ${passHdr || '—'}`);
console.log(`  PAYMENT-RESPONSE  ${receipt ? Buffer.from(receipt, 'base64').toString() : '—'}`);
// 3. Past the line, with nothing to send.
const after = [];
for (let i = 0; i < 3; i++) after.push((await scan('0x1')).status);
console.log(`  next 3 scans with nothing sent: ${after.join(',')} (400 = answered, bad_address)`);
const ok = res.status === 200 && !!passHdr && !!receipt && after.every((c) => c === 400);
console.log(`\n  ${ok ? 'PASS' : 'FAIL'}  the pass bought on the scan answers it and carries the caller on`);
process.exit(ok ? 0 : 1);
