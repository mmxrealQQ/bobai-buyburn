// One command that answers "is everything actually running".
//
//   node scripts/health.mjs
//
// The checks themselves live in scripts/lib/health-checks.mjs, because the same
// body runs every morning in worker-health/ and reports to the operator on
// Telegram. This file is the hand: it runs them and prints them.
import { runHealth } from './lib/health-checks.mjs';

const results = await runHealth({ rpc: process.env.BSC_RPC_URL || undefined });

const areas = [...new Set(results.map((r) => r.area))];
let bad = 0;
console.log('');
for (const a of areas) {
  console.log(a);
  for (const r of results.filter((x) => x.area === a)) {
    if (!r.good) bad++;
    console.log(`  ${r.good ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(42)} ${r.detail}`);
  }
  console.log('');
}
console.log(bad === 0
  ? `${results.length} checks, everything running\n`
  : `${results.length} checks, ${bad} FAILING\n`);
process.exit(bad ? 1 : 0);
