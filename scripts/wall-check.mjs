#!/usr/bin/env node
// The Agent Wall (worker-agent/wall.js) against the real ERC-8004 registry and $BOBAI balances, with a stand-in KV:
// the link and logo rules, the exact message, a real signature by #49467's owner taken and ranked by what its wallets
// hold, a stranger refused (403), a changed link refused (401), an older entry refused (409). Off-chain signatures only.
// Usage: node scripts/wall-check.mjs [--live]
import path from 'node:path';
import dotenv from 'dotenv';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { handleWall, cleanLink, wallMessage, rankWall } from '../worker-agent/wall.js';
import { sha256Bytes, dayOf } from '../worker-agent/guestbook.js';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });
let pass = 0, fail = 0;
const say = (ok, t, got) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 200)})`}`); };

say(!cleanLink('https://brainonbnb.com').error && !!cleanLink('http://x.com').error && !!cleanLink('javascript:alert(1)').error && !!cleanLink('https://localhost').error, 'link: https and a public host only');
const kv = new Map(), meta = new Map();
const env = { AGENT: { get: async (k, o) => (kv.has(k) ? kv.get(k) : null), put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) meta.set(k, o.metadata); }, getWithMetadata: async (k) => (kv.has(k) ? { value: kv.get(k), metadata: meta.get(k) } : { value: null }) }, BSC_RPC_KEYED_URL_2: process.env.BSC_RPC_KEYED_URL_2 };
const call = async (method, p, body, ip = '1.2.3.4') => { const u = new URL('https://agent.brainonbnb.com' + p); const r = await handleWall(new Request(u, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, u.pathname, u, ip); return { status: r.status, j: await r.json() }; };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const logo = 'data:image/png;base64,' + png.toString('base64'), h = await sha256Bytes(png), link = 'https://brainonbnb.com';
const owner = privateKeyToAccount((process.env.PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.PRIVATE_KEY);
const m = await call('GET', `/wall/message?agent=49467&link=${encodeURIComponent(link)}&logo_sha256=${h}`);
say(m.status === 200 && m.j.message === wallMessage({ agent: '49467', link, logoHash: h, date: dayOf() }), 'GET /wall/message gives the exact message');
const sig = await owner.signMessage({ message: m.j.message });
const st = privateKeyToAccount(generatePrivateKey()), s2 = await st.signMessage({ message: m.j.message });
say((await call('POST', '/wall', { agent: 49467, link, date: m.j.date, signer: st.address, signature: s2, logo })).status === 403, 'a stranger\'s wallet: 403');
say((await call('POST', '/wall', { agent: 49467, link: link + '/x', date: m.j.date, signer: owner.address, signature: sig, logo })).status === 401, 'link changed after signing: 401');
const ok = await call('POST', '/wall', { agent: 49467, link, date: m.j.date, signer: owner.address, signature: sig, logo });
say(ok.status === 201 && ok.j.entry?.role === 'owner', 'the owner of #49467 puts its logo up: 201', ok);
say(ok.j.ranked?.ok && ok.j.ranked.n === 1, `ranked at once from BNB Chain (block ${ok.j.ranked?.block})`, ok.j.ranked);
const w = await call('GET', '/wall');
say(w.j.wall?.[0]?.agent === '49467' && w.j.wall[0].bobai > 0, `on the wall with ${w.j.wall?.[0]?.bobai} $BOBAI (owner + agentWallet)`, w.j);
const lg = await handleWall(new Request(new URL('https://agent.brainonbnb.com/wall/logo/49467')), env, '/wall/logo/49467', new URL('https://x/wall/logo/49467'), '1.1.1.1');
say(Buffer.from(await lg.arrayBuffer()).equals(png) && /sandbox/.test(lg.headers.get('content-security-policy') || ''), 'the logo: its bytes, sandbox CSP');
const older = await call('POST', '/wall', { agent: 49467, link, date: '2026-01-01', signer: owner.address, signature: sig, logo });
say(older.status === 400 || older.status === 409, 'an old date is refused', older.status);

if (process.argv.includes('--live')) {
  const g = await fetch('https://agent.brainonbnb.com/wall').then((r) => r.json()).catch(() => null);
  say(g && Array.isArray(g.wall) && g.max === 808, `live GET /wall (${g?.wall?.length} on the wall)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
