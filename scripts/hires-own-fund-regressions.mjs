// Pins Liste B "Hires" (2026-11-16, A-Z review 15.11.):
//   1. NOTHING TO SET IT BESIDE, NOTHING PAID: a hire bought to stand beside the agent's own reading is refused when that
//      reading was not read (ownUnread) — before a quote is asked or a key opened.
//   2. THE JOB SAYS WHAT HAPPENED: a send that stopped after the job existed (a receipt that took over 90 s) is read back
//      from the chain; escrow funded by our wallet = the hire went through and is followed like any other (jobAfterFailure).
//   node scripts/hires-own-fund-regressions.mjs      (offline)
import { readFileSync } from 'node:fs';
import { HIRES, ownUnread, jobAfterFailure, FUNDED_OR_LATER } from '../worker-agent/agent-hires.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const H = (by) => HIRES.find((h) => h.by === by);

// 1. ownUnread
ok('Keel (#302257) and Bound (#363709) need their own reading; Sluicegate (paused, a brief of its own) does not', !!H(302257).needsOwn && !!H(363709).needsOwn && !H(304493).needsOwn);
ok('#302257 with its health factor: hired', ownUnread(H(302257), { own: { hf: 2.17 } }) === null);
ok('#302257 without it: refused, nothing paid', /was not read.*nothing paid/.test(ownUnread(H(302257), { own: null }) || ''));
ok('#363709 with position and range: hired', ownUnread(H(363709), { position: '7637521', own: { in_range: true } }) === null);
ok('#363709, /lp/portfolio down (no position, no range): refused', /was not read/.test(ownUnread(H(363709), { position: '', own: null }) || ''));
ok('#363709, range read but no position: refused (the brief would name none)', /named no position/.test(ownUnread(H(363709), { position: '', own: { in_range: false } }) || ''));
ok('#304493 asks nothing of its own', ownUnread(H(304493), {}) === null);

// 2. jobAfterFailure over a stand-in chain
const me = '0xAbC0000000000000000000000000000000000001';
const seq = (...jobs) => { let i = 0; return async () => jobs[Math.min(i++, jobs.length - 1)]; };
let slept = 0; const sleep = async (ms) => { slept += ms; };
ok('funded at once: the hire went through', (await jobAfterFailure(1, me, { read: seq({ client: me.toLowerCase(), status: 'FUNDED' }), sleep }))?.status === 'FUNDED' && slept === 0);
slept = 0;
ok('OPEN, then FUNDED a block later: found on the second read', (await jobAfterFailure(1, me, { read: seq({ client: me, status: 'OPEN' }, { client: me, status: 'FUNDED' }), sleep }))?.status === 'FUNDED' && slept === 30000, `slept ${slept}`);
slept = 0;
ok('OPEN all three reads (the fund never went): failed, after a minute', (await jobAfterFailure(1, me, { read: seq({ client: me, status: 'OPEN' }), sleep })) === null && slept === 60000, `slept ${slept}`);
ok('delivered already (SUBMITTED): went through', (await jobAfterFailure(1, me, { read: seq({ client: me, status: 'SUBMITTED' }), sleep }))?.status === 'SUBMITTED');
ok('EXPIRED: nothing in escrow, failed', (await jobAfterFailure(1, me, { read: seq({ client: me, status: 'EXPIRED' }), sleep })) === null);
ok('another client\'s job: never ours', (await jobAfterFailure(1, me, { read: seq({ client: '0x0000000000000000000000000000000000000009', status: 'FUNDED' }), sleep })) === null);
ok('an unreadable chain: failed as before', (await jobAfterFailure(1, me, { read: async () => { throw new Error('down'); }, sleep })) === null);
ok('OPEN and EXPIRED are not "funded"', !FUNDED_OR_LATER.includes('OPEN') && !FUNDED_OR_LATER.includes('EXPIRED'));

// source: where the pieces sit
const src = readFileSync(new URL('../worker-agent/agent-hires.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('export async function hireOnce'), src.indexOf('// THE ANSWER, FROM THE CHAIN'));
ok('the own reading is asked before the quote and before the key', body.indexOf('ownUnread(h, ctx)') > 0 && body.indexOf('ownUnread(h, ctx)') < body.indexOf('accountForAgent(') && body.indexOf('ownUnread(h, ctx)') < body.indexOf('handleHire('));
ok('the tx is in the record before its receipt is awaited', body.indexOf('txs.push(row)') > 0 && body.indexOf('txs.push(row)') < body.indexOf('waitForTransactionReceipt'));
ok('a stopped send reads the job back; only no job at all stays "failed"', /const job = jobId \? await jobAfterFailure\(jobId, me\.address\) : null;\s*if \(!job\) return log\(env, \{ \.\.\.plan, status: 'failed'/.test(body));
ok('a hire found funded goes on to notify the seller (the funded path)', body.indexOf('plan.fund_note') < body.indexOf('const reply = await notifyFunded'));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
