// BRAIN PLAZA LISTINGS — a DexScreener for agents (operator, 2026-10-12).
//
// "Nothing gets built with real thought anymore. Ship fast, farm the hype,
// disappear." The listing is the answer: whoever builds an agent AND keeps it
// running can have it listed here, once, for $95. It buys a profile page, the
// "verified & maintained" badge, a daily check that can take the badge away, a
// slot at the top of its category marked "Featured (paid)" and an announcement
// in the Telegram group. It never buys rank: the evidence-ordered list below
// the featured slot is untouched.
//
// THE MONEY NEVER PASSES THROUGH US. The buyer pays from their own wallet
// straight to the operator's wallet (PAYEE, his choice); this worker holds no
// key and only reads the transfer from the chain. Changing the price or the
// payee is the operator's call, nobody else's.
//
// THE PATH
//   GET  /listing/check?agent=<id>   who it is, whether it answers, whether it can be listed (free, nothing stored)
//   POST /listing/quote {agent, currency: usd1|bnb|bobai}
//        -> a nonce, the amount to send, the payee, and the line the owner signs
//   POST /listing/verify {nonce, signature}
//        -> the signature must come from the wallet that owns the id (or its agentWallet); checked before any payment
//   POST /listing/submit {nonce, signature, tx, contact?}
//        -> the transfer is read from the chain (right token, right payee, enough, after the quote, never used before)
//           and the agent is checked again; then it is listed
//   GET  /listings                   every listing with its status (Plaza and the bot read this)
//   GET  /listed/<id>                its profile page (?format=json for the record)
// A daily check (runListingMonitor) asks every listed agent once; three failed
// days in a row take the badge off ("paused") until it answers again.

import { netFetch } from './self-fetch.js';
import { recoverMessageAddress } from 'viem';
import { registrationOf, resolveA2aEndpoint } from './hire.js';
import { OWN_AGENT_IDS } from '../shared/agent-registrations.js';
import { RPCS } from '../shared/lp-agent.js';
import { noteAgentState, addAgentWatch } from './agent-watch.js';

export const LISTING_USD = 95;
export const PAYEE = '0x5c82d2f12ee6ac09297784f94ebf9331277bdc3c'; // the operator's wallet (operator, 2026-10-12)
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const QUOTE_TTL_MS = 60 * 60e3; // an hour to sign and pay
const OURS = new Set([49467, ...OWN_AGENT_IDS].map(String));
const PAUSE_AFTER = 3; // failed daily checks in a row

const json = (status, body) => ({ status, body });
const lc = (a) => String(a || '').toLowerCase();
const pad32 = (addr) => '0x' + lc(addr).replace(/^0x/, '').padStart(64, '0');

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await netFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('no rpc answered');
}
const callAddr = async (sel, id) => {
  const raw = await rpc('eth_call', [{ to: REGISTRY, data: sel + BigInt(id).toString(16).padStart(64, '0') }, 'latest']).catch(() => null);
  return raw && raw.length >= 66 && !/^0x0*$/.test(raw) ? '0x' + raw.slice(-40) : null;
};
export const ownerOf = (id) => callAddr('0x6352211e', id);        // ownerOf(uint256)
export const agentWalletOf = (id) => callAddr('0x00339509', id);  // getAgentWallet(uint256)

