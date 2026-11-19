#!/usr/bin/env node
// A Worker refuses a promise made by another request (2026-11-19, stranger test of /services): the GoPlus account
// token's in-flight fetch sat in module scope and was handed to every scan that landed while it ran — 6 of 9
// concurrent /api/preflight calls answered 422 "This promise was created by a request that has since ended", and that
// went out as not_measurable, "asking again will not change it", while the same call answered a second later.
// Pins: (1) no promise is kept in module scope of the site worker's scan modules; (2) the runtime's own failures
// classify as chain_unavailable (503, retry), never as a determinate answer about the address.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

// (1) the scan modules the site worker imports keep no in-flight promise between requests
for (const f of ['dashboard/scanner-scan.js', 'dashboard/scanner-chain.js', 'dashboard/preflight.js', 'dashboard/tier-scan.js', 'dashboard/swap-route.js', 'dashboard/range-scan.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const hit = src.match(/\b(inflight|inFlight|in_flight)\s*[:=]\s*(?!null\b)[^;,}\n]{1,60}/);
  check(!hit, `${f}: no shared in-flight promise`, hit ? hit[0] : '');
}

// (2) errorAnswer, taken from the worker source as it is
const w = fs.readFileSync(path.join(ROOT, 'dashboard/_worker.js'), 'utf8');
const start = w.indexOf('function errorAnswer(e)');
const end = w.indexOf('\n}\n', start);
check(start > 0 && end > start, 'errorAnswer found in dashboard/_worker.js');
const errorAnswer = new Function(`${w.slice(start, end + 2)}; return errorAnswer;`)();
const CASES = [
  ['This promise was created by a request that has since ended, so it can never settle. With the handle_cross_request_promise_resolution compatibility flag, a promise can only settle in the request that created it, and settling it after that request ends is dropped.', 'chain_unavailable', 503],
  ['Network connection lost.', 'chain_unavailable', 503],
  ['The operation was aborted due to timeout', 'chain_unavailable', 503],
  ['internal error', 'chain_unavailable', 503],
  // determinate answers keep their code
  ['0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 is not a BSC token', 'not_a_token', 422],
  ['Invalid BSC address', 'bad_address', 400],
];
for (const [msg, code, status] of CASES) {
  const r = errorAnswer(new Error(msg));
  check(r.body.code === code && r.status === status, `"${msg.slice(0, 50)}…" -> ${code} ${status}`, `${r.body.code} ${r.status}`);
}

console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
