// BNB's standard hire, the seller's half: a signed quote.
//
// Marketplaces built on the BNB Agent SDK (Marque, Mandate, Agent Atlas and the
// SDK's own buyer) negotiate with skill "negotiate-erc8183-job" and expect a
// NegotiationResult envelope back: the request, the response terms with price
// and currency, keccak hashes of both, and a negotiation_hash the provider has
// signed. The buyer anchors that envelope verbatim as the job's description in
// createJob, so neither side can rewrite the deal afterwards — and it never
// sends notify_funded; the seller is expected to find its funded job on the
// chain (watchFundedJobs in job-watch.js).
//
// PORTED, NOT INVENTED. Every field, default and hashing step below follows
// bnb-chain/bnbagent-sdk typescript/src/erc8183/negotiation.ts
// (NegotiationHandler.negotiate, buildDescriptionContent) and
// src/core/canonicalJson.ts, because a buyer re-derives negotiation_hash from
// the on-chain description and one key out of order is a quote that fails
// verification after the money is in escrow. scripts/standard-quote-check.mjs
// verifies our envelope with the SDK's own verifier logic.
import { keccak256, toBytes, getAddress } from 'viem';

// canonicalJson: keys sorted at every depth, JSON.stringify, and every code
// point from U+007F up escaped as \uXXXX (the SDK's Python twin does the same).
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number');
  return v;
}
export const canonicalJson = (value) =>
  JSON.stringify(sortValue(value)).replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
const keccakOfText = (text) => keccak256(toBytes(text));

// The SDK's TermSpecification.toDict(): the two evaluation fields always
// present with their defaults, the optional ones only when set.
function termsDict(t) {
  const out = {
    deliverables: t.deliverables,
    quality_standards: t.quality_standards,
    evaluation_required: t.evaluation_required ?? true,
    evaluator_type: t.evaluator_type ?? 'uma_oov3',
  };
  if (t.success_criteria != null) out.success_criteria = t.success_criteria;
  if (t.price != null) out.price = t.price;
  if (t.currency != null) out.currency = t.currency;
  return out;
}

// sanitizeForClaim: square brackets to parentheses, control characters other
// than tab and newline dropped — what the SDK writes into the description.
function sanitizeForClaim(s) {
  if (typeof s !== 'string') return String(s);
  let out = '';
  for (const ch of s.replaceAll('[', '(').replaceAll(']', ')')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 || ch === '\t' || ch === '\n') out += ch;
  }
  return out;
}

// The quote is good for fifteen minutes, the SDK's ceiling: long enough to
// fund, short enough that a price cannot be held against us for a day.
export const QUOTE_TTL_SECONDS = 900;
const MAX_DESCRIPTION_BYTES = 4096;

