// node worker-pop/test2.mjs — Brain Pop 2.0: the engine (temp/terminal-site/terminal/pop-engine.js, the one file the
// terminal plays and the worker checks with). Deterministic, aim is checked, rugs and misses cost, weapons work, a
// replay of the same inputs gives the same score, and the balance between a careless, a decent and a perfect player.
import { plan, pos, createRun, replay, WEAPONS, RUN_MS, turn } from '../temp/terminal-site/terminal/pop-engine.mjs';
let pass = 0, fail = 0; const t = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const d = '2026-11-06', P = plan(d);
t(JSON.stringify(P) === JSON.stringify(plan(d)) && JSON.stringify(P) !== JSON.stringify(plan('2026-11-07')), 'one plan a day, another the next');
t(P.length >= 80 && P.length <= 160, 'enough to do in a minute', P.length);
t(P.filter((s) => s.rug).length >= 5 && P.some((s) => s.gold) && P.some((s) => s.hp), 'rugs, golden ones and the kaiju', JSON.stringify({ rugs: P.filter((s) => s.rug).length, gold: P.filter((s) => s.gold).length }));
const firstRug = P.find((s) => s.rug); t(firstRug.at > 7000, 'no rug in the first 7 seconds (learn first)', firstRug.at);
// a player: every 'step' ms looks at what is there and taps one with an aim error; avoids rugs if 'careful'
function play({ step, err, careful, weapons, seed = 1 }) {
  let a = seed * 9301 + 49297; const rnd = () => (a = (a * 9301 + 49297) % 233280) / 233280;
  const run = createRun(P), inputs = [];
  for (let tt = 400; tt <= RUN_MS; tt += step) {
    const L = run.alive(tt).filter(([s]) => !(careful && s.rug && !run.golden(s, tt)));
    if (!L.length) continue;
    const [s, q] = L[Math.floor(rnd() * L.length)], x = Math.round(q.x + (rnd() - 0.5) * 2 * err), y = Math.round(q.y + (rnd() - 0.5) * 2 * err);
    if (run.tap(tt, x, y)) inputs.push([tt, x, y]);
  }
  return { S: run.S, inputs };
}
const sloppy = play({ step: 300, err: 90, careful: false, weapons: false });
const decent = play({ step: 420, err: 35, careful: true, weapons: true });
const pro = play({ step: 260, err: 15, careful: true, weapons: true });
const bot = play({ step: 120, err: 0, careful: true, weapons: true });
const row = (x) => ({ score: x.S.score, pops: x.S.pops, misses: x.S.misses, rugs: x.S.rugs, maxc: x.S.maxc, weapons: x.S.used.length });
console.log('balance', JSON.stringify({ sloppy: row(sloppy), decent: row(decent), pro: row(pro), bot: row(bot) }));
t(sloppy.S.score < decent.S.score && decent.S.score < pro.S.score, 'skill pays: careless < decent < sharp');
t(sloppy.S.misses > decent.S.misses && sloppy.S.rugs > 0 && decent.S.rugs === 0, 'aim matters: a wild tapper misses and hits rugs');
t(decent.S.used.length >= 2 && sloppy.S.used.length < decent.S.used.length, 'super powers come by themselves, more for the clean player', JSON.stringify({ sloppy: sloppy.S.used.length, decent: decent.S.used.length }));
// the server's replay is the same game
for (const [n, x] of [['sloppy', sloppy], ['decent', decent], ['pro', pro]]) { const r = replay(d, x.inputs); t(r && r.score === x.S.score && r.pops === x.S.pops && r.misses === x.S.misses, 'replay = play (' + n + ')', JSON.stringify({ play: x.S.score, replay: r && r.score })); }
// cheats change nothing: taps on empty places, taps in the future, taps too fast, weapons not unlocked
const s0 = P.find((s) => !s.rug && !s.hp && s.p === 'pop'), q0 = pos(s0, s0.at + 300);
{ const r1 = replay(d, [[s0.at + 300, Math.round(q0.x), Math.round(q0.y)]]); t(r1.pops === 1 && r1.score > 0, 'a tap on a creature pops it', r1.score); }
{ const near = replay(d, [[s0.at + 300, Math.round(q0.x), Math.round(q0.y)]]).score, edge = replay(d, [[s0.at + 300, Math.round(q0.x + s0.r * 0.9), Math.round(q0.y)]]).score, late = replay(d, [[s0.at + 1500, Math.round(pos(s0, s0.at + 1500).x), Math.round(pos(s0, s0.at + 1500).y)]]).score;
  t(near > edge && edge > 0 && near > late && late > 0, 'aim and speed pay without steps: centre > edge, sooner > later', JSON.stringify({ near, edge, late })); }
{ const sig = (p) => p.map((x) => [x.at, x.life, x.r, x.rug, x.gold, x.pts, x.hp || 0].join()).join('|'), A = plan(d, 11), B = plan(d, 12);
  t(sig(A) === sig(B) && JSON.stringify(A) !== JSON.stringify(B) && JSON.stringify(A) === JSON.stringify(plan(d, 11)), 'every round its own look, every round the same difficulty');
  const s1 = A.find((x) => x.p === 'pop' && !x.rug && !x.hp), q1 = pos(s1, s1.at + 300); t(replay(d, [[s1.at + 300, Math.round(q1.x), Math.round(q1.y)]], 11).pops === 1, 'the server replays a round on its own seed'); }
