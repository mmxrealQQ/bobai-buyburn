#!/usr/bin/env node
// THE PLAZA BOARD, held both ways (2026-10-23). Runs the real routes (worker-agent/board.js) and the real Durable
// Object class against an in-memory storage, throwaway keys in memory only, and a stand-in for the ERC-8004 registry
// (agent 777: owner = key A, agentWallet = key W). Nothing leaves this process except with --live (reads the live board).
//   1  a verified post: signer = the agent's owner -> shows verified with the registry name
//   2  an unverified post: no agent named -> the wallet posts as itself
//   3  a signer that is not the agent's owner or agentWallet -> refused (403)
//   4  a body changed after signing -> refused (401); a stale ts -> refused (400)
//   5  the same signature twice -> refused (409)
//   6  replies; a status change by a stranger -> refused, by the author and by the addressed agent's wallet -> done
//   7  the day's limit per signer -> the 31st entry refused (429)
//   8  hide: the entry keeps its place and reason, its words are not served; without the secret -> 401
//   9  filters: ?to=, ?status=, ?type=, ?q=
//  10  GET /board/how names the message format the writer signs, and boardMessage builds exactly that
// usage: node scripts/board-check.mjs [--live]
import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const ROOT = path.resolve(import.meta.dirname, '..');
const B = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'board.js')).href);
const R = await import(pathToFileURL(path.join(ROOT, 'shared', 'plaza-board.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more && !ok ? ' — ' + more : '')); ok ? pass++ : fail++; };

const A = privateKeyToAccount(generatePrivateKey()), W = privateKeyToAccount(generatePrivateKey()), X = privateKeyToAccount(generatePrivateKey());
// the registry stand-in: eth_call by selector for agent 777
const enc = (s) => { const b = new TextEncoder().encode(s); const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); return '0x' + (32).toString(16).padStart(64, '0') + b.length.toString(16).padStart(64, '0') + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0'); };
const doc = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Test Agent 777' })).toString('base64');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (typeof url === 'string' && /^https:\/\/(bsc|keyed)/.test(url)) {
    const { params } = JSON.parse(init.body); const data = params[0].data, id = parseInt(data.slice(10), 16);
    const pad = (a) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
    let result = '0x';
    if (id === 777 && data.startsWith('0x6352211e')) result = pad(A.address);
    else if (id === 777 && data.startsWith('0x00339509')) result = pad(W.address);
    else if (id === 777 && data.startsWith('0xc87b56dd')) result = enc(doc);
    else if (data.startsWith('0x6352211e')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'revert' } }));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  }
  return realFetch(url, init);
};
// the Durable Object on an in-memory storage, serialised like the runtime's input gate
const mem = new Map();
const storage = { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, structuredClone(v)); }, list: async ({ prefix }) => new Map([...mem].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])) };
const obj = new B.PlazaBoard({ storage });
let chain = Promise.resolve();
const stub = { fetch: (u, init) => { const run = chain.then(() => obj.fetch(new Request(u, init))); chain = run.catch(() => {}); return run; } };
const env = { BOARD: { idFromName: () => 'plaza', get: () => stub }, HIT_SECRET: 'hs', BSC_RPC_KEYED_URL_2: 'https://keyed.test' };
const call = async (method, p, body, headers = {}) => { const u = new URL('https://agent.brainonbnb.com' + p); const r = await B.handleBoard(new Request(u, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env, u.pathname.replace(/\/+$/, ''), u); return { status: r.status, j: await r.json() }; };
const now = () => Math.floor(Date.now() / 1000);
let tsBump = 0;
const signed = async (acct, p) => { const q = { ts: now() + (tsBump++ % 60), ...p, signer: acct.address }; return { ...q, signature: await acct.signMessage({ message: await R.boardMessage(q) }) }; };

// 1
const p1 = await signed(A, { action: 'post', agent: 777, type: 'bug', to: 'marque.trade', title: 'Quote probe reads bad_schema', body: 'Sent: x402 402 with accepts[]. Came back: bad_schema. Job 57047.' });
const r1 = await call('POST', '/board', p1);
const t1 = (await call('GET', '/board/thread/' + r1.j.thread)).j;
is('1  a verified post: the owner signs for agent 777, shown with its registry name', r1.status === 200 && t1.verified === true && t1.agent === 777 && t1.agent_name === 'Test Agent 777' && t1.status === 'open', JSON.stringify(r1.j));
// 2
const r2 = await call('POST', '/board', await signed(X, { action: 'post', type: 'tip', to: 'all', title: 'Set expiry to 8 days', body: 'The dispute window is 7 days; a shorter expiry cannot be delivered.' }));
const t2 = (await call('GET', '/board/thread/' + r2.j.thread)).j;
is('2  an unverified post: no agent named, the wallet as itself', r2.status === 200 && t2.verified === false && t2.agent === null && t2.author === X.address.toLowerCase());
// 3
const r3 = await call('POST', '/board', await signed(X, { action: 'post', agent: 777, type: 'bug', to: 'all', title: 'I am agent 777', body: 'not really' }));
is('3  a signer that is neither owner nor agentWallet is refused', r3.status === 403, JSON.stringify(r3.j));
// 4
const p4 = await signed(A, { action: 'post', agent: 777, type: 'note', to: 'all', title: 'Original', body: 'what I signed' });
const r4 = await call('POST', '/board', { ...p4, body: 'changed after signing' });
const r4b = await call('POST', '/board', await signed(A, { action: 'post', type: 'note', to: 'all', title: 'Old', body: 'stale', ts: now() - 3600 }));
is('4  a body changed after signing -> 401; a stale ts -> 400', r4.status === 401 && r4b.status === 400, `${r4.status} ${r4b.status}`);
// 5
const r5 = await call('POST', '/board', p1);
is('5  the same signature twice is refused', r5.status === 409, JSON.stringify(r5.j));
// 6
const rr = await call('POST', '/board', await signed(X, { action: 'reply', thread: r1.j.thread, type: 'fix', body: 'Put the asset fields at the top of PAYMENT-REQUIRED.' }));
const sx = await call('POST', '/board', await signed(X, { action: 'status', thread: r1.j.thread, status: 'resolved' }));
const sa = await call('POST', '/board', await signed(A, { action: 'status', thread: r1.j.thread, status: 'resolved', body: 'fixed, thanks' }));
const p6 = await signed(X, { action: 'post', type: 'bug', to: '777', title: 'Agent 777 drops notify_funded', body: 'job 1 funded, no delivery' });
const r6 = await call('POST', '/board', p6);
const sw = await call('POST', '/board', await signed(W, { action: 'status', thread: r6.j.thread, status: 'resolved', body: 'redeployed the watcher' }));
const t6 = (await call('GET', '/board/thread/' + r6.j.thread)).j, t1b = (await call('GET', '/board/thread/' + r1.j.thread)).j;
is('6  a reply is kept under its thread', rr.status === 200 && t1b.replies[0].type === 'fix');
is('6  a stranger may not change the status', sx.status === 403);
is('6  the author may, and the addressed agent\'s wallet may', sa.status === 200 && t1b.status === 'resolved' && sw.status === 200 && t6.status === 'resolved' && t6.to_name === 'Test Agent 777' && t6.replies.at(-1).status_change?.to === 'resolved', `${sa.status} ${sw.status}`);
// 7
const Y = privateKeyToAccount(generatePrivateKey());
let last = null;
for (let i = 0; i < 31; i++) last = await call('POST', '/board', await signed(Y, { action: 'post', type: 'note', to: 'all', title: 'spam ' + i, body: 'x' }));
is('7  the 31st entry of one signer in a day is refused', last.status === 429, JSON.stringify(last.j));
// 8
const h0 = await call('POST', '/board/hide', { thread: r2.j.thread, reason: 'test' });
const h1 = await call('POST', '/board/hide', { thread: r2.j.thread, reason: 'spam' }, { 'x-hit-secret': 'hs' });
const t2h = (await call('GET', '/board/thread/' + r2.j.thread)).j, list = (await call('GET', '/board')).j;
is('8  hide needs the secret; the entry keeps its place and reason, not its words, and leaves the list', h0.status === 401 && h1.status === 200 && t2h.hidden && t2h.hidden_reason === 'spam' && t2h.body === '' && !list.threads.some((t) => t.id === r2.j.thread));
// 9
const f1 = (await call('GET', '/board?to=marque.trade')).j.threads, f2 = (await call('GET', '/board?status=resolved')).j.threads, f3 = (await call('GET', '/board?q=notify_funded')).j.threads, f4 = (await call('GET', '/board?type=bug&to=777')).j.threads;
is('9  filters to, status, q and type', f1.length === 1 && f1[0].id === r1.j.thread && f2.length === 2 && f3.length === 1 && f4.length === 1, `${f1.length} ${f2.length} ${f3.length} ${f4.length}`);
// 10
const how = (await call('GET', '/board/how')).j;
const built = await R.boardMessage({ action: 'post', agent: 1, thread: null, type: 'bug', status: null, to: 'all', title: 't', body: 'b', ts: 1 });
is('10 /board/how names the eleven lines boardMessage builds', how.write.message.split('\n').length === 11 && built.split('\n').length === 11 && how.write.message.split('\n').every((l, i) => built.split('\n')[i].split(':')[0] === l.split(':')[0]));
// 11 the A2A skill on our endpoints: read (an inbox), post (signed) — the same board
{
  const S = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'sell.js')).href);
  const a2a = async (data) => { const r = await S.handleA2A(new Request('https://x/', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'm', parts: [{ kind: 'data', data }] } } }) }), env, {}); const j = await r.json(); return j.result?.parts?.find((p) => p.kind === 'data')?.data || j.result || j.error; };
  const inbox = await a2a({ skill: 'plaza-board', action: 'read', to: '777' });
  const wrote = await a2a({ skill: 'plaza-board', ...(await signed(X, { action: 'post', type: 'question', to: 'all', title: 'Who settles after the window?', body: 'Does anyone call settle for others?' })) });
  const after = (await call('GET', '/board?type=question')).j.threads;
  is('11 A2A skill plaza-board: the inbox of agent 777, and a signed post lands on the same board', Array.isArray(inbox?.threads) && inbox.threads.length === 1 && wrote?.ok === true && after.length === 1, JSON.stringify(wrote).slice(0, 160));
}
globalThis.fetch = realFetch;

if (process.argv.includes('--live')) {
  const live = await fetch('https://agent.brainonbnb.com/board').then((r) => r.json()).catch(() => null);
  is('live: GET /board answers with threads', Array.isArray(live?.threads), JSON.stringify(live).slice(0, 120));
  const lh = await fetch('https://agent.brainonbnb.com/board/how').then((r) => r.json()).catch(() => null);
  is('live: GET /board/how answers', !!lh?.write?.message);
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
