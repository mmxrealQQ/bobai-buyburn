#!/usr/bin/env node
// THE BUYER'S NUMBERS (2026-10-23). Marque job 57037, a real buyer: "Plan a 45-level grid for BNB/USDT between 500 and
// 5500 with 5000 USDT, stop below 400." On 20.10. it was refused ("Give a BSC token or pool address"); with the WBNB
// default of 22.10. it would have been answered — with 10 levels, ±15 % and $1,000: the delivery read addresses, not
// levels, capital or bounds. Pins (the code before 2026-10-23 FAILs 1-4):
//   1  understand reads levels "45-level", capital "5000 USDT", bounds "between 500 and 5500", stop "below 400", BNB = WBNB
//   2  the delivery's own params (deliverJob: understand under the job's fields) carry them
//   3  the grid is planned between the buyer's bounds with its levels and capital, the stop reported   [live: reads the pool]
//   4  without bounds the ± band still applies (nothing else changed)                                    [live]
// usage: node scripts/grid-numbers-check.mjs [--offline]
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const offline = process.argv.includes('--offline');
const U = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'understand.js')).href);
const S = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'sell.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more ? ' — ' + more : '')); ok ? pass++ : fail++; };
const TASK = 'Plan a 45-level grid for BNB/USDT between 500 and 5500 with 5000 USDT, stop below 400.';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const u = U.understand(S.SERVICES.grid_plan, TASK);
is('1  levels, capital, bounds, stop and the token read from the sentence', u.levels === 45 && u.capitalUsd === 5000 && u.lowerPrice === 500 && u.upperPrice === 5500 && u.stopPrice === 400 && String(u.token).toLowerCase() === WBNB.toLowerCase(), JSON.stringify(u));
const params = { ...U.understand(S.SERVICES.grid_plan, TASK), ...S.extractParams(TASK, {}), service: 'grid_plan' };
is('2  the delivery params carry them and need nothing more', S.missingInput('grid_plan', params) === null && params.levels === 45 && params.lowerPrice === 500, JSON.stringify(params));

if (offline) console.log('skip  3-4 (live)');
else {
  let r = null; try { r = (await S.doWork('grid_plan', params)).plan; } catch (e) { r = { error: e.message }; }
  const g = r?.grid || {};
  is('3  planned between 500 and 5500 with 45 levels and $5,000, the stop reported', g.levels === 45 && g.lower_price === 500 && g.upper_price === 5500 && g.capital_usd === 5000 && g.stop_below === 400 && g.prices?.length === 45, r?.error || JSON.stringify({ levels: g.levels, lo: g.lower_price, hi: g.upper_price, cap: g.capital_usd, stop: g.stop_below }));
  let b = null; try { b = (await S.doWork('grid_plan', { token: WBNB, levels: 10, bandPct: 15, capitalUsd: 1000 })).plan; } catch (e) { b = { error: e.message }; }
  is('4  without bounds: ±15 % around the price, as before', b?.grid?.band_pct === 15 && b.grid.levels === 10 && b.grid.lower_price < b.token.price_usd && b.grid.upper_price > b.token.price_usd, b?.error || '');
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
