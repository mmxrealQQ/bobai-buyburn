// FEED THE LEASH (2026-10-14, operator's go for "an agent that hires an agent"): $U the agents earned from their hires
// (in the provider wallet 0x7380) goes to the Altana wallet, which pays for second opinions through its session key —
// so the agent economy pays for itself. One fixed transfer, at most 1 $U; the session itself caps spending at 1 $U a day.
// Usage:  node scripts/fund-leash.mjs [amount=1]            the plan, nothing sent
//         node scripts/fund-leash.mjs [amount=1] --send     sign with AGENT_PROVIDER_PRIVATE_KEY (a person runs it with `!`)
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const U = '0xcE24439F2D9C6a2289F741120FE202248B666666', LEASH = '0xC5A17B5295Fc50BAdB1F9f9C09b412fE5e84F7d3', PROVIDER = '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963';
const amount = parseUnits(String(Number(process.argv.find((a) => /^\d+(\.\d+)?$/.test(a)) || 1)), 18), SEND = process.argv.includes('--send');
if (amount > parseUnits('1', 18)) { console.error('at most 1 $U per run'); process.exit(1); }
const ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }, { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }];
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const bal = (a) => pub.readContract({ address: U, abi: ABI, functionName: 'balanceOf', args: [a] });
const [have, leash] = await Promise.all([bal(PROVIDER), bal(LEASH)]);
console.log(`provider ${PROVIDER} holds ${formatUnits(have, 18)} $U · leash ${LEASH} holds ${formatUnits(leash, 18)} $U`);
console.log(`plan: transfer ${formatUnits(amount, 18)} $U provider -> leash`);
if (have < amount) { console.error('the provider holds less than that'); process.exit(1); }
if (!SEND) { console.log('nothing sent (no --send)'); process.exit(0); }
const account = privateKeyToAccount((k => k.startsWith('0x') ? k : `0x${k}`)(process.env.AGENT_PROVIDER_PRIVATE_KEY || ''));
if (account.address.toLowerCase() !== PROVIDER) { console.error(`the key is ${account.address}, not the provider`); process.exit(1); }
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const hash = await wallet.sendTransaction({ to: U, data: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [LEASH, amount] }), gasPrice: 100000000n });
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(`sent ${hash} — ${rc.status} · leash now ${formatUnits(await bal(LEASH), 18)} $U`);