// ------------------------------------------------------------- does it answer
// A2A first (a message/send that comes back with a result), then MCP (an
// initialize that comes back with a result). A JSON-RPC error alone is a door
// that opens and says no — not an agent somebody keeps running for others.
async function answers(id, reg) {
  const out = { a2a: null, mcp: null };
  try {
    const r = await resolveA2aEndpoint(String(id));
    if (r?.endpoint) {
      const res = await netFetch(r.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: crypto.randomUUID(), kind: 'message', parts: [{ kind: 'text', text: 'What can you do?' }] } } }) });
      const j = await res.json().catch(() => null);
      out.a2a = { endpoint: r.endpoint, ok: !!(j && j.result), status: res.status };
    }
  } catch (e) { out.a2a = { ok: false, error: String(e.message || e).slice(0, 120) }; }
  if (!out.a2a?.ok) {
    const mcp = (reg?.services || []).find((s) => /mcp/i.test(s.name || '') || /\/mcp(\/|$|\?)/i.test(s.endpoint))?.endpoint
      || (reg?.endpoints || []).find((e) => /\/mcp(\/|$|\?)/i.test(e));
    if (mcp) {
      try {
        const res = await netFetch(mcp, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'brain-plaza-listing', version: '1.0' } } }) });
        const t = await res.text();
        const m = t.match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : null;
        out.mcp = { endpoint: mcp, ok: !!(j && j.result), status: res.status };
      } catch (e) { out.mcp = { endpoint: mcp, ok: false, error: String(e.message || e).slice(0, 120) }; }
    }
  }
  return { ok: !!(out.a2a?.ok || out.mcp?.ok), ...out };
}

export async function checkAgent(idRaw, opts = {}) {
  const id = String(idRaw || '').trim();
  if (!/^\d{1,9}$/.test(id)) return { ok: false, id, reasons: ['give the agent\'s ERC-8004 id on BNB Smart Chain (a number)'] };
  const reasons = [];
  if (OURS.has(id) && !opts.house) reasons.push('this is one of Brain On BNB\'s own agents');
  const [owner, agentWallet, reg] = await Promise.all([ownerOf(id), agentWalletOf(id), registrationOf(Number(id)).catch(() => null)]);
  if (!owner) reasons.push(`#${id} is not registered on the ERC-8004 identity registry on BNB Smart Chain`);
  if (owner && !reg) reasons.push('its registration names no https:// endpoint we can call');
  const ans = reg ? await answers(id, reg) : { ok: false };
  if (reg && !ans.ok) reasons.push('it did not answer: no A2A message/send result and no MCP initialize result');
  return { ok: !reasons.length, id, owner, agent_wallet: agentWallet, name: reg?.name || null, description: reg?.description || null, image: reg?.image || null, endpoints: reg?.endpoints || [], answers: ans, reasons };
}

// ------------------------------------------------------------------- quote
const signLine = (id, nonce) => `Brain Plaza listing\nAgent #${id} on BNB Smart Chain\nNonce: ${nonce}`;

export async function quoteListing(body, env, deps) {
  const id = String(body?.agent || '').trim(), currency = lc(body?.currency || 'usd1');
  if (!['usd1', 'bnb', 'bobai'].includes(currency)) return json(400, { error: 'currency is one of usd1, bnb, bobai' });
  const existing = await readListing(env, id);
  if (existing && existing.status !== 'removed') return json(409, { error: `#${id} is listed already (since ${existing.since})`, profile: `https://agent.brainonbnb.com/listed/${id}` });
  const chk = await checkAgent(id);
  if (!chk.ok) return json(422, { error: 'this agent cannot be listed yet', reasons: chk.reasons, check: chk });
  let send, min, asset, label;
  if (currency === 'usd1') { send = BigInt(LISTING_USD) * 10n ** 18n; min = send; asset = USD1; label = `${LISTING_USD} USD1`; }
  else if (currency === 'bnb') {
    const px = await deps.bnbUsd();
    const bnb = Math.ceil((LISTING_USD / px) * 1e5) / 1e5; // up to the next 0.00001 BNB
    // whole 0.00001 BNB steps, no float in the atomic amount
    send = BigInt(Math.round(bnb * 1e5)) * 10n ** 13n; min = (send * 98n) / 100n; asset = 'BNB'; label = `${bnb} BNB (≈ $${LISTING_USD} at ${px.toFixed(2)} $/BNB)`;
  } else {
    const q = await deps.bobaiForUsd(LISTING_USD);
    send = BigInt(q.tokens) * 10n ** 18n; min = q.atomic; asset = BOBAI; label = `${q.tokens.toLocaleString('en-US')} BOBAI (≈ $${LISTING_USD}; the 3% tax is covered, at least ${Number(q.atomic / 10n ** 18n).toLocaleString('en-US')} must arrive)`;
  }
  const nonce = crypto.randomUUID();
  const quote = { id, currency, asset, send: send.toString(), min: min.toString(), label, payee: PAYEE, created: Date.now(), expires: Date.now() + QUOTE_TTL_MS, owner: chk.owner, agent_wallet: chk.agent_wallet };
  await env.AGENT.put(`listquote:${nonce}`, JSON.stringify(quote), { expirationTtl: 2 * 3600 });
  return json(200, { nonce, agent: id, name: chk.name, pay: { to: PAYEE, asset, amount_atomic: quote.send, label, network: 'BNB Smart Chain (56)' }, sign: signLine(id, nonce), signers: [chk.owner, chk.agent_wallet].filter(Boolean), expires_at: new Date(quote.expires).toISOString() });
}

