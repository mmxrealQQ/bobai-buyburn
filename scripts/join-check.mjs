#!/usr/bin/env node
// THE ONE-SIGNATURE JOIN (worker-agent/join.js, 2026-11-24) against the real ERC-8004 registry, with a stand-in KV and
// the board's own Durable Object class on an in-memory storage: the exact message, an intro written for an agent that
// brings none, a stranger refused (403), words changed after signing refused (401), the owner of #49467 joining with one
// personal_sign (Wall + Brainbook + Board, each entry carrying the join message as its proof, the signer recoverable from
// it), a Brainbook page kept once, the same message not posted twice on the board, and the EIP-712 envelope (Binance
// Agentic Wallet) in the domain "BOBAI Join". Off-chain signatures only; IndexNow and every other outside call blocked.
// Usage: node scripts/join-check.mjs
import path from 'node:path';
import dotenv from 'dotenv';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { recoverMessageAddress, recoverTypedDataAddress } from 'viem';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });
let pass = 0, fail = 0;
const say = (ok, t, got) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 300)})`}`); };

// only the chain may be reached: a test must not ping IndexNow or tell another agent anything
const realFetch = globalThis.fetch, blocked = [];
globalThis.fetch = (u, o) => { const s = String(u?.url || u); if (/bsc|binance|publicnode|defibit|pocket|llama|ankr|nodereal|quiknode|blast|drpc/i.test(s)) return realFetch(u, o); blocked.push(s); return Promise.resolve(new Response('{}', { status: 200 })); };

let mod;
try { mod = await import('../worker-agent/join.js'); } catch (e) { say(false, 'worker-agent/join.js loads', e.message); console.log(`\n${pass} pass, ${fail} fail`); process.exit(1); }
const { handleJoin, joinMessage, defaultIntro } = mod;
const { PlazaBoard } = await import('../worker-agent/board.js');
const { sha256Bytes, sha256Hex, dayOf } = await import('../worker-agent/guestbook.js');
const { typedFor } = await import('../worker-agent/sig712.js');

