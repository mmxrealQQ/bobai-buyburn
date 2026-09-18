// Standard x402 payment, so that an agent with an ordinary x402 client can pay
// us without knowing anything about us.
//
// The worker already accepts a direct USD1 transfer plus a transaction hash.
// That works, costs nobody gas, and needs no third party — but it is not the
// protocol. A caller using a stock x402 library hits our 402, finds a scheme
// its library does not implement, and gives up. Interoperability is the whole
// point of a payment standard; being almost compatible is being incompatible.
//
// So this adds the real thing, through Dexter's public facilitator:
//   - scheme "exact" on eip155:56, the shape every x402 v2 client speaks
//   - transfers via Permit2, so the payer signs and the facilitator submits
//   - gasSponsored, meaning neither side pays gas to move the money
//
// Chosen over Binance's B402 for one reason: B402's settle endpoint could not
// be verified. The documented path returns 403, the short path returns an empty
// 202 to any body including obvious nonsense, and no /supported responds at
// all. Dexter answers an invalid payload with "No facilitator registered for
// scheme: undefined" — an actual error from actual code. One of those is a
// service; the other might be a catch-all in front of one. B402 gets added the
// day it can be confirmed, and the accepts[] array already has room.

const FACILITATOR = 'https://x402.dexter.cash';
const NETWORK = 'eip155:56';

// USDC on BSC, as the facilitator itself reports it. Read from /supported
// rather than assumed: the name and version below feed the EIP-712 domain a
// payer signs against, and a wrong version produces signatures that verify
// nowhere — silently, at settlement.
export const DEXTER_ASSET = {
  address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  name: 'USD Coin',
  version: '2',
  decimals: 18,
  symbol: 'USDC',
};

// Advertised alongside our direct-transfer scheme. A client picks whichever it
// can do; both land the same amount in the same wallet.
// THE SHAPE x402 VERSION 2 NAMES (2026-09-18). The 402 said x402Version 2 and
// carried version 1's field names: v2 (coinbase/x402, specs/x402-specification-v2
// §5.1.2) reads the price from `amount` and the resource from a top-level
// `resource: { url, … }`; `maxAmountRequired` and a per-entry `resource` string
// are v1. A stock v2 client finds no amount — which is the likeliest reason no
// facilitator payment has ever arrived. Both spellings are sent: v2's for the
// clients that follow the spec, v1's for the ones already written against this.
export function v2Shape(requirements, { url, description = null, mimeType = 'application/json' } = {}) {
  return {
    ...requirements,
    resource: { url, ...(description ? { description } : {}), mimeType },
    accepts: (requirements.accepts || []).map((a) => ({ ...a, amount: a.amount ?? a.maxAmountRequired })),
  };
}
export function dexterAccepts({ payTo, amountAtomic, description, resource }) {
  return {
    scheme: 'exact',
    network: NETWORK,
    asset: DEXTER_ASSET.address,
    amount: String(amountAtomic),
    maxAmountRequired: String(amountAtomic),
    payTo,
    resource,
    description,
    mimeType: 'application/json',
    maxTimeoutSeconds: 120,
    extra: {
      name: DEXTER_ASSET.name,
      version: DEXTER_ASSET.version,
      decimals: DEXTER_ASSET.decimals,
      assetTransferMethod: 'permit2',
      feePayer: 'facilitator',
    },
  };
}

const post = async (path, body) => {
  const r = await fetch(FACILITATOR + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { ok: r.ok, status: r.status, json, text: text.slice(0, 300) };
};

// Verify first, settle second — never the other way round, and never settle
// without verifying. Verification is free and tells us whether the signature
// covers what we asked for; settlement moves money.
export async function verifyAndSettle(paymentPayload, paymentRequirements) {
  const v = await post('/verify', { x402Version: 2, paymentPayload, paymentRequirements });
  if (!v.ok || !v.json) {
    return { ok: false, stage: 'verify', reason: v.json?.error || v.text || `facilitator returned ${v.status}` };
  }
  // The facilitator reports invalidity in the body, not the status code — a
  // 200 saying isValid:false is a rejection, and treating it as success would
  // hand out the service for free.
  if (v.json.isValid === false || v.json.valid === false) {
    return { ok: false, stage: 'verify', reason: v.json.invalidReason || v.json.reason || 'payment did not verify' };
  }

  const s = await post('/settle', { x402Version: 2, paymentPayload, paymentRequirements });
  if (!s.ok || !s.json) {
    return { ok: false, stage: 'settle', reason: s.json?.error || s.text || `facilitator returned ${s.status}` };
  }
  if (s.json.success === false) {
    return { ok: false, stage: 'settle', reason: s.json.errorReason || s.json.error || 'settlement failed' };
  }
  return {
    ok: true,
    tx: s.json.transaction || s.json.txHash || null,
    network: s.json.network || NETWORK,
    payer: s.json.payer || paymentPayload?.payload?.authorization?.from || null,
  };
}

// A caller sends the payload base64 in PAYMENT-SIGNATURE. Anything that is not
// a decodable x402 payload is treated as our own direct-transfer scheme (a
// bare transaction hash), so the two can share one header without ambiguity.
export function parsePaymentHeader(value) {
  const raw = String(value || '').trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(raw)) return { kind: 'txhash', value: raw };
  try {
    const decoded = JSON.parse(atob(raw));
    if (decoded && (decoded.scheme || decoded.payload || decoded.x402Version)) {
      return { kind: 'x402', value: decoded };
    }
  } catch { /* not base64 json */ }
  return { kind: 'unknown', value: raw };
}
