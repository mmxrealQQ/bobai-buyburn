#!/usr/bin/env node
// The Brain Guestbook (worker-agent/guestbook.js), end to end against the real ERC-8004 registry with a stand-in KV:
// the words rules, the message, a real signature by #49467's owner taken, a stranger's signature refused (403), a bad
// signature refused (401), the second entry of the same agent refused (409), the day's limit. Off-chain signatures only.
// Usage: node scripts/guestbook-check.mjs [--live]   (--live: also GET the live routes, read-only)
import path from 'node:path';
import dotenv from 'dotenv';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { handleGuestbook, cleanWords, guestbookMessage, dateOk, dayOf, normAgent } from '../worker-agent/guestbook.js';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });
let pass = 0, fail = 0;
const say = (ok, t, got) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 200)})`}`); };

say(cleanWords('  hello\n\tworld  ').words === 'hello world', 'words: whitespace folded to one line');
say(!!cleanWords('hi').error, 'words: under 3 characters refused');
say(!!cleanWords('x'.repeat(281)).error, 'words: over 280 refused');
say(cleanWords('read https://brainonbnb.com/board now').words === 'read https://brainonbnb.com/board now', 'words: links allowed (operator 22.11.)');
say(cleanWords('gm from the chain 🧠').words === 'gm from the chain 🧠', 'words: emoji kept');
say(normAgent('049467') === '49467' && normAgent('abc') === null && normAgent('1e5') === null, 'agent id normalised, junk refused');
const now = Date.parse('2026-11-22T00:00:30Z');
say(dateOk('2026-11-22', now) && dateOk('2026-11-21', now) && !dateOk('2026-11-20', now) && !dateOk('2026-11-23', now), 'date: today or yesterday only');

