// Pins Liste B "DeFi worker-lp" (2026-11-16, A-Z review 15.11.):
//   1. ONE RE-SET AT A TIME: a re-set holds lp:busy from the second opinion to its last send; a watch that finds it held
//      does nothing, an hourly or daily run waits for it (busyAfterWait).
//   2. STILL DUE AFTER THE SECOND OPINION: the plan is read again after the ask (up to 5 min); a price back inside or at
//      the edge, or a position that changed, is no re-set (stillDue); a due one goes on with the fresh plan.
//   3. THE EDGE DOES NOT RESTART THE WAIT beside a centred range (edgeKeepsClock); one-sided as before.
//   4. THE SWEEP BUYS FIRST: the operator's half is sent after the $BOBAI buy, so a refused buy splits nothing twice.
//   node scripts/lp-lock-edge-regressions.mjs      (offline; the fork run is scripts/lp-fork-test.mjs --only sweepfail)
import { readFileSync } from 'node:fs';
import { stillDue, edgeKeepsClock, busyAfterWait, BUSY_KEY, BUSY_TTL_S } from '../worker-lp/index.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

// 2. stillDue
const old = { resume: false, no: null, summary: { position: '7', in_range: false } };
ok('still out, same position: due (null), the fresh plan goes on', stillDue({ resume: false, no: null, summary: { position: '7', in_range: false } }, old) === null);
ok('back inside: not due', /back inside/.test(stillDue({ resume: false, no: 'the price is inside the range', summary: { position: '7', in_range: true } }, old) || ''));
ok('back at the edge: not due', /edge/.test(stillDue({ resume: false, no: 'at the edge', summary: { position: '7', in_range: false, at_edge: true } }, old) || ''));
ok('another position by now: not due', /position changed/.test(stillDue({ resume: false, no: null, summary: { position: '8', in_range: false } }, old) || ''));
ok('the position gone (a resume now): not due', /position changed/.test(stillDue({ resume: true, no: null, summary: { position: null, in_range: false } }, old) || ''));
ok('a refusal of its own (e.g. gas): not due, with its words', /after the second opinion: low gas/.test(stillDue({ resume: false, no: 'low gas', summary: { position: '7', in_range: false } }, old) || ''));
const res = { resume: true, no: null, summary: { position: null, in_range: false } };
ok('a resume still found: due', stillDue({ resume: true, no: null, summary: { position: null } }, res) === null);
ok('a resume no longer found: not due', /no longer there/.test(stillDue({ resume: false, no: null, summary: { position: '9', in_range: true } }, res) || ''));
ok('a resume refused now: not due', /no longer there.*low gas/.test(stillDue({ resume: true, no: 'low gas', summary: {} }, res) || ''));

// 3. edgeKeepsClock
ok('centred, outside: the note stays', edgeKeepsClock({ LP_RESET_MODE: 'centred' }, false) === true);
ok('centred, back inside: the note goes', edgeKeepsClock({ LP_RESET_MODE: 'centred' }, true) === false);
ok('one-sided: the edge clears the note as before', edgeKeepsClock({ LP_RESET_MODE: 'one-sided' }, false) === false && edgeKeepsClock({}, false) === false);

// 1. busyAfterWait over a stand-in KV
const kv = (vals) => { let i = 0; return { AGENT: { get: async (k) => (k === BUSY_KEY ? vals[Math.min(i++, vals.length - 1)] : null) } }; };
let slept = 0; const sleep = async (ms) => { slept += ms; };
ok('free: nothing held, no wait', (await busyAfterWait(kv([null]), { sleep })) === null && slept === 0);
slept = 0;
ok('held, the watch: returned at once, no wait', (await busyAfterWait(kv(['hourly check of x']), { watch: true, sleep })) === 'hourly check of x' && slept === 0);
slept = 0;
ok('held, the hourly run: waits until it is free', (await busyAfterWait(kv(['a', 'a', 'a', null]), { sleep, stepMs: 15000 })) === null && slept === 45000, `slept ${slept}`);
slept = 0;
ok('held the whole wait: still held, after the full wait only', (await busyAfterWait(kv(['a']), { sleep, waitMs: 60000, stepMs: 15000 })) === 'a' && slept === 60000, `slept ${slept}`);
ok('the hold outlives no cron (15 min)', BUSY_TTL_S === 900);

// source: where the pieces sit
const w = readFileSync(new URL('../worker-lp/index.js', import.meta.url), 'utf8');
const iPut = w.indexOf('await env.AGENT.put(BUSY_KEY'), iAsk = w.indexOf("askSecondOpinion(env, 'before a re-set'"), iFresh = w.indexOf('const gone = fresh ? stillDue(fresh, plan)'), iExec = w.indexOf('executeRebalance(pub, lpWallet(), lp, go,'), iFree = w.indexOf('finally { await env.AGENT.delete(BUSY_KEY)');
ok('the hold is taken before the ask, the plan read again after it, the re-set sent with the fresh plan, the hold freed after', iPut > 0 && iPut < iAsk && iAsk < iFresh && iFresh < iExec && iExec < iFree, [iPut, iAsk, iFresh, iExec, iFree].join(' '));
ok('the hold carries its TTL', /put\(BUSY_KEY, [^;]*expirationTtl: BUSY_TTL_S/.test(w));
ok('the LP steps look at the hold first, past the sweep', w.indexOf('const busy = await busyAfterWait(env, { watch })') > w.indexOf("await run('sweep'") && w.indexOf('const busy = await busyAfterWait(env, { watch })') < w.indexOf("await run('collect'"));
ok('no "one-minute cap" left in the words', !/one-minute cap/.test(w));
ok('both edge paths ask edgeKeepsClock before clearing the note', (w.match(/!edgeKeeps\) await env\.AGENT\.delete\(OUT_SINCE_KEY\)/g) || []).length === 2);

// 4. sweep order
const a = readFileSync(new URL('../shared/lp-agent.js', import.meta.url), 'utf8');
const sw = a.slice(a.indexOf('export async function executeSweep'), a.indexOf('// rebalance: a position the price has left'));
const iBuy = sw.indexOf("functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens'"), iOp = sw.indexOf('to the operator`');
ok('the sweep buys $BOBAI first, then sends the operator\'s half', iBuy > 0 && iOp > iBuy, `buy at ${iBuy}, operator at ${iOp}`);
ok('the operator\'s half goes before the pool part (a failed pool part does not skip it)', iOp < sw.indexOf('turn the rest into WBNB'));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