t(new Set([sloppy, decent, pro, bot].map((x) => x.S.score)).size === 4 && [sloppy, decent, pro].every((x) => x.S.score % 10000000 !== 0), 'no two scores alike, seven decimals', [sloppy, decent, pro].map((x) => (x.S.score / 1e7).toFixed(7)).join(' '));
t(replay(d, [[s0.at + 300, Math.round(q0.x) + 400 > 1000 ? Math.round(q0.x) - 400 : Math.round(q0.x) + 400, Math.round(q0.y)]]).score === 0, 'a tap beside it does not');
t(replay(d, [[s0.at - 500, Math.round(q0.x), Math.round(q0.y)]]).score === 0, 'a tap before it comes does not');
t(replay(d, [[70000, 500, 500]]).applied === 0, 'nothing after the minute');
t(replay(d, [[1000, 'w', 6]]).applied === 0, 'a weapon cannot be called, it only comes from a streak');
{ const run = createRun(P); let k = 0; for (let tt = 400; tt < 30000 && !run.S.used.length; tt += 250) { const L = run.alive(tt).filter(([x]) => !x.rug && !x.hp); if (!L.length) continue; const [, q] = L[0]; if (run.tap(tt, Math.round(q.x), Math.round(q.y))) k++; }
  t(run.S.used[0] === 0 && run.S.armed === 'burn' && run.S.combo === 4, 'four clean pops in a row fire BURN by itself', JSON.stringify({ taps: k, combo: run.S.combo, used: run.S.used })); }
t(replay(d, [[s0.at + 300, Math.round(q0.x), Math.round(q0.y)], [s0.at + 310, 10, 10]]).applied === 1, 'faster than a hand (10 ms) is not applied');
const rug = P.find((s) => s.rug && s.p === 'pop'), qr = pos(rug, rug.at + 200);
t(replay(d, [[rug.at + 200, Math.round(qr.x), Math.round(qr.y)]]).rugs === 1, 'a rug costs');
t(replay(d, 'x') === null && replay(d, new Array(901).fill([1, 1, 1])) === null, 'garbage is refused');
t(WEAPONS.length === 7 && WEAPONS.map((w) => w.k).join() === 'burn,hammer,liq,defi,giggle,creator,trades', 'the seven stations, in the order they fire');
{ const ev = pro.S.ev.map((e) => e[0]); t(ev.includes('super') && ev.includes('mega') && ev.includes('auto'), 'a clean streak reaches SUPER (8) and MEGA (16); the helpers pop on their own', JSON.stringify({ super: ev.filter((k) => k === 'super').length, mega: ev.filter((k) => k === 'mega').length, auto: ev.filter((k) => k === 'auto').length }));
  const r = replay(d, pro.inputs); t(r.score === pro.S.score, 'the helpers count the same in the replay of the server'); }
{ const all = [sloppy, decent, pro, bot].flatMap((x) => x.S.ev.map((e) => e[0])); t(all.includes('split'), 'the spaghetti octopus splits into three minis', all.filter((k) => k === 'split').length);
  t(sloppy.S.misses > 0 && replay(d, [[1000, 2, 2]]).misses === 1 && replay(d, [[1000, 2, 2]]).score === 0, 'a miss costs (never below zero)'); }
console.log(`pop 2.0 test: ${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
