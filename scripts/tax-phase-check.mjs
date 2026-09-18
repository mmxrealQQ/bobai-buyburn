#!/usr/bin/env node
// The tax split is written in three places that must say the same thing: the
// schedule on the page (dashboard/app.js), the split the MCP tool
// bobai_tokenomics answers with as data (dashboard/_worker.js, TAX_PHASES), and
// the bot that actually sends the money (worker/index.js). This holds the
// dates and the percentages of the windows still ahead against each other.
//
// And the money is sent from TWO files: worker/index.js, which runs, and
// buyback-bot.js, the fallback for a day Cloudflare is down. Until 2026-09-18
// this checker never opened the second and looked for two date strings in the
// first. Now both bots' OWN code is run — the window constants, the is…Active
// predicates and the split block, lifted out of each file as they stand, with
// the clock set by this script — at instants around every boundary still
// ahead, and the two answers are held against each other and against the
// table the MCP tool answers with. Nothing is imported, no key is read, the
// bots are not touched.
// Offline.   node scripts/tax-phase-check.mjs
import fs from 'node:fs';

let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); };
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const app = src('../dashboard/app.js'), bot = src('../worker/index.js');
// The Pages worker is not a module node can import (no exports but its default
// handler): the two definitions are lifted out of its text and run as they stand.
const w = src('../dashboard/_worker.js');
const snippet = w.slice(w.indexOf('const TAX_PHASES = ['), w.indexOf('const tokenomicsNow'));
const { TAX_PHASES, taxPhaseAt } = new Function(`${snippet}; return { TAX_PHASES, taxPhaseAt };`)();
ok('the tool answers with the phase (tokenomicsNow is what the case returns)', /case 'bobai_tokenomics': return tokenomicsNow\(\);/.test(w) && /current_phase: taxPhaseAt\(\)/.test(w));

const iso = (name) => (app.match(new RegExp(name + "=new Date\\('([^']+)'\\)")) || [])[1];
const sun = TAX_PHASES.find((p) => p.id === 'sunshine'), fin = TAX_PHASES.find((p) => p.id === 'standard-final');
ok('the campaign window is the page\'s own (GG_START … GG_END)', !!sun && iso('GG_START') === sun.from && iso('GG_END') === sun.until, `${iso('GG_START')} … ${iso('GG_END')}`);
ok('the standard split begins where the campaign ends', !!fin && fin.from === sun.until && fin.until === null);
const row = (app.match(/\{id:'sunshine'[^}]+\}/) || [''])[0];
const pct = (k) => Number((row.match(new RegExp(k + ":'([0-9.]+)%'")) || [])[1]);
ok('the percentages are the page\'s row for the same window', pct('creatorPct') === sun.split_pct.creator && pct('bobPct') === sun.split_pct.bob_burn && pct('bobaiPct') === sun.split_pct.bobai_burn && pct('lpPct') === sun.split_pct.defi_agent && pct('gigglePct') === sun.split_pct.giggle_academy_pot, row.slice(0, 40) + '…');
ok('every window adds up to the 3% the contract takes', TAX_PHASES.every((p) => Math.abs(Object.values(p.split_pct).reduce((a, b) => a + b, 0) - 3) < 1e-9));
ok('the bot carries both dates', bot.includes('2026-09-17T00:01:00Z') && bot.includes('2026-11-20T00:01:00Z'));
const at = (d) => taxPhaseAt(Date.parse(d));
ok('a day inside the campaign answers with it and names what follows', at('2026-10-01T00:00:00Z')?.id === 'sunshine' && at('2026-10-01T00:00:00Z')?.next?.id === 'standard-final' && at('2026-10-01T00:00:00Z')?.total_pct === 3);
ok('the minute it ends the standard split answers, with nothing after it', at('2026-11-20T00:01:00Z')?.id === 'standard-final' && at('2026-11-20T00:01:00Z')?.next === null && at('2026-11-20T00:00:59Z')?.id === 'sunshine');