// Returns { ok:true, envelope } or { ok:false, reason_code, reason }.
// `service` decides price and names itself in the deliverables, so the job
// the buyer anchors says which of our agents was hired (they share one
// provider address). `account` is the provider's viem account.
export async function signedQuote({ data, service, account, chainId, verifyingContract, currency, now = Math.floor(Date.now() / 1000) }) {
  const task = data?.task_description;
  const t = data?.terms;
  if (typeof task !== 'string' || !t || typeof t !== 'object' || Array.isArray(t) || typeof t.deliverables !== 'string') {
    return { ok: false, reason_code: '0x04', reason: "negotiate-erc8183-job needs 'task_description' (string) and 'terms' with 'deliverables' and 'quality_standards'" };
  }
  if (!t.quality_standards) return { ok: false, reason_code: '0x04', reason: 'quality_standards is required in terms.' };
  // A buyer asking to pay in another token gets told which one we take,
  // rather than a quote it cannot fund.
  if (t.currency && String(t.currency).toLowerCase() !== String(currency).toLowerCase()) {
    return { ok: false, reason_code: '0x06', reason: `Requested payment token is unavailable; this seller takes ${currency} ($U)` };
  }
  const request = { task_description: task, terms: termsDict(t) };
  if (Array.isArray(data.context_urls) && data.context_urls.length) request.context_urls = data.context_urls;
  if (data.request_id) request.request_id = data.request_id;
  const requestHash = keccakOfText(canonicalJson(request));

  const responseTerms = termsDict({
    deliverables: `service ${service.id} — ${t.deliverables}`,
    quality_standards: t.quality_standards,
    success_criteria: t.success_criteria ?? null,
    price: String(service.price),
    currency,
  });
  const response = { accepted: true, terms: responseTerms, estimated_completion_seconds: 120, quote_expires_at: now + QUOTE_TTL_SECONDS };
  const responseHash = keccakOfText(canonicalJson(response));

  // buildDescriptionContent — exactly the fields the buyer writes on-chain.
  const terms = { deliverables: sanitizeForClaim(responseTerms.deliverables), quality_standards: sanitizeForClaim(responseTerms.quality_standards) };
  if (Array.isArray(responseTerms.success_criteria) && responseTerms.success_criteria.length) terms.success_criteria = responseTerms.success_criteria.map(sanitizeForClaim);
  const content = {
    version: 1,
    negotiated_at: now,
    task: sanitizeForClaim(task),
    terms,
    price: responseTerms.price,
    currency,
    quote_expires_at: response.quote_expires_at,
    chain_id: chainId,
    verifying_contract: getAddress(verifyingContract),
  };
  const negotiationHash = keccakOfText(canonicalJson(content));
  const providerSig = await account.signMessage({ message: negotiationHash });

  if (canonicalJson({ ...content, negotiation_hash: negotiationHash, provider_sig: providerSig }).length > MAX_DESCRIPTION_BYTES) {
    return { ok: false, reason_code: '0x07', reason: `task and terms are too long for the on-chain description (max ${MAX_DESCRIPTION_BYTES} bytes); shorten them` };
  }
  return {
    ok: true,
    envelope: {
      request,
      request_hash: requestHash,
      response: { ...response, negotiated_at: now },
      response_hash: responseHash,
      negotiation_hash: negotiationHash,
      provider_sig: providerSig,
      chain_id: chainId,
      verifying_contract: getAddress(verifyingContract),
      provider_address: account.address,
    },
  };
}

// The BUYER's half (2026-10-04): the on-chain job description an SDK buyer
// writes for a signed quote — buildJobDescription(result) of the SDK. The
// seller re-derives negotiation_hash from exactly these fields, so Brain
// Plaza's hire button must write this and not a summary of its own. Returns
// null when the envelope is not one (no hash, not accepted, no price).
export function jobDescriptionFromEnvelope(env) {
  const response = env?.response || {}, request = env?.request || {};
  const terms = response.terms || {};
  if (!env?.negotiation_hash || response.accepted === false || !terms.price || !terms.currency) return null;
  const t = { deliverables: sanitizeForClaim(terms.deliverables ?? ''), quality_standards: sanitizeForClaim(terms.quality_standards ?? '') };
  if (Array.isArray(terms.success_criteria) && terms.success_criteria.length) t.success_criteria = terms.success_criteria.map(sanitizeForClaim);
  const content = {
    version: 1,
    negotiated_at: env.negotiated_at || response.negotiated_at || Math.floor(Date.now() / 1000),
    task: sanitizeForClaim(request.task_description ?? ''),
    terms: t,
    price: terms.price,
    currency: terms.currency,
  };
  const exp = env.quote_expires_at || response.quote_expires_at;
  if (exp != null) content.quote_expires_at = exp;
  if (env.chain_id != null) content.chain_id = env.chain_id;
  if (env.verifying_contract != null) content.verifying_contract = getAddress(env.verifying_contract);
  content.negotiation_hash = env.negotiation_hash;
  if (env.provider_sig) content.provider_sig = env.provider_sig;
  const s = canonicalJson(content);
  return s.length > MAX_DESCRIPTION_BYTES ? null : s;
}

// The SDK's agentMessage(): what the reference buyer reads the quote out of
// (reply.result.parts[0].data).
export const agentMessage = (data) => ({ kind: 'message', role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'data', data }] });
