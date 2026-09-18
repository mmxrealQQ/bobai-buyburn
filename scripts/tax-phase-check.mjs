#!/usr/bin/env node
// The tax split is written in three places that must say the same thing: the
// schedule on the page (dashboard/app.js), the split the MCP tool
// bobai_tokenomics answers with as data (dashboard/_worker.js, TAX_PHASES), and
// the bot that actually sends the money (worker/index.js). This holds the
// dates and the percentages of the windows still ahead against each other.
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
console.log(`\n${n - failed}/${n} checks pass`);
process.exitCode = failed ? 1 : 0;
