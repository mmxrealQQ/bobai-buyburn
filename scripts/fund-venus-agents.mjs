#!/usr/bin/env node
// Fund the two Venus agents from the NFT relayer (operator, 21.10.2026: sent 0.046 BNB to the relayer for this).
//   Backup 1 (health factor keeper #302257): 0.025 BNB — 0.02 to supply as collateral, the rest gas.
//   Backup 2 (yield router #304493): 0.002 BNB gas, and ~0.0085 BNB each swapped to USDT and to USDC, sent straight
//   to it by the swap (PancakeSwap V2, at least 98 % of the router's quote).
// The relayer keeps at least 0.02 BNB (it mints the NFTs) and its 808.41 $BOBAI (untouched). Nothing here touches the
// Venus markets: worker-agent/venus-work.js does that once VENUS_WORK is on.
//   node scripts/fund-venus-agents.mjs [--confirm]
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const confirm = process.argv.includes('--confirm');
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const B1 = '0xEAC21928DE023677A25eb925D1cb1b0786FaF946', B2 = '0x497dAc54FD7238027Ecbbd194b353379a1D605F0';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E', WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955', USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const R = parseAbi(['function getAmountsOut(uint256,address[]) view returns (uint256[])', 'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])']);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const PLAN = { b1: parseEther('0.025'), b2gas: parseEther('0.002'), each: parseEther('0.0085') };
const KEEP = parseEther('0.02');

const k = (process.env.NFT_RELAYER_PRIVATE_KEY || '').trim();
if (!k) { console.error('refused: NFT_RELAYER_PRIVATE_KEY is not in .env'); process.exit(1); }
const relayer = privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wal = createWalletClient({ account: relayer, chain: bsc, transport: http(RPC) });
const have = await pub.getBalance({ address: relayer.address });
const spend = PLAN.b1 + PLAN.b2gas + 2n * PLAN.each;
console.log(`relayer ${relayer.address}: ${formatEther(have)} BNB; spends ${formatEther(spend)} + gas, keeps ${formatEther(have - spend)}`);
if (have - spend < KEEP + parseEther('0.0005')) { console.error(`refused: that would leave the relayer under ${formatEther(KEEP)} BNB`); process.exit(1); }
const quotes = {};
for (const [name, t] of [['USDT', USDT], ['USDC', USDC]]) quotes[name] = (await pub.readContract({ address: ROUTER, abi: R, functionName: 'getAmountsOut', args: [PLAN.each, [WBNB, t]] }))[1];
console.log(`  1. ${formatEther(PLAN.b1)} BNB -> Backup 1 ${B1}`);
console.log(`  2. ${formatEther(PLAN.b2gas)} BNB -> Backup 2 ${B2}`);
console.log(`  3. ${formatEther(PLAN.each)} BNB -> ~${Number(formatUnits(quotes.USDT, 18)).toFixed(3)} USDT to Backup 2`);
console.log(`  4. ${formatEther(PLAN.each)} BNB -> ~${Number(formatUnits(quotes.USDC, 18)).toFixed(3)} USDC to Backup 2`);
if (!confirm) { console.log('\nplan only. Nothing was sent. Re-run with --confirm.'); process.exit(0); }

const sent = async (hash, what) => { const rc = await pub.waitForTransactionReceipt({ hash }); if (rc.status !== 'success') { console.error(`${what} failed: ${hash}`); process.exit(1); } console.log(`  ok ${what}: ${hash}`); };
await sent(await wal.sendTransaction({ to: B1, value: PLAN.b1, gasPrice: 100000000n }), 'BNB to Backup 1');
await sent(await wal.sendTransaction({ to: B2, value: PLAN.b2gas, gasPrice: 100000000n }), 'BNB to Backup 2');
const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
for (const [name, t] of [['USDT', USDT], ['USDC', USDC]]) {
  const min = quotes[name] * 98n / 100n;
  await pub.simulateContract({ account: relayer, address: ROUTER, abi: R, functionName: 'swapExactETHForTokens', args: [min, [WBNB, t], B2, deadline], value: PLAN.each });
  await sent(await wal.writeContract({ address: ROUTER, abi: R, functionName: 'swapExactETHForTokens', args: [min, [WBNB, t], B2, deadline], value: PLAN.each, gasPrice: 100000000n, gas: 300000n }), `${name} to Backup 2`);
}
const [b1, b2, u, c, left] = await Promise.all([pub.getBalance({ address: B1 }), pub.getBalance({ address: B2 }), pub.readContract({ address: USDT, abi: ERC20, functionName: 'balanceOf', args: [B2] }), pub.readContract({ address: USDC, abi: ERC20, functionName: 'balanceOf', args: [B2] }), pub.getBalance({ address: relayer.address })]);
console.log(`\nBackup 1: ${formatEther(b1)} BNB · Backup 2: ${formatEther(b2)} BNB, ${formatUnits(u, 18)} USDT, ${formatUnits(c, 18)} USDC · relayer keeps ${formatEther(left)} BNB`);
