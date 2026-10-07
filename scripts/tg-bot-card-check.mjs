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
ok('the second it starts the card pays 0.5% BOB burn with the note, 0.3% liq add, and names the raised window as what follows', /now.*\n.*Liq Boost III/.test(t2) && /<b>0\.5%<\/b> Burn \$BOB.*−0\.3% → Liq Boost III/.test(t2) && /<b>0\.3%<\/b> BOBAI liq add \+ LP burn/.test(t2) && /Upcoming<\/b>\n📅 Sep 20, 06:00 UTC → Nov 20, 2026 · \$BOBAI Liq Boost III raised to 0\.5%/.test(t2) && !/Sep 17 → Sep 19/.test(t2.split('Upcoming')[1] || '') && /Sep 17 → Sep 19/.test(t1.split('Upcoming')[0] || ''));
// 2026-09-20 06:00 UTC: the boost raised to 0.5%, the 0.2% out of the BOB burn — the second before and the second itself.
const r1 = at('2026-09-20T05:59:59Z'), r2 = at('2026-09-20T06:00:00Z');
ok('Sep 20 06:00 UTC: the second before pays 0.5% BOB burn + 0.3% liq add, the second itself 0.3% + 0.5%, the standard split next', /<b>0\.5%<\/b> Burn \$BOB/.test(r1.split('Upcoming')[0]) && /<b>0\.3%<\/b> BOBAI liq add/.test(r1.split('Upcoming')[0]) && /now.*\n.*raised to 0\.5%/.test(r2) && /<b>0\.3%<\/b> Burn \$BOB.*−0\.5% → Liq Boost III/.test(r2) && /<b>0\.5%<\/b> BOBAI liq add \+ LP burn/.test(r2) && /Upcoming<\/b>\n📅 from Nov 20, 2026 · Standard/.test(r2));
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

// /tax (2026-10-05): the live tax card — registered, in /help, answered as /tax and /buyback; its charge bar never
// rounds up (97% is not full), the dollars use the BOBAI and BNB price, a missing read says so instead of a 0
ok('/tax is registered, listed in /help and answered (also /buyback)', /command: 'tax'/.test(tg) && /\/tax — Tax live/.test(tg) && /case '\/tax':/.test(tg) && /case '\/buyback':/.test(tg));
const taxSrc = cut('export function formatTaxCard', '\n}\n').replace('export ', '') + '\n}';
const helpers = cut('const fmtAmt = ', 'const approxUsd');
const formatTaxCard = new Function('formatUsd', 'formatNumber', 'BOT_WALLET', 'TAX_GAS_RESERVE', 'TAX_MIN_SPLIT', `${helpers}\n${taxSrc}\nreturn formatTaxCard;`)(
  (n) => '$' + n.toFixed(2), (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0)), '0xdeFC', 0.003, 0.004);
const now = Date.parse('2026-10-05T06:00:00Z'), log = [{ time: '2026-10-04T07:51:00Z', totalBnb: '0.05', bobaiBurned: '50000', bobBurned: '1' }, { time: '2026-10-05T04:00:00Z', totalBnb: '0.04', bobaiBurned: '20000', bobBurned: '0' }];
const tc = formatTaxCard({ queued: 388000, minDispatch: 400000, walletBnb: 0.0103, price: 0.0004, bnbUsd: 800 }, log, now);
ok('/tax: 97% shows nine bars, queued tax in $, the wallet BNB above the gas reserve, the last run and the 24 h count',
  /<b>97%<\/b> charged\n▰{9}▱\n/.test(tc) && /388\.0K of 400\.0K BOBAI tax queued in the token \(≈\$155\.20\)/.test(tc) && /\+ 0\.0073 BNB .*\(≈\$5\.84\)/.test(tc)
  && /Last buyback: <b>2h 0m ago<\/b>\n0\.0400 BNB \(≈\$32\.00\) → 20\.0K BOBAI burned/.test(tc) && /Last 24h: <b>2<\/b> buybacks · 70\.0K BOBAI burned/.test(tc), tc.split('\n').slice(2, 5).join(' | '));
const tf = formatTaxCard({ queued: null, minDispatch: null, walletBnb: null, price: null, bnbUsd: null }, [], now);
ok('/tax: a failed read says so (no 0%, no $0)', /could not read the token/.test(tf) && /log did not answer/.test(tf) && !/\b0%|\$0/.test(tf));

// /defi: THE RANGE, DRAWN (2026-10-07, operator: "make the range visual — so one sees how it stands"): the dot inside the
// bar where the price stands, outside it when the price left the range, the edge prices under the edges
const rbSrc = cut('export function formatRangeBar', '\n}\n').replace('export ', '') + '\n}';
const formatRangeBar = new Function(`${rbSrc}\nreturn formatRangeBar;`)();
const rb = (t) => formatRangeBar({ tick: t, main: { lower: -58100, upper: -56190 } }).join('\n');
const below = rb(-58130), mid = rb(-57145), above = rb(-56000);
ok('/defi: the range bar puts the price where it stands — below, inside (halfway), above',
  /<pre>● ┃─{16}┃\n  0\.002998  0\.003629<\/pre>/.test(below) && /0\.3% below the range/.test(below)
  && /<pre>┃─{8}●─{7}┃\n0\.002998  0\.003629<\/pre>/.test(mid) && /50% up the range/.test(mid)
  && /┃─{16}┃ ●/.test(above) && /above the range/.test(above), below.split('\n')[0] + ' | ' + mid.split('\n')[0] + ' | ' + above.split('\n')[0]);
ok('/defi: no range read = no bar (the card stays as it was)', formatRangeBar(null).length === 0 && /formatDefiCard\(pm, \{ range: pm \? await readDefiRange\(pm\.pool\) : null \}\)/.test(tg));

console.log(`\n${n - failed}/${n} checks pass`);
process.exitCode = failed ? 1 : 0;
