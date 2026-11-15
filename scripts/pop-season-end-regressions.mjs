// BRAIN POP AFTER 30 NOV (15.11., the A-Z pass) — in every self-test run, so the season's end stays safe:
//   worker-pop/test6.mjs          GET /api/pop/day without ?d= after the season = 30 Nov (was 400 for every old link)
//   scripts/tg-pop-chain-test.mjs the night post is marked only once Telegram took it (the 1 Dec season-over post)
// Both failed on the code before 15.11.
//   node scripts/pop-season-end-regressions.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
let bad = 0;
for (const f of ['worker-pop/test6.mjs', 'scripts/tg-pop-chain-test.mjs']) {
  const r = spawnSync(process.execPath, [path.join(ROOT, f)], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status === 0;
  if (!ok) { bad++; console.log((r.stdout || '') + (r.stderr || '')); }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f}`);
}
console.log(bad ? `\n${bad} FAIL` : '\nBrain Pop season end: 2 checks hold');
process.exit(bad ? 1 : 0);