const kv = new Map();
const meta = new Map();
const env = { AGENT: { get: async (k) => kv.get(k) ?? null, put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) meta.set(k, o.metadata); }, getWithMetadata: async (k) => (kv.has(k) ? { value: kv.get(k), metadata: meta.get(k) || null } : { value: null, metadata: null }) }, BSC_RPC_KEYED_URL_2: process.env.BSC_RPC_KEYED_URL_2 };
const call = async (method, p, body, ip = '1.2.3.4') => {
  const url = new URL('https://agent.brainonbnb.com' + p);
  const req = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const r = await handleGuestbook(req, env, url.pathname, url, ip);
  return { status: r.status, j: await r.json() };
};
const owner = privateKeyToAccount((process.env.PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.PRIVATE_KEY);
const words = 'Test line from the check, never stored live.';
const m = await call('GET', `/guestbook/message?agent=49467&words=${encodeURIComponent(words)}`);
say(m.status === 200 && m.j.message === guestbookMessage({ agent: '49467', words, date: dayOf() }), 'GET /guestbook/message gives the exact message');
const sig = await owner.signMessage({ message: m.j.message });
const stranger = privateKeyToAccount(generatePrivateKey());
const s2 = await stranger.signMessage({ message: m.j.message });
const r403 = await call('POST', '/guestbook', { agent: 49467, words, date: m.j.date, signer: stranger.address, signature: s2 });
say(r403.status === 403, 'a wallet that is neither owner nor agentWallet: 403', r403);
const r401 = await call('POST', '/guestbook', { agent: 49467, words: words + '!', date: m.j.date, signer: owner.address, signature: sig });
say(r401.status === 401, 'words changed after signing: 401', r401.status);
const ok = await call('POST', '/guestbook', { agent: 49467, words, date: m.j.date, signer: owner.address, signature: sig });
say(ok.status === 201 && ok.j.entry?.role === 'owner' && /^[0-9a-f]{64}$/.test(ok.j.entry?.seal || '') && ok.j.entry?.name, `the owner of #49467 signs: 201, role owner, seal, name "${ok.j.entry?.name}"`, ok);
const again = await call('POST', '/guestbook', { agent: 49467, words, date: m.j.date, signer: owner.address, signature: sig });
say(again.status === 409 && again.j.entry?.words === words, 'the same agent again: 409 with its first entry', again.status);
const list = await call('GET', '/guestbook');
say(list.j.count === 1 && list.j.entries[0].agent === '49467', 'GET /guestbook lists it');
let lim = 0; for (let i = 0; i < 12; i++) { const r = await call('POST', '/guestbook', { agent: 49467, words, date: m.j.date, signer: owner.address, signature: sig }, '9.9.9.9'); if (r.status === 429) lim++; }
say(lim > 0, 'the day\'s limit per address answers 429');

// THE LIVING MARK: the code's hash is in the signed message; changed code is refused; served as text with a sandbox CSP
{
  kv.clear();
  const code = '<canvas id=c></canvas><script>/* mark */document.body.style.background="#000"</script>';
  const { sha256Hex } = await import('../worker-agent/guestbook.js');
  const h = await sha256Hex(code);
  const mm = await call('GET', `/guestbook/message?agent=49467&words=${encodeURIComponent(words)}&code_sha256=${h}`);
  say(mm.status === 200 && mm.j.message.includes(`My living mark, sha256: ${h}\n`), 'GET /guestbook/message with code_sha256 puts the hash in the message');
  const sg = await owner.signMessage({ message: mm.j.message });
  const tampered = await call('POST', '/guestbook', { agent: 49467, words, date: mm.j.date, signer: owner.address, signature: sg, code: code + ' ' }, '5.5.5.5');
  say(tampered.status === 401, 'code changed after signing: 401', tampered.status);
  const big = await call('POST', '/guestbook', { agent: 49467, words, date: mm.j.date, signer: owner.address, signature: sg, code: 'x'.repeat(12001) }, '5.5.5.5');
  say(big.status === 400, 'code over 12,000 bytes: 400', big.status);
  const okc = await call('POST', '/guestbook', { agent: 49467, words, date: mm.j.date, signer: owner.address, signature: sg, code }, '5.5.5.5');
  say(okc.status === 201 && okc.j.entry?.code_sha256 === h && /\/guestbook\/code\/49467$/.test(okc.j.entry?.code_url || ''), 'signed with its code: 201, code_sha256 + code_url in the entry', okc.status);
  const url = new URL('https://agent.brainonbnb.com/guestbook/code/49467');
  const r = await handleGuestbook(new Request(url), env, url.pathname, url, '1.1.1.1');
  const body = await r.text();
  say(body === code && /text\/plain/.test(r.headers.get('content-type')) && /sandbox/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-content-type-options') === 'nosniff', 'GET /guestbook/code/<id>: the exact bytes, as text, sandbox CSP, nosniff');
  const plain = await call('GET', '/guestbook');
  say(plain.j.entries[0].code === undefined, 'the list carries the hash and the address, not the code');
}

// A PICTURE: its hash signed; SVG refused even when named png; a swapped picture refused; served as bytes with a sandbox CSP
{
  kv.clear(); meta.clear();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  const { sha256Bytes, cleanImage } = await import('../worker-agent/guestbook.js');
  const ih = await sha256Bytes(png);
  say(!!cleanImage('data:image/png;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')).error, 'an SVG named image/png is refused (read from its bytes)');
  say(!!cleanImage('data:image/png;base64,' + Buffer.alloc(310 * 1024, 1).toString('base64')).error, 'a picture over 300 KB is refused');
  const mi = await call('GET', `/guestbook/message?agent=49467&words=${encodeURIComponent(words)}&image_sha256=${ih}`);
  say(mi.status === 200 && mi.j.message.includes(`My picture, sha256: ${ih}\n`), 'GET /guestbook/message with image_sha256 puts the hash in the message');
  const si = await owner.signMessage({ message: mi.j.message });
  const other = 'data:image/png;base64,' + Buffer.concat([png, Buffer.from([0])]).toString('base64');
  const sw = await call('POST', '/guestbook', { agent: 49467, words, date: mi.j.date, signer: owner.address, signature: si, image: other }, '6.6.6.6');
  say(sw.status === 401, 'a different picture than the signed one: 401', sw.status);
  const oi = await call('POST', '/guestbook', { agent: 49467, words, date: mi.j.date, signer: owner.address, signature: si, image: dataUrl }, '6.6.6.6');
  say(oi.status === 201 && oi.j.entry?.image_sha256 === ih && oi.j.entry?.image_type === 'image/png', 'signed with its picture: 201, image_sha256 + type in the entry', oi.status);
  const url = new URL('https://agent.brainonbnb.com/guestbook/image/49467');
  const r = await handleGuestbook(new Request(url), env, url.pathname, url, '1.1.1.1');
  const got = Buffer.from(await r.arrayBuffer());
  say(got.equals(png) && r.headers.get('content-type') === 'image/png' && /sandbox/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-content-type-options') === 'nosniff', 'GET /guestbook/image/<id>: the exact bytes, image/png, sandbox CSP, nosniff');
}

// THE ANCHOR (brainbook-anchor.js): the Merkle root as documented, the memo readable, and a run that stops before it
// sends anything when the wallet has no gas
{
  const A = await import('../worker-agent/brainbook-anchor.js');
  const h = (x) => A.sha256Text(x);
  const l = [await h('a'), await h('b'), await h('c')];
  const want = await h((await h(l[0] + l[1])) + l[2]);
  say((await A.merkleRoot(l)) === want, 'merkle root: sha256(left hex + right hex), an odd last one goes up');
  say((await A.merkleRoot([l[0]])) === l[0] && (await A.merkleRoot([])) === null, 'merkle root of one page is its leaf, of none is null');
  const m = A.memoOf(1, 3, want, '49467');
  say(m.startsWith('BRAINBOOK · ANCHOR #1 · 3 pages · merkle sha256 ' + want), 'the memo reads the anchor, the count and the root');
  const ord = A.inOrder([{ at: '2026-11-22T06:00:00Z', agent: '2' }, { at: '2026-11-22T05:00:00Z', agent: '1' }]);
  say(ord[0].agent === '1', 'pages in signing order');
  if (process.argv.includes('--anchor-dry')) {
    const store = new Map([['gb:all', JSON.stringify([{ agent: '1', at: '2026-11-22T05:00:00Z', message: 'm', signature: '0xAB' }])]]);
    const fenv = { AGENT: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, BOARD_AGENT_PRIVATE_KEY: process.env.BOARD_AGENT_PRIVATE_KEY };
    const r = await A.runBrainbookAnchor(fenv, { force: true });
    console.log('      anchor run against the real chain:', JSON.stringify(r).slice(0, 220));
    say(r.ok === false ? /gas|BNB/.test(r.error) : !!r.anchor?.tx, r.ok ? `anchored: ${r.anchor.tx}` : 'no gas: the run stopped before sending');
  }
}

if (process.argv.includes('--live')) {
  const g = await fetch('https://agent.brainonbnb.com/guestbook').then((r) => r.json()).catch(() => null);
  say(g && Array.isArray(g.entries) && g.how?.steps?.length >= 3, `live GET /guestbook (${g?.count} entries)`);
  const lm = await fetch('https://agent.brainonbnb.com/guestbook/message?agent=49467&words=hello%20there').then((r) => r.json()).catch(() => null);
  say(lm?.message?.startsWith('Brain Guestbook on BNB Chain'), 'live GET /guestbook/message');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
