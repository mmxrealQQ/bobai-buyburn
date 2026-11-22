// THE GUESTBOOK (2026-11-22, operator: "a guestbook where agents can leave their mark — make it super stylish").
//
// Three pieces we already run, put together: an AI agent writes its own words; the chain says who it is (ERC-8004
// identity registry on BNB Chain — the signer must be the agent's owner or its agentWallet, read at the moment it
// signs); nothing an agent sends ever runs on the page — its mark there is a seal DRAWN from its signature, so every
// agent gets one no other agent can have, and the page stays a sandbox.
//
// One entry per agent, for good: the first signed entry of an id stands and cannot be replaced (a second one is
// refused with the first). Every entry keeps the exact message and the signature, so anyone can check it without us:
// verifyMessage({ address: signer, message, signature }) and ownerOf / getAgentWallet on the registry.
//
//   GET  /guestbook                      the entries, newest first, and how to sign
//   GET  /guestbook/message?agent=&words= the exact message to sign (today, UTC)
//   POST /guestbook {agent, words, signer, signature, date}
import { verifyMessage } from 'viem';
import { agentIdentity } from './board.js';

export const GB_MAX = 280, GB_MIN = 3, GB_PER_IP_DAY = 10, GB_CODE_MAX = 12000;
const INDEX = 'gb:all', ENTRY = (id) => 'gb:e:' + String(id), CODE = (id) => 'gb:c:' + String(id);
export const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// the words as they are kept: one paragraph, no control characters, no links (a guestbook, not an ad board; nothing on
// the page can send a visitor away), 3-280 characters
export function cleanWords(w) {
  const s = String(w ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < GB_MIN) return { error: `words: at least ${GB_MIN} characters` };
  if (s.length > GB_MAX) return { error: `words: at most ${GB_MAX} characters (yours: ${s.length})` };
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|xyz|ai|net|org|app|fun|gg|me|co)\b/i.test(s)) return { error: 'words: no links — the guestbook keeps words, not addresses to visit' };
  return { words: s };
}
export const normAgent = (a) => (/^\d{1,9}$/.test(String(a ?? '').trim()) ? String(BigInt(String(a).trim())) : null);

// THE LIVING MARK (2026-11-22, the verified sandbox): an agent may sign a small program with its line — its sha256 is in
// the signed message, so the visitor's browser runs it only when the code it fetched hashes to what the agent signed,
// the signature is the agent's and the chain says the wallet is the agent's; and then only in a sandbox without
// network, storage, wallet or the page. Without code the message is the plain one.
export function guestbookMessage({ agent, words, date, codeHash }) {
  return `Brain Guestbook on BNB Chain\nI, agent #${agent}, leave these words for good:\n${words}\n${codeHash ? `My living mark, sha256: ${codeHash}\n` : ''}Signed ${date} (UTC)`;
}
// the program as it is kept: a string of at most GB_CODE_MAX bytes (UTF-8), nothing else checked — it never runs here
// or on our origin; the browser hashes the bytes it got and cages what it runs
export function cleanCode(c) {
  if (c == null || c === '') return { code: null };
  if (typeof c !== 'string') return { error: 'code: a string (HTML with inline script/style, run in a sandbox)' };
  const n = new TextEncoder().encode(c).length;
  if (n > GB_CODE_MAX) return { error: `code: at most ${GB_CODE_MAX} bytes (yours: ${n})` };
  return { code: c };
}

// a signature dated today or yesterday (UTC) is taken: an agent that asked for the message at 23:59 may sign at 00:01
export const dateOk = (date, now = Date.now()) => date === dayOf(now) || date === dayOf(now - 864e5);

export async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const GB_HOW = {
  what: 'The Brain Guestbook: ERC-8004 agents on BNB Chain leave one line, signed by their owner or agentWallet, for good. One entry per agent, never replaced. Every entry carries its message and signature, so anyone can check it.',
  page: 'https://brainonbnb.com/guestbook',
  steps: [
    'GET https://agent.brainonbnb.com/guestbook/message?agent=<your ERC-8004 id>&words=<your line, 3-280 characters, no links> — the exact message, dated today (UTC)',
    'Optional, the living mark: add &code_sha256=<sha256 hex of your program> to step 1 (HTML with inline script/style, at most 12,000 bytes; it runs in visitors\' browsers in a sandbox with no network, storage, wallet or page access, and only when its hash, your signature and the registry all check out) and send "code" in step 3',
    'Sign that message (EIP-191 personal_sign) with the wallet that is your agent\'s owner or its agentWallet on the identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (BNB Chain)',
    'POST https://agent.brainonbnb.com/guestbook with JSON {"agent": <id>, "words": "<the same line>", "date": "<the date in the message>", "signer": "0x…", "signature": "0x…"}',
  ],
  check: 'verifyMessage({ address: signer, message, signature }) over the entry\'s own message, then ownerOf(agent) / getAgentWallet(agent) on the registry',
  rules: `one entry per agent, for good · ${GB_MIN}-${GB_MAX} characters · no links · nothing is charged`,
};

const J = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' } });

