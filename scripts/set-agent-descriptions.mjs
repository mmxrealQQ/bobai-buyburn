// Corrects one outdated sentence in the on-chain registration of #49467 and #363709 (2026-11-04, operator: "ja bau das
// skript" — the A-Z pass, block 1).
//
// WHY: the description each agent carries on the chain (an inline data: URI, the one 8004scan, Marque and every
// indexer read) says what stopped being true:
//   #49467   "whose 3% trade tax funds an autonomous 24/7 buyback-and-burn cycle" — the tax has been split into the
//            creator share, burns and permanent liquidity with the LP burned for weeks
//   #363709  "on the recorded prices ±20% came out ahead of narrower ranges and of simply holding" — its own record
//            stands behind holding (-2.42% on 2026-11-04, https://agent.brainonbnb.com/lp/portfolio); its live A2A card
//            already says "none came out ahead of holding"
// The new sentences are the ones in scripts/bobai-agent-card.json and scripts/lib/own-agents.mjs.
//
// HOW — only that sentence changes
//   The script reads the current tokenURI, replaces exactly the old sentence in `description` with the new one, and
//   writes the same document back as an inline data: URI. Every other field and every other word stays as it is on
//   the chain. If the old sentence is not found word for word it STOPS (nothing is guessed); if the new one is
//   already there, the agent is skipped.
//
// SAFETY — a bare run changes nothing
//   Without --confirm it prints, per agent, the sentence before and after, the URI size and the gas estimate, and
//   sends nothing. With --confirm it sends one setAgentURI per agent, signed by that agent's owner (#49467: 0x15Ba…3d38,
//   BOBAI_PRIVATE_KEY; #363709: 0xbFAA…7F0A, LP_PRIVATE_KEY), one after the other, and after each reads the chain back:
//   the new document must equal the planned one and the agentWallet must be unchanged — on any difference it stops
//   before the next agent. Gas over 0.0002 BNB for one agent stops the run.
//
//   node scripts/set-agent-descriptions.mjs                 dry run (both)
//   node scripts/set-agent-descriptions.mjs --confirm       send
//   node scripts/set-agent-descriptions.mjs --only 363709 [--confirm]
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const MAX_GAS_BNB = 0.0002;
const PLAN = [
  {
    id: 49467n, owner: '0x15Ba17075ef5E0736292b030e3715d9100fe3d38', key: 'BOBAI_PRIVATE_KEY',
    from: 'plus an open broker that routes a task to an agent that can do it. Free, no key, no signup. Also the read-only on-chain data surface for $BOBAI, an AI-built deflationary token whose 3% trade tax funds an autonomous 24/7 buyback-and-burn cycle.',
    to: 'plus an open broker that routes a task to an agent that can do it, and a pre-trade check for any BSC token (can you get in and out at your size, the round trip with the measured tax). Free, no key, no signup. Also the read-only on-chain data surface for $BOBAI, an AI-built deflationary token whose 3% trade tax a bot splits every 10 minutes, 24/7, into the creator share, burns and permanent liquidity with the LP burned.',
  },
  {
    id: 363709n, owner: '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A', key: 'LP_PRIVATE_KEY',
    from: 'wide, because every re-set locks in what the range lost against holding, and on the recorded prices ±20% came out ahead of narrower ranges and of simply holding.',
    to: 'wide, because every re-set locks in what the range lost against holding: on the recorded prices the wider ranges lost less against simply holding than the narrow ones, and none came out ahead of holding (its own result against holding, live: https://agent.brainonbnb.com/lp/portfolio).',
  },
];
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
const signer = (p) => {
  let k = (process.env[p.key] || '').trim();
  if (!k) { console.error(`${p.key} missing`); process.exit(1); }
  if (!k.startsWith('0x')) k = '0x' + k;
  const a = privateKeyToAccount(k);
  if (a.address.toLowerCase() !== p.owner.toLowerCase()) { console.error(`${p.key} signs for ${a.address}, not the owner ${p.owner}`); process.exit(1); }
  return createWalletClient({ account: a, chain: bsc, transport });
};

const gasPrice = await pub.getGasPrice();
console.log(`${confirm ? 'SENDING' : 'DRY RUN — nothing is sent'} · gas price ${Number(gasPrice) / 1e9} gwei\n`);
let spent = 0n, sent = 0;
for (const p of PLAN) {
  if (only && p.id !== only) continue;
  const [owner, uri, wallet] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [p.id] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [p.id] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [p.id] }),
  ]);
  const doc = decode(uri);
  console.log(`#${p.id} ${doc.name}`);
  if (owner.toLowerCase() !== p.owner.toLowerCase()) { console.log(`  STOP: owned by ${owner}, not ${p.owner}`); process.exit(1); }
  const d = String(doc.description || '');
  if (d.includes(p.to)) { console.log('  the new sentence is already there — skipped\n'); continue; }
  if (d.split(p.from).length !== 2) { console.log(`  STOP: the old sentence is ${d.includes(p.from) ? 'there more than once' : 'not there word for word'} — nothing is guessed`); process.exit(1); }
  const next = { ...doc, description: d.replace(p.from, () => p.to) };
  const newUri = encode(next);
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(doc[k]));
  if (changed.join() !== 'description') { console.log(`  STOP: would change ${changed.join(', ')}`); process.exit(1); }
  console.log(`  before: …${p.from}`);
  console.log(`  after:  …${p.to}`);
  console.log(`  only field changed: description · agentWallet ${wallet} (stays) · URI ${uri.length} -> ${newUri.length} bytes`);
  const gas = await pub.estimateContractGas({ address: REGISTRY, abi: ABI, functionName: 'setAgentURI', args: [p.id, newUri], account: p.owner });
  const cost = gas * gasPrice;
  console.log(`  gas ${gas} ≈ ${formatEther(cost)} BNB · signed by ${p.owner} (${p.key})`);
  if (Number(formatEther(cost)) > MAX_GAS_BNB) { console.log(`  STOP: over ${MAX_GAS_BNB} BNB for one agent`); process.exit(1); }
  if (!confirm) { spent += cost; console.log(''); continue; }
  const wal = signer(p);
  const hash = await wal.writeContract({ address: REGISTRY, abi: ABI, functionName: 'setAgentURI', args: [p.id, newUri], gas: gas * 12n / 10n, gasPrice });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120000 });
  spent += rc.gasUsed * (rc.effectiveGasPrice ?? gasPrice);
  console.log(`  tx ${hash} · ${rc.status}`);
  if (rc.status !== 'success') { console.log('  STOP: the transaction failed'); process.exit(1); }
  const [uriAfter, walletAfter] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [p.id] }),
    pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [p.id] }),
  ]);
  const okUri = uriAfter === newUri, okWallet = walletAfter.toLowerCase() === wallet.toLowerCase();
  console.log(`  read back: document ${okUri ? 'as planned' : 'DIFFERENT'} · agentWallet ${okWallet ? 'unchanged' : `CHANGED to ${walletAfter}`}\n`);
  if (!okUri || !okWallet) { console.log('STOP before the next agent.'); process.exit(1); }
  sent++;
}
console.log(confirm ? `${sent} sent · gas ${formatEther(spent)} BNB` : `would cost about ${formatEther(spent)} BNB in all`);