async function signerOk(quote, nonce, signature) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature || ''))) return { ok: false, error: 'signature missing or malformed (65 bytes, 0x…)' };
  let who;
  try { who = lc(await recoverMessageAddress({ message: signLine(quote.id, nonce), signature })); } catch { return { ok: false, error: 'the signature could not be read' }; }
  // read again at the moment of use: an id can change hands between quote and payment
  const [owner, aw] = await Promise.all([ownerOf(quote.id), agentWalletOf(quote.id)]);
  if (who !== lc(owner) && who !== lc(aw)) return { ok: false, error: `signed by ${who}, which neither owns #${quote.id} (${owner}) nor is its agentWallet (${aw || 'none'})` };
  return { ok: true, signer: who };
}

export async function verifySigner(body, env) {
  const nonce = String(body?.nonce || ''), quote = JSON.parse((await env.AGENT.get(`listquote:${nonce}`)) || 'null');
  if (!quote) return json(404, { error: 'unknown or expired quote — ask for a new one' });
  const s = await signerOk(quote, nonce, body?.signature);
  return s.ok ? json(200, { ok: true, signer: s.signer, next: `send ${quote.label} to ${PAYEE}, then submit the transaction hash` }) : json(403, s);
}

// --------------------------------------------------------------- payment
export async function paymentOk(quote, tx) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(tx || ''))) return { ok: false, status: 400, error: 'tx must be a transaction hash (0x + 64 hex)' };
  const [rc, t] = await Promise.all([rpc('eth_getTransactionReceipt', [tx]), rpc('eth_getTransactionByHash', [tx])]);
  if (!rc || !t) return { ok: false, status: 202, pending: true, error: 'the transaction is not mined yet — submit again in a few seconds' };
  if (rc.status !== '0x1') return { ok: false, status: 422, error: 'the transaction failed on-chain' };
  const blk = await rpc('eth_getBlockByNumber', [rc.blockNumber, false]);
  const at = Number(BigInt(blk.timestamp)) * 1000;
  if (at < quote.created - 120e3) return { ok: false, status: 422, error: 'the transaction is older than the quote' };
  const need = BigInt(quote.min);
  let got = 0n;
  if (quote.asset === 'BNB') {
    if (lc(t.to) === PAYEE) got = BigInt(t.value);
  } else {
    for (const l of rc.logs || []) {
      if (lc(l.address) === lc(quote.asset) && l.topics?.[0] === TRANSFER_TOPIC && lc(l.topics?.[2]) === pad32(PAYEE)) got += BigInt(l.data);
    }
  }
  if (got < need) return { ok: false, status: 422, error: `the transaction pays ${got} (atomic) of ${quote.currency.toUpperCase()} to ${PAYEE}; at least ${need} is needed` };
  return { ok: true, paid: got.toString(), from: lc(t.from), block: Number(BigInt(rc.blockNumber)), at: new Date(at).toISOString() };
}

