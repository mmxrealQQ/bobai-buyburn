// Revoke the agent's Altana session from the product — the one control the
// session page did not have.
//
// What Altana's track asks for, word for word: "a user can see what their agent
// may do, and revoke it, inside the product". /session showed it; revocation
// ran from the operator's laptop because the admin key lived only there. This
// moves the signing to the worker, under two locks, and leaves the key where a
// key belongs:
//
//   1. The admin key is a Cloudflare secret (ALTANA_ADMIN_PRIVATE_KEY). It is
//      never in code, never in the public mirror, never returned by any route.
//      The same arrangement holds the DeFi wallet's key and the provider
//      wallet's key on the other workers of this project.
//   2. The route fires only with the operator's token (SESSION_REVOKE_TOKEN,
//      also a secret) in the request. Without it the answer is 401 and nothing
//      is signed. A stranger who finds the button gets the same 401. This is
//      what keeps the button from being an off-switch anyone could press —
//      the reason the page used to have no button at all.
//
// The revocation itself is the SDK's own: an admin-signed Altana intent that
// revokes the key on the account AND in the public KeyStore in one bundle, the
// same call scripts/altana-session.mjs makes. After it, isValidKey() answers
// false and the account contract refuses the session's next call.
//
//   POST /session/revoke            header x-operator-token: <token>
//        body {"keyId":"0x…"}      one key; omitted = every currently valid key
//   GET  /session/revoke            what this is, without doing anything
//
// The record of every revocation fired here is kept in KV and shown on the
// page: when, which key, the transaction — so the control is a fact a reader
// can check on the chain, not a button that claims to have worked.
import { createClient, BNB, signerFromPrivateKey } from '@altananetwork/sdk';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ALTANA_NETWORKS, readSessionState } from './session.js';

// The KeyStore lists the admin key beside the session keys, and it refuses to
// revoke the admin ("KeyStore: cannot revoke root key" — learned by pressing
// the button on it). Its keyId is keccak256 of the admin's public key, which
// this worker can derive from the secret without exposing anything; a page
// that cannot tell the two apart offers the root key for revocation, which is
// exactly what the first version did.
export function adminKeyId(env) {
  try { return env.ALTANA_ADMIN_PRIVATE_KEY ? keccak256(privateKeyToAccount(env.ALTANA_ADMIN_PRIVATE_KEY).publicKey).toLowerCase() : null; } catch { return null; }
}
export function annotateRoles(state, env) {
  const admin = adminKeyId(env);
  for (const c of state.chains || []) {
    for (const k of c.keys || []) {
      k.role = admin == null ? 'unknown' : k.keyId.toLowerCase() === admin ? 'admin' : 'session';
      k.role_note = k.role === 'admin' ? 'the admin (root) key — it grants and revokes sessions and cannot itself be revoked'
        : k.role === 'session' ? 'a session key — limited by allowlist, cap and expiry; revocable'
        : 'role not determined on this worker';
    }
  }
  return state;
}
// A revert reason as words. The relay hands back the raw Error(string) data,
// and a record that says 0x08c379a0… says nothing to a reader.
function revertReason(text) {
  const m = /0x08c379a0[0-9a-fA-F]{128,}/.exec(String(text || ''));
  if (!m) return String(text || '').slice(0, 300);
  try {
    const d = m[0].slice(10);
    const len = parseInt(d.slice(64, 128), 16);
    const hex = d.slice(128, 128 + len * 2);
    let s = '';
    for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return s;
  } catch { return String(text || '').slice(0, 300); }
}

const SEL_GET_PUBKEY = '0x7cefdd5d';
const pad = (hexOrAddr) => String(hexOrAddr).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const KV_KEY = 'session:revocations';

async function ethCall(rpcs, to, data) {
  let last;
  for (const endpoint of rpcs) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message); continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('no endpoint answered');
}

// The SEC1 public key the KeyStore holds for (wallet, keyId): ABI `bytes`,
// offset + length + data. The SDK's revokeSession takes the public key, not
// the keyId, and derives keyId = keccak256(publicKey) itself — so what is
// read here has to be the exact bytes that were registered.
function decodeBytes(hex) {
  const h = String(hex || '').replace(/^0x/, '');
  if (h.length < 128) return null;
  const len = parseInt(h.slice(64, 128), 16);
  return '0x' + h.slice(128, 128 + len * 2);
}

export async function readRevocations(env) {
  try { return JSON.parse((await env.AGENT.get(KV_KEY)) || '[]'); } catch { return []; }
}

