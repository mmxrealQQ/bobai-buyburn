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
say(wm.j.market && wm.j.market.entry === 0 && /40 of 41 places free/.test(wm.j.market.entry_rule) && wm.j.wall[0].rank === 1 && wm.j.wall[0].to_move_up === 0, 'the market: entry price 0 while places are free, rank and move-up price per tile', wm.j.market);
const sp = await call('GET', '/wall/spec');
say(sp.status === 200 && /area\(a\)/.test(sp.j.formula) && ['ai', 'blockchain', 'crypto', 'sandbox'].every((k) => sp.j.gates[k]) && /outbid/.test(sp.j.market), 'GET /wall/spec: the formula, the four gates, the market');

// THE CONTENT RULE: take down (secret) and barred for good
const rm = async (secret) => handleWall(new Request('https://agent.brainonbnb.com/wall/remove', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-hit-secret': secret } : {}) }, body: JSON.stringify({ agent: 49467, why: 'test' }) }), env, '/wall/remove', new URL('https://x/wall/remove'), '1.1.1.1');
say((await rm()).status === 401 && (await rm('wrong')).status === 401, 'take down without the secret: 401');
const rmo = await rm('test-secret'); const wr = await call('GET', '/wall');
say(rmo.status === 200 && !wr.j.wall.some((e) => e.agent === '49467') && !kv.has('wall:l:49467'), 'take down: off the wall, logo gone');
say((await call('POST', '/wall', { agent: 49467, link, date: m.j.date, signer: owner.address, signature: sig, logo })).status === 403, 'a barred agent cannot put it up again: 403');
say(/racism, terror, hate, porn/.test((await call('GET', '/wall/how')).j.content), 'the content rule is in /wall/how');

// 41 PLACES (operator, 23.11.: "41 spots, sorted by $BOBAI held; at the start everyone can, until the 41 are full").
// Ranked from the chain with real owners: agents #1..#42 (their owners hold no $BOBAI) beside #363709 (holds a lot).
{
  const word = (n) => BigInt(n).toString(16).padStart(64, '0'), ids = Array.from({ length: 42 }, (_, i) => String(i + 1));
  const owners = [];
  for (let k = 0; k < ids.length; k += 10) {
    const part = await fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ids.slice(k, k + 10).map((a, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: '0x6352211e' + word(a) }, 'latest'] }))) }).then((r) => r.json());
    owners.push(...part.sort((a, b) => a.id - b.id).map((x) => (x.result && x.result.length >= 66 ? '0x' + x.result.slice(26, 66).toLowerCase() : null)));
  }
  const big = await fetch('https://bsc-dataseed.binance.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: '0x6352211e' + word(363709) }, 'latest'] }) }).then((r) => r.json());
  const mk = (agent, signer, i) => ({ agent, name: '#' + agent, link, logo_sha256: h, logo_type: 'image/png', signer, role: 'owner', message: 'x', signature: '0x', since: new Date(Date.UTC(2026, 10, 23, 0, i)).toISOString(), at: '' });
  const usable = ids.map((a, i) => (owners[i] ? mk(a, owners[i], i) : null)).filter(Boolean);
  kv.set('wall:all', JSON.stringify([mk('363709', '0x' + big.result.slice(26, 66).toLowerCase(), 99), ...usable.slice(0, 3)]));
  const r3 = await rankWall(env), w4 = JSON.parse(kv.get('wall:rank'));
  say(r3.ok && w4.wall.length === 4 && w4.wall[0].agent === '363709' && w4.wall.slice(1).every((e) => e.bobai === 0), `while places are free, agents holding no $BOBAI get on too (${w4.wall.length} on, #363709 first)`, w4.wall.map((e) => [e.agent, e.bobai]));
  say(usable.length >= 3 && w4.wall[1]?.agent === usable[0]?.agent && w4.wall[3]?.agent === usable[2]?.agent, 'equal holdings: who came first stands first', { usable: usable.length, waiting: w4.waiting });
  kv.set('wall:all', JSON.stringify([...usable.slice(0, 41), mk('363709', '0x' + big.result.slice(26, 66).toLowerCase(), 99)]));
  await rankWall(env); const w5 = JSON.parse(kv.get('wall:rank'));
  say(usable.length >= 41 && w5.wall.length === 41 && w5.wall[0].agent === '363709' && w5.waiting.length === 1 && w5.waiting[0].agent === usable[40].agent && /all 41 places/.test(w5.waiting[0].why), `the wall full: 41 on, the holder takes the place of the one that came last (${w5.waiting[0]?.agent} waits)`, w5.waiting);
}

