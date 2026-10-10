// The census card "escrow released" and the per-provider "completed" must count
// the same thing: completions of FUNDED jobs. A COMPLETED job with budget 0
// released nothing (2026-10-10: the card counted those, the rows did not).
import { aggregate } from './lib/job-aggregate.mjs';

const A = '0x00000000000000000000000000000000000000a1';
const B = '0x00000000000000000000000000000000000000b2';
const job = (id, status, budget, provider = A) => ({ id, status, budget: String(budget), provider, client: B });
const jobs = new Map([
  [1, job(1, 'COMPLETED', 10n ** 18n)],
  [2, job(2, 'COMPLETED', 0)],
  [3, job(3, 'SUBMITTED', 10n ** 18n)],
  [4, job(4, 'OPEN', 0)],
]);
const a = aggregate(jobs);
const checks = [
  ['escrow released counts funded completions only', a.completed === 1],
  ['zero-budget completions are reported apart', a.completed_unfunded === 1],
  ['card equals the sum of the provider rows', a.completed === a.providers.reduce((s, p) => s + p.completed, 0)],
  ['without-top-provider subtracts like from like', a.withoutTopProvider.completed === 0],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
