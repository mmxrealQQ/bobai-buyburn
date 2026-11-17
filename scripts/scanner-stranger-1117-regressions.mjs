#!/usr/bin/env node
// Stranger test of /scanner, 2026-11-17: three things the API said that were not so.
//   1. a four.meme curve token: preflight token.price_usd null while pool-scan had curve.priceUsd
//   2. an owner the scanner knows by name (four.meme's manager, MasterChef v1) told as
//      "a contract (a multisig, a timelock or anything else — not read further)"
//   3. LP custody burnedPct floored row by row: dead 0.000138% + zero 0.000069% -> 0.0001
//      beside lp.burnedPct 0.0002 in the same answer
// Offline.  node scripts/scanner-stranger-1117-regressions.mjs
import { registerHooks } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
registerHooks({
  load(url, ctx, next) { return /\/(dashboard|shared)\/(?:i18n\/)?[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); },
});
const dash = path.resolve(import.meta.dirname, '../dashboard');
const { shape, controlBlock } = await import(pathToFileURL(path.join(dash, 'preflight.js')).href);

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

// 1
const curve = { address: '0xc', symbol: 'C', name: 'C', quotable: false, reason: 'curve', curve: { progressPct: 62.1, feePct: 1, sellQuoted: true, priceUsd: 2.523712345e-5, tradeCost: [{ sizeUsd: 100, buyCostPct: 1.2, sellCostPct: 1.3 }] } };
let o = shape(curve, null, 100);
ok('a curve token carries the curve price in token.price_usd', o.token.price_usd === 2.52371e-5, String(o.token.price_usd));
o = shape({ ...curve, curve: { ...curve.curve, priceUsd: null } }, null, 100);
ok('… and null when the curve has none (never 0)', o.token.price_usd === null, String(o.token.price_usd));
o = shape({ ...curve, price: { usd: 3e-5 } }, null, 100);
ok('… a pool price still comes first', o.token.price_usd === 3e-5, String(o.token.price_usd));

// 2
const ctl = (address, kind) => controlBlock({ read: true, owner: { address, kind, source: 'owner()' }, proxy: null, mint_selector: false });
let c = ctl('0x5c952063c7fc8610ffdb798152d69f0b9550762b', 'contract');
ok('four.meme’s manager is named, not "not read further"', /four\.meme/.test(c.owner_note) && !/not read further/.test(c.owner_note) && /four\.meme/.test(c.owner.name || ''), c.owner_note);
c = ctl('0x73feaa1ee314f8c655e354234017be2193c9e24e', 'contract');
ok('MasterChef v1 is named as pool-scan names it', c.owner_note === 'The owner is a contract: PancakeSwap MasterChef v1.', c.owner_note);
c = ctl('0x' + '1'.repeat(40), 'contract');
ok('an unknown contract keeps the old sentence and no name', /not read further/.test(c.owner_note) && !('name' in c.owner), c.owner_note);
c = ctl('0x' + '2'.repeat(40), 'eoa');
ok('a plain wallet is still a plain wallet', c.owner_note === 'The owner is a plain wallet: one private key.');

// 3 (source: the custody read talks to the chain; its arithmetic is pinned here)
const src = fs.readFileSync(path.join(dash, 'scanner-chain.js'), 'utf8');
const body = src.slice(src.indexOf("const rows=list.map((a,i)=>{"), src.indexOf("burnedPct:sum('burned')"));
ok('custody rows keep the unrounded share (no floor per row)', body.length > 200 && !/pct:Math\.floor/.test(body));
const fl4 = new Function(`${(body.match(/const fl4=[^;]+;/) || [''])[0]} return typeof fl4==='function'?fl4:null;`)();
ok('the sum is floored once: 0.000138 + 0.000069 -> 0.0002', !!fl4 && fl4(0.000138 + 0.000069) === 0.0002 && fl4(99.99029) === 99.9902);

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
