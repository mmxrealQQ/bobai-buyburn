// Republishes the on-chain documents of the agents we run.
//
// setAgentURI(agentId, uri) on the ERC-8004 registry, signed by the wallet that
// owns them. Same shape as scripts/update-8004-metadata.mjs does for #49467,
// with the documents coming from scripts/lib/own-agents.mjs so that registering
// and updating can never describe the same agent differently.
//
// WHY THIS RAN THE DAY AFTER REGISTERING
// The first documents did not carry the operator's name. They pointed at our
// endpoints and used our logo, which is a hint, not an attribution — anybody
// can reference a domain they do not own. The link that counts is the domain
// proof at /.well-known/agent-registration.json on both origins, and the
// document should say so in words a person reading the registry can follow.
//
// SAFETY — a bare run changes nothing
//   Does nothing without --confirm. A bare run prints the diff it would write.
//   Refuses if the signer does not own the agent: setAgentURI from the wrong
//     wallet reverts, and finding that out from a failed transaction is worse
//     than finding it out here.
//
// Usage:
//   node scripts/update-own-agents.mjs             # show what would change
//   node scripts/update-own-agents.mjs --confirm   # write it
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createWalletClient, createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { OWN_AGENTS, toTokenURI } from './lib/own-agents.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'data', 'own-agents.json');
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';

const ABI = [
  { name: 'setAgentURI', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newURI', type: 'string' }], outputs: [] },
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'tokenURI', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
];

const confirm = process.argv.includes('--confirm');
class Refused extends Error {}
const die = (m) => { throw new Refused(m); };

const decodeDoc = (uri) => {
  try {
    if (!uri?.includes('base64,')) return null;
    return JSON.parse(Buffer.from(uri.split('base64,')[1], 'base64').toString('utf8'));
  } catch { return null; }
};

(async () => {
  const pk = process.env.AGENT_PROVIDER_PRIVATE_KEY;
  if (!pk) die('No AGENT_PROVIDER_PRIVATE_KEY in .env');
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

  let state;
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch { die('data/own-agents.json is missing — nothing has been registered yet.'); }

  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`\nSigner ${account.address}  (${Number(formatEther(balance)).toFixed(6)} BNB)\n`);

  for (const agent of OWN_AGENTS) {
    const rec = state.agents?.[agent.slug];
    if (!rec?.id) { console.log(`  ${agent.slug}: not registered, skipping.`); continue; }

    const owner = await publicClient.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [BigInt(rec.id)] });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      die(`#${rec.id} is owned by ${owner}, not by the signer. setAgentURI would revert.`);
    }

    const current = decodeDoc(await publicClient.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [BigInt(rec.id)] }));
    const uri = toTokenURI(agent.doc);

    console.log(`  #${rec.id}  ${agent.slug}`);
    console.log(`    name   ${current?.name || '(unreadable)'}`);
    console.log(`        -> ${agent.doc.name}`);
    const before = new Set((current?.attributes || []).map((a) => a.trait_type));
    const added = agent.doc.attributes.filter((a) => !before.has(a.trait_type)).map((a) => a.trait_type);
    if (added.length) console.log(`    adds   ${added.join(', ')}`);
    console.log(`    size   ${uri.length} bytes`);

    if (JSON.stringify(current) === JSON.stringify(agent.doc)) {
      console.log('    -> already identical on-chain, nothing to write.\n');
      continue;
    }
    if (!confirm) { console.log('    -> not written (no --confirm)\n'); continue; }

    const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
    const hash = await wallet.writeContract({ address: REGISTRY, abi: ABI, functionName: 'setAgentURI', args: [BigInt(rec.id), uri] });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') die(`setAgentURI reverted for #${rec.id} in block ${rc.blockNumber}`);
    console.log(`    tx     https://bscscan.com/tx/${hash}`);
    console.log(`    ok     block ${rc.blockNumber}\n`);

    rec.name = agent.doc.name;
    rec.updated_at = new Date().toISOString();
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  }

  if (!confirm) console.log('Nothing written. Re-run with --confirm.');
})().catch((e) => {
  console.log(e instanceof Refused ? `\n[REFUSED] ${e.message}` : `\n[ERROR] ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});