export async function submitListing(body, env) {
  const nonce = String(body?.nonce || ''), quote = JSON.parse((await env.AGENT.get(`listquote:${nonce}`)) || 'null');
  if (!quote) return json(404, { error: 'unknown or expired quote — ask for a new one' });
  const s = await signerOk(quote, nonce, body?.signature);
  if (!s.ok) return json(403, s);
  const tx = lc(body?.tx);
  const used = await env.AGENT.get(`listtx:${tx}`);
  if (used) return json(409, { error: `this transaction already paid for listing #${used}` });
  const p = await paymentOk(quote, tx);
  if (!p.ok) return json(p.status, p);
  // the money has arrived: claim the transaction FIRST, so a second submit
  // cannot list twice on one payment, whatever happens below
  await env.AGENT.put(`listtx:${tx}`, quote.id);
  const chk = await checkAgent(quote.id);
  const rec = {
    id: quote.id, name: chk.name, description: chk.description, image: chk.image, endpoints: chk.endpoints,
    owner: chk.owner, signer: s.signer, contact: String(body?.contact || '').slice(0, 80) || null,
    paid: { tx, currency: quote.currency, amount_atomic: p.paid, label: quote.label, from: p.from, at: p.at },
    since: new Date().toISOString().slice(0, 10), status: chk.ok ? 'verified' : 'paused', announced: false,
    checks: [{ at: new Date().toISOString(), ok: chk.ok, a2a: !!chk.answers?.a2a?.ok, mcp: !!chk.answers?.mcp?.ok }],
  };
  await env.AGENT.put(`listing:${quote.id}`, JSON.stringify(rec));
  const ids = JSON.parse((await env.AGENT.get('listings')) || '[]');
  if (!ids.includes(quote.id)) { ids.push(quote.id); await env.AGENT.put('listings', JSON.stringify(ids)); }
  await env.AGENT.delete(`listquote:${nonce}`).catch(() => {});
  // THE BUILDER'S ALARM (2026-10-13): a webhook given at listing is the agent watch for this agent, set at once — the
  // builder hears of the first silent hour, long before three silent days pause the badge. A bad URL never fails a paid listing.
  const alarm = body?.alarm ? await addAgentWatch(env, { agent: quote.id, callback: body.alarm }).catch((e) => ({ status: 500, body: { error: String(e.message || e) } })) : null;
  return json(200, { ok: true, listed: quote.id, status: rec.status, ...(alarm ? { alarm: alarm.status === 200 ? 'set: your webhook hears every down and up' : 'not set: ' + (alarm.body?.error || 'refused') } : {}), profile: `https://agent.brainonbnb.com/listed/${quote.id}`, plaza: 'https://brainonbnb.com/registry',
    ...(chk.ok ? {} : { note: 'paid and listed; the badge shows once the agent answers our daily check' }) });
}

// ------------------------------------------------------------ our own agent
// THE HOUSE LISTING (operator, 2026-10-12: "list only ours" — the first listing is our own DeFi agent; the price stays).
// Our own agents are refused on the paid path; this one, behind HIT_SECRET, lists one of them WITHOUT a payment and
// says so everywhere (house: true): the profile, the Plaza badge and the announcement name it as ours, not as paid.
export async function houseListing(env, idRaw) {
  const id = String(idRaw || '').trim();
  if (!OURS.has(id)) return json(400, { error: 'the house listing is for our own agents only; everyone else pays' });
  const chk = await checkAgent(id, { house: true });
  if (!chk.ok) return json(422, { error: 'it does not pass the check', reasons: chk.reasons });
  const prev = await readListing(env, id);
  const rec = {
    id, name: chk.name, description: chk.description, image: chk.image, endpoints: chk.endpoints, owner: chk.owner, signer: null, contact: null,
    house: true, paid: { currency: 'house', label: 'our own agent, not paid' },
    since: prev?.since || new Date().toISOString().slice(0, 10), status: 'verified', announced: true, // ours: never announced as a new listing (operator, 2026-10-12: "all our agents get the badge" — a badge, not a launch post)
    checks: [...(prev?.checks || []), { at: new Date().toISOString(), ok: true, a2a: !!chk.answers?.a2a?.ok, mcp: !!chk.answers?.mcp?.ok }].slice(-30),
  };
  await env.AGENT.put(`listing:${id}`, JSON.stringify(rec));
  const ids = JSON.parse((await env.AGENT.get('listings')) || '[]');
  if (!ids.includes(id)) { ids.push(id); await env.AGENT.put('listings', JSON.stringify(ids)); }
  return json(200, { ok: true, listed: id, house: true, profile: `https://agent.brainonbnb.com/listed/${id}` });
}