const explain = {
  what_this_is: 'Revokes the agent\'s Altana session from the product. The admin key that signs the revocation is a secret on this worker; the route fires only with the operator\'s token.',
  how: 'POST /session/revoke with header x-operator-token. Body {"keyId":"0x…"} revokes one key; no body revokes every key that is currently valid.',
  what_happens: 'One admin-signed Altana intent revokes the key on the account and in the public KeyStore. isValidKey() answers false from the next block; the account contract refuses the session\'s next call.',
  why_a_token: 'A public endpoint that could end the session would be an off-switch any stranger could press. The token is what makes this a control rather than a denial-of-service.',
  record: 'Every revocation fired here is kept and shown on /session with its transaction.',
};

export async function handleSessionRevoke(request, env) {
  const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-operator-token', 'access-control-allow-methods': 'GET, POST, OPTIONS' },
  });
  // The browser's preflight: a 204 may carry no body at all — a Response
  // built with one throws, which the page saw as "Failed to fetch".
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-operator-token', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '600' } });
  if (request.method !== 'POST') return json({ ...explain, revocations: await readRevocations(env) });

  // Lock 2, before anything else. A constant-time compare is not needed for
  // a random 32-byte token, but a missing secret must fail closed: an empty
  // SESSION_REVOKE_TOKEN would otherwise equal an empty header.
  const token = request.headers.get('x-operator-token') || '';
  if (!env.SESSION_REVOKE_TOKEN || token.length < 16 || token !== env.SESSION_REVOKE_TOKEN) {
    return json({ error: 'operator token required', note: 'Only the operator can revoke. This is what stops a stranger from switching the agent off.' }, 401);
  }
  if (!env.ALTANA_ADMIN_PRIVATE_KEY) return json({ error: 'the admin key is not configured on this worker' }, 503);
  const walletAddress = env.ALTANA_AGENT_WALLET;
  if (!walletAddress) return json({ error: 'no agent wallet configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const net = ALTANA_NETWORKS[56];
  const state = await readSessionState(56, walletAddress);
  if (state.error) return json({ error: `KeyStore unreadable: ${state.error}` }, 503);
  const want = body.keyId ? String(body.keyId).toLowerCase() : null;
  const admin = adminKeyId(env);
  if (want && admin && want === admin) {
    return json({ error: 'that is the admin (root) key, the one that grants and revokes sessions; the KeyStore refuses to revoke it and this route will not try', keyId: want }, 400);
  }
  const targets = (state.keys || []).filter((k) => k.valid === true && k.keyId.toLowerCase() !== admin && (!want || k.keyId.toLowerCase() === want));
  if (!targets.length) return json({ error: want ? 'that key is not a currently valid session key of this wallet' : 'no valid session key to revoke', keys: state.keys }, 404);

  const signer = signerFromPrivateKey(env.ALTANA_ADMIN_PRIVATE_KEY);
  const client = createClient({ chains: [BNB] });
  // createWallet registers the admin authority on the relay when it is not yet
  // registered; for an existing account it resolves to the same address. The
  // address the relay names must be the wallet this worker publishes, or the
  // key on this worker is not the admin of that wallet — refuse, do not sign.
  const wallet = await client.createWallet({ signer });
  if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
    return json({ error: 'the admin key on this worker does not control the published agent wallet', relay_says: wallet.address, published: walletAddress }, 500);
  }

  const done = [];
  for (const k of targets) {
    const rec = { at: new Date().toISOString(), keyId: k.keyId, chainId: 56 };
    try {
      const pub = decodeBytes(await ethCall(net.rpcs, net.keyStore, SEL_GET_PUBKEY + pad(walletAddress) + k.keyId.replace(/^0x/, '')));
      if (!pub) throw new Error('the KeyStore returned no public key for this keyId');
      const r = await client.revokeSession({ wallet, signer, session: pub });
      rec.status = r.status || 'submitted';
      rec.transactionHash = r.transactionHash || null;
      rec.explorer = r.transactionHash ? `${net.explorer}/tx/${r.transactionHash}` : null;
    } catch (e) {
      rec.status = 'failed';
      rec.error = revertReason(e.message || e);
    }
    done.push(rec);
  }
  const record = [...done, ...(await readRevocations(env))].slice(0, 50);
  await env.AGENT.put(KV_KEY, JSON.stringify(record));
  const after = await readSessionState(56, walletAddress).catch(() => null);
  return json({ revoked: done, keys_after: after?.keys || null, note: 'isValidKey() is read live; a key can take a block to flip.' }, done.every((d) => d.status !== 'failed') ? 200 : 502);
}
