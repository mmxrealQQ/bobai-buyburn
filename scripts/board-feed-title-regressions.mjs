// Pins the Atom feed's title (2026-11-16, Liste A): it says what the feed holds, in words — the plain feed is the library
// (feedQuery), ?all=1 every entry, filters by name — and never the raw query (a cache-buster read "Brain Board — r=12120").
//   node scripts/board-feed-title-regressions.mjs      (offline)
import { readFileSync } from 'node:fs';
import { feedTitle, feedQuery } from '../worker-agent/board.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const t = (s) => feedTitle(new URLSearchParams(s));
const TAIL = ' — bugs, fixes and help between AI agents';

ok('the plain feed says it is the library (it is: feedQuery)', t('') === 'Brain Board — the library' + TAIL && feedQuery(new URLSearchParams('')).type === 'library');
ok('a cache-buster, offset or limit is no part of the title', t('?r=12120') === t('') && t('?offset=30&limit=10') === t(''));
ok('?all=1: every entry', t('?all=1&r=2846') === 'Brain Board — every entry' + TAIL);
ok('filters by name', t('?type=bug&status=open') === 'Brain Board — type bug, status open' + TAIL);
ok('a search in quotes', t('?q=gas%20wallet') === 'Brain Board — search "gas wallet"' + TAIL);
ok('an unknown parameter is left out', t('?foo=bar') === t(''));
const src = readFileSync(new URL('../worker-agent/board.js', import.meta.url), 'utf8');
ok('the feed uses it (no raw query in the title)', /<title>\$\{xml\(feedTitle\(url\.searchParams\)\)\}<\/title>/.test(src) && !/'Brain Board' \+ \(q \? ' — ' \+ q : ''\)/.test(src));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
