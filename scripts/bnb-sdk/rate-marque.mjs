// Rate an agent we hired THROUGH Marque, so the rating counts on Marque (Set and Earn quest: "ratedAll").
//
// Read out of marque.trade's job page 2026-10-13: POST /api/v1/phase2/rate { chainId, jobId, wallet, stars, comment }
// returns the exact giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash) call on the
// ERC-8004 ReputationRegistry; the buyer's wallet sends it. Marque keeps the canonical text behind the hash.
//
// Before anything is sent this checks, from Marque's own job record: the job was paid by THIS wallet, the agent
// delivered, the call goes to the ReputationRegistry, and it rates the agent the job was for. A rating is a public,
// permanent statement: give the stars the delivery earned (read it first: the deliverable URL is printed).
//
// A bare run prepares and prints only. Usage (repo root):
//   node scripts/bnb-sdk/rate-marque.mjs <jobId> <stars 1-5> [--comment "..."] [--from defi] [--confirm]
import path from 'node:path';
import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, http, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const SITE = 'https://marque.trade/api/v1/';
const REPUTATION = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const RPC = 'https://bsc-dataseed1.defibit.io';
const raw = process.argv.slice(2);
const opt = (n) => { const i = raw.indexOf(n); return i >= 0 ? raw[i + 1] : null; };
const confirm = raw.includes('--confirm');
const [jobId, starsRaw] = raw.filter((a, i) => a !== '--confirm' && !['--from', '--comment'].includes(a) && !['--from', '--comment'].includes(raw[i - 1]));
const stars = Number(starsRaw);
if (!/^\d+$/.test(jobId || '') || !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) { console.log('usage: node scripts/bnb-sdk/rate-marque.mjs <jobId> <stars 1-5> [--comment "..."] [--from defi|health] [--confirm]'); process.exit(1); }
const fromDefi = opt('--from') === 'defi';
if (confirm && fromDefi) {
  // the same quiet minutes as hire-marque.mjs: never beside a send of the DeFi agent from 0xbFAA
  const n = new Date(), mm = n.getUTCMinutes(), hh = n.getUTCHours();
  if ([9, 0, 1, 2].includes(mm % 10) || (mm >= 49 && mm <= 52) || (hh === 4 && mm >= 20 && mm <= 30)) {
    console.log(`REFUSED: UTC ${hh}:${String(mm).padStart(2, '0')} is a minute the DeFi agent may send from 0xbFAA — run again in a few minutes`);
    process.exit(1);
  }
}
// --from health (2026-10-23): the Venus health factor monitor's own agentWallet, which pays its daily Keel hire
const fromHealth = opt('--from') === 'health';
const pk = process.env[fromDefi ? 'LP_PRIVATE_KEY' : fromHealth ? 'BACKUP1_PRIVATE_KEY' : 'AGENT_PROVIDER_PRIVATE_KEY'];
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const get = async (p) => { const r = await fetch(SITE + p, { signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p}: ${j.detail || j.error || r.status}`); return j; };

const job = await get(`phase2/job/56/${jobId}`);
console.log(`job ${jobId}  ${job.agent?.name} #${job.agent?.agentId} (${job.agent?.category})  state ${job.state}`);
console.log(`  deliverable  ${job.deliverable?.url || 'none'}`);
const refuse = (m) => { console.log('  REFUSED: ' + m); process.exit(1); };
if (String(job.client).toLowerCase() !== account.address.toLowerCase()) refuse(`the job was paid by ${job.client}, not by this wallet ${account.address}`);
if (!job.deliverable?.url || !job.tx?.submitted) refuse('the agent has not delivered yet — rate after the delivery');
if (job.tx?.rating) refuse(`already rated in ${job.tx.rating}`);

const r = await fetch(SITE + 'phase2/rate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chainId: 56, jobId: String(jobId), wallet: account.address, stars, ...(opt('--comment') ? { comment: String(opt('--comment')).slice(0, 280) } : {}) }), signal: AbortSignal.timeout(60000) });
const prep = await r.json().catch(() => ({}));
if (!r.ok || !prep.call) refuse(`Marque did not prepare it: ${prep.detail || prep.error || r.status}`);
const c = prep.call;
if (getAddress(c.to) !== getAddress(REPUTATION) || c.functionName !== 'giveFeedback' || c.chainId !== 56) refuse(`unexpected call ${c.functionName} on ${c.to} (chain ${c.chainId})`);
if (String(c.args[0]) !== String(job.agent.agentId)) refuse(`the call rates #${c.args[0]}, the job was for #${job.agent.agentId}`);
console.log(`  rating       ${stars} star${stars === 1 ? '' : 's'} = value ${c.args[1]} · ${c.args[3]} / ${c.args[4]}`);
console.log(`  canonical    ${prep.canonical}`);
if (!confirm) { console.log('  -> nothing sent (no --confirm)'); process.exit(0); }

const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const ABI = parseAbi(['function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)']);
const [a0, a1, a2, a3, a4, a5, a6, a7] = c.args;
const hash = await wallet.writeContract({ address: REPUTATION, abi: ABI, functionName: 'giveFeedback', args: [BigInt(a0), BigInt(a1), Number(a2), a3, a4, a5, a6, a7] });
console.log(`  sent         ${hash}`);
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(rc.status === 'success' ? `  rated in block ${rc.blockNumber}` : `  REVERTED in block ${rc.blockNumber}`);
process.exit(rc.status === 'success' ? 0 : 1);
