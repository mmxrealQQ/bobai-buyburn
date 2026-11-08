// Brain Pop balance (2026-11-08): the same four players as test2.mjs (sloppy, decent, pro, bot) on the fixed day,
// 20 rounds each (different round seeds), with the old rules and with the new rules (rulesFor >= 9 Nov).
// Prints the average score, longest streak, powers and SUPER/MEGA/GOD per round. Usage: node balance-sim.mjs
import { plan, createRun, rulesFor } from '../temp/terminal-site/terminal/pop-engine.mjs';
function play(P, { step, err, careful }, seed) {
  let a = seed * 9301 + 49297; const rnd = () => (a = (a * 9301 + 49297) % 233280) / 233280;
  const run = createRun(P);
  for (let tt = 400; tt <= run.endAt(); tt += step) {
    const L = run.alive(tt).filter(([s]) => !(careful && s.rug && !run.golden(s, tt)));
    if (!L.length) continue;
    const [, q] = L[Math.floor(rnd() * L.length)];
    run.tap(tt, Math.round(q.x + (rnd() - 0.5) * 2 * err), Math.round(q.y + (rnd() - 0.5) * 2 * err));
  }
  run.advance(run.endAt()); const S = run.S, ev = (k) => S.ev.filter((e) => e[0] === k).length;
  return { score: S.score / 1e7, maxc: S.maxc, powers: S.used.length, super: ev('super'), mega: ev('mega'), god: ev('god'), misses: S.misses };
}
const players = { sloppy: { step: 300, err: 90, careful: false }, decent: { step: 420, err: 35, careful: true }, pro: { step: 260, err: 15, careful: true }, bot: { step: 120, err: 0, careful: true } };
const avg = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const out = {};
for (const [name, p] of Object.entries(players)) for (const which of ['old', 'new']) {
  const rows = [];
  for (let seed = 1; seed <= 20; seed++) {
    const P = plan('2026-11-09', seed * 7919);
    P.rules = which === 'old' ? rulesFor('2026-11-08') : rulesFor('2026-11-09');
    rows.push(play(P, p, seed));
  }
  out[name + ' ' + which] = { score: Math.round(avg(rows, 'score')), maxc: +avg(rows, 'maxc').toFixed(1), powers: +avg(rows, 'powers').toFixed(1), super: +avg(rows, 'super').toFixed(1), mega: +avg(rows, 'mega').toFixed(1), god: +avg(rows, 'god').toFixed(1), misses: +avg(rows, 'misses').toFixed(1) };
}
console.table(out);
for (const n of Object.keys(players)) { const o = out[n + ' old'], m = out[n + ' new']; console.log(`${n}: score ${o.score.toLocaleString()} -> ${m.score.toLocaleString()} (${m.score >= o.score ? '+' : ''}${Math.round((m.score / o.score - 1) * 100)}%), powers ${o.powers} -> ${m.powers}, longest streak ${o.maxc} -> ${m.maxc}`); }
