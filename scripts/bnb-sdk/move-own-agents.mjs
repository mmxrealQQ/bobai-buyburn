// Moves our five older agents to an owner that is not the wallet they sign with — as #363709 was on 2026-10-04.
//
// WHY (operator decision 2026-10-14): Mandate marks #302257, #302258, #304493, #304494 and #310460 "Custody: failed —
// signs with its owner's own wallet. Nothing separates what the agent can do from everything its owner can do."
// Owner and agentWallet are both the provider 0x7380. After the move the owner is the DeFi wallet 0xbFAA (as for
// #363709) and the agentWallet stays 0x7380, the key that signs quotes and deliveries, so nothing a buyer checks
// changes. Registration updates for them are then signed with --from defi (update-own-agents.mjs).
//
// THE REGISTRY'S RULES, as in move-defi-agent.mjs (confirmed again 2026-10-14 by recovering the 2026-10-04
// signature to 0x7380): a transfer CLEARS agentWallet; setAgentWallet is sent by the owner with an EIP-712
// AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline) signed by the new wallet.
//
// SAFETY: a bare run changes nothing. --confirm sends. --rpc <url> rehearses on a local anvil fork with the real keys.
// Refuses to send from 0xbFAA in worker-lp's minutes and if 0xbFAA would drop under 2x MIN_GAS_BNB.
//
// Usage: node scripts/bnb-sdk/move-own-agents.mjs [--ids 302257,302258] [--rpc URL] [--confirm]
import path from 'node:path';
import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const confirm = args.includes('--confirm');
const RPC = arg('--rpc') || 'https://bsc-dataseed1.defibit.io';
const IDS = (arg('--ids') || '302257,302258,304493,304494,310460').split(',').map((x) => BigInt(x.trim()));
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const U = '0xcE24439F2D9C6a2289F741120FE202248B666666';
const MIN_GAS_BNB = 0.0015;
const key = (k) => { const v = process.env[k]; if (!v) throw new Error(`no ${k} in .env`); return privateKeyToAccount(v.startsWith('0x') ? v : `0x${v}`); };
const provider = key('AGENT_PROVIDER_PRIVATE_KEY');
const defi = key('LP_PRIVATE_KEY');
const ABI = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function getAgentWallet(uint256) view returns (address)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
const chain = { ...bsc, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wP = createWalletClient({ account: provider, chain, transport: http(RPC) });
const wD = createWalletClient({ account: defi, chain, transport: http(RPC) });
const send = async (label, w, req) => {
  const hash = await w.writeContract({ ...req, gasPrice: 100000000n }); // 0.1 gwei, as every send of ours
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label.padEnd(16)} ${RPC.includes('127.0.0.1') ? hash : 'https://bscscan.com/tx/' + hash}`);
};

let failed = 0;
for (const ID of IDS) {
  const [owner, aw, bnbD, bnbP, ] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [ID] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [ID] }),
    pub.getBalance({ address: defi.address }), pub.getBalance({ address: provider.address }),
  ]);
  console.log(`#${ID}  owner ${owner}  agentWallet ${aw}`);
  console.log(`  provider ${provider.address}  ${formatEther(bnbP)} BNB`);
  console.log(`  defi     ${defi.address}  ${formatEther(bnbD)} BNB`);
  const moved = owner.toLowerCase() === defi.address.toLowerCase();
  if (!moved && owner.toLowerCase() !== provider.address.toLowerCase()) throw new Error('owned by neither wallet — stopping');
  // one setAgentWallet costs ~0.00001 BNB at 0.1 gwei; what the agent keeps for its own re-sets (MIN_GAS_BNB) must stay, with room
  if (Number(formatEther(bnbD)) < MIN_GAS_BNB + 0.0005) throw new Error(`the DeFi wallet holds under ${MIN_GAS_BNB + 0.0005} BNB — its own re-sets come first`);
  const now = new Date(); const m = now.getUTCMinutes(), h = now.getUTCHours();
  const lpBusy = [9, 0, 1, 2].includes(m % 10) || (m >= 49 && m <= 52) || (h === 4 && m >= 20 && m <= 30);
  console.log(`  plan: ${moved ? '(already owned by 0xbFAA) ' : 'transferFrom, '}sign AgentWalletSet, setAgentWallet`);
  if (!confirm) { console.log('  -> nothing sent (no --confirm)'); continue; }
  if (lpBusy && !RPC.includes('127.0.0.1')) throw new Error(`UTC ${h}:${String(m).padStart(2, '0')} is a minute worker-lp may send from 0xbFAA — run again in a few minutes`);

  if (!moved) await send('transferFrom', wP, { address: REGISTRY, abi: ABI, functionName: 'transferFrom', args: [provider.address, defi.address, ID] });
  const block = await pub.getBlock();
  const deadline = block.timestamp + 240n;
  const signature = await provider.signTypedData({
    domain: { name: 'ERC8004IdentityRegistry', version: '1', chainId: 56, verifyingContract: REGISTRY },
    types: { AgentWalletSet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'AgentWalletSet',
    message: { agentId: ID, newWallet: provider.address, owner: defi.address, deadline },
  });
  await send('setAgentWallet', wD, { address: REGISTRY, abi: ABI, functionName: 'setAgentWallet', args: [ID, provider.address, deadline, signature] });

  const [o2, a2] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [ID] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [ID] }),
  ]);
  const ok = o2.toLowerCase() === defi.address.toLowerCase() && a2.toLowerCase() === provider.address.toLowerCase();
  console.log(`${ok ? 'PASS' : 'FAIL'}  #${ID} owner ${o2}  agentWallet ${a2}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
