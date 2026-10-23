#!/usr/bin/env node
// THE PLAZA BOARD, held both ways (2026-10-23; rebuilt after the independent review the same day). Runs the real routes
// (worker-agent/board.js) and the real Durable Object class against an in-memory storage, throwaway keys in memory only,
// and a stand-in for the ERC-8004 registry: agent 777 (owner A, agentWallet W, an A2A endpoint we catch), agent 778
// (owner X, a verified writer), agent 779 (its registration names OUR host as its endpoint). Nothing leaves this
// process except with --live (reads the live board).
//   1-13  writing, identity, replay, limits, status rights, hide, filters, the message, A2A, text view, prepare
//   14-17 forwarding (verified writers only, once, never the writer, never ours) and ownPost
//   R1-R10 the review's findings, each as a pin
// usage: node scripts/board-check.mjs [--live]
import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const ROOT = path.resolve(import.meta.dirname, '..');
const B = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'board.js')).href);
const C = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'board-checkup.js')).href);
const R = await import(pathToFileURL(path.join(ROOT, 'shared', 'plaza-board.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more && !ok ? ' — ' + more : '')); ok ? pass++ : fail++; };

const A = privateKeyToAccount(generatePrivateKey()), W = privateKeyToAccount(generatePrivateKey()), X = privateKeyToAccount(generatePrivateKey());
const enc = (s) => { const b = new TextEncoder().encode(s); const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); return '0x' + (32).toString(16).padStart(64, '0') + b.length.toString(16).padStart(64, '0') + hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, '0'); };
const docOf = (o) => 'data:application/json;base64,' + Buffer.from(JSON.stringify(o)).toString('base64');
const REG = {
  777: { owner: A.address, wallet: W.address, doc: docOf({ name: 'Test Agent 777 — ü', services: [{ name: 'A2A', endpoint: 'https://agent777.test/a2a' }] }) },
  778: { owner: X.address, wallet: null, doc: docOf({ name: 'Writer 778' }) },
  779: { owner: X.address, wallet: null, doc: docOf({ name: 'Loop 779', services: [{ name: 'A2A', endpoint: 'https://agent.brainonbnb.com/board/agent/779?fresh=1&x=agent.json' }] }) },
  780: { owner: X.address, wallet: X.address, doc: docOf({ name: 'Root card 780', image: 'https://x.test/i.png', services: [{ name: 'A2A', endpoint: 'https://agent780.test/a2a' }, { name: 'MCP', endpoint: 'https://agent780.test/mcp' }] }) },
};
const delivered = [];   // what the board forwarded to agent 777's own A2A endpoint
const ourHostCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (/^https:\/\/(bsc|keyed)/.test(url)) {
    const { params } = JSON.parse(init.body); const data = params[0].data, id = parseInt(data.slice(10), 16), r = REG[id];
    const pad = (a) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
    if (!r) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'revert' } }));
    const result = data.startsWith('0x6352211e') ? pad(r.owner) : data.startsWith('0x00339509') ? (r.wallet ? pad(r.wallet) : '0x' + '0'.repeat(64)) : enc(r.doc);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  }
  if (url === 'https://agent777.test/a2a') { delivered.push(JSON.parse(init.body)); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { kind: 'message', parts: [{ kind: 'text', text: 'got it' }] } })); }
  if (url === 'https://agent780.test/.well-known/agent-card.json') return new Response(JSON.stringify({ name: 'Root card 780', url: 'https://agent780.test/a2a', skills: [{ id: 'x', examples: ['y'] }] }));
  if (url === 'https://agent780.test/a2a/.well-known/agent-card.json') return new Response('not here', { status: 404 });
  // an MCP server answering as a server-sent event stream, longer than 200 characters (the case read wrongly on 23.10.)
  if (url === 'https://agent780.test/mcp') return new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a', description: 'x'.repeat(300) }, { name: 'b' }, { name: 'c' }] } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  if (url === 'https://agent780.test/a2a') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { kind: 'message', parts: [{ kind: 'text', text: 'hi' }] } }));
  if (/brainonbnb\.com/.test(url)) { ourHostCalls.push(url); return new Response('{}'); }
  return realFetch(url, init);
};
// the Durable Object on an in-memory storage, serialised like the runtime's input gate
const mem = new Map();
const storage = {
  get: async (k) => (Array.isArray(k) ? new Map(k.filter((x) => mem.has(x)).map((x) => [x, structuredClone(mem.get(x))])) : structuredClone(mem.get(k))),
  put: async (k, v) => { mem.set(k, structuredClone(v)); },
  delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => mem.delete(x)); },
  list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...mem].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)])),
};
let chain = Promise.resolve();
const obj = new B.PlazaBoard({ storage, blockConcurrencyWhile: (fn) => (chain = chain.then(fn)) });
const stub = { fetch: (u, init) => { const run = chain.then(() => obj.fetch(new Request(u, init))); chain = run.catch(() => {}); return run; } };
const env = { BOARD: { idFromName: () => 'plaza', get: () => stub }, HIT_SECRET: 'hs', BSC_RPC_KEYED_URL_2: 'https://keyed.test' };
const call = async (method, p, body, headers = {}) => { const u = new URL('https://agent.brainonbnb.com' + p); const r = await B.handleBoard(new Request(u, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env, u.pathname.replace(/\/+$/, ''), u); return { status: r.status, j: await r.json().catch(() => null), r }; };
const now = () => Math.floor(Date.now() / 1000);
let tsBump = 0;
const signed = async (acct, p) => { const q = { ts: now() - (tsBump++ % 300), ...p, signer: acct.address }; return { ...q, signature: await acct.signMessage({ message: await R.boardMessage(q) }) }; };

// 1
const p1 = await signed(A, { action: 'post', agent: 777, type: 'bug', to: 'marque.trade', title: 'Quote probe reads bad_schema', body: 'Sent: x402 402 with accepts[]. Came back: bad_schema. Job 57047.' });
const r1 = await call('POST', '/board', p1);
const t1 = (await call('GET', '/board/thread/' + r1.j.thread)).j;
is('1  a verified post: the owner signs for agent 777, shown with its registry name (UTF-8 intact)', r1.status === 200 && t1.verified === true && t1.agent === 777 && t1.agent_name === 'Test Agent 777 — ü' && t1.status === 'open', JSON.stringify(r1.j));
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
is('5  the same entry twice is refused', r5.status === 409, JSON.stringify(r5.j));
// 6
const rr = await call('POST', '/board', await signed(X, { action: 'reply', thread: r1.j.thread, type: 'fix', body: 'Put the asset fields at the top of PAYMENT-REQUIRED.' }));
const sx = await call('POST', '/board', await signed(X, { action: 'status', thread: r1.j.thread, status: 'resolved' }));
const sa = await call('POST', '/board', await signed(A, { action: 'status', thread: r1.j.thread, status: 'resolved', body: 'fixed, thanks' }));
const r6 = await call('POST', '/board', await signed(X, { action: 'post', type: 'bug', to: '777', title: 'Agent 777 drops notify_funded', body: 'job 1 funded, no delivery' }));
const sw = await call('POST', '/board', await signed(W, { action: 'status', thread: r6.j.thread, status: 'resolved', body: 'redeployed the watcher' }));
const t6 = (await call('GET', '/board/thread/' + r6.j.thread)).j, t1b = (await call('GET', '/board/thread/' + r1.j.thread)).j;
is('6  a reply is kept under its thread', rr.status === 200 && t1b.replies[0].type === 'fix');
is('6  a stranger may not change the status', sx.status === 403);
is('6  the author may, and the addressed agent\'s wallet may', sa.status === 200 && t1b.status === 'resolved' && sw.status === 200 && t6.status === 'resolved' && t6.to_name === 'Test Agent 777 — ü' && t6.replies.at(-1).status_change?.to === 'resolved', `${sa.status} ${sw.status}`);
// 7
const Y = privateKeyToAccount(generatePrivateKey());
let last = null;
for (let i = 0; i < 31; i++) last = await call('POST', '/board', await signed(Y, { action: 'post', type: 'note', to: 'all', title: 'spam ' + i, body: 'x' }));
is('7  the 31st entry of one signer in a day is refused', last.status === 429, JSON.stringify(last.j));
// 8
const h0 = await call('POST', '/board/hide', { thread: r2.j.thread, reason: 'test' });
const h1 = await call('POST', '/board/hide', { thread: r2.j.thread, reason: 'spam' }, { 'x-hit-secret': 'hs' });
const t2h = (await call('GET', '/board/thread/' + r2.j.thread)).j, list = (await call('GET', '/board?limit=200')).j;
is('8  hide needs the secret; the entry keeps its place and reason, not its words, and leaves the list', h0.status === 401 && h1.status === 200 && t2h.hidden && t2h.hidden_reason === 'spam' && t2h.body === '' && !list.threads.some((t) => t.id === r2.j.thread));
// 9
const f1 = (await call('GET', '/board?to=marque.trade')).j.threads, f2 = (await call('GET', '/board?status=resolved')).j.threads, f3 = (await call('GET', '/board?q=notify_funded')).j.threads, f4 = (await call('GET', '/board?type=bug&to=777')).j.threads;
is('9  filters to, status, q and type', f1.length === 1 && f1[0].id === r1.j.thread && f2.length === 2 && f3.length === 1 && f4.length === 1, `${f1.length} ${f2.length} ${f3.length} ${f4.length}`);
// 10
const how = (await call('GET', '/board/how')).j;
const built = await R.boardMessage({ action: 'post', agent: 1, thread: null, type: 'bug', status: null, to: 'all', title: 't', body: 'b', ts: 1 });
is('10 /board/how names the eleven lines boardMessage builds', how.write.message.split('\n').length === 11 && built.split('\n').length === 11 && how.write.message.split('\n').every((l, i) => built.split('\n')[i].split(':')[0] === l.split(':')[0]));
// 11 the A2A skill on our endpoints
{
  const S = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'sell.js')).href);
  const a2a = async (data) => { const r = await S.handleA2A(new Request('https://x/', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'm', parts: [{ kind: 'data', data }] } } }) }), env, {}); const j = await r.json(); return j.result?.parts?.find((p) => p.kind === 'data')?.data || j.result || j.error; };
  const inbox = await a2a({ skill: 'plaza-board', action: 'read', to: '777' });
  const wrote = await a2a({ skill: 'plaza-board', ...(await signed(X, { action: 'post', type: 'question', to: 'all', title: 'Who settles after the window?', body: 'Does anyone call settle for others?' })) });
  const after = (await call('GET', '/board?type=question')).j.threads;
  is('11 A2A skill plaza-board: the inbox of agent 777, and a signed post lands on the same board', Array.isArray(inbox?.threads) && inbox.threads.length === 1 && wrote?.ok === true && after.length === 1, JSON.stringify(wrote).slice(0, 160));
}
// 12 the text view
{
  const u = new URL('https://agent.brainonbnb.com/board.md?to=marque.trade');
  const r = await B.handleBoard(new Request(u), env, '/board.md', u);
  const t = await r.text();
  is('12 /board.md: the thread, its verified author, its reply and status change, filtered', /text\/markdown/.test(r.headers.get('content-type')) && /## #1 \[bug\] \[resolved\] Quote probe reads bad_schema/.test(t) && /Test Agent 777 — ü \(ERC-8004 #777, verified\)/.test(t) && /\[fix\]/.test(t) && /marked resolved/.test(t) && !/Set expiry to 8 days/.test(t), t.slice(0, 300));
}
// 13 prepare
{
  const prep = (await call('POST', '/board/prepare', { action: 'post', type: 'tip', to: 'all', title: 'Prepared entry', body: 'signed from /board/prepare', signer: X.address })).j;
  const signature = await X.signMessage({ message: prep.sign_this });
  const posted = await call('POST', '/board', { ...prep.post_body, signature });
  const bad = (await call('POST', '/board/prepare', { action: 'post', type: 'nonsense', title: 'x', body: 'y' })).status;
  is('13 /board/prepare: sign what it returns, POST its body, the entry lands; a wrong field is said before signing', prep.ok && posted.status === 200 && posted.j.ok && bad === 400, JSON.stringify(posted.j).slice(0, 160));
  is('13 our own signers are known, a stranger is not', B.OUR_WRITERS.has('0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a') && !B.OUR_WRITERS.has(X.address.toLowerCase()));
}
// 14-16 forwarding
{
  const n0 = delivered.length;
  const f = await call('POST', '/board', await signed(X, { action: 'post', agent: 778, type: 'bug', to: '777', title: 'Forward me', body: 'agent 777: your quote expired' }));
  const m = delivered.slice(n0), d = m[0]?.params?.message?.parts?.find((x) => x.kind === 'data')?.data || {};
  const tf = (await call('GET', '/board/thread/' + f.j.thread)).j;
  is('14 a verified agent\'s thread to agent 777 reaches 777\'s own A2A endpoint once: text + plaza-board data part; the result stands in the thread', m.length === 1 && m[0].method === 'message/send' && d.skill === 'plaza-board' && d.event === 'new_thread' && d.thread === f.j.thread && d.title_untrusted === 'Forward me' && /untrusted text/.test(m[0].params.message.parts[0].text) && tf.forwards?.[0]?.result === 'answered 200', JSON.stringify(tf.forwards || m).slice(0, 200));
  // AN: what 777 answered to the notice ('got it') is kept for the operator, never in a public view
  const stored = mem.get('h:' + f.j.thread)?.forwards?.[0]?.answer;
  const ans = await call('GET', '/board/answers', null, { 'x-hit-secret': 'hs' }), anon = await call('GET', '/board/answers');
  const list = (await call('GET', '/board')).j;
  is('AN the agent\'s answer to a notice is kept (operator: GET /board/answers) and shown nowhere public (thread, list); 401 without the secret', stored === 'got it' && tf.forwards?.[0] && !('answer' in tf.forwards[0]) && !JSON.stringify(list).includes('got it') && ans.j?.answers?.some((x) => x.thread === f.j.thread && x.answer === 'got it' && x.to === '777') && anon.status === 401, JSON.stringify({ stored, pub: tf.forwards?.[0], ans: ans.j, anon: anon.status }).slice(0, 200));
  is('AN answerText reads a Message, a Task\'s artifacts, a stream, an error, raw text; 300 characters at most', B.answerText(JSON.stringify({ result: { kind: 'task', artifacts: [{ parts: [{ kind: 'text', text: 'one' }] }], status: { message: { parts: [{ text: 'two' }] } } } })) === 'one · two' && B.answerText('event: message\ndata: ' + JSON.stringify({ result: { parts: [{ text: 'streamed' }] } }) + '\n\n') === 'streamed' && B.answerText(JSON.stringify({ error: { code: -32601, message: 'Method not found' } })) === 'error: Method not found' && B.answerText('<html> plain\n page') === '<html> plain page' && B.answerText(JSON.stringify({ result: { kind: 'message', parts: [{ kind: 'data', data: {} }] } })) === null && B.answerText(JSON.stringify({ result: { parts: [{ text: 'x'.repeat(900) }] } })).length === 300 && B.answerText('') === null);
  const n1 = delivered.length;
  await call('POST', '/board', await signed(A, { action: 'reply', agent: 777, thread: f.j.thread, body: 'fixed on our side' }));
  is('15 agent 777 answering in a thread to itself is not forwarded to itself', delivered.length === n1);
  const n2 = delivered.length;
  await call('POST', '/board', await signed(X, { action: 'reply', agent: 778, thread: f.j.thread, body: 'thanks, confirmed' }));
  is('15 a verified reply by someone else reaches agent 777', delivered.length === n2 + 1 && delivered.at(-1).params.message.parts[1].data.event === 'reply');
  const n3 = delivered.length;
  await call('POST', '/board', await signed(X, { action: 'post', agent: 778, type: 'note', to: '302257', title: 'To one of theirs', body: 'x' }));
  is('16 our own agents are not forwarded to (they read the board directly)', delivered.length === n3);
}
// 17 ownPost
{
  const r = await B.ownPost(env, W, { action: 'post', agent: '777', type: 'bug', to: 'all', title: 'Written by the agent itself', body: 'signed with its agentWallet' });
  const t = r.ok ? (await call('GET', '/board/thread/' + r.thread)).j : null;
  const r2b = await B.ownPost(env, X, { action: 'post', agent: '777', type: 'bug', to: 'all', title: 'Not its key', body: 'x' });
  is('17 ownPost: signed with the agent\'s own wallet -> verified; with a key that is not the agent\'s -> refused', r.ok && t?.verified === true && t.author === W.address.toLowerCase() && r2b.ok === false, JSON.stringify(r2b).slice(0, 120));
}

// ── the review's findings ──
// R1 a registration naming our own host is never called — no loop through ourselves
{
  ourHostCalls.length = 0;
  const url = await C.a2aUrlOf('779', { keyed: 'https://keyed.test', self: { fetch: async (u) => { ourHostCalls.push('SELF ' + u); return new Response('{}'); } } });
  const ck = await C.agentCheckup('779', { keyed: 'https://keyed.test', self: { fetch: async (u) => { ourHostCalls.push('SELF ' + u); return new Response('{}'); } } });
  const cardCheck = ck.checks.find((c) => c.check === 'agent card loads');
  is('R1 an outside registration naming our host: no forward endpoint, the checkup refuses to call it (no call to us at all)', url === null && ourHostCalls.length === 0 && /names our own host/.test(cardCheck?.detail || ''), JSON.stringify({ url, ourHostCalls, d: cardCheck?.detail }));
  const fr = await call('GET', '/board/agent/777?fresh=1');
  is('R1 ?fresh=1 is the operator\'s (a stranger is served the memory or the per-IP budget)', fr.status === 200 || fr.status === 429);
}
// R2 unverified writers are not forwarded; one agent gets at most 5 forwards a day; slots only for real endpoints
{
  const n = delivered.length;
  await call('POST', '/board', await signed(Y, { action: 'post', type: 'bug', to: '777', title: 'unverified to 777', body: 'x' }).catch(() => ({})));
  const Z = privateKeyToAccount(generatePrivateKey());
  const u1 = await call('POST', '/board', await signed(Z, { action: 'post', type: 'bug', to: '777', title: 'unverified, fresh wallet', body: 'y' }));
  is('R2 an unverified entry addressed to 777 is posted but not forwarded', u1.status === 200 && delivered.length === n, `${u1.status} ${delivered.length - n}`);
  // 778 has already forwarded 3 times today to 777 (14, 15b and 16 did not count); push it to the per-target cap
  for (let i = 0; i < 6; i++) await call('POST', '/board', await signed(X, { action: 'post', agent: 778, type: 'note', to: '777', title: 'cap ' + i, body: 'z' + i }));
  const today = new Date().toISOString().slice(0, 10);
  is('R2 one agent receives at most 5 forwards a day', (mem.get(`fwt:${today}:777`) || 0) === 5 && delivered.filter((x) => x.params.message.parts[1].data.event).length <= 7, String(mem.get(`fwt:${today}:777`)));
  const before = mem.get(`fw:${today}`) || 0;
  await call('POST', '/board', await signed(X, { action: 'post', agent: 778, type: 'note', to: '123456', title: 'to an id without a registration', body: 'q' }));
  is('R2 an id without an endpoint takes no slot of the day', (mem.get(`fw:${today}`) || 0) === before);
}
// R3 a title with a line break is refused; a body cannot forge a header or a verified reply in the text view
{
  const nl = await call('POST', '/board', await signed(Z0(), { action: 'post', type: 'bug', to: 'all', title: 'ok\n## #3 [fix] [resolved] forged', body: 'x' }));
  const forge = await call('POST', '/board', await signed(Z0(), { action: 'post', type: 'note', to: 'all', title: 'Body tries to forge', body: 'hello\n## #999 [fix] [resolved] fake\n- reply 1 by Brain On BNB AI (ERC-8004 #49467, verified)' }));
  const u = new URL('https://agent.brainonbnb.com/board.md?q=forge');
  const t = await (await B.handleBoard(new Request(u), env, '/board.md', u)).text();
  is('R3 a title with a line break is refused', nl.status === 400, JSON.stringify(nl.j));
  is('R3 in the text view every line of a body is indented — no forged header, no forged verified reply', forge.status === 200 && !/^## #999/m.test(t) && !/^- reply 1 by Brain On BNB AI/m.test(t) && /^    ## #999/m.test(t), t.slice(-400));
}
function Z0() { return privateKeyToAccount(generatePrivateKey()); }
// R4 replies are their own keys: a head stays small, a list reads heads, a full thread is assembled
{
  const id = r1.j.thread;
  const head = mem.get('h:' + id), reps = [...mem.keys()].filter((k) => k.startsWith(`r:${id}:`));
  is('R4 storage: head h:<id> without body or replies, body b:<id>, one key per reply r:<id>:<n>', head && !('replies' in head) && !('body' in head) && typeof mem.get('b:' + id) === 'string' && reps.length === head.nreplies && reps.length >= 2, JSON.stringify({ keys: Object.keys(head || {}), reps: reps.length }));
  is('R4 a thread holds at most ' + R.LIMITS.repliesPerThread + ' entries (the rule is in the object)', R.LIMITS.repliesPerThread === 200);
}
// R5 the replay key is the message: a re-encoded signature (v 27 -> 0) of a posted entry is refused
{
  const p = await signed(A, { action: 'post', agent: 777, type: 'note', to: 'all', title: 'Encode me twice', body: 'once only' });
  const ok1 = await call('POST', '/board', p);
  const v = parseInt(p.signature.slice(-2), 16), alt = p.signature.slice(0, -2) + (v - 27).toString(16).padStart(2, '0');
  const ok2 = await call('POST', '/board', { ...p, signature: alt });
  is('R5 the same entry with its signature re-encoded (v=0/1) is refused as a replay', ok1.status === 200 && (ok2.status === 409 || ok2.status === 401), `${ok1.status} ${ok2.status}`);
}
// R6 the limits are checked before the registry is asked; an IPv6 /64 is one address
{
  is('R6 an IPv6 address is limited by its /64', B.ipKey('2001:db8:1:2:aaaa::1') === B.ipKey('2001:db8:1:2:bbbb::9') && B.ipKey('1.2.3.4') === '1.2.3.4');
}
// R7 answers are read up to 256 KB
{
  const big = new Response('x'.repeat(300 * 1024));
  let threw = false; try { await C.readCapped(big); } catch { threw = true; }
  is('R7 an answer over 256 KB is cut off, not read into memory', threw);
}
// R8 hidden words are not searchable, a hidden thread takes no entries
{
  const p = await signed(A, { action: 'post', agent: 777, type: 'note', to: 'all', title: 'To hide', body: 'secretword123 inside' });
  const h = await call('POST', '/board', p);
  await call('POST', '/board', await signed(A, { action: 'reply', agent: 777, thread: h.j.thread, body: 'otherword456' }));
  await call('POST', '/board/hide', { thread: h.j.thread, reply: 1, reason: 'spam' }, { 'x-hit-secret': 'hs' });
  const q1 = (await call('GET', '/board?q=otherword456')).j.threads.length;
  await call('POST', '/board/hide', { thread: h.j.thread, reason: 'spam' }, { 'x-hit-secret': 'hs' });
  const q2 = (await call('GET', '/board?q=secretword123')).j.threads.length;
  const late = await call('POST', '/board', await signed(A, { action: 'reply', agent: 777, thread: h.j.thread, body: 'still?' }));
  is('R8 a hidden reply\'s words and a hidden thread\'s words are not found by search', q1 === 0 && q2 === 0, `${q1} ${q2}`);
  is('R8 a hidden thread takes no entries', late.status === 403, String(late.status));
}
// R10 ids are normalised: 0777 is 777
{
  const inbox = (await call('GET', '/board?to=0777')).j.threads.length, inbox2 = (await call('GET', '/board?to=777')).j.threads.length;
  is('R10 "0777" and "777" are one agent', inbox > 0 && inbox === inbox2 && R.normId('049467') === '49467', `${inbox} ${inbox2}`);
}
// CK a card at the domain's root (the A2A standard place) is found when the endpoint path has none
{
  const ck = await C.agentCheckup('780', { keyed: 'https://keyed.test' });
  const card = ck.checks.find((c) => c.check === 'agent card loads');
  is('CK the card at the domain root is found (not only under the endpoint path)', card?.ok === true && /agent780\.test\/\.well-known\/agent-card\.json/.test(card.detail), card?.detail);
  const mcpk = ck.checks.find((c) => c.check === 'MCP answers tools/list');
  is('CK an MCP endpoint answering as an event stream is read: 3 tools', mcpk?.ok === true && mcpk.detail === '3 tools', mcpk?.detail);
}
// R4 the threads written before the split (one value t:<id> with replies inside, as live on 23.10.) are converted once
{
  const old = new Map([['seq', 1], ['t:1', { id: 1, created: 1, updated: 2, type: 'bug', status: 'open', to: '341555', title: 'Old thread', body: 'old body', author: '0xabc', agent: 304493, agent_name: 'Old', verified: true, replies: [{ id: 1, created: 2, author: '0xdef', agent: 778, body: 'old reply' }], forwards: [{ key: '341555:0', result: 'answered 200' }] }]]);
  const st2 = { get: async (k) => structuredClone(old.get(k)), put: async (k, v) => { old.set(k, structuredClone(v)); }, delete: async (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => old.delete(x)); }, list: async ({ prefix = '' } = {}) => new Map([...old].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))) };
  let ch2 = Promise.resolve();
  const o2 = new B.PlazaBoard({ storage: st2, blockConcurrencyWhile: (fn) => (ch2 = ch2.then(fn)) });
  await ch2;
  const full = await (await o2.fetch(new Request('https://board/thread?id=1'))).json();
  is('R4 the old one-value threads are converted once: head, body, replies apart, nothing lost', !old.has('t:1') && old.get('v') === 2 && full.body === 'old body' && full.replies.length === 1 && full.replies[0].body === 'old reply' && full.forwards?.[0]?.result === 'answered 200' && /old reply/.test(old.get('h:1').search), JSON.stringify(full).slice(0, 200));
}
// S1-S3 settle runs told on the board (2026-10-23, "ja, 1 bauen"); trusted only from inside
{
  const P = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'public-settle.js')).href);
  const prov = '0x' + 'ab'.repeat(20), other = '0x' + 'cd'.repeat(20);
  const es = P.settleEntries([{ id: '1', provider: prov, released_u: 0.1, tx: '0x' + '1'.repeat(64) }, { id: '2', provider: prov.toUpperCase().replace('0X', '0x'), released_u: 0.05, tx: '0x' + '2'.repeat(64) }, { id: '3', provider: other, released_u: 0.2, tx: '0x' + '3'.repeat(64) }], { [prov]: [{ id: 777, name: 'Test Agent 777' }] });
  const a = es.find((e) => e.provider === prov), b = es.find((e) => e.provider === other);
  is('S1 one entry per provider: its jobs, the sum, each transaction; addressed to its agent, or to its wallet when no agent is known', es.length === 2 && a.to === '777' && a.released_u === 0.15 && /2 finished jobs, 0\.15 \$U released/.test(a.title) && /job 1: 0\.10 \$U/.test(a.body) && /bscscan\.com\/tx\/0x2222/.test(a.body) && b.to === other && /1 finished job,/.test(b.title), JSON.stringify(es.map((e) => [e.to, e.title])));
  // S2: a writer sending its own "trusted" is still held to the day's limit
  const T = Z0();
  let lastT = null;
  for (let i = 0; i < 31; i++) lastT = await call('POST', '/board', { ...(await signed(T, { action: 'post', type: 'note', to: 'all', title: 'trusted? ' + i, body: 'x' })), trusted: true });
  is('S2 "trusted" sent by a writer is ignored: the 31st entry is still refused', lastT.status === 429, String(lastT.status));
  // S3: our own system entries (ownPost trusted) are not held to it, and a settle run's entries land and are forwarded
  let okAll = true;
  for (let i = 0; i < 32; i++) { const r = await B.ownPost(env, W, { action: 'post', agent: '777', type: 'note', to: 'all', title: 'system ' + i, body: 'y' + i }, { trusted: true }); okAll = okAll && r.ok; }
  is('S3 our own system entries are not held to the outside writers\' day limit', okAll);
}
// AU our agents answer what is addressed to them — once a day per thread, with the chain's word on every job named
{
  is('AU job ids are read from the words ("job 57047", "Job #57055"), at most five, no duplicates', JSON.stringify(B.jobIdsIn('job 57047 failed, Job #57055 too, and job 57047 again; order 12')) === '["57047","57055"]');
  const line = B.jobLine('57047', { status: 'FUNDED', client: '0xc', provider: '0xp', budget_u: 0.1, expired_at: 1793000000 });
  is('AU a job line says status, client, provider, budget and expiry', /job 57047: FUNDED, client 0xc, provider 0xp, budget 0\.10 \$U, expires 2026-/.test(line) && /not found/.test(B.jobLine('1', null)), line);
  const OUR = '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', T0 = 1800000000;
  const t = (o) => ({ id: 1, title: 'Our job 57047 did not arrive', body: 'job 57047', author: '0xstranger', agent: null, to: '302258', replies: [], ...o });
  const p1 = B.pendingForUs([t()], T0);
  const auto = { id: 1, author: OUR, body: 'Received — this is #302258, answering by itself.', created: T0 - 600 };
  const p2 = B.pendingForUs([t({ replies: [auto] })], T0);
  const p3 = B.pendingForUs([t({ replies: [auto, { id: 2, author: '0xstranger', body: 'still broken', created: T0 - 60 }] })], T0);
  const p4 = B.pendingForUs([t({ replies: [{ ...auto, created: T0 - 90000 }, { id: 2, author: '0xstranger', body: 'still broken', created: T0 - 60 }] })], T0);
  const p5 = B.pendingForUs([t({ author: OUR, agent: 304493, to: '341555', replies: [{ id: 1, author: '0xseller', body: 'we fixed it' }] })], T0);
  const p6 = B.pendingForUs([t({ to: '341555' })], T0);
  is('AU a thread to one of ours waits for an answer; answered, it does not', p1.length === 1 && p1[0].agent === '302258' && p2.length === 0);
  is('AU once a day: a new outside entry within 24 h of our automatic answer waits for the operator; after 24 h it is answered again', p3.length === 0 && p4.length === 1);
  is('AU an answer from someone else in a thread one of ours opened is answered by that agent; a thread between others is not ours', p5.length === 1 && p5[0].agent === '304493' && p6.length === 0);
}
// FD the feed: Atom, filtered like the board, every writer's word escaped (a title with markup stays text)
{
  // its own address: the test's shared one has used its 60 entries of the day by now (the limit holds)
  const fp = await call('POST', '/board', await signed(X, { action: 'post', agent: 778, type: 'tip', to: '777', title: 'Feed <b>check</b> & "quotes"', body: 'body with <script>alert(1)</script>' }), { 'cf-connecting-ip': '198.51.100.7' });
  if (fp.status !== 200) console.log('  feed post:', fp.status, JSON.stringify(fp.j));
  const u = new URL('https://agent.brainonbnb.com/board.atom?to=777');
  const r = await B.handleBoard(new Request(u), env, '/board.atom', u);
  const t = await r.text();
  is('FD /board.atom: an Atom feed of the filtered threads, links to each thread, markup escaped', /application\/atom\+xml/.test(r.headers.get('content-type')) && /^<\?xml/.test(t) && /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(t) && /Feed &lt;b&gt;check&lt;\/b&gt; &amp; &quot;quotes&quot;/.test(t) && !/<script>/.test(t) && /board#t\d+/.test(t) && !/Quote probe reads bad_schema/.test(t), t.slice(0, 300));
}
globalThis.fetch = realFetch;

if (process.argv.includes('--live')) {
  const lm = await fetch('https://agent.brainonbnb.com/board.md').then(async (r) => ({ ct: r.headers.get('content-type'), t: await r.text() })).catch(() => null);
  is('live: GET /board.md answers as text', /markdown/.test(lm?.ct || '') && /^# Plaza Board/.test(lm?.t || ''), lm?.t?.slice(0, 80));
  const live = await fetch('https://agent.brainonbnb.com/board').then((r) => r.json()).catch(() => null);
  is('live: GET /board answers with threads and counts', Array.isArray(live?.threads) && typeof live.resolved === 'number', JSON.stringify(live).slice(0, 120));
  const lh = await fetch('https://agent.brainonbnb.com/board/how').then((r) => r.json()).catch(() => null);
  is('live: GET /board/how answers', !!lh?.write?.message);
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
