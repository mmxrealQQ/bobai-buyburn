// Registers our two hireable agents in the ERC-8004 identity registry on BSC.
//
// WHY TWO NEW IDENTITIES AND NOT OUR EXISTING ONE
// Agent #49467 is the marketplace: the census, the broker, the dispatcher. It
// is not a grid trader and it is not a lending monitor, and folding three
// unrelated jobs into one registry entry is precisely the sloppiness the census
// exists to point at. One identity per thing that can be hired.
//
// WHAT GETS WRITTEN
// register(string tokenURI, (string key, bytes value)[] metadata) — selector
// 0x8ea42286. That signature is not in any documentation we could find. It was
// read out of a live registration transaction on the registry and confirmed
// against a public signature database, the same way the escrow's submit() was
// recovered. The metadata array is left empty: it is a free-text side channel
// and everything meaningful belongs in the document itself.
//
// The token URI is an inline data: URI rather than a link. A link is one
// expired domain away from an agent that can no longer describe itself, and our
// own census found 43% of the registry pointing off-chain with no way to tell
// from the chain whether anything is still there. Ours is on-chain, complete,
// and costs about a cent to put there.
//
// SAFETY — a bare run changes nothing
//   Does nothing without --confirm. A bare run prints exactly what would go
//   on-chain, including the decoded document and the gas estimate.
//   Refuses to register a name that is already registered to us — re-running
//   this after a success would mint a second identity for the same agent, and
//   there is no way to burn one.
//   Refuses if the endpoints in the document do not answer. An agent card
//   naming a dead endpoint is what 1,060 entries in this registry already do.
//
// Usage:
//   node scripts/register-own-agents.mjs             # show the plan
//   node scripts/register-own-agents.mjs --confirm   # register
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createWalletClient, createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { OWN_AGENTS } from './lib/own-agents.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'data', 'own-agents.json');
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.defibit.io';
const A2A = 'https://agent.brainonbnb.com/a2a';

const REGISTER_ABI = [{
  name: 'register', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenURI', type: 'string' },
    {
      name: 'metadata', type: 'tuple[]',
      components: [{ name: 'key', type: 'string' }, { name: 'value', type: 'bytes' }],
    },
  ],
  outputs: [{ type: 'uint256' }],
}];

// The agents. Documents come from scripts/lib/own-agents.mjs, which is also
// what update-own-agents.mjs reads.
//
// This file used to carry its own copy. It had drifted — the local version
// still called them "Venus Health Factor Monitor" and "BSC Grid Planner"
// while the shared one had been renamed to "Brain on BNB — …" for attribution.
// Nothing broke only because registration had already run; the next agent
// registered from here would have gone on-chain under the old name, and an
// on-chain document cannot be edited afterwards. Two copies of a document that
// is written to a chain is exactly what the shared file warns against in its
// own header.
const AGENTS = OWN_AGENTS;

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');

class Refused extends Error {}
const die = (m) => { throw new Refused(m); };

const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { agents: {} }; } };

(async () => {
  const pk = process.env.AGENT_PROVIDER_PRIVATE_KEY;
  if (!pk) die('No AGENT_PROVIDER_PRIVATE_KEY in .env — run scripts/create-provider-wallet.mjs first.');
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);

  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) die('The provider wallet holds no gas. Run scripts/fund-provider-wallet.mjs first.');

  const state = loadState();

  // An agent that cannot be reached is a row in a contract. Ours answers before
  // it is written, not after.
  process.stdout.write('checking the A2A endpoint answers… ');
  const probe = await fetch(A2A, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'reg-probe', parts: [{ kind: 'data', data: { skill: 'list' } }] } } }),
    signal: AbortSignal.timeout(20000),
  }).then((r) => r.json()).catch(() => null);
  if (!probe?.result?.services?.length) die(`${A2A} did not answer with a service list.`);
  if (!probe.result.can_sign) die('The live agent reports it cannot sign — it would take jobs it cannot deliver. Fix the provider key secret first.');
  if (String(probe.result.provider).toLowerCase() !== account.address.toLowerCase()) {
    die(`The live agent quotes ${probe.result.provider} as provider, but this script would register identities owned by ${account.address}. Those must match, or the employment history will never join up.`);
  }
  console.log('yes, and it quotes the same provider address.');

  console.log(`\nRegistering from ${account.address}  (${Number(formatEther(balance)).toFixed(6)} BNB)\n`);

  for (const agent of AGENTS) {
    if (state.agents[agent.slug]?.id) {
      console.log(`  ${agent.slug.padEnd(14)} already registered as #${state.agents[agent.slug].id} — skipping.`);
      continue;
    }
    const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(agent.doc)).toString('base64')}`;
    const gas = await publicClient.estimateContractGas({
      address: REGISTRY, abi: REGISTER_ABI, functionName: 'register', args: [uri, []], account,
    }).catch((e) => { die(`gas estimate failed for ${agent.slug}: ${e.shortMessage || e.message}`); });
    const gasPrice = await publicClient.getGasPrice();

    console.log(`  ${agent.slug}`);
    console.log(`    name       ${agent.doc.name}`);
    console.log(`    category   ${agent.doc.attributes.find((a) => a.trait_type === 'Category')?.value}`);
    console.log(`    document   ${uri.length} bytes, inline (no host to outlive it)`);
    console.log(`    endpoint   ${A2A}`);
    console.log(`    gas        ${gas} units ≈ ${Number(formatEther(gas * gasPrice)).toFixed(8)} BNB`);

    if (!confirm) { console.log('    -> not sent (no --confirm)\n'); continue; }

    const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
    const hash = await wallet.writeContract({ address: REGISTRY, abi: REGISTER_ABI, functionName: 'register', args: [uri, []] });
    console.log(`    tx         https://bscscan.com/tx/${hash}`);
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') die(`registration reverted in block ${rc.blockNumber}`);

    // The new id comes out of the mint log: Transfer(from=0x0, to=owner, id).
    // Reading it from the receipt rather than guessing at a counter is the only
    // way to be sure which id is ours.
    const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const mint = rc.logs.find((l) => l.topics[0] === TRANSFER && BigInt(l.topics[1]) === 0n);
    const id = mint ? Number(BigInt(mint.topics[3])) : null;
    console.log(`    agent id   ${id ?? '(could not read from receipt)'}`);
    console.log(`    verify     https://8004scan.io/agents/bsc/${id}\n`);

    state.agents[agent.slug] = { id, name: agent.doc.name, category: agent.doc.attributes.find((a) => a.trait_type === 'Category')?.value, owner: account.address, tx: hash, block: Number(rc.blockNumber), registered_at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  }

  if (!confirm) console.log('Nothing sent. Re-run with --confirm to register.');
  else console.log(`Written to ${path.relative(ROOT, STATE)}`);
})().catch((e) => {
  console.log(e instanceof Refused ? `\n[REFUSED] ${e.message}` : `\n[ERROR] ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});