// --------------------------------------------------------------- reading
// ------------------------------------------------------------ builder log
// THE BUILDER LOG (operator, 2026-10-12: "a $95 listing must show the dev means it — that he builds and uses his agent
// for real"): a listed agent's builder posts short updates, each signed by the wallet that owns the id (or its
// agentWallet), with the time he signed (within 10 minutes, so an old signature cannot be sent again). Up to 280
// characters, one a minute, the last 30 kept; shown on the profile, the chart and the screener. Our own agents post
// through HIT_SECRET (by: "brainonbnb").
const logLine = (id, at, text) => `Brain Plaza builder log\nAgent #${id} on BNB Smart Chain\n${at}\n${text}`;
export const logMessage = logLine;
export async function readLog(env, id) { return JSON.parse((await env.AGENT.get(`listinglog:${String(id)}`)) || '[]'); }
export async function postLog(body, env, opts = {}) {
  const id = String(body?.agent || '').trim(), text = String(body?.text || '').replace(/\s+/g, ' ').trim(), at = String(body?.at || '');
  if (!/^\d{1,9}$/.test(id)) return json(400, { error: 'agent: its ERC-8004 id on BNB Smart Chain' });
  const r = await readListing(env, id); if (!r || r.status === 'removed') return json(404, { error: `#${id} is not listed on Brain Plaza` });
  if (text.length < 3 || text.length > 280) return json(400, { error: 'text: 3 to 280 characters' });
  let by;
  if (opts.house) { if (!r.house) return json(400, { error: 'the house log is for our own agents only' }); by = 'brainonbnb'; }
  else {
    const t = Date.parse(at); if (!t || Math.abs(Date.now() - t) > 10 * 60e3) return json(400, { error: 'at: the ISO time you signed, within 10 minutes of now', sign: logLine(id, new Date().toISOString(), text) });
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(body?.signature || ''))) return json(400, { error: 'signature missing or malformed (65 bytes, 0x…)', sign: logLine(id, at, text) });
    let who; try { who = lc(await recoverMessageAddress({ message: logLine(id, at, text), signature: body.signature })); } catch { return json(400, { error: 'the signature could not be read' }); }
    const [owner, aw] = await Promise.all([ownerOf(id), agentWalletOf(id)]);
    if (who !== lc(owner) && who !== lc(aw)) return json(403, { error: `signed by ${who}, which neither owns #${id} (${owner}) nor is its agentWallet (${aw || 'none'})` });
    by = who;
  }
  const log = await readLog(env, id);
  if (log.length && Date.now() - Date.parse(log[log.length - 1].at) < 60e3) return json(429, { error: 'one update a minute' });
  log.push({ at: new Date().toISOString(), text, by }); await env.AGENT.put(`listinglog:${id}`, JSON.stringify(log.slice(-30)));
  return json(200, { ok: true, agent: id, entries: Math.min(log.length, 30), profile: `https://agent.brainonbnb.com/listed/${id}` });
}

