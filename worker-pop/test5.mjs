// EVERY DAY EQUALLY HARD (2026-11-08): pins the fixed day die both ways.
//  (1) days 1-3 (6-8 Nov) build exactly the plans they were played with (hashes taken from the engine before the change),
//      so every run on record still replays to its score;
//  (2) from 9 Nov every day has the same creatures, times, sizes, worth, rugs and golden ones — only where they show
//      changes with the round's seed;
//  (3) the fixed die is the rich one: 107 creatures, 13 golden, 7 rugs, base points 1,072.
// Usage: node test5.mjs
import crypto from 'node:crypto';
import { plan } from '../temp/terminal-site/terminal/pop-engine.mjs';
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`); };
const h = (P) => crypto.createHash('sha256').update(JSON.stringify(P)).digest('hex').slice(0, 16);
const KEEP = { '2026-11-06': ['9f303e75d462fdd7', '5f9ca26e9a4b289d'], '2026-11-07': ['8cb9ca75842e351f', '75d90c2410844d10'], '2026-11-08': ['f8485ef0e858ea9d', '96753178e063336b'] };
for (const [d, [a, b]] of Object.entries(KEEP)) say(h(plan(d, 0)) === a && h(plan(d, 12345)) === b, `${d} builds the plan it was played with`);
const diff = (P) => JSON.stringify(P.map((s) => [s.at, s.rug, s.gold, s.pts, s.r, s.life, s.hp || 0]));
const ref = diff(plan('2026-11-09', 1));
for (const d of ['2026-11-10', '2026-11-17', '2026-11-24', '2026-11-30', '2026-12-15']) say(diff(plan(d, 777)) === ref, `${d}: the same difficulty as 9 Nov`);
const A = plan('2026-11-20', 1), B = plan('2026-11-20', 2);
say(A.some((s, i) => s.x0 !== B[i].x0 || s.y0 !== B[i].y0 || s.p !== B[i].p), 'two rounds of one day still differ in where the creatures show');
const P = plan('2026-11-09', 5), c = P.filter((s) => !s.rug);
say(c.length === 107 && P.filter((s) => s.gold).length === 13 && P.filter((s) => s.rug).length === 7 && c.reduce((t, s) => t + s.pts * (s.gold ? 5 : 1), 0) === 1072, 'the fixed day: 107 creatures, 13 golden, 7 rugs, 1,072 base points');
// (4) the easier rules (8.11., operator chose 1 + 2) hold from 9 Nov only: streak 2.6 s, stations 6/8/10/11/12/14/16,
//     a miss drains 2; days 1-3 keep 2 s, 8/10/12/14/16/18/22 and 3 — and their runs replay exactly as before
import { rulesFor } from '../temp/terminal-site/terminal/pop-engine.mjs';
const R9 = rulesFor('2026-11-09'), R8 = rulesFor('2026-11-08');
say(R9.combo === 2600 && R9.need.join() === '6,8,10,11,12,14,16' && R9.missDrain === 2, 'from 9 Nov: 2.6 s streak, stations 6/8/10/11/12/14/16, a miss drains 2');
say(R8.combo === 2000 && R8.need.join() === '8,10,12,14,16,18,22' && R8.missDrain === 3, 'days 1-3: 2 s streak, stations 8/10/12/14/16/18/22, a miss drains 3');
say(plan('2026-11-09', 1).rules.combo === 2600 && plan('2026-11-07', 1).rules.combo === 2000, 'each plan carries its own day\'s rules');
console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
