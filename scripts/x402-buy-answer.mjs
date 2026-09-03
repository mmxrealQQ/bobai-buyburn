// Buy one answer from our own agent over x402, the way a stranger's agent
// would: read the 402, pay 0.10 USD1 by direct transfer, repeat the request
// with the transaction hash, get the document back.
//
// WHY THIS EXISTS
// The per-answer sale (agent.brainonbnb.com/answer?service=<id>, 2026-09-03)
// is the profit lever of the agent side: five deliveries, one payment each,
// every cent swept into the liquidity position and its fees into the buyback.
// Its refusal paths are pinned by the smoke test without money. The path that
// takes money can only be proved by paying, and that is what this does, once,
// on demand — plan by default, `--confirm` to spend.
//
// WHO PAYS
// The NFT relayer wallet, for the same reason as x402-buy-usd1.mjs: it is the
// only project wallet with BNB to spare, and it keeps a floor for the mints.
// If it holds less than the price in USD1, a small swap tops it up first.
//
// Usage:
//   node scripts/x402-buy-answer.mjs                                  # plan
//   node scripts/x402-buy-answer.mjs --service health_factor --confirm
//   node scripts/x402-buy-answer.mjs --service grid_plan --task "grid plan for 0x245c…, 10 levels across a 15% band, $1000 capital" --confirm
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
const service = arg('--service', 'health_factor');
// --in bobai: pay the same price in $BOBAI, as the 402 quotes it. The relayer
// holds no $BOBAI, so a small swap buys it first (fee-on-transfer aware: the
// token takes 3 % on every transfer, and the 402's tenth of slack covers the
// 3 % the recipient loses). Everything else is the USD1 path.
const IN = String(arg('--in', 'usd1')).toLowerCase();
const BOBAI = A('0x245c386dcfed896f5c346107596141e5edcbffff');
const FOT_ROUTER_ABI = [
  { name: 'swapExactETHForTokensSupportingFeeOnTransferTokens', type: 'function', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }, { type: 'uint256' }], outputs: [] },
];
const DEFAULT_TASKS = {
  health_factor: 'health factor and liquidation distance for the Venus position at 0xd319e1F8e987cf78333cEA853F455366640929cF',
  grid_plan: 'grid plan for 0x245c386dcfed896f5c346107596141e5edcbffff, 10 levels across a 15% band, $1000 capital',
  yield_plan: 'where is the best yield on BNB Chain for USDT right now',
  rebalance_plan: 'rebalance holdings [{"token":"0x245c386dcfed896f5c346107596141e5edcbffff","usd":700},{"token":"0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82","usd":300}] to equal weight',
  lp_tier_plan: 'which PancakeSwap fee tier is actually paying for 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82, placing $1000 of liquidity',
  lp_position_plan: 'what would the liquidity agent do with PancakeSwap V3 position 7309536',
};
const task = arg('--task', DEFAULT_TASKS[service]);
// --proof <tx>: a payment already made whose answer was refused (bad input)
// or never asked for. Skips the swap and the transfer and asks with that
// hash; the service releases an unconsumed proof for exactly this retry.
const proofGiven = arg('--proof', null);
// What the sentence names, sent as fields too, so the answer does not hang
// on the seller's reading of the sentence.
const params = {};
{ const m = task && task.match(/position\s*(?:id\s*)?#?\s*(\d{3,})/i); if (m) params.position = m[1]; }
{ const m = task && task.match(/0x[a-fA-F0-9]{40}/); if (m && service === 'lp_position_plan' && !params.position) params.address = m[0]; }
const stop = (why) => { console.error(`\n  refused: ${why}`); process.exitCode = 1; };

// 1. The terms, from the 402 itself — never from a number typed here.
const termsRes = await fetch(`${AGENT}/answer?service=${service}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const terms = await termsRes.json().catch(() => ({}));
if (termsRes.status !== 402) { stop(`expected a 402 with terms, got ${termsRes.status}: ${JSON.stringify(terms).slice(0, 200)}`); }
else {
  const wantBobai = IN === 'bobai';
  const direct = (terms.accepts || []).find((a) => a.extra && a.extra.assetTransferMethod === 'direct-transfer' && (wantBobai ? a.extra.symbol === 'BOBAI' : a.extra.symbol !== 'BOBAI'));
  if (!direct) stop(wantBobai ? 'the 402 offers no $BOBAI option right now (the pair could not be priced)' : 'the 402 offers no direct-transfer scheme');
  else {
    const payTo = A(direct.payTo);
    const asset = A(direct.asset);
    const label = wantBobai ? 'BOBAI' : 'USD1';
    // The 402's amount already carries a tenth of slack; in $BOBAI the token
    // itself takes 3 % on the way, so the full quoted count is what to send.
    const price = wantBobai ? BigInt(Math.floor(Number(terms.in_bobai.tokens) * 1e18)) : BigInt(direct.maxAmountRequired);
    if (!wantBobai && asset !== USD1) stop(`the 402 asks for ${direct.asset}, not USD1`);
    else if (wantBobai && asset !== BOBAI) stop(`the 402 names ${direct.asset} as $BOBAI, which it is not`);
    else if (!wantBobai && price > 200000000000000000n) stop(`the 402 asks ${formatUnits(price, 18)} USD1, more than this script will pay`);
    else if (wantBobai && Number(terms.in_bobai.tokens) * Number(terms.in_bobai.usd_per_bobai) > 0.2) stop('the $BOBAI quote is worth more than 0.20 $, which this script will not pay');
    else {
      console.log(`Buy one answer: ${terms.name}\n`);
      console.log(`  service   ${service}`);
      console.log(`  task      "${task}"`);
      console.log(`  price     ${formatUnits(price, 18)} ${label}${wantBobai ? ` (≈ $${(Number(terms.in_bobai.tokens) * Number(terms.in_bobai.usd_per_bobai)).toFixed(3)} at the 402's quote; the 402 accepts ${formatUnits(BigInt(direct.maxAmountRequired), 18)} after the token's 3 % tax)` : ''}  ->  ${payTo}`);
      console.log(`  needs     ${JSON.stringify(terms.needs)}`);

      const key = process.env.NFT_RELAYER_PRIVATE_KEY;
      if (!key) stop('NFT_RELAYER_PRIVATE_KEY is not in .env');
      else {
        const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
        const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
        const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
        const [bnb, held] = await Promise.all([
          pub.getBalance({ address: account.address }),
          pub.readContract({ address: asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
        ]);
        console.log(`\n  from      ${account.address}  (NFT relayer): ${formatEther(bnb)} BNB, ${formatUnits(held, 18)} ${label}`);
        const needSwap = held < price;
        let spend = 0n;
        // Buying $BOBAI: the pool sends 3 % less than it quotes (tax on the
        // way out), so aim a little higher than the transfer needs.
        const target = wantBobai ? (price * 106n) / 100n : price + 20000000000000000n;
        if (needSwap) {
          const amountsIn = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'getAmountsIn', args: [target, [WBNB, asset]] });
          spend = (amountsIn[0] * 103n) / 100n;
          if (spend > MAX_SPEND_BNB) stop(`the top-up swap would need ${formatEther(spend)} BNB, over the ${formatEther(MAX_SPEND_BNB)} ceiling`);
          else if (bnb - spend < MIN_REMAINING) stop(`that would leave the relayer under ${formatEther(MIN_REMAINING)} BNB, and it mints NFTs`);
          else console.log(`  1. swap   ${formatEther(spend)} BNB -> ~${formatUnits(target, 18)} ${label} (the wallet is short)`);
        }
        if (!process.exitCode) {
          console.log(`  ${needSwap ? '2' : '1'}. pay    ${formatUnits(price, 18)} ${label} -> ${payTo}`);
          console.log(`  ${needSwap ? '3' : '2'}. ask    POST /answer?service=${service} with PAYMENT-SIGNATURE: <tx>`);
          if (!confirm) {
            console.log('\n  plan only. Nothing was sent. Re-run with --confirm to do it.');
          } else if (proofGiven) {
            console.log(`\n  asking with the payment already made: ${proofGiven}`);
            let ans = null, res = null;
            res = await fetch(`${AGENT}/answer?service=${service}`, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': proofGiven }, body: JSON.stringify({ task, params }) });
            ans = await res.json().catch(() => ({}));
            console.log(`\n  HTTP ${res.status}`);
            if (ans.summary) {
              console.log(`  ${ans.summary.headline}`);
              for (const [k, v] of ans.summary.facts || []) console.log(`    ${k}: ${v}`);
              if (ans.result && ans.result.plan && ans.result.plan.verdict) console.log(`\n  ${ans.result.plan.verdict}`);
              console.log(`\n  paid ${ans.paid}, tx ${ans.tx}`);
            } else {
              console.log(`  ${JSON.stringify(ans).slice(0, 600)}`);
              if (res.status !== 200) process.exitCode = 1;
            }
          } else {
            if (needSwap) {
              const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
              console.log('\n  swapping...');
              const swapTx = wantBobai
                ? await wallet.writeContract({ address: ROUTER, abi: FOT_ROUTER_ABI, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [price, [WBNB, asset], account.address, deadline], value: spend, gas: 500000n })
                : await wallet.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [price, [WBNB, asset], account.address, deadline], value: spend, gas: 500000n });
              const sr = await pub.waitForTransactionReceipt({ hash: swapTx });
              if (sr.status !== 'success') stop(`the swap failed: ${swapTx}`);
              else console.log(`  swap ok   ${swapTx}`);
            }
            if (!process.exitCode) {
              console.log('\n  paying...');
              const payTx = await wallet.writeContract({ address: asset, abi: ERC20_ABI, functionName: 'transfer', args: [payTo, price], gas: 150000n });
              const pr = await pub.waitForTransactionReceipt({ hash: payTx });
              if (pr.status !== 'success') stop(`the payment failed: ${payTx}`);
              else {
                console.log(`  paid ok   ${payTx}`);
                console.log('\n  asking...');
                // The service reads receipts from public nodes; give them a moment.
                let ans = null, res = null;
                for (let i = 0; i < 6; i++) {
                  res = await fetch(`${AGENT}/answer?service=${service}`, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': payTx }, body: JSON.stringify({ task, params }) });
                  ans = await res.json().catch(() => ({}));
                  if (res.status !== 402 || !/not found/.test(ans.reason || '')) break;
                  await new Promise((r) => setTimeout(r, 4000));
                }
                console.log(`\n  HTTP ${res.status}`);
                if (ans.summary) {
                  console.log(`  ${ans.summary.headline}`);
                  for (const [k, v] of ans.summary.facts || []) console.log(`    ${k}: ${v}`);
                  console.log(`\n  paid ${ans.paid}, tx ${ans.tx}`);
                  console.log('  this payment now shows on agent.brainonbnb.com/stats and will be swept by the liquidity agent.');
                } else {
                  console.log(`  ${JSON.stringify(ans).slice(0, 600)}`);
                  if (res.status !== 200) process.exitCode = 1;
                }
              }
            }
          }
        }
      }
    }
  }
}
