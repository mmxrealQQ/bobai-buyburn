#!/usr/bin/env node
// The Telegram bot's /bot card says which split the buyback worker pays right
// now and what follows; its windows must be the worker's own, and the card
// must turn over at the same second the money does. This lifts formatBotCard
// and botBurnsFromLog out of worker-tg-bot/index.js as they stand and runs
// them with a set clock — nothing imported, no token, no chat.
// Offline.   node scripts/tg-bot-card-check.mjs
import fs from 'node:fs';

let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); };
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const tg = src('../worker-tg-bot/index.js'), bot = src('../worker/index.js');

const win = (text, name) => (text.match(new RegExp(`const ${name}\\s*=\\s*(?:new Date|Date\\.parse)\\('([^']+)'\\)`)) || [])[1];
ok('the card\'s windows are the worker\'s, to the second',
  win(tg, 'GG_START') === win(bot, 'GIGGLE_START') && win(tg, 'BB3_START') === win(bot, 'BOBAI_LIQ_BOOST3_START') && win(tg, 'GG_END') === win(bot, 'GIGGLE_END') && win(tg, 'GG_END') === win(bot, 'BOBAI_LIQ_BOOST3_END'),
  `${win(tg, 'GG_START')} · ${win(tg, 'BB3_START')} · ${win(tg, 'GG_END')}`);

// The pieces the two functions need, lifted from the file: the three window
// constants, the phase table, and the functions themselves (export stripped).
const cut = (from, to) => { const a = tg.indexOf(from), b = tg.indexOf(to, a); if (a < 0 || b < 0) throw new Error('anchor missing: ' + from.slice(0, 40)); return tg.slice(a, b); };
const consts = ['GG_START', 'GG_END'].map((k) => `const ${k} = Date.parse('${win(tg, k)}');`).join('\n');
const table = cut("const BB3_START = Date.parse(", '// One card:');
const card = cut('export function formatBotCard', '// The burn card\'s figures').replace('export ', '');
const sums = cut('export function botBurnsFromLog', '// Billions read as B').replace('export ', '');
const { formatBotCard, botBurnsFromLog } = new Function(`${consts}\n${table}\n${card}\n${sums}\nreturn { formatBotCard, botBurnsFromLog };`)();

const at = (d) => formatBotCard(Date.parse(d));
const t1 = at('2026-09-19T17:59:59Z'), t2 = at('2026-09-19T18:00:00Z'), t3 = at('2026-11-20T00:00:59Z'), t4 = at('2026-11-20T00:01:00Z');
ok('the second before Liq Boost III the card pays 0.8% BOB burn and lists the boost as upcoming', /now.*\n.*Giggle Academy pot \+ DeFi Agent\n/.test(t1) && /<b>0\.8%<\/b> Burn \$BOB/.test(t1) && t1.indexOf('Upcoming') < t1.indexOf('Liq Boost III'));
ok('the second it starts the card pays 0.3% BOB burn with the note, 0.5% liq add (raised from 0.3% on 2026-09-20), and names the standard split as what follows', /now.*\n.*Liq Boost III/.test(t2) && /<b>0\.3%<\/b> Burn \$BOB.*−0\.5% → Liq Boost III/.test(t2) && /<b>0\.5%<\/b> BOBAI liq add \+ LP burn/.test(t2) && /Upcoming<\/b>\n📅 from Nov 20, 2026 · Standard/.test(t2) && !/Giggle Academy pot \+ DeFi Agent\n👤 <b>0\.8%<\/b> Creator/.test(t2.split('Upcoming')[1] || ''));
ok('the second before Nov 20 00:01 it still pays the boost, the second itself is 1/1/1 with nothing upcoming', /now.*\n.*Liq Boost III/.test(t3) && /now.*\n.*Standard\n👤 <b>1%<\/b> Creator/.test(t4) && !/Upcoming/.test(t4) && !/ends in/.test(t4));
ok('every slice line of the running split adds up to 3%', (() => { const body = t2.split('Upcoming')[0]; const pct = [...body.matchAll(/<b>([0-9.]+)%<\/b>/g)].map((m) => Number(m[1])); return pct.length === 6 && Math.abs(pct.reduce((a, b) => a + b, 0) - 3) < 1e-9; })());
ok('the card links the wallet the bot pays from and the full schedule', /bscscan\.com\/address\/0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce/.test(t2) && /brainonbnb\.com\/#tokenomics/.test(t2));
ok('it never has two blank lines in a row', !/\n\n\n/.test(t1 + t2 + t3 + t4));

const s = botBurnsFromLog([{ bob: '10', bobaiBurned: '1.5' }, { bobBurned: '20', bobaiBurned: '2' }, null, { bobaiNote: 'failed' }]);
ok('the bot\'s own burns are summed under both names the log used, a null row and a failed run counting nothing', s.runs === 4 && s.bob === 30 && s.bobai === 3.5);
ok('an empty or missing log reads 0, not NaN', botBurnsFromLog(null).bob === 0 && botBurnsFromLog([]).bobai === 0);

// Both directions: a card whose table lost the boost window has to be caught.
const stale = table.replace("Date.parse('2026-09-19T18:00:00Z')", "Date.parse('2026-09-20T18:00:00Z')");
const staleCard = new Function(`${consts}\n${stale}\n${card}\n${sums}\nreturn formatBotCard;`)()(Date.parse('2026-09-19T18:00:00Z'));
ok('a table one day late is caught (the detector is not blind)', stale !== table && !/now.*\n.*Liq Boost III/.test(staleCard));

ok('/bot is registered, listed in /help and answered', /command: 'bot'/.test(tg) && /\/bot — What the bot does/.test(tg) && /case '\/bot':/.test(tg));

console.log(`\n${n - failed}/${n} checks pass`);
process.exitCode = failed ? 1 : 0;