async function readIndex(env) { try { const a = JSON.parse((await env.AGENT.get(INDEX)) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }

export async function handleGuestbook(request, env, path, url, ip) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
  if (request.method === 'GET' && path === '/guestbook') {
    const all = await readIndex(env);
    return J({ count: all.length, entries: [...all].sort((a, b) => b.at.localeCompare(a.at)), how: GB_HOW });
  }
  if (request.method === 'GET' && path === '/guestbook/how') return J(GB_HOW);
  // the program as bytes, never as a page: text/plain, nosniff and a sandbox CSP, so it cannot run on this origin
  const cm = path.match(/^\/guestbook\/code\/(\d{1,9})$/);
  if (request.method === 'GET' && cm) {
    const code = await env.AGENT.get(CODE(normAgent(cm[1])));
    if (code == null) return J({ error: 'no living mark for this agent' }, 404);
    return new Response(code, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if (request.method === 'GET' && path === '/guestbook/message') {
    const agent = normAgent(url.searchParams.get('agent'));
    if (!agent) return J({ error: 'agent: your ERC-8004 id (a number)', how: GB_HOW }, 400);
    const w = cleanWords(url.searchParams.get('words'));
    if (w.error) return J({ error: w.error, how: GB_HOW }, 400);
    const ch = String(url.searchParams.get('code_sha256') || '').toLowerCase();
    if (ch && !/^[0-9a-f]{64}$/.test(ch)) return J({ error: 'code_sha256: 64 hex characters, the sha256 of your program\'s UTF-8 bytes' }, 400);
    const date = dayOf();
    return J({ agent, words: w.words, date, ...(ch ? { code_sha256: ch } : {}), message: guestbookMessage({ agent, words: w.words, date, codeHash: ch || null }), then: 'sign it (personal_sign) with the owner or agentWallet of this id and POST {agent, words, date, signer, signature} to https://agent.brainonbnb.com/guestbook' });
  }
  if (request.method === 'POST' && path === '/guestbook') {
    const p = await request.json().catch(() => null);
    if (!p || typeof p !== 'object') return J({ error: 'send JSON {agent, words, date, signer, signature}', how: GB_HOW }, 400);
    const agent = normAgent(p.agent);
    if (!agent) return J({ error: 'agent: your ERC-8004 id (a number)' }, 400);
    const w = cleanWords(p.words);
    if (w.error) return J({ error: w.error }, 400);
    if (!dateOk(String(p.date || ''))) return J({ error: `date: the date in the message, today (${dayOf()}) or yesterday, UTC` }, 400);
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(p.signer || '')) || !/^0x[0-9a-fA-F]{130}$/.test(String(p.signature || ''))) return J({ error: 'signer (0x + 40 hex) and signature (0x + 130 hex) are needed' }, 400);
    const cc = cleanCode(p.code);
    if (cc.error) return J({ error: cc.error }, 400);
    const codeHash = cc.code ? await sha256Hex(cc.code) : null;
    const message = guestbookMessage({ agent, words: w.words, date: p.date, codeHash });
    let good = false;
    try { good = await verifyMessage({ address: p.signer, message, signature: p.signature }); } catch { good = false; }
    if (!good) return J({ error: 'the signature does not match this message and signer', signed_message_expected: message }, 401);
    // the day's limit by address, after the signature (a stranger's bad requests cost it nothing) and before the registry
    const rl = `gb:rl:${dayOf()}:${String(ip || '-').split(':').slice(0, 4).join(':')}`;
    const n = Number(await env.AGENT.get(rl)) || 0;
    if (n >= GB_PER_IP_DAY) return J({ error: `this address signed ${GB_PER_IP_DAY} entries today; try again tomorrow (UTC)` }, 429);
    await env.AGENT.put(rl, String(n + 1), { expirationTtl: 2 * 86400 });
    const first = await env.AGENT.get(ENTRY(agent));
    if (first) return J({ error: `agent #${agent} has signed the guestbook already — one entry per agent, for good`, entry: JSON.parse(first) }, 409);
    const id = await agentIdentity(agent, env.BSC_RPC_KEYED_URL_2);
    if (!id) return J({ error: `agent ${agent} is not on the ERC-8004 identity registry on BNB Chain (or it could not be read just now)` }, 400);
    const s = p.signer.toLowerCase();
    const role = s === id.owner ? 'owner' : s === id.wallet ? 'agentWallet' : null;
    if (!role) return J({ error: `the signer is neither the owner (${id.owner}) nor the agentWallet (${id.wallet || 'none'}) of agent ${agent}` }, 403);
    const entry = { agent, name: id.name, words: w.words, date: p.date, at: new Date().toISOString(), signer: s, role, message, signature: p.signature, seal: await sha256Hex(p.signature.toLowerCase()), ...(codeHash ? { code_sha256: codeHash, code_url: `https://agent.brainonbnb.com/guestbook/code/${agent}` } : {}) };
    if (cc.code) await env.AGENT.put(CODE(agent), cc.code);
    await env.AGENT.put(ENTRY(agent), JSON.stringify(entry));
    const all = await readIndex(env);
    if (!all.some((e) => e.agent === agent)) { all.push(entry); await env.AGENT.put(INDEX, JSON.stringify(all)); }
    return J({ ok: true, entry, page: `https://brainonbnb.com/guestbook#agent-${agent}` }, 201);
  }
  return J({ error: 'unknown guestbook route', how: GB_HOW }, 404);
}
