// Moves the DeFi Agent #363709 to the wallet that actually runs it.
//
// WHY (operator decision 2026-10-04, Set and Earn): the agent's real actions —
// daily collect, one-sided re-sets, deposits — are sent by the DeFi wallet
// 0xbFAA…7F0A, but marketplaces and BNB read "its" transactions from the
// wallets the registry ties to it (owner + agentWallet), and both were the
// provider 0x7380, which only ever calls the registry and the escrow. So the
// owner becomes 0xbFAA (whose transactions ARE rebalancing), and the
// agentWallet stays 0x7380 (the key that signs quotes and deliveries — what
// every SDK buyer checks the quote against). 0xbFAA becomes the campaign wallet.
//
// THE REGISTRY'S RULES (erc-8004/erc-8004-contracts IdentityRegistryUpgradeable):
// a transfer CLEARS agentWallet; setAgentWallet must be sent by the owner and
// carry an EIP-712 signature by the new wallet — AgentWalletSet(uint256
// agentId,address newWallet,address owner,uint256 deadline), domain
// ("ERC8004IdentityRegistry","1",56,registry), deadline at most 5 minutes out.
//
// Steps: 0x7380 transferFrom -> 0x7380 signs -> 0xbFAA setAgentWallet ->
// (optional) 0x7380 sends $U to 0xbFAA for the campaign hires. Read back:
// ownerOf = 0xbFAA, getAgentWallet = 0x7380.
//
// SAFETY: a bare run changes nothing. --confirm sends. --rpc <url> runs it
// against another node (a local anvil fork, to rehearse with the real keys).
// It refuses to send from 0xbFAA in the minutes worker-lp may itself send
// (xx:09-xx:12 of each ten, xx:49-xx:52, 04:20-04:30 UTC), so the two never
// race for a nonce, and refuses if 0xbFAA would drop under 2x MIN_GAS_BNB.
//
// Usage: node scripts/bnb-sdk/move-defi-agent.mjs [--fund-u 1.05] [--rpc URL] [--confirm]
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
const fundU = arg('--fund-u') ? parseUnits(arg('--fund-u'), 18) : 0n;
const ID = 363709n;
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
  const hash = await w.writeContract(req);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label.padEnd(16)} ${RPC.includes('127.0.0.1') ? hash : 'https://bscscan.com/tx/' + hash}`);
};

const [owner, aw, bnbD, bnbP, uP] = await Promise.all([
  pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [ID] }),
  pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [ID] }),
  pub.getBalance({ address: defi.address }), pub.getBalance({ address: provider.address }),
  pub.readContract({ address: U, abi: ABI, functionName: 'balanceOf', args: [provider.address] }),
]);
console.log(`#${ID}  owner ${owner}  agentWallet ${aw}`);
console.log(`  provider ${provider.address}  ${formatEther(bnbP)} BNB, ${formatUnits(uP, 18)} $U`);
console.log(`  defi     ${defi.address}  ${formatEther(bnbD)} BNB`);
const moved = owner.toLowerCase() === defi.address.toLowerCase();
if (!moved && owner.toLowerCase() !== provider.address.toLowerCase()) throw new Error('owned by neither wallet — stopping');
if (Number(formatEther(bnbD)) < 2 * MIN_GAS_BNB) throw new Error(`the DeFi wallet holds under ${2 * MIN_GAS_BNB} BNB — its own re-sets come first`);
if (fundU > uP) throw new Error(`the provider holds only ${formatUnits(uP, 18)} $U`);
const now = new Date(); const m = now.getUTCMinutes(), h = now.getUTCHours();
const lpBusy = [9, 0, 1, 2].includes(m % 10) || (m >= 49 && m <= 52) || (h === 4 && m >= 20 && m <= 30);
console.log(`  plan: ${moved ? '(already owned by 0xbFAA) ' : 'transferFrom, '}sign AgentWalletSet, setAgentWallet${fundU ? `, send ${formatUnits(fundU, 18)} $U to 0xbFAA` : ''}`);
if (!confirm) { console.log('  -> nothing sent (no --confirm)'); process.exit(0); }
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
if (fundU) await send('$U -> 0xbFAA', wP, { address: U, abi: ABI, functionName: 'transfer', args: [defi.address, fundU] });

const [o2, a2] = await Promise.all([
  pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [ID] }),
  pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [ID] }),
]);
const ok = o2.toLowerCase() === defi.address.toLowerCase() && a2.toLowerCase() === provider.address.toLowerCase();
console.log(`${ok ? 'PASS' : 'FAIL'}  owner ${o2}  agentWallet ${a2}`);
process.exit(ok ? 0 : 1);
