#!/usr/bin/env node
// Point the two Venus agents at wallets of their own (operator, 21.10.2026): #302257 (health factor monitor) ->
// Backup 1, #304493 (yield ranking) -> Backup 2. setAgentWallet is sent by the owner 0xbFAA (LP_PRIVATE_KEY) and
// carries each new wallet's EIP-712 consent (scripts/lib/agent-wallet-sig.mjs, proved on a fork by
// scripts/venus-work-fork-test.mjs). The worker reads the registry (worker-agent/agent-wallets.js), so from the next
// quote on each agent signs with its own key and its jobs are delivered by it; jobs already funded to the provider
// are still delivered by the provider.
//
// Plan by default; --confirm sends. Refuses inside the DeFi agent's run (04:15–04:45 UTC: the same wallet, its nonce).
//   node scripts/set-venus-agent-wallets.mjs [--confirm]
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { agentWalletSig, IDENTITY_REGISTRY, SET_AGENT_WALLET_ABI } from './lib/agent-wallet-sig.mjs';

const confirm = process.argv.includes('--confirm');
const acct = (name) => { const k = (process.env[name] || '').trim(); return k ? privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`) : null; };
const owner = acct('LP_PRIVATE_KEY'), b1 = acct('BACKUP1_PRIVATE_KEY'), b2 = acct('BACKUP2_PRIVATE_KEY');
const stop = (why) => { console.error(`refused: ${why}`); process.exit(1); };
if (!owner || !b1 || !b2) stop('LP_PRIVATE_KEY, BACKUP1_PRIVATE_KEY and BACKUP2_PRIVATE_KEY must all be in .env');
const pub = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org') });
const wal = createWalletClient({ account: owner, chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org') });
const reg = (functionName, args) => pub.readContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName, args });

const plan = [[302257n, b1, 'Venus Health Factor Monitor', 'Backup 1'], [304493n, b2, 'Venus Yield Ranking', 'Backup 2']];
console.log(`owner ${owner.address}: ${formatEther(await pub.getBalance({ address: owner.address }))} BNB\n`);
const todo = [];
for (const [id, a, name, label] of plan) {
  const [o, w] = await Promise.all([reg('ownerOf', [id]), reg('getAgentWallet', [id])]);
  if (o.toLowerCase() !== owner.address.toLowerCase()) stop(`#${id} is owned by ${o}, not ${owner.address}`);
  const done = w.toLowerCase() === a.address.toLowerCase();
  console.log(`#${id} ${name}: agentWallet ${w}${done ? ' — already ' + label : ` -> ${a.address} (${label})`}`);
  if (!done) todo.push([id, a]);
}
if (!todo.length) { console.log('\nnothing to do.'); process.exit(0); }
if (!confirm) { console.log(`\nplan only: ${todo.length} transaction(s) from ${owner.address}, 0.1 gwei. Nothing was sent. Re-run with --confirm.`); process.exit(0); }
const now = new Date(), m = now.getUTCHours() * 60 + now.getUTCMinutes();
if (m >= 4 * 60 + 15 && m <= 4 * 60 + 45) stop('04:15–04:45 UTC is the DeFi agent\'s run from this same wallet; try after 04:45');
for (const [id, a] of todo) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const sig = await agentWalletSig(a, { agentId: id, owner: owner.address, deadline });
  await pub.simulateContract({ account: owner, address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'setAgentWallet', args: [id, a.address, deadline, sig] });
  const hash = await wal.writeContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'setAgentWallet', args: [id, a.address, deadline, sig], gasPrice: 100000000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  const now2 = await reg('getAgentWallet', [id]);
  console.log(`#${id}: ${rc.status} ${hash} — agentWallet now ${now2}`);
  if (rc.status !== 'success' || now2.toLowerCase() !== a.address.toLowerCase()) stop(`#${id} did not move`);
}
console.log('\ndone. Next: node scripts/hire-path-check.mjs (escrow provider = agentWallet) and the signed quotes of /health-factor/a2a and /yield-optimizer/a2a.');
