// Adds the `registrations` field to the on-chain registration of our six hireable agents (2026-10-23, operator: "ja, 1").
//
// WHY: 8004scan reads metadata completeness 75 for all six and 90 for #49467; the one field #49467's document carries
// and theirs do not is `registrations` — the agent naming its own id and registry, as the ERC-8004 registration-v1
// schema has it. Everything else in each document stays exactly as it is on the chain today: the script reads the
// current tokenURI, adds that one field, and writes the same document back as an inline data: URI.
//
// SAFETY — a bare run changes nothing
//   Without --confirm it prints, per agent, the fields before and after, the URI size and the gas estimate, and sends
//   nothing. With --confirm it sends one setAgentURI per agent, signed by the owner (the DeFi agent's wallet 0xbFAA,
//   LP_PRIVATE_KEY), one after the other, and after each one reads the chain back: the new document must equal the
//   planned one and the agentWallet must be unchanged — on any difference it stops before the next agent.
//   An agent whose document already names itself is skipped. Gas over 0.0002 BNB for one agent stops the run.
//
//   node scripts/set-agent-registrations.mjs             dry run (all six)
//   node scripts/set-agent-registrations.mjs --confirm   send
//   node scripts/set-agent-registrations.mjs --only 363709 [--confirm]
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REGISTRY_CAIP = `eip155:56:${REGISTRY}`;
const OWNER = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
const IDS = [302257n, 302258n, 304493n, 304494n, 310460n, 363709n];
const MAX_GAS_BNB = 0.0002;
const ABI = parseAbi([
  'function tokenURI(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
  'function getAgentWallet(uint256) view returns (address)',
  'function setAgentURI(uint256 agentId, string newURI)',
]);
const confirm = process.argv.includes('--confirm');
const only = process.argv.includes('--only') ? BigInt(process.argv[process.argv.indexOf('--only') + 1]) : null;
const rpcs = [process.env.BSC_RPC_KEYED_URL_2, 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'].filter(Boolean);
const transport = fallback(rpcs.map((u) => http(u, { timeout: 30000 })));
const pub = createPublicClient({ chain: bsc, transport });

const decode = (uri) => {
  if (!uri.startsWith('data:application/json')) throw new Error(`not an inline JSON document: ${uri.slice(0, 60)}`);
  const body = uri.slice(uri.indexOf(',') + 1);
  return JSON.parse(/;base64,/.test(uri) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body));
};
const encode = (doc) => `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString('base64')}`;

let account = null;
if (confirm) {
  let key = (process.env.LP_PRIVATE_KEY || '').trim();
  if (!key) { console.error('LP_PRIVATE_KEY missing'); process.exit(1); }
  if (!key.startsWith('0x')) key = '0x' + key;
  account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== OWNER.toLowerCase()) { console.error(`LP_PRIVATE_KEY signs for ${account.address}, not the owner ${OWNER}`); process.exit(1); }
}
const wal = account ? createWalletClient({ account, chain: bsc, transport }) : null;
const gasPrice = await pub.getGasPrice();
console.log(`${confirm ? 'SENDING' : 'DRY RUN — nothing is sent'} · gas price ${Number(gasPrice) / 1e9} gwei · owner ${OWNER}\n`);
let spent = 0n, sent = 0;
for (const id of IDS) {
  if (only && id !== only) continue;
  const [owner, uri, wallet] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [id] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [id] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [id] }),
  ]);
  const doc = decode(uri);
  console.log(`#${id} ${doc.name}`);
  if (owner.toLowerCase() !== OWNER.toLowerCase()) { console.log(`  STOP: owned by ${owner}, not ${OWNER}`); process.exit(1); }
  if (Array.isArray(doc.registrations) && doc.registrations.some((r) => String(r.agentId) === String(id))) { console.log('  already names itself — skipped\n'); continue; }
  const next = { ...doc, registrations: [{ agentId: Number(id), agentRegistry: REGISTRY_CAIP }] };
  const newUri = encode(next);
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(doc[k]));
  console.log(`  fields now: ${Object.keys(doc).join(', ')}`);
  console.log(`  changes:    ${changed.join(', ')} -> ${JSON.stringify(next.registrations)}`);
  console.log(`  agentWallet ${wallet} (stays) · URI ${uri.length} -> ${newUri.length} bytes`);
  const gas = await pub.estimateContractGas({ address: REGISTRY, abi: ABI, functionName: 'setAgentURI', args: [id, newUri], account: OWNER });
  const cost = gas * gasPrice;
  console.log(`  gas ${gas} ≈ ${formatEther(cost)} BNB`);
  if (Number(formatEther(cost)) > MAX_GAS_BNB) { console.log(`  STOP: over ${MAX_GAS_BNB} BNB for one agent`); process.exit(1); }
  if (!confirm) { spent += cost; console.log(''); continue; }
  const hash = await wal.writeContract({ address: REGISTRY, abi: ABI, functionName: 'setAgentURI', args: [id, newUri], gas: gas * 12n / 10n, gasPrice });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120000 });
  spent += rc.gasUsed * (rc.effectiveGasPrice ?? gasPrice);
  console.log(`  tx ${hash} · ${rc.status}`);
  if (rc.status !== 'success') { console.log('  STOP: the transaction failed'); process.exit(1); }
  const [uriAfter, walletAfter] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [id] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [id] }),
  ]);
  const okUri = uriAfter === newUri, okWallet = walletAfter.toLowerCase() === wallet.toLowerCase();
  console.log(`  read back: document ${okUri ? 'as planned' : 'DIFFERENT'} · agentWallet ${okWallet ? 'unchanged' : `CHANGED to ${walletAfter}`}\n`);
  if (!okUri || !okWallet) { console.log('STOP before the next agent.'); process.exit(1); }
  sent++;
}
console.log(confirm ? `${sent} sent · gas ${formatEther(spent)} BNB` : `would cost about ${formatEther(spent)} BNB in all`);
