// GIVE THE BUYER'S MONEY BACK (2026-10-14). Five jobs on the ERC-8183 kernel were funded for our agents (provider
// 0x7380), never delivered and are past their expiry: Mandate's two with a 6-day expiry the 7-day dispute window could
// not fit (56866, 56887), one naming a position that does not exist (#12345, 56758), two older ones (56788, 56693).
// The escrow still holds the buyers' 0.48 $U, and every chart of our six agents shows the shared provider at "3 funded,
// not delivered, 0%". claimRefund(id) may be called by anyone and pays the budget back to the job's CLIENT — never to
// the caller — so we can return it and the record turns to what it is: expired, refunded.
//
// Rails, all read from the chain before anything is sent: the job is FUNDED, its provider is our provider wallet, it was
// never submitted (no deliverable), and it is past its expiry; the call is simulated first and must go through.
// Usage:  node scripts/refund-expired-jobs.mjs 56866 56887 …          simulate, print what would happen (default)
//         node scripts/refund-expired-jobs.mjs 56866 … --send         sign with AGENT_PROVIDER_PRIVATE_KEY (a person runs it with `!`)
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { decodeJob, ERC8183 } from '../worker-agent/hire.js';

const PROVIDER = '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963';
const SEND = process.argv.includes('--send');
const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
if (!ids.length) { console.error('name the job ids'); process.exit(1); }
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const data = (id) => '0x5b7baf64' + word(id); // claimRefund(uint256)
const account = SEND ? privateKeyToAccount((k => k.startsWith('0x') ? k : `0x${k}`)(process.env.AGENT_PROVIDER_PRIVATE_KEY || '')) : null;
if (SEND && account.address.toLowerCase() !== PROVIDER) { console.error(`the key is ${account.address}, not the provider ${PROVIDER}`); process.exit(1); }
const wallet = SEND ? createWalletClient({ account, chain: bsc, transport: http(RPC) }) : null;
const from = SEND ? account.address : PROVIDER;
if (SEND) console.log(`sending as ${from} (${formatEther(await pub.getBalance({ address: from }))} BNB)\n`);

let bad = 0;
for (const id of ids) {
  const job = decodeJob(await pub.call({ to: ERC8183.commerce, data: '0xbf22c457' + word(id) }).then((r) => r.data));
  const now = Math.floor(Date.now() / 1000);
  const why = [
    job.status !== 'FUNDED' && `status is ${job.status}, not FUNDED`,
    String(job.provider).toLowerCase() !== PROVIDER && `provider is ${job.provider}, not ours`,
    job.submitted_at && Number(job.submitted_at) > 0 && 'it was delivered',
    !(Number(job.expired_at) < now) && `not expired yet (${new Date(Number(job.expired_at) * 1000).toISOString()})`,
  ].filter(Boolean);
  if (why.length) { console.log(`job ${id}: refused — ${why.join('; ')}`); bad++; continue; }
  const sim = await pub.call({ account: from, to: ERC8183.commerce, data: data(id) }).then(() => null, (e) => e.shortMessage || e.message);
  if (sim) { console.log(`job ${id}: the simulation reverted — ${String(sim).slice(0, 160)}`); bad++; continue; }
  console.log(`job ${id}: ${job.budget_u} $U back to the buyer ${job.client}, expired ${new Date(Number(job.expired_at) * 1000).toISOString().slice(0, 16)} — simulation goes through`);
  if (!SEND) continue;
  const hash = await wallet.sendTransaction({ to: ERC8183.commerce, data: data(id), gasPrice: 100000000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(`  sent ${hash} — ${rc.status}`);
  if (rc.status !== 'success') bad++;
}
if (!SEND) console.log('\nNothing sent. A person adds --send (with `!`).');
process.exit(bad ? 1 : 0);