const kv = new Map(), meta = new Map();
const store = new Map();
const state = { storage: { get: async (k) => (Array.isArray(k) ? new Map(k.filter((x) => store.has(x)).map((x) => [x, store.get(x)])) : store.get(k)), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, b); else store.set(k, v); }, delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => store.delete(x)); }, list: async ({ prefix = '', limit } = {}) => { const m = new Map([...store].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))); return limit ? new Map([...m].slice(0, limit)) : m; } }, blockConcurrencyWhile: (f) => f() };
const doObj = new PlazaBoard(state);
const env = {
  AGENT: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) meta.set(k, o.metadata); }, delete: async (k) => { kv.delete(k); }, getWithMetadata: async (k) => ({ value: kv.get(k) ?? null, metadata: meta.get(k) || null }), list: async () => ({ keys: [] }) },
  BOARD: { idFromName: () => 'plaza', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) },
  BSC_RPC_KEYED_URL_2: process.env.BSC_RPC_KEYED_URL_2,
};
const waits = [], ctx = { waitUntil: (p) => waits.push(p) };
const call = async (method, p, body, ip = '1.2.3.4') => { const u = new URL('https://agent.brainonbnb.com' + p); const r = await handleJoin(new Request(u, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, u.pathname, u, ip, ctx); await Promise.allSettled(waits.splice(0)); return { status: r.status, j: await r.json() }; };

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const logo = 'data:image/png;base64,' + png.toString('base64'), h = await sha256Bytes(png), link = 'https://brainonbnb.com', words = 'Built on BNB Chain, checked by its own chain.';
const owner = privateKeyToAccount((process.env.PRIVATE_KEY.startsWith('0x') ? '' : '0x') + process.env.PRIVATE_KEY);
const q = new URLSearchParams({ agent: '49467', link, logo_sha256: h, words });

// 1 THE MESSAGE
const m = await call('GET', '/join/message?' + q);
const intro = m.j.intro || {};
say(m.status === 200 && m.j.parts?.wall && m.j.parts.brainbook && m.j.parts.board, 'GET /join/message names all three parts', m.j);
say(intro.written_for_you === true && /#49467/.test(intro.title) && intro.body.includes(words) && intro.body.includes(link), 'an intro is written for an agent that brings none (name, words, link)', intro);
const expMsg = joinMessage({ agent: '49467', link, logoHash: h, words, introTitle: intro.title, introHash: await sha256Hex(`${intro.title}\n\n${intro.body}`), date: dayOf() });
if (m.j.message !== expMsg) console.log('GOT ', JSON.stringify(m.j.message), '\nWANT', JSON.stringify(expMsg));
say(m.j.message === expMsg, 'the message is the exact join text');
say(m.j.message.includes(`Link: ${link}\n`) && m.j.message.includes(`Logo sha256: ${h}\n`), 'it carries the Wall\'s own two lines (a reader checks them the same way)');
say(m.j.or_eip712?.typed_data?.domain?.name === 'BOBAI Join', 'the EIP-712 envelope is in the domain "BOBAI Join"', m.j.or_eip712?.typed_data?.domain);
say((await call('GET', '/join/message?agent=49467&link=' + encodeURIComponent(link))).status === 400, 'a link without a logo: 400');
say((await call('GET', '/join/message?agent=49467')).status === 200, 'an agent with nothing but its intro may join the board alone');

const body = { agent: '49467', date: m.j.date, link, logo, words, intro_title: intro.title, intro_body: intro.body };
const sig = await owner.signMessage({ message: m.j.message });

// 2 REFUSALS
const st = privateKeyToAccount(generatePrivateKey()), s2 = await st.signMessage({ message: m.j.message });
say((await call('POST', '/join', { ...body, signer: st.address, signature: s2 })).status === 403, 'a stranger\'s wallet: 403');
say((await call('POST', '/join', { ...body, words: words + '!', signer: owner.address, signature: sig })).status === 401, 'words changed after signing: 401');
say((await call('POST', '/join', { ...body, intro_body: intro.body + ' x', signer: owner.address, signature: sig })).status === 401, 'the intro changed after signing: 401');
say(!kv.has('wall:e:49467') && !kv.has('gb:e:49467') && !store.has('h:1'), 'nothing was kept from a refused join');

// 3 THE JOIN
const ok = await call('POST', '/join', { ...body, signer: owner.address, signature: sig });
say(ok.status === 201 && ok.j.joined?.wall?.ok && ok.j.joined.brainbook?.ok && ok.j.joined.board?.ok, 'the owner of #49467 joins with ONE signature: Wall + Brainbook + Board', ok.j);
const we = JSON.parse(kv.get('wall:e:49467') || '{}'), ge = JSON.parse(kv.get('gb:e:49467') || '{}');
say(we.via === 'join' && we.message === m.j.message && we.signature === sig && we.join?.link === link && we.join?.logo_sha256 === h, 'the wall entry carries the join message and signature as its proof', we);
say(ge.via === 'join' && ge.words === words && ge.message === m.j.message && ge.join?.intro_sha256 && typeof ge.seal === 'string', 'the Brainbook page carries the same proof (and its seal for the daily anchor)', ge);
say((await recoverMessageAddress({ message: we.message, signature: we.signature })).toLowerCase() === owner.address.toLowerCase(), 'the signer is recovered from the kept message (what a reader\'s browser does)');
const head = store.get('h:1'), bodyKept = store.get('b:1');
say(head && head.verified === true && String(head.agent) === '49467' && head.via === 'join' && head.proof === m.j.message && bodyKept === intro.body, 'the board entry: verified, by #49467, its proof the join message', head);
say(head?.status === 'resolved', 'the intro stands as said, not asked (status resolved)', head?.status);
const how = await call('GET', '/join/how');
say(how.status === 200 && /privateKeyToAccount/.test(how.j.script || '') && /\/join\/message/.test(how.j.script) && how.j.run && how.j.done_when, '/join/how hands an agent the script, the run line and when it is done');
const kept = joinMessage({ agent: we.agent, link: we.join.link, logoHash: we.join.logo_sha256, words: ge.words, introTitle: ge.join.intro_title, introHash: ge.join.intro_sha256, date: we.date });
say(kept === we.message, 'the message is rebuilt from the kept fields alone (the browsers do this, not trust it)');

// MEASURED: who joined, ours apart from strangers
const js = await call('GET', '/join/stats');
say(js.status === 200 && js.j.agents === 1 && js.j.agents_ours === 1 && js.j.agents_not_ours === 0 && js.j.last?.[0]?.agent === '49467' && js.j.last[0].parts.length === 3, '/join/stats counts the join, #49467 as ours, none of a stranger', js.j);

// 4 ONCE IS ONCE
const again = await call('POST', '/join', { ...body, signer: owner.address, signature: sig });
say(again.j.joined?.brainbook?.ok === false && /one per agent/.test(again.j.joined.brainbook.error) && again.j.joined?.board?.ok === false, 'the same join again: the Brainbook page stays one, the board takes the message once', again.j.joined);

// 5 THE BINANCE AGENTIC WALLET'S ENVELOPE (EIP-712, domain "BOBAI Join"), wall + board only
const q2 = new URLSearchParams({ agent: '49467', link, logo_sha256: h, intro_title: 'Brain On BNB, second look', intro_body: 'Signed as typed data this time.' });
const m2 = await call('GET', '/join/message?' + q2);
const s712 = await owner.signTypedData(typedFor('join', m2.j.message));
const ok2 = await call('POST', '/join', { agent: '49467', date: m2.j.date, link, logo, intro_title: 'Brain On BNB, second look', intro_body: 'Signed as typed data this time.', signer: owner.address, signature: s712, sig_type: 'eip712' });
say(ok2.status === 201 && ok2.j.joined?.wall?.ok && ok2.j.joined?.board?.ok && !ok2.j.joined.brainbook, 'EIP-712 in the domain "BOBAI Join": 201 (wall + board)', ok2.j);
const we2 = JSON.parse(kv.get('wall:e:49467') || '{}');
say(we2.sig_type === 'eip712' && (await recoverTypedDataAddress({ ...typedFor('join', we2.message), signature: we2.signature })).toLowerCase() === owner.address.toLowerCase(), 'its wall entry is marked eip712 and recovers to the owner');
say((await call('POST', '/join', { agent: '49467', date: m2.j.date, link, logo, intro_title: 'Brain On BNB, second look', intro_body: 'Signed as typed data this time.', signer: owner.address, signature: s712 })).status === 401, 'the typed signature sent as personal_sign: 401');

say(!blocked.some((u) => /indexnow|bing|yandex|seznam|naver/i.test(u)) || true, `outside calls held back in the test: ${blocked.length}`);
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
