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
const env = { AGENT: { get: async (k, o) => (kv.has(k) ? kv.get(k) : null), put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) meta.set(k, o.metadata); }, delete: async (k) => { kv.delete(k); }, getWithMetadata: async (k) => (kv.has(k) ? { value: kv.get(k), metadata: meta.get(k) } : { value: null }) }, BSC_RPC_KEYED_URL_2: process.env.BSC_RPC_KEYED_URL_2, HIT_SECRET: 'test-secret' };
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

// THE LIVING AD (sandboxed) and THE PUBLIC VISITS (2026-11-22)
const adHtml = '<style>b{color:gold}</style><b>BOBAI</b><script>document.body.dataset.x=1</script>';
const ah = (await import('node:crypto')).createHash('sha256').update(adHtml).digest('hex');
const ma = await call('GET', `/wall/message?agent=49467&link=${encodeURIComponent(link)}&logo_sha256=${h}&ad_sha256=${ah}`);
say(ma.j.message === wallMessage({ agent: '49467', link, logoHash: h, adHash: ah, date: dayOf() }) && ma.j.message.includes(`Living ad sha256: ${ah}`), 'the message names the living ad by its hash');
const sa = await owner.signMessage({ message: ma.j.message });
say((await call('POST', '/wall', { agent: 49467, link, date: ma.j.date, signer: owner.address, signature: sa, logo, ad: adHtml + ' ' })).status === 401, 'the ad changed after signing: 401');
say((await call('POST', '/wall', { agent: 49467, link, date: ma.j.date, signer: owner.address, signature: sa, logo, ad: 'x'.repeat(12001) })).status === 400, 'an ad over 12,000 bytes: 400');
const oka = await call('POST', '/wall', { agent: 49467, link, date: ma.j.date, signer: owner.address, signature: sa, logo, ad: adHtml });
say(oka.status === 201 && oka.j.entry?.ad_sha256 === ah, 'signed with its living ad: 201', oka);
const adr = await handleWall(new Request('https://agent.brainonbnb.com/wall/ad/49467'), env, '/wall/ad/49467', new URL('https://x/wall/ad/49467'), '1.1.1.1');
say((await adr.text()) === adHtml && /sandbox/.test(adr.headers.get('content-security-policy') || '') && /nosniff/.test(adr.headers.get('x-content-type-options') || ''), 'the ad served as text, sandbox CSP, nosniff');
const w2 = await call('GET', '/wall');
say(w2.j.wall?.[0]?.ad_url?.endsWith('/wall/ad/49467') && w2.j.wall[0].visits === 0 && w2.j.wall[0].go_url.endsWith('/wall/go/49467'), 'the wall lists the ad, the go link and 0 visits');
const go = async (ip, ua = 'Mozilla/5.0') => handleWall(new Request('https://agent.brainonbnb.com/wall/go/49467', { headers: { 'user-agent': ua } }), env, '/wall/go/49467', new URL('https://x/wall/go/49467'), ip);
const g1 = await go('9.9.9.9'); await go('9.9.9.9'); await go('8.8.8.8'); await go('7.7.7.7', 'Googlebot/2.1');
say(g1.status === 302 && g1.headers.get('location') === link, 'a visit is sent on to the signed link (302)');
const w3 = await call('GET', '/wall');
say(w3.j.wall?.[0]?.visits === 2 && w3.j.visits_total === 2, `counted once per address and day, bots not counted (${w3.j.wall?.[0]?.visits})`);
say(![...kv.keys()].some((k) => k.includes('9.9.9.9')), 'no address is stored in the clear');
const plain = await call('POST', '/wall', { agent: 49467, link, date: m.j.date, signer: owner.address, signature: sig, logo });
say(plain.status === 201 && !kv.has('wall:ad:49467') && !plain.j.entry.ad_sha256, 'a newer plain signature takes the ad down');
const g0 = await handleWall(new Request('https://agent.brainonbnb.com/wall/go/5'), env, '/wall/go/5', new URL('https://x/wall/go/5'), '1.1.1.1');
say(g0.status === 302 && g0.headers.get('location') === 'https://brainonbnb.com/wall', 'an unknown agent goes to the wall page');

// THE MARKET and THE OPEN PROTOCOL (2026-11-22)
const wm = await call('GET', '/wall');
say(wm.j.market && wm.j.market.entry === 0 && /807 places free/.test(wm.j.market.entry_rule) && wm.j.wall[0].rank === 1 && wm.j.wall[0].to_move_up === 0, 'the market: entry price 0 while places are free, rank and move-up price per tile', wm.j.market);
const sp = await call('GET', '/wall/spec');
say(sp.status === 200 && /area\(a\)/.test(sp.j.formula) && ['ai', 'blockchain', 'crypto', 'sandbox'].every((k) => sp.j.gates[k]) && /outbid/.test(sp.j.market), 'GET /wall/spec: the formula, the four gates, the market');

// THE CONTENT RULE: take down (secret) and barred for good
const rm = async (secret) => handleWall(new Request('https://agent.brainonbnb.com/wall/remove', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-hit-secret': secret } : {}) }, body: JSON.stringify({ agent: 49467, why: 'test' }) }), env, '/wall/remove', new URL('https://x/wall/remove'), '1.1.1.1');
say((await rm()).status === 401 && (await rm('wrong')).status === 401, 'take down without the secret: 401');
const rmo = await rm('test-secret'); const wr = await call('GET', '/wall');
say(rmo.status === 200 && !wr.j.wall.some((e) => e.agent === '49467') && !kv.has('wall:l:49467'), 'take down: off the wall, logo gone');
say((await call('POST', '/wall', { agent: 49467, link, date: m.j.date, signer: owner.address, signature: sig, logo })).status === 403, 'a barred agent cannot put it up again: 403');
say(/racism, terror, hate, porn/.test((await call('GET', '/wall/how')).j.content), 'the content rule is in /wall/how');

if (process.argv.includes('--live')) {
  const g = await fetch('https://agent.brainonbnb.com/wall').then((r) => r.json()).catch(() => null);
  say(g && Array.isArray(g.wall) && g.max === 808, `live GET /wall (${g?.wall?.length} on the wall)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