export async function readListing(env, id) { return JSON.parse((await env.AGENT.get(`listing:${String(id)}`)) || 'null'); }
export async function readListings(env) {
  const ids = JSON.parse((await env.AGENT.get('listings')) || '[]');
  const all = await Promise.all(ids.map((id) => readListing(env, id)));
  const logs = await Promise.all(all.map((r) => (r ? readLog(env, r.id).catch(() => []) : [])));
  return all.map((r, k) => [r, logs[k]]).filter(([r]) => r && r.status !== 'removed').map(([{ checks, contact, signer, ...r }, log]) => ({
    ...r, badge: r.status === 'verified', last_check: checks?.[checks.length - 1] || null, days_checked: checks?.length || 0,
    days_answered: (checks || []).filter((c) => c.ok).length, profile: `https://agent.brainonbnb.com/listed/${r.id}`,
    // VERIFIED BUILDER: the wallet that signed the listing still owns the id (or is its agentWallet) and the agent answers
    verified_builder: !!signer && r.builder_ok !== false && r.status === 'verified', builder: signer || null,
    last_log: log.length ? log[log.length - 1] : null, log_entries: log.length,
  }));
}
export async function markAnnounced(env, id) {
  const r = await readListing(env, id); if (!r) return false;
  r.announced = true; await env.AGENT.put(`listing:${id}`, JSON.stringify(r)); return true;
}

// ------------------------------------------------------- the daily check
export async function runListingMonitor(env) {
  const today = new Date().toISOString().slice(0, 10);
  if ((await env.AGENT.get('listing_monitor_day')) === today) return { skipped: 'done today' };
  await env.AGENT.put('listing_monitor_day', today, { expirationTtl: 3 * 86400 });
  const ids = JSON.parse((await env.AGENT.get('listings')) || '[]'); const out = [];
  for (const id of ids) {
    const r = await readListing(env, id); if (!r || r.status === 'removed') continue;
    const chk = await checkAgent(id).catch(() => ({ ok: false, answers: {} }));
    // OURS / registration changes are not this check's business; whether it answers is
    const ok = !!chk.answers?.ok;
    if (r.signer) { const [own, aw] = await Promise.all([ownerOf(id), agentWalletOf(id)]).catch(() => [null, null]); if (own) r.builder_ok = r.signer === lc(own) || r.signer === lc(aw); }
    r.checks = [...(r.checks || []), { at: new Date().toISOString(), ok, a2a: !!chk.answers?.a2a?.ok, mcp: !!chk.answers?.mcp?.ok }].slice(-30);
    const tail = r.checks.slice(-PAUSE_AFTER);
    r.status = ok ? 'verified' : tail.length >= PAUSE_AFTER && tail.every((c) => !c.ok) ? 'paused' : r.status;
    await env.AGENT.put(`listing:${id}`, JSON.stringify(r)); out.push([id, ok, r.status]);
  }
  return { checked: out };
}

