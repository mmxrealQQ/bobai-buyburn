// worker-agent/holder-pass.js — hold $BOBAI, use the paid services (2026-10-16)
//
// Operator: "profit and volume for $BOBAI first". Paying per call moved cents; a reason to BUY the token and keep it is
// what moves its market. A wallet holding the line — 1,000,000 $BOBAI, the line the rug watch's holder tier already
// draws — uses every paid answer and the pool watch without paying, within a daily allowance. The proof is a signature,
// not a transaction: nothing is spent, the tokens stay where they are, and the balance is read from the chain on every
// use. It travels where a payment does (PAYMENT-SIGNATURE, X-PAYMENT, or an MCP tool's `payment`), so every surface that
// sells reads it at the one place that checks payments (chargeX402). Tips are not a sale and take none.
//
//   proof:   bobai-holder <wallet> <issued> <signature>
//   message: "BOBAI holder pass\nwallet: <lowercase address>\nissued: <ISO 8601 UTC time>"   (EIP-191 personal_sign)

import { recoverMessageAddress } from 'viem';

export const HOLDER_PASS = {
  bobai: '0x245c386dcfed896f5c346107596141e5edcbffff',
  line: 1000000n * 10n ** 18n,
  lineText: '1,000,000 $BOBAI',
  // per wallet and UTC day: an answer is one reading, a watch runs 30 days
  allowance: { answer: 20, watch: 2 },
  proofWindowMs: 10 * 60 * 1000,
  proofFutureMs: 2 * 60 * 1000,
};

export const passMessage = (wallet, issued) => `BOBAI holder pass\nwallet: ${String(wallet).toLowerCase()}\nissued: ${issued}`;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PROOF_RE = /^bobai-holder\s+(0x[0-9a-fA-F]{40})\s+(\S+)\s+(0x[0-9a-fA-F]{130})$/;

export const isHolderProof = (proof) => /^bobai-holder\s/i.test(String(proof || '').trim());
// The wallet a holder proof names, unverified — for reading a default input before the proof is checked, never for access.
export const holderWalletOf = (proof) => String(proof || '').trim().match(PROOF_RE)?.[1]?.toLowerCase() || null;
// What each sale counts against: an answer, or a watch.
export const passKind = (sold) => (sold === 'watch' ? 'watch' : String(sold || '').startsWith('answer:') ? 'answer' : null);

// How to use it, said the same way on every 402 that accepts it.
export const holderPassTerms = () => ({
  line: `${HOLDER_PASS.lineText} (token ${HOLDER_PASS.bobai}, 18 decimals) in the signing wallet, read from the chain at each use`,
  allowance: `per wallet and UTC day: ${HOLDER_PASS.allowance.answer} answers and ${HOLDER_PASS.allowance.watch} pool watches, nothing paid`,
  how: 'Sign, with the wallet, the message "BOBAI holder pass\\nwallet: <lowercase address>\\nissued: <ISO 8601 UTC time, e.g. new Date().toISOString()>" (EIP-191 personal_sign — a signature, no transaction, nothing spent), then send the same request with header PAYMENT-SIGNATURE: bobai-holder <address> <issued> <signature>',
  issued_within: '10 minutes before the request',
  why: 'Held, not spent: the tokens stay in your wallet.',
  in_a_browser: 'https://brainonbnb.com/pass — connect the wallet, sign, read the answer',
});

const no = (code, reason) => ({ ok: false, status: 402, body: { error: 'holder pass not accepted', code, reason, holder_pass: holderPassTerms() } });

// Checks a holder proof for one sale. rpcFn: the worker's rpc(method, params). Returns
// { ok, wallet, used, of } or { ok:false, status, body }. The allowance is taken here: call it once per sale.
export async function useHolderPass(env, rpcFn, proof, sold, now = Date.now()) {
  const kind = passKind(sold);
  if (!kind) return no('not_for_this', 'the holder pass covers the paid answers and the pool watch; this one is paid.');
  const m = String(proof || '').trim().match(PROOF_RE);
  if (!m) return no('bad_proof', 'send: bobai-holder <wallet 0x…> <issued ISO time> <signature 0x… 65 bytes>, separated by single spaces.');
  const [, w, issued, signature] = m;
  const wallet = w.toLowerCase();
  if (!ISO_RE.test(issued)) return no('bad_issued', 'issued must be the ISO 8601 UTC time you signed, as in 2026-10-16T12:00:00.000Z.');
  const t = Date.parse(issued);
  if (!(now - t <= HOLDER_PASS.proofWindowMs) || t - now > HOLDER_PASS.proofFutureMs) return no('stale_proof', 'issued must lie within the last 10 minutes: sign a fresh message and send it at once.');
  let signer;
  try { signer = (await recoverMessageAddress({ message: passMessage(wallet, issued), signature })).toLowerCase(); }
  catch { return no('bad_signature', 'the signature does not recover to any address over the message.'); }
  if (signer !== wallet) return no('wrong_signer', `the signature does not come from ${wallet}. Sign exactly: "${passMessage(wallet, issued).replace(/\n/g, '\\n')}" with that wallet.`);
  let bal;
  try {
    const hex = await rpcFn('eth_call', [{ to: HOLDER_PASS.bobai, data: '0x70a08231' + wallet.slice(2).padStart(64, '0') }, 'latest']);
    bal = hex && hex !== '0x' ? BigInt(hex) : 0n;
  } catch { return { ok: false, status: 503, body: { error: 'the $BOBAI balance could not be read right now — retry in a few seconds', code: 'chain_unavailable' } }; }
  if (bal < HOLDER_PASS.line) return no('below_line', `${wallet} holds ${(Number(bal / 10n ** 15n) / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} $BOBAI; the pass needs ${HOLDER_PASS.lineText}.`);
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `holderpass:${wallet}:${day}`;
  const used = JSON.parse((await env.AGENT.get(key)) || '{}');
  const of = HOLDER_PASS.allowance[kind];
  if ((used[kind] || 0) >= of) return no('allowance_used', `${wallet} has used today's ${of} ${kind === 'watch' ? 'pool watches' : 'answers'} of the holder pass; it renews at 00:00 UTC, or pay as usual.`);
  used[kind] = (used[kind] || 0) + 1;
  await env.AGENT.put(key, JSON.stringify(used), { expirationTtl: 3 * 86400 });
  return { ok: true, wallet, used: used[kind], of, kind };
}
