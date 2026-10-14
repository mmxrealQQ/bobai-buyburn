// MONEY THAT LIES STILL BUYS $BOBAI (2026-10-14, operator on the wallet map: "alles Brachliegende soll $BOBAI kaufen").
// Stables that sit in wallets which are no income source and are never swept: the DeFi agent's $U from the Set and Earn
// campaign, the NFT relayer's $U and USD1 left from our own test hires. Each is sold for $BOBAI in one swap (token ->
// WBNB -> $BOBAI on PancakeSwap V2, floor = quote less the 3% transfer tax less 5%). The $BOBAI stays in the same
// wallet — except the relayer's, which holds exactly 808.41 $BOBAI by the operator's rule, so its $BOBAI goes to the
// x402 income wallet, where the agents' $BOBAI is kept. (The provider's USDC lying there today goes too; from now on it is swept daily,
// half to the operator: shared/lp-agent.js INCOME_SOURCES 'provider-usdc'.)
// Usage:  node scripts/sweep-dormant.mjs            the plan, nothing sent
//         node scripts/sweep-dormant.mjs --send     sign with each wallet's own key (a person runs it with `!`)
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { ADDR, bobaiBuyFloor } from '../shared/lp-agent.js';

const SEND = process.argv.includes('--send');
const X402 = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';
const T = { U: '0xcE24439F2D9C6a2289F741120FE202248B666666', USD1: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d' };
const JOBS = [
  { what: 'DeFi agent $U (Set and Earn campaign)', keyEnv: 'LP_PRIVATE_KEY', wallet: '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', token: T.U, symbol: '$U', to: null },
  { what: 'provider USDC (no sweep knew it until today)', keyEnv: 'AGENT_PROVIDER_PRIVATE_KEY', wallet: '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963', token: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', to: null },
  { what: 'NFT relayer $U (test hires)', keyEnv: 'NFT_RELAYER_PRIVATE_KEY', wallet: '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2', token: T.U, symbol: '$U', to: X402 },
  { what: 'NFT relayer USD1 (test hires)', keyEnv: 'NFT_RELAYER_PRIVATE_KEY', wallet: '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2', token: T.USD1, symbol: 'USD1', to: X402 },
];
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const ROUTER = parseAbi(['function getAmountsOut(uint256,address[]) view returns (uint256[])', 'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)']);
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
let bad = 0;
for (const j of JOBS) {
  const to = j.to || j.wallet, amount = await pub.readContract({ address: j.token, abi: ERC20, functionName: 'balanceOf', args: [j.wallet] });
  if (amount === 0n) { console.log(`${j.what}: nothing there`); continue; }
  const out = (await pub.readContract({ address: ADDR.V2_ROUTER, abi: ROUTER, functionName: 'getAmountsOut', args: [amount, [j.token, ADDR.WBNB, ADDR.BOBAI]] }))[2];
  console.log(`${j.what}: ${formatUnits(amount, 18)} ${j.symbol} -> about ${Number(formatUnits(out, 18)).toFixed(0)} $BOBAI, held by ${to}`);
  if (!SEND) continue;
  const acct = privateKeyToAccount((k => k.startsWith('0x') ? k : `0x${k}`)(process.env[j.keyEnv] || ''));
  if (acct.address.toLowerCase() !== j.wallet.toLowerCase()) { console.log(`  REFUSED: ${j.keyEnv} does not open ${j.wallet}`); bad++; continue; }
  const w = createWalletClient({ account: acct, chain: bsc, transport: http(RPC) });
  const a = await w.writeContract({ address: j.token, abi: ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, amount], gasPrice: 100000000n });
  await pub.waitForTransactionReceipt({ hash: a });
  const s = await w.writeContract({ address: ADDR.V2_ROUTER, abi: ROUTER, functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens', args: [amount, bobaiBuyFloor(out), [j.token, ADDR.WBNB, ADDR.BOBAI], to, BigInt(Math.floor(Date.now() / 1000) + 600)], gasPrice: 100000000n });
  const rc = await pub.waitForTransactionReceipt({ hash: s });
  console.log(`  sent ${s} — ${rc.status}`); if (rc.status !== 'success') bad++;
}
if (!SEND) console.log('\nNothing sent. A person adds --send (with `!`).');
process.exit(bad ? 1 : 0);