// THE SCRIPT FOR A BUILDER'S AI (23.11.): /wall/how starts with what to do, the 4 values and a script that parses
{
  const hw = (await call('GET', '/wall/how')).j, keys = Object.keys(hw);
  const tmp = path.resolve(import.meta.dirname, '.wall-script-check.mjs'); (await import('node:fs')).writeFileSync(tmp, hw.script || '');
  let parses = false; try { (await import('node:child_process')).execSync(`node --check "${tmp}"`); parses = true; } catch {} (await import('node:fs')).rmSync(tmp, { force: true });
  say(keys[0] === 'in_one_second' && ['AGENT_ID', 'PRIVATE_KEY', 'LINK', 'LOGO'].every((k) => hw.you_need?.[k]) && /signMessage/.test(hw.script) && /never sent/.test(hw.you_need.PRIVATE_KEY) && parses, '/wall/how: one-second summary first, the 4 values, a script that parses');
}

// EIP-712 (2026-11-23, operator: "make it work with the Binance Agentic Wallet"): that wallet signs typed data only
{
  const { typedFor } = await import('../worker-agent/sig712.js');
  kv.delete('wall:barred');   // the take-down test above barred #49467 in this same store
  const me = await call('GET', `/wall/message?agent=49467&link=${encodeURIComponent(link)}&logo_sha256=${h}`);
  say(me.j.or_eip712?.typed_data?.domain?.name === 'BOBAI Agent Wall' && me.j.or_eip712.typed_data.message.message === me.j.message && /baw sign-message preview --binanceChainId 56 --signType EIP712/.test(me.j.or_eip712.binance_agentic_wallet?.preview || ''), 'the message step offers the EIP-712 envelope and the ready baw command');
  const t = await owner.signTypedData(typedFor('wall', me.j.message)), tb = await owner.signTypedData(typedFor('brainbook', me.j.message));
  say((await call('POST', '/wall', { agent: 49467, link, date: me.j.date, signer: owner.address, signature: t, logo })).status === 401, 'an EIP-712 signature sent without sig_type: 401');
  say((await call('POST', '/wall', { agent: 49467, link, date: me.j.date, signer: owner.address, signature: tb, logo, sig_type: 'eip712' })).status === 401, 'an EIP-712 signature for the Brainbook\'s domain: 401 on the wall');
  const ok7 = await call('POST', '/wall', { agent: 49467, link, date: me.j.date, signer: owner.address, signature: t, logo, sig_type: 'eip712' });
  say(ok7.status === 201 && ok7.j.entry?.sig_type === 'eip712', 'signed as EIP-712 typed data by the owner: 201, kept as sig_type eip712', ok7);
}

// ONE WALLET COUNTS ONCE (A-Z 24.11., operator: share it): #363709 and #302258 have the same owner and agentWallet on the
// registry; on the wall each stood on the full holding of both. Two entries naming the same addresses: each gets half.
{
  const { agentIdentity } = await import('../worker-agent/board.js');
  const [x, y] = await Promise.all([agentIdentity('363709', process.env.BSC_RPC_KEYED_URL_2), agentIdentity('302258', process.env.BSC_RPC_KEYED_URL_2)]);
  const same = x && y && x.owner === y.owner && x.wallet === y.wallet;
  const balOf = async (a) => { const r = await fetch('https://bsc-dataseed.binance.org/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x245c386dcfed896f5c346107596141e5edcbffff', data: '0x70a08231' + a.slice(2).padStart(64, '0') }, 'latest'] }) }).then((r) => r.json()); return Number(BigInt(r.result) / 10n ** 14n) / 1e4; };
  const total = same ? (await balOf(x.owner)) + (x.wallet && x.wallet !== x.owner ? await balOf(x.wallet) : 0) : 0;
  kv.set('wall:all', JSON.stringify([{ agent: '363709', name: 'a', signer: x.owner, date: dayOf(), since: '2026-11-23T00:00:00Z' }, { agent: '302258', name: 'b', signer: y.owner, date: dayOf(), since: '2026-11-24T00:00:00Z' }]));
  const rr = await rankWall(env), rk = JSON.parse(kv.get('wall:rank') || '{}'), a = rk.wall?.find((e) => e.agent === '363709'), b = rk.wall?.find((e) => e.agent === '302258');
  say(same && rr.ok && a && b && Math.abs(a.bobai - b.bobai) < 0.01 && Math.abs(a.bobai + b.bobai - total) < 0.01 && a.shared?.length && b.shared?.length, `one wallet behind two agents is shared: ${a?.bobai} + ${b?.bobai} = ${total} $BOBAI, not twice`, { a, b, total });
}

if (process.argv.includes('--live')) {
  const g = await fetch('https://agent.brainonbnb.com/wall').then((r) => r.json()).catch(() => null);
  say(g && Array.isArray(g.wall) && g.max === 41, `live GET /wall (${g?.wall?.length} on the wall)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
