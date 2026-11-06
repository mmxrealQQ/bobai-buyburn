// node worker-pop/test.mjs — the daily plan is the same every time for a day and different between days; a fair run
// counts as the terminal counts it; every cheat is refused (each case was made to fail first by breaking check()).
import { plan, check, nameOf, dayNo, validDay, seasonOver, RUN_MS } from './game.js';
let pass = 0, fail = 0; const t = (ok, what, more = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const d = '2026-11-06', P = plan(d);
t(JSON.stringify(P) === JSON.stringify(plan(d)), 'the plan of a day is always the same');
t(JSON.stringify(P) !== JSON.stringify(plan('2026-11-07')), 'another day, another plan');
t(P.length >= 70 && P.length <= 140, 'about a hundred creatures in a minute', P.length);
t(P.every(s => s.at >= 0 && s.at + s.life <= RUN_MS), 'nothing outlives the minute');
t(P.filter(s => s.n === 'snail').length === 3 && P.filter(s => s.n === 'kaiju').length === 1, 'three snails, one kaiju');
t(P.some(s => s.gold), 'some golden ones');
// a fair run: every third creature, hit a little after it shows
const fair = P.filter((s, k) => k % 3 === 0 && s.n !== 'kaiju').map(s => [s.i, s.at + 300]);
const c = check(d, fair); t(c.ok && c.score > 0 && c.n === fair.length, 'a fair run counts', JSON.stringify({ score: c.score, maxc: c.maxc }));
// the terminal's rules: one creature at 5, then a second within 2.2 s scores x2
const two = P.filter(s => s.n !== 'kaiju' && s.n !== 'snail' && !s.gold).slice(0, 2), c2 = check(d, [[two[0].i, two[0].at + 200], [two[1].i, Math.max(two[0].at + 400, two[1].at + 50)]]);
t(c2.ok && (Math.max(two[0].at + 400, two[1].at + 50) - (two[0].at + 200) < 2200 ? c2.score === 15 : c2.score === 10), 'combo as in the terminal (5, then 5 x2)', JSON.stringify(c2));
const one = check(d, [fair[0]]).score, tw = check(d, [[fair[0][0], fair[0][1]], [fair[0][0], fair[0][1] + 500]]);
t(tw.ok && tw.score === one && tw.dropped === 1, 'the same creature twice counts once', JSON.stringify({ one, tw: tw.score }));
const no = c => c.ok && c.score === 0 && c.dropped === 1;
t(no(check(d, [[P[5].i, P[5].at + P[5].life + 2000]])), 'a hit after the creature left does not count');
t(no(check(d, [[P[5].i, P[5].at - 1000]])), 'a hit before it came does not count');
const pa = P.find((s, k) => P[k + 1] && P[k + 1].at < s.at + s.life - 500 && s.n !== 'kaiju' && P[k + 1].n !== 'kaiju'), pb = P[pa.i + 1];
t(check(d, [[pa.i, pb.at + 100], [pb.i, pb.at + 300]]).ok, 'two creatures in sight, 200 ms apart, count');
const fh = check(d, [[pa.i, pb.at + 100], [pb.i, pb.at + 110]]); t(fh.ok && fh.dropped === 1 && fh.n === 1, 'faster than a hand (10 ms apart): the second does not count');
t(no(check(d, [[9999, 100]])), 'a creature that is not in the plan does not count');
const k = P.find(s => s.n === 'kaiju');
t(no(check(d, [[k.i, k.at + 500]])), 'the kaiju without its six hits does not count');
const kh = [0, 1, 2, 3, 4].map(j => [k.i, k.at + 200 + j * 150]), ck = check(d, [[k.i, k.at + 1100]], kh);
t(ck.ok && ck.score === 50, 'the kaiju after six hits: 50', JSON.stringify(ck));
t(!check(d, 'x').ok && no(check(d, [[1]])), 'garbage is refused or does not count');
const late = check(d, [...fair.slice(0, 3), [P[7].i, P[7].at + P[7].life + 3000]]); t(late.ok && late.score === check(d, fair.slice(0, 3)).score, 'one bad pop does not throw the honest ones away');
t(nameOf([0, 0, 42]) === 'TURBO LUMACONE 42' && nameOf([99, 0, 1]) === null && nameOf(['<b>', 0, 1]) === null, 'names come only from the lists');
t(dayNo('2026-11-06') === 1 && dayNo('2026-11-07') === 2, 'day numbers');
t(validDay('2026-11-06', '2026-11-07') && !validDay('2026-11-08', '2026-11-07') && !validDay('2026-11-05', '2026-11-07') && !validDay('2026-02-31', '2026-12-01'), 'only real days from the first to today');
t(validDay('2026-11-30', '2026-12-05') && !validDay('2026-12-01', '2026-12-05') && seasonOver('2026-12-01') && !seasonOver('2026-11-30'), 'the season: boards until 30 Nov');
t(nameOf({ own: 'mmx_QQ', v: 0 }) === 'Il Grande mmx_QQone' && nameOf({ own: ' mmx_QQ ', v: 1 }) === 'mmx_QQini Cervellini', 'an own name, as typed, brainrotted', nameOf({ own: 'mmx_QQ', v: 0 }));
t(['ab', 'x'.repeat(17), 'evil.com', 'a/b', '<b>hi</b>', '1234', 'two words'].every(n => nameOf({ own: n, v: 0 }) === null) && ['BOBAI', 'admin', 'BOBAI_TEAM'].every(n => nameOf({ own: n, v: 0 }) !== null) && nameOf({ own: 'mmx', v: 99 }) === null && nameOf('plain text') === null, 'no short, long, link, rude, posing, digit-only name, no unknown form, no bare text');
console.log(`pop test: ${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
