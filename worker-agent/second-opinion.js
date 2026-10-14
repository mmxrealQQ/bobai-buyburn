// AN AGENT THAT HIRES AN AGENT (2026-10-14, operator's choice: "it has to be revolutionary"). The DeFi agent does not
// move money on its own word alone: every morning and before every re-set it pays an outside agent for a second
// opinion on its position — Mandate's Range-1 (ERC-8004 #344119, rebalancing, 0.01 $U on the ERC-8183 kernel) — from
// its Altana wallet, through the session key whose leash anyone can read in the KeyStore (four calls: the kernel,
// $U.approve, router.registerJob, router.settle; 1 $U a day; an expiry; revocable on /session). Range-1 reads the
// wallet's PancakeSwap V3 positions from the chain and says whether each is in range; "a payment buys the answer, not
// authority" (its own words). Stage 1 records the opinion beside the agent's own reading; it decides nothing yet.
//
// Rails here, before the session's own: at most 3 hires a UTC day, at most 0.05 $U each, the offer read live from
// Mandate (no offer, no hire), the wallet must hold the price, the session must not have expired. Every attempt — hired,
// refused or failed — goes into a public log (GET /second-opinion), newest first.
import { BNB, signerFromPrivateKey, hireErc8183Agent } from '@altananetwork/sdk';

export const SELLER = { id: 344119, name: 'Mandate Range-1', site: 'https://www.mandatemarkets.com' };
export const SUBJECT = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A'; // the DeFi agent's wallet
const U = '0xcE24439F2D9C6a2289F741120FE202248B666666';
const MAX_PRICE = 50000000000000000n, MAX_PER_DAY = 3, LOG_KEY = 'opinion:log', LOG_CAP = 60;

function sessionOf(env) {
  if (!env.ALTANA_SESSION) return null;
  const raw = JSON.parse(env.ALTANA_SESSION);
  return { ...raw, signer: signerFromPrivateKey(raw.signerPrivateKey), expiry: Number(raw.expiry),
    permissions: { ...raw.permissions, spend: (raw.permissions?.spend || []).map((s) => ({ ...s, limit: BigInt(s.limit) })) } };
}
async function balanceOfU(rpc, who) {
  const r = await rpc('eth_call', [{ to: U, data: '0x70a08231' + who.slice(2).toLowerCase().padStart(64, '0') }, 'latest']);
  return BigInt(r || '0x0');
}
export async function readOpinions(env) {
  try { return JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]'); } catch { return []; }
}
async function log(env, row) {
  const list = await readOpinions(env);
  list.unshift(row);
  await env.AGENT.put(LOG_KEY, JSON.stringify(list.slice(0, LOG_CAP)));
  return row;
}

// why: 'daily' or 'before a re-set' (with the agent's own reading beside it, so the record shows both side by side)
export async function secondOpinion(env, { why = 'daily', own = null, rpc } = {}) {
  const at = new Date().toISOString(), day = at.slice(0, 10);
  const base = { at, why, seller: SELLER, subject: SUBJECT, own };
  const session = sessionOf(env);
  if (!session) return log(env, { ...base, status: 'refused', reason: 'no session key on this worker' });
  if (session.expiry * 1000 < Date.now()) return log(env, { ...base, status: 'refused', reason: 'the session has expired — grant a new one' });
  const dayKey = `opinion:day:${day}`, used = Number((await env.AGENT.get(dayKey)) || 0);
  if (used >= MAX_PER_DAY) return log(env, { ...base, status: 'refused', reason: `already ${used} hires today (at most ${MAX_PER_DAY})` });

  const page = await fetch(`${SELLER.site}/agents/${SELLER.id}`).then((r) => r.text()).catch(() => '');
  const m = page.match(/\\"escrow\\":\{\\"provider\\":\\"(0x[0-9a-fA-F]{40})\\",\\"budget\\":\\"(\d+)\\",\\"tokenId\\":\\"(\d+)\\",\\"name\\":\\"([^\\]+)\\"/);
  if (!m) return log(env, { ...base, status: 'refused', reason: 'Mandate shows no escrow offer for Range-1 right now' });
  const [, provider, budgetRaw, , name] = m, budget = BigInt(budgetRaw);
  if (budget > MAX_PRICE) return log(env, { ...base, status: 'refused', reason: `the price ${Number(budget) / 1e18} $U is above the cap` });
  const have = await balanceOfU(rpc, session.walletAddress).catch(() => null);
  if (have == null || have < budget) return log(env, { ...base, status: 'refused', reason: `the Altana wallet holds ${have == null ? 'an unreadable amount of' : Number(have) / 1e18} $U, the price is ${Number(budget) / 1e18}` });

  await env.AGENT.put(dayKey, String(used + 1), { expirationTtl: 2 * 86400 }); // counted before the hire: a failed send still used a try
  const task = `via mandatemarkets.com: ${name} (ERC-8004 #${SELLER.id}) for ${SUBJECT}`;
  let hired;
  try {
    hired = await hireErc8183Agent(session, { provider, task, budget }, { network: BNB });
  } catch (e) {
    return log(env, { ...base, status: 'failed', price_u: Number(budget) / 1e18, reason: String(e.shortMessage || e.message || e).slice(0, 200) });
  }
  const jobId = String(hired.jobId), tx = hired.transactionHash || hired.txHash || null;
  await fetch(`${SELLER.site}/api/escrow/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId, tx, subject: SUBJECT }) }).catch(() => null);
  let answer = null, deliveredAt = null;
  for (let i = 0; i < 10 && !answer; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const d = await fetch(`${SELLER.site}/api/escrow/jobs/${jobId}/deliverable`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d && d.answer) { answer = d.answer; deliveredAt = d.deliveredAt || null; }
  }
  const positions = answer ? (answer.positions || []).map((p) => ({ position: String(p.position), pair: p.pair, in_range: !!p.inRange, ticks_out: p.ticksOut ?? 0, tick: p.tick, range: p.range, plan: p.plan || null })) : null;
  // agrees: the outside agent read the same position the same way (in or out of range) as the agent's own look
  const mine = own && own.position != null ? positions?.find((p) => p.position === String(own.position)) : null;
  const agrees = mine && own.in_range != null ? mine.in_range === !!own.in_range : null;
  return log(env, { ...base, status: answer ? 'answered' : 'hired, no answer yet', job: jobId, tx, price_u: Number(budget) / 1e18, paid_by: session.walletAddress,
    answer: positions, delivered_at: deliveredAt, deliverable: `${SELLER.site}/api/escrow/jobs/${jobId}/deliverable`, agrees });
}
