// AFTER THE SEASON (15.11., the A-Z pass): from 1 Dec GET /api/pop/day without ?d= asked for "today" (1 Dec), which is
// past LAST_DAY, so every old link (/m/pop, ?pop=play, a TG or X post) answered 400 "no such day" and the terminal said
// "The game server did not answer". Now a day not asked for is the season's last day once it is over, the answer says
// season_over, and the game opens as an unranked rematch of 30 Nov (start sends d because day !== today; the boards stay).
// Usage: node worker-pop/test6.mjs
import fs from 'node:fs';
import path from 'node:path';
import { askedDay, validDay, seasonOver, LAST_DAY } from './game.js';
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${t}`); };
say(askedDay(null, '2026-11-20') === '2026-11-20', 'in the season, no ?d= is today');
say(askedDay(null, '2026-11-30') === '2026-11-30', 'the last day itself is today');
for (const t of ['2026-12-01', '2026-12-24', '2027-01-15']) {
  const d = askedDay(null, t);
  say(d === LAST_DAY && validDay(d, t) && seasonOver(t), `${t}: no ?d= is ${LAST_DAY} and valid (was 400)`);
}
say(askedDay('2026-11-12', '2026-12-01') === '2026-11-12', 'an asked day stays the asked day');
say(!validDay(askedDay('2026-12-01', '2026-12-01'), '2026-12-01'), 'asking for a day after the season still 400');
// the server uses it on /day and says season_over
const src = fs.readFileSync(path.join(import.meta.dirname, 'index.js'), 'utf8');
const dayLine = src.split('\n').find((l) => l.includes("const d = ") && l.includes("searchParams.get('d')") && l.includes("validDay") && !l.includes('scope'));
say(!!dayLine && dayLine.includes('askedDay('), 'GET /day takes its day from askedDay()');
const dayRet = src.split('\n').find((l) => l.includes('return J({ v: V, day: d'));
say(!!dayRet && dayRet.includes('season_over'), 'GET /day answers season_over');
console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
