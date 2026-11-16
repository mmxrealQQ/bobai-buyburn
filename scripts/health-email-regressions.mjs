// Pins Liste B "Health zweiter Kanal" (2026-11-16): the e-mail way (Resend, from health@mail.brainonbnb.ai) is there
// for the hourly look AND now the morning report when the bot cannot post; POST /email-test tries it on demand.
// Offline: Resend is a stand-in, nothing is sent.   node scripts/health-email-regressions.mjs
import { readFileSync } from 'node:fs';
import worker, { emailFallback } from '../worker-health/index.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

// emailFallback
ok('no secrets: not configured, nothing asked', (await emailFallback({}, 'x', async () => { throw new Error('must not be called'); })) === 'not configured');
let seen = null;
const stand = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return { ok: true, status: 200 }; };
const env = { RESEND_API_KEY: 're_test', ALERT_EMAIL_TO: 'op@example.org', BROADCAST_SECRET: 's3cret' };
ok('with secrets: sent through Resend', (await emailFallback(env, '🚨 <b>Health</b> &amp; more\nline two', stand)) === 'sent' && seen.url === 'https://api.resend.com/emails' && seen.init.headers.authorization === 'Bearer re_test');
ok('plain text, the first line the subject, from the verified sender domain', seen.body.subject === '🚨 Health & more' && seen.body.text === '🚨 Health & more\nline two' && seen.body.from.endsWith('@mail.brainonbnb.ai>') && seen.body.to[0] === 'op@example.org');
ok('refused by Resend: said with its status', (await emailFallback(env, 'x', async () => ({ ok: false, status: 403 }))) === 'refused (403)');

// /email-test
const call = async (headers, e = env) => { const real = globalThis.fetch; globalThis.fetch = stand; try { return await worker.fetch(new Request('https://h/email-test', { method: 'POST', headers }), e); } finally { globalThis.fetch = real; } };
let r = await call({});
ok('/email-test without the secret: forbidden', r.status === 403);
seen = null; r = await call({ 'x-broadcast-secret': 's3cret' });
const body = await r.json();
ok('/email-test with it: one test message, the answer says sent', body.email === 'sent' && /e-mail test/.test(seen?.body?.subject || ''), JSON.stringify(body));
r = await call({ 'x-broadcast-secret': 's3cret' }, { BROADCAST_SECRET: 's3cret' });
ok('/email-test before the secrets are set: not configured', (await r.json()).email === 'not configured');

// the morning report
const src = readFileSync(new URL('../worker-health/index.js', import.meta.url), 'utf8');
const morning = src.slice(src.indexOf('async function morningRun'), src.indexOf('// Pure: the second look'));
ok('the morning report e-mails when Telegram refused it twice', /if \(!sent\) mailed = await emailFallback\(env, text\);/.test(morning) && morning.indexOf('r = await post();') < morning.indexOf('mailed = await emailFallback'));
ok('… not when it was a duplicate (already sent today)', morning.indexOf('r.duplicate') < morning.indexOf('mailed = await emailFallback'));
ok('the hourly look keeps its e-mail way', /if \(!sent\) fallback = await emailFallback\(env, text\);/.test(src));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
