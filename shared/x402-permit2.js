// A standard x402 payment through Permit2, read against our own terms.
// Pure: no network, no key. Used by worker-agent (which checks a payment and
// simulates it before delivering) and by worker-lp (which settles the queue
// with the x402 income wallet). One reading, two workers.
//
// WHY THIS EXISTS (2026-09-24, A8 of the review; the operator's go, route 2)
// accepts[0] — USDC on BNB Chain through Permit2 — had never carried a
// payment. Paid once with the official client (@x402/fetch 2.27.0): signed
// right, verified by the facilitator, then its settle reverted
// TRANSFER_FROM_FAILED, twice; the same payment settles in an eth_call against
// the same proxy from any caller, the facilitator's own signer included. The
// fault is inside the facilitator. So the settlement is ours: worker-agent
// checks and simulates, worker-lp sends it.
import { encodeFunctionData } from 'viem';

export const PERMIT2_PROXY = '0x402085c248eea27d92e8b30b2c58ed07f9e20001';
export const QUEUE_PREFIX = 'x402:settle:';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const SETTLE_ABI = [{
  type: 'function', name: 'settle', stateMutability: 'nonpayable', outputs: [],
  inputs: [
    { name: 'permit', type: 'tuple', components: [
      { name: 'permitted', type: 'tuple', components: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }] },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    { name: 'owner', type: 'address' },
    { name: 'witness', type: 'tuple', components: [{ name: 'to', type: 'address' }, { name: 'validAfter', type: 'uint256' }] },
    { name: 'signature', type: 'bytes' },
  ],
}];

const lc = (x) => String(x || '').toLowerCase();
const isAddr = (x) => /^0x[0-9a-fA-F]{40}$/.test(String(x || ''));

// Does this authorization pay what the terms ask, to whom they ask? null when
// it does, the reason when it does not. `minLifeSec`: how long it must still
// be valid — long enough for the queue to settle it.
export function permit2Mismatch(payload, req, { nowSec = Math.floor(Date.now() / 1000), minLifeSec = 1200 } = {}) {
  const a = payload && payload.permit2Authorization;
  if (!a || !a.permitted || !a.witness) return 'not a Permit2 payment';
  if (!/^0x[0-9a-fA-F]+$/.test(String(payload.signature || ''))) return 'the signature is missing';
  if (!isAddr(a.from) || !isAddr(a.permitted.token) || !isAddr(a.witness.to) || !isAddr(a.spender)) return 'an address in the authorization is malformed';
  if (lc(a.permitted.token) !== lc(req.asset)) return 'the payment is in another token than the one asked';
  let amount, required, deadline, validAfter;
  try {
    amount = BigInt(a.permitted.amount); required = BigInt(req.amount ?? req.maxAmountRequired);
    deadline = BigInt(a.deadline); validAfter = BigInt(a.witness.validAfter ?? 0); BigInt(a.nonce);
  } catch { return 'a number in the authorization is not a number'; }
  if (amount < required) return 'the payment is smaller than the price';
  if (lc(a.witness.to) !== lc(req.payTo)) return 'the payment goes to another address than ours';
  if (lc(a.spender) !== PERMIT2_PROXY) return 'the payment names another spender than the x402 Permit2 proxy';
  if (deadline < BigInt(nowSec + minLifeSec)) return `the authorization expires within ${Math.round(minLifeSec / 60)} minutes — too soon to settle`;
  if (validAfter > BigInt(nowSec)) return 'the authorization is not valid yet';
  return null;
}

// The one call there is to make, and nothing else can be encoded here: the
// proxy's settle with the authorization as the payer signed it.
export function settleCalldata(payload) {
  const a = payload.permit2Authorization;
  return encodeFunctionData({ abi: SETTLE_ABI, functionName: 'settle', args: [
    { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
    a.from, { to: a.witness.to, validAfter: BigInt(a.witness.validAfter ?? 0) }, payload.signature,
  ] });
}

// The id a payment is known by before it has a transaction: payer and
// Permit2 nonce, which the chain lets settle once.
export const permit2Id = (payload) => `permit2:${lc(payload.permit2Authorization.from)}:${String(payload.permit2Authorization.nonce)}`;

// What a receipt moved of `token` from `from` to `to`.
export function transferredIn(logs, token, from, to) {
  const pad = (x) => '0x' + lc(x).replace(/^0x/, '').padStart(64, '0');
  let sum = 0n;
  for (const l of logs || []) {
    if (lc(l.address) !== lc(token) || !l.topics || lc(l.topics[0]) !== TRANSFER_TOPIC) continue;
    if (lc(l.topics[1]) !== pad(from) || lc(l.topics[2]) !== pad(to)) continue;
    try { sum += BigInt(l.data); } catch { /* not an amount */ }
  }
  return sum;
}
