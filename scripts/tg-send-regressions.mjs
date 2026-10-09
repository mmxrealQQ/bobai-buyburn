// TG SEND REGRESSIONS (2026-10-07): the bot's Telegram calls, run against the real worker code with a stand-in fetch.
// Pins, both ways (each FAILs on the code before 2026-10-07):
//   1  a send Telegram refuses for a lasting cause (kicked) is written down (KV last_send_error, lasting: true)
//   2  /health serves that record (it said "can post" from the token alone)
//   3  Telegram's HTML 5xx page does not throw out of the caller (/broadcast answers, it does not crash)
//   4  a passing refusal (429) is written down as not lasting
//   5  every outbound call of the bot carries a deadline (tg, rpcCall, tryGetLogs: AbortSignal.timeout)
//   6  a balance read that fails is unknown, never 0: the whale alert reads balances strictly
//   7  the morning health check is red on a lasting refusal under a day old, not on a passing one
// usage: node scripts/tg-send-regressions.mjs      offline; self-tests.mjs runs it (a *-regressions file)
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const worker = await import(pathToFileURL(path.join(ROOT, 'worker-tg-bot', 'index.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'ok    ' : 'FAIL  ') + what + (ok || !more ? '' : ' — ' + more)); ok ? pass++ : fail++; };

const store = new Map();
const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [] }) };
const env = { KV, BOT_TOKEN: 'x', TG_INTERNAL_CHAT_ID: '-1', BROADCAST_SECRET: 's' };
const real = { fetch: globalThis.fetch, error: console.error, log: console.log };
const quiet = () => Object.assign(console, { error: () => {}, log: () => {} });
const loud = () => Object.assign(console, { error: real.error, log: real.log });
const broadcast = () => worker.default.fetch(new Request('https://tg/broadcast', { method: 'POST', headers: { 'x-broadcast-secret': 's', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello', target: 'internal' }) }), env, { waitUntil() {} });
const telegramSays = (status, body, type = 'application/json') => { globalThis.fetch = async (u) => String(u).includes('api.telegram.org') ? new Response(body, { status, headers: { 'content-type': type } }) : new Response('{}', { status: 503 }); };

try {
  quiet();
  telegramSays(403, JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' }));
  await broadcast().catch(() => null);
  const rec = store.get('last_send_error') ? JSON.parse(store.get('last_send_error')) : null;
  loud(); is('1 a lasting refusal (kicked) is written down', !!rec && rec.lasting === true && /kicked/.test(rec.description), JSON.stringify(rec)); quiet();
  // offline (2026-10-09): /health now reads the dead balance; the chain answers 503 here (a live socket left open at
  // exit trips a libuv assertion on Windows)
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  const h = await (await worker.default.fetch(new Request('https://tg/health'), env, { waitUntil() {} })).json();
  loud(); is('2 /health serves the refusal', !!h.last_send_error && h.last_send_error.lasting === true, JSON.stringify(h.last_send_error)); quiet();
  telegramSays(502, '<html><body>Bad Gateway</body></html>', 'text/html');
  let threw = null; const r = await broadcast().catch((e) => { threw = e; return null; });
  loud(); is('3 an HTML 5xx page from Telegram does not throw out of the caller', !threw && !!r, threw ? String(threw.message) : ''); quiet();
  telegramSays(429, JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 5' }));
  await broadcast().catch(() => null);
  const rec2 = JSON.parse(store.get('last_send_error') || 'null');
  loud(); is('4 a passing refusal (429) is written down as not lasting', !!rec2 && rec2.code === 429 && rec2.lasting === false, JSON.stringify(rec2)); quiet();
  // 2026-10-09 review: a user who blocked the bot refuses its private reply with "bot was blocked" — his choice, not a
  // bot that cannot post; it must not turn the morning check red (only the group, operator and internal chat count)
  store.delete('last_send_error');
  telegramSays(403, JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
  await worker.default.fetch(new Request('https://tg/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1, text: '/help', chat: { id: 5550001, type: 'private' }, from: { id: 5550001, is_bot: false, first_name: 'x' } } }) }), env, { waitUntil() {} }).catch(() => null);
  const rec3 = JSON.parse(store.get('last_send_error') || 'null');
  loud(); is('8 a stranger who blocked the bot is no lasting refusal', !(rec3 && rec3.lasting), JSON.stringify(rec3));
} finally { globalThis.fetch = real.fetch; loud(); }

const src = fs.readFileSync(path.join(ROOT, 'worker-tg-bot', 'index.js'), 'utf8');
const body = (name) => { const i = src.indexOf(`async function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); };
is('5 tg, rpcCall and tryGetLogs carry a deadline', ['tg', 'rpcCall', 'tryGetLogs'].every((n) => /AbortSignal\.timeout\(/.test(body(n))), ['tg', 'rpcCall', 'tryGetLogs'].filter((n) => !/AbortSignal\.timeout\(/.test(body(n))).join(', '));
const cached = src.slice(src.indexOf('const getBalCached = async'), src.indexOf('const isSpecial = (a)'));
const exw = src.slice(src.indexOf('// EX_WHALE: tracked wallet crossed'), src.indexOf('// EX_WHALE: tracked wallet crossed') + 600);
is('6 the whale alert reads balances strictly (a failed read is unknown, never 0)', /getBobaiBalanceStrict\(/.test(cached) && !/getBobaiBalance\(/.test(cached) && /getBobaiBalanceStrict\(/.test(exw));

// 7: the morning health check's rule for the bot, read from the module and run on three records
const hsrc = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'health-checks.mjs'), 'utf8');
// the end searched from the start (2026-10-09): the hourly light look now names 'telegram bot can post' earlier in the file
const seAt = hsrc.indexOf("const se = j.last_send_error");
const line = hsrc.slice(seAt, hsrc.indexOf("'telegram bot can post'", seAt) + 400);
// the rule itself, lifted from the module and run on three records
const rule = (j) => { const se = j.last_send_error, seAge = se && se.at ? (Date.now() - Date.parse(se.at)) / 36e5 : null; return j.channel_configured === true && !(!!(se && se.lasting && seAge != null && seAge < 24)); };
const now = new Date().toISOString(), old = new Date(Date.now() - 30 * 36e5).toISOString();
is('7 the morning check: red on a lasting refusal under a day old, green on a passing one or an old one',
  /se\.lasting/.test(line) && /seAge < 24/.test(line) && /!seRed/.test(line)
  && rule({ channel_configured: true, last_send_error: { at: now, lasting: true } }) === false
  && rule({ channel_configured: true, last_send_error: { at: now, lasting: false } }) === true
  && rule({ channel_configured: true, last_send_error: { at: old, lasting: true } }) === true);

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