// ----------------------------------------------------------- profile page
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function profileHtml(r, log = []) {
  const checks = (r.checks || []).slice(-14);
  const dots = checks.map((c) => `<i class="${c.ok ? 'y' : 'n'}" title="${h(c.at.slice(0, 10))}: ${c.ok ? 'answered' : 'no answer'}"></i>`).join('');
  const badge = (r.status === 'verified' ? '<span class="b ok">✓ verified &amp; maintained</span>' : '<span class="b no">paused — did not answer our last checks</span>')
    + (r.house ? ' <span class="b" style="color:var(--gold);background:rgba(240,185,11,.1)">Brain On BNB&rsquo;s own agent · not a paid listing</span>' : '')
    + (r.signer && r.builder_ok !== false && r.status === 'verified' ? ' <span class="b ok" title="the wallet that listed it still owns the id, and it answers">✓ verified builder</span>' : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(r.name || 'Agent #' + r.id)} · Brain Plaza</title><meta name="description" content="${h((r.description || '').slice(0, 160))}">
<style>:root{color-scheme:dark;--bg:#0b090a;--card:#151214;--ink:#f2ece2;--mut:#a59c8f;--gold:#F0B90B;--ok:#4cc38a;--no:#ff7a6e;--line:rgba(240,185,11,.22)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 Inter,system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:28px 18px 60px;display:grid;gap:18px}
a{color:var(--gold)}.k{font:600 12px ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
h1{font:700 clamp(26px,5vw,38px)/1.1 'Space Grotesk',system-ui,sans-serif;margin:6px 0 0}.top{display:flex;gap:16px;align-items:center}.top img{width:72px;height:72px;border-radius:16px;object-fit:cover;border:1px solid var(--line)}
.b{display:inline-block;font:600 12.5px ui-monospace,Consolas,monospace;padding:6px 10px;border-radius:999px}.ok{color:var(--ok);background:rgba(76,195,138,.12)}.no{color:var(--no);background:rgba(255,122,110,.12)}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:grid;gap:8px;min-width:0}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}dt{color:var(--mut)}dd{margin:0;overflow-wrap:anywhere}
.lg{padding:6px 0;border-top:1px solid rgba(240,185,11,.12)}.dots{display:flex;gap:4px;flex-wrap:wrap}.dots i{width:14px;height:14px;border-radius:4px;display:block}.dots .y{background:var(--ok)}.dots .n{background:var(--no)}.m{color:var(--mut);font-size:13.5px}</style></head><body><main>
<a class="k" href="https://brainonbnb.com/registry">← Brain Plaza</a>
<div class="top">${r.image ? `<img src="${h(r.image)}" alt="">` : ''}<div><span class="k">Listed agent · ERC-8004 #${h(r.id)}</span><h1>${h(r.name || 'Agent #' + r.id)}</h1></div></div>
<div>${badge}</div>
${r.description ? `<div class="c"><p style="margin:0">${h(r.description)}</p></div>` : ''}
<div class="c"><span class="k">Builder log</span>${log.length ? log.slice(-10).reverse().map((e) => `<div class="lg"><b>${h(e.at.slice(0, 10))}</b> ${h(e.text)}<span class="m"> · ${e.by === 'brainonbnb' ? 'Brain On BNB' : 'signed by ' + h(e.by.slice(0, 6) + '…' + e.by.slice(-4))}</span></div>`).join('') : '<span class="m">No update posted yet.</span>'}
${r.house ? '' : `<details><summary class="m" style="cursor:pointer">Post an update — the wallet that owns #${h(r.id)} signs it</summary>
<textarea id="lgt" maxlength="280" rows="3" style="width:100%;margin-top:8px;background:#0f0d0e;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:8px;font:inherit" placeholder="What changed? e.g. v1.3: faster quotes, new MCP tool"></textarea>
<button id="lgb" type="button" style="margin-top:6px;background:var(--gold);color:#0b090a;border:0;border-radius:999px;padding:8px 16px;font-weight:700;cursor:pointer">Sign and post</button> <span class="m" id="lgs"></span>
<script>(function(){var b=document.getElementById('lgb'),s=document.getElementById('lgs');b.onclick=async function(){try{var t=document.getElementById('lgt').value.replace(/\\s+/g,' ').trim();if(t.length<3){s.textContent='Write 3 to 280 characters.';return}
if(!window.ethereum){s.textContent='Open this page in a wallet browser (or with a wallet extension).';return}
var a=(await ethereum.request({method:'eth_requestAccounts'}))[0],at=new Date().toISOString(),msg='Brain Plaza builder log\\nAgent #${h(r.id)} on BNB Smart Chain\\n'+at+'\\n'+t;
s.textContent='Sign in your wallet…';var sig=await ethereum.request({method:'personal_sign',params:[msg,a]});
var res=await fetch('/listing/log',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:'${h(r.id)}',text:t,at:at,signature:sig})}),j=await res.json();
s.textContent=j.ok?'Posted. Reloading…':(j.error||'Refused.');if(j.ok)setTimeout(function(){location.reload()},900)}catch(e){s.textContent=(e&&e.message)||'Cancelled.'}}})();</script></details>`}
<span class="m">${r.house ? 'Our own agent: Brain On BNB posts its log. ' : 'Signed by the wallet that owns the agent, so only its builder can write here. '}An agent that keeps answering stays maintained; this is where its builder shows what they build.</span></div>
<div class="c"><span class="k">Alarm when it goes down</span><span class="m">Free, for its builder or anyone who relies on it: your https webhook is called on every change, down and back up — checked every hour while it is listed.</span>
<div style="display:flex;flex-wrap:wrap;gap:8px"><input id="alu" type="url" placeholder="https://your.server/hook" style="flex:1 1 240px;min-width:0;background:#0f0d0e;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:8px;font:inherit"><button id="alb" type="button" style="background:var(--gold);color:#0b090a;border:0;border-radius:999px;padding:8px 16px;font-weight:700;cursor:pointer">Alarm me</button></div><span class="m" id="als"></span>
<script>(function(){var b=document.getElementById('alb'),s=document.getElementById('als');b.onclick=async function(){var u=document.getElementById('alu').value.trim();if(u.indexOf('https://')!==0){s.textContent='An https:// address that accepts a POST.';return}
try{var r=await fetch('/agent-watch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:'${h(r.id)}',callback:u})}),j=await r.json();s.textContent=j.ok?'Set. Your webhook hears every down and up of #${h(r.id)}.':(j.error||'Refused.')}catch(e){s.textContent='Could not reach the server just now.'}}})();</script></div>
<div class="c"><span class="k">Our daily check, last ${checks.length} day${checks.length === 1 ? '' : 's'}</span><div class="dots">${dots}</div>
<span class="m">Every day we call it once — an A2A message or an MCP initialize. Green: it answered. Three red days in a row take the badge off until it answers again.</span></div>
<div class="c"><dl><dt>Listed since</dt><dd>${h(r.since)}</dd><dt>Owner</dt><dd><a href="https://bscscan.com/address/${h(r.owner)}">${h(r.owner)}</a></dd>
<dt>Endpoints</dt><dd>${(r.endpoints || []).map((e) => `<code>${h(e)}</code>`).join('<br>')}</dd>
<dt>Measured</dt><dd><a href="https://brainonbnb.com/agent/${h(r.id)}">its chart: uptime, paid work, buyers, price</a></dd>
<dt>On-chain</dt><dd><a href="https://8004scan.io/agents/bsc/${h(r.id)}">8004scan</a> · <a href="https://bscscan.com/token/${REGISTRY}?a=${h(r.id)}">registry</a></dd></dl></div>
<p class="m">A listing is paid once and shows this page, the badge and a "Featured (paid)" slot at the top of its category on Brain Plaza. It never buys a place in the list below: that order is the evidence — who answers, who quotes, who has been paid. <a href="https://brainonbnb.com/list">List your agent</a></p>
</main></body></html>`;
}

// THE LISTED ONES, EVERY HOUR (agent chart phase 4): a listed agent is asked once an hour (A2A message/send or MCP
// initialize, as at listing), its profile shows the result, and a change from up to down or back alerts its watchers
// within the hour. The badge itself still follows the daily rule (three silent days).
export async function runListedLive(env) {
  const ids = JSON.parse((await env.AGENT.get('listings')) || '[]'); const out = [];
  for (const id of ids) {
    const r = await readListing(env, id); if (!r || r.status === 'removed') continue;
    const reg = await registrationOf(Number(id)).catch(() => null);
    const ans = reg ? await answers(id, reg).catch(() => ({ ok: false })) : { ok: false };
    r.live = { ok: !!ans.ok, at: new Date().toISOString() };
    // the endpoints follow the registration (2026-10-13: a profile kept the endpoints of the day it was listed)
    if (reg?.endpoints?.length) r.endpoints = reg.endpoints.slice(0, 12);
    await env.AGENT.put(`listing:${id}`, JSON.stringify(r));
    await noteAgentState(env, id, !!ans.ok, 'hourly check (listed)').catch(() => null);
    out.push([id, !!ans.ok]);
  }
  return { checked: out };
}
