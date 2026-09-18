// ONE PAYMENT, ONE ANSWER — THE LEDGER (2026-09-18).
// A payment's key was a bare '1', written after the check and DELETED when the
// answer failed. Two requests with one hash, one of them built to fail: both
// passed the check, the good one delivered, the bad one's failure path deleted
// the mark — and the hash was unspent again, for ever, along with its earnings
// record. N parallel requests each got an answer too.
// Now a payment has a state and an owner:
//   claimed   {by: nonce, at}   taken by one request; a second one is refused
//                               while the claim is fresh, and only the request
//                               that holds the nonce may change it
//   delivered                   final; never deleted, no expiry
//   credit                      the answer failed after a good payment: the
//                               money is the buyer's to spend again, by the
//                               same hash, and nothing else ever frees a mark
// The claim is written, then read back: a request that does not read its own
// nonce lost the race and stops. KV is eventually consistent between
// locations, so this narrows the window to a cross-location race of seconds
// — it does not close it the way a Durable Object would (backlog).
export const CLAIM_FRESH_MS = 3 * 60 * 1000;
export const readPaid = async (env, tx) => {
  const raw = await env.AGENT.get(`paid:${tx}`);
  if (!raw) return null;
  if (raw === '1') return { state: 'delivered', legacy: true };   // marks written before the ledger
  try { return JSON.parse(raw); } catch { return { state: 'delivered' }; }
};
export async function claimPayment(env, tx, sold) {
  const cur = await readPaid(env, tx);
  if (cur && cur.state === 'delivered') return { ok: false, reason: 'this payment has already been used' };
  if (cur && cur.state === 'claimed' && Date.now() - Number(cur.at || 0) < CLAIM_FRESH_MS) return { ok: false, reason: 'this payment is being used by another request right now — wait for it to finish' };
  const by = crypto.randomUUID();
  await env.AGENT.put(`paid:${tx}`, JSON.stringify({ state: 'claimed', by, at: Date.now(), for: sold, ...(cur && cur.state === 'credit' ? { was_credit: true } : {}) }));
  const back = await readPaid(env, tx);
  if (!back || back.by !== by) return { ok: false, reason: 'this payment is being used by another request right now — wait for it to finish' };
  return { ok: true, by, credit: !!(cur && cur.state === 'credit') };
}
export async function settlePayment(env, tx, by, state, extra = {}) {
  const cur = await readPaid(env, tx);
  if (!cur || cur.by !== by) return false;   // not ours to change
  await env.AGENT.put(`paid:${tx}`, JSON.stringify({ ...cur, state, settled_at: Date.now(), ...extra }));
  return true;
}