// ── the two bots, run as they stand ─────────────────────────────────────────
const fallback = src('../buyback-bot.js');
const SLICES = ['bobaiBurnBps', 'bobBurnBps', 'creatorBps', 'bobLiqBps', 'bobaiLiqBps', 'wc26PoolBps', 'lpAgentBps', 'giggleBps'];
// What a bot would split the tax into at `ms`: its constants and predicates
// (from the first window constant to TAX_BPS) and its split block (from the
// first flag to the sum), run with a Date whose now() is ours.
function splitOf(text, ms) {
  const head = text.slice(text.indexOf('const LIQ_BOOST_START'), text.indexOf('const TAX_BPS = 300;'));
  const flags = text.search(/const \w+\s*= isLiqBoostActive\(\);/);
  const body = text.slice(flags, text.indexOf('const bpsSum'));
  if (!head || flags < 0 || !body) return null;
  class Clock extends Date { static now() { return ms; } }
  return new Function('Date', `${head}; ${body}; return { ${SLICES.join(', ')} };`)(Clock);
}
const windowsOf = (text) => Object.fromEntries([...text.matchAll(/const (\w+_(?:START|END))\s*=\s*new Date\('([^']+)'\)/g)].map((m) => [m[1], m[2]]));
const predicatesOf = (text) => [...text.matchAll(/return now >= (\w+) && now (<=|<) (\w+);/g)].map((m) => m.slice(1).join(' ')).join(' | ');
const winA = windowsOf(bot), winB = windowsOf(fallback);
ok('both bots carry the same windows, to the second', Object.keys(winA).length >= 14 && JSON.stringify(winA) === JSON.stringify(winB), `${Object.keys(winA).length} constants`);
ok('both bots close their windows the same way (< or <=)', predicatesOf(bot).length > 0 && predicatesOf(bot) === predicatesOf(fallback));

// Every boundary still ahead, a second before, on it and a second after; plus today and a day well past the last one.
const ahead = [...new Set(Object.values(winA).map((d) => Date.parse(d)).filter((t) => t > Date.now()))];
const instants = [Date.now(), ...ahead.flatMap((t) => [t - 1000, t, t + 1000]), Math.max(...Object.values(winA).map((d) => Date.parse(d))) + 30 * 86400000];
const same = [], sums = [], table = [];
for (const t of instants) {
  const a = splitOf(bot, t), b = splitOf(fallback, t);
  const when = new Date(t).toISOString();
  if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) same.push(when);
  if (!a || SLICES.reduce((x, k) => x + a[k], 0) !== 300 || SLICES.some((k) => a[k] < 0)) sums.push(when);
  // The tool's table speaks in percent of a trade, the bot in bps; the programs the table does not name are over and have to be 0.
  const ph = taxPhaseAt(t), sp = ph && ph.split_pct;
  const bps = (v) => Math.round((v || 0) * 100);
  if (!a || !sp || a.creatorBps !== bps(sp.creator) || a.bobBurnBps !== bps(sp.bob_burn) || a.bobaiBurnBps !== bps(sp.bobai_burn) || a.lpAgentBps !== bps(sp.defi_agent) || a.giggleBps !== bps(sp.giggle_academy_pot) || a.bobLiqBps || a.bobaiLiqBps || a.wc26PoolBps) table.push(when);
}
ok(`the fallback bot splits exactly like the live bot at ${instants.length} instants around every boundary ahead`, same.length === 0, same.join(', '));
ok('at each of them the live bot\'s split adds up to 300 bps with no slice below zero', sums.length === 0, sums.join(', '));
ok('and it is the split the MCP tool answers with for that instant', table.length === 0, table.join(', '));
const endT = Date.parse('2026-11-20T00:01:00Z');
const before = splitOf(bot, endT - 1000), after = splitOf(bot, endT);
ok('2026-11-20 00:01:00 UTC: the second before pays the DeFi agent and the Giggle pot, the second itself is 1/1/1', !!before && !!after && before.lpAgentBps === 30 && before.giggleBps === 30 && before.creatorBps === 80 && after.lpAgentBps === 0 && after.giggleBps === 0 && after.creatorBps === 100 && after.bobBurnBps === 100 && after.bobaiBurnBps === 100);
// Both directions: a fallback bot one window behind has to be caught.
const stale = fallback.replace("const GIGGLE_END   = new Date('2026-11-20T00:01:00Z')", "const GIGGLE_END   = new Date('2026-11-21T00:01:00Z')");
ok('a fallback bot with one date a day off is caught (the detector is not blind)', stale !== fallback && JSON.stringify(splitOf(stale, endT)) !== JSON.stringify(splitOf(bot, endT)));

console.log(`\n${n - failed}/${n} checks pass`);
process.exitCode = failed ? 1 : 0;
