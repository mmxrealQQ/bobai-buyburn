// Brain Plaza's hire path, checked against the chain (2026-10-04).
//
// Asks the live /hire for a quote — nothing is signed or paid — for each of our
// six agents and two outside sellers that speak only BNB's signed-quote
// standard, and checks what a buyer would sign:
//   - the agent is found (new agents are read from the chain, not only the census)
//   - the escrow provider is the registry's agentWallet (the owner can differ:
//     our DeFi Agent #363709 is owned by 0xbFAA and paid through 0x7380)
//   - a signed quote is anchored as the signed record (negotiation_hash in the
//     createJob description), not as a summary of our own
// Found broken on 4.10. in all three ways; must FAIL on that code.
// Usage: node scripts/hire-path-check.mjs [base=https://agent.brainonbnb.com]
import { createPublicClient, http, parseAbi, decodeFunctionData } from 'viem';
import { bsc } from 'viem/chains';

const BASE = process.argv[2] || 'https://agent.brainonbnb.com';
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const pub = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed1.defibit.io') });
const CASES = [
  { id: 363709, task: 'Plan for the PancakeSwap V3 position 7450561', signed: false },
  { id: 302257, task: 'health factor of the Venus account 0xd319e1F8e987cf78333cEA853F455366640929cF' },
  { id: 302258, task: 'grid plan for 0x245c386dcfed896f5c346107596141e5edcbffff, 10 levels, 15% band, $1000' },
  { id: 304493, task: 'where is the best stablecoin yield on BNB Chain right now' },
  { id: 304494, task: 'rebalance holdings [{"token":"0x245c386dcfed896f5c346107596141e5edcbffff","usd":700},{"token":"0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82","usd":300}] to equal weight' },
  { id: 310460, task: 'which PancakeSwap fee tier is actually paying for 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82, placing $1000 of liquidity' },
  { id: 341556, task: 'Health factor and liquidation distance for the Venus account 0xd319e1F8e987cf78333cEA853F455366640929cF', signed: true },
  { id: 344119, task: 'Range check for the PancakeSwap V3 position 7450561', signed: null },
];
const CREATE = parseAbi(['function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook)']);
let bad = 0;
const ok = (n, pass, d) => { if (!pass) bad++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${n} — ${d}`); };

for (const c of CASES) {
  const aw = await pub.readContract({ address: REGISTRY, abi: parseAbi(['function getAgentWallet(uint256) view returns (address)']), functionName: 'getAgentWallet', args: [BigInt(c.id)] }).catch(() => null);
  const r = await fetch(`${BASE}/hire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: c.task, agent: String(c.id) }), signal: AbortSignal.timeout(90000) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  if (!r.hireable) { ok(`#${c.id} quotes through /hire`, false, r.error || r.provider_problem || JSON.stringify(r).slice(0, 160)); continue; }
  ok(`#${c.id} quotes through /hire`, true, `${r.quote?.price} (${r.quote?.dialect})`);
  ok(`#${c.id} escrow provider = agentWallet`, !!aw && r.provider?.toLowerCase() === aw.toLowerCase(), `provider ${r.provider} · agentWallet ${aw} · ${r.provider_source}`);
  const step1 = (r.calls || []).find((x) => x.step === 1);
  let desc = '';
  try { desc = decodeFunctionData({ abi: CREATE, data: step1.data }).args[3]; } catch {}
  if (r.quote?.dialect === 'envelope') ok(`#${c.id} signed quote anchored as the signed record`, /"negotiation_hash":"0x[0-9a-f]{64}"/.test(desc) && /"provider_sig":"0x/.test(desc) && !/"via":"brainonbnb/.test(desc), desc.slice(0, 120));
}
process.exit(bad ? 1 : 0);
