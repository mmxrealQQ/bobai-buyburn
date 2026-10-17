#!/usr/bin/env node
// scripts/pool-scan-shape-check.mjs — what an outside pool scan found, and the scans that were refused, are counted (2026-10-17)
//
// /stats/detail of 16./17.10.: ~460 outside pool scans a day, nearly all by one trading bot; the counter saw only the
// answered ones (14 of 86 by 05 UTC on 17.10.) and named every scan without a pool 'none' — a four.meme curve, a
// one-sided pool, a sliver and no pool at all alike. This checks, offline against dashboard/_worker.js: scanShape names
// each answer shape apart, REST and MCP count with it, and a refused outside scan counts poolscan:err:<code> and its
// client under poolscanua.
//
//   node scripts/pool-scan-shape-check.mjs     exit 1 on any FAIL
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'dashboard', '_worker.js'), 'utf8');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

const fnText = src.match(/function scanShape\(out\) \{[\s\S]*?\n\}/)?.[0];
check(!!fnText, 'scanShape exists in dashboard/_worker.js');
const scanShape = fnText ? new Function(`${fnText}; return scanShape;`)() : () => null;
const cases = [
  [{ pool: { kind: 'v2' } }, 'v2'],
  [{ pool: { kind: 'v3' } }, 'v3'],
  [{ quotable: false, curve: { platform: 'four.meme' }, venues: [] }, 'curve'],
  [{ quotable: false, liquidity: { readablePoolUsd: 0, elsewhereUsd: 0 }, oneSidedPools: [{}] }, 'onesided'],
  [{ quotable: false, liquidity: { readablePoolUsd: 800, elsewhereUsd: 90000 } }, 'sliver'],
  [{ quotable: false, liquidity: { readablePoolUsd: 0, elsewhereUsd: 5000 } }, 'elsewhere'],
  [{ quotable: false, liquidity: { readablePoolUsd: 0, elsewhereUsd: 0 } }, 'nopool'],
];
for (const [out, want] of cases) check(scanShape(out) === want, `scanShape names '${want}'`, `got ${scanShape(out)}`);

const route = src.slice(src.indexOf("'/api/pool-scan': 'bsc_pool_scan'"), src.indexOf('THE SITEMAP KEEPS ITSELF'));
check(/poolscan:nooffer:\$\{scanShape\(out\)\}/.test(route), 'REST counts an answer without the offer by its shape');
check(/const outsideScan = !isOwn && !siteCall/.test(route), 'the site\'s own pages and our own workers stay out of the scan counters');
const catchPart = route.slice(route.indexOf('} catch (e) {'));
check(/if \(outsideScan\) count\(null, \[`poolscan:err:\$\{[^`]*\}`, `poolscanua:\$\{product\}`\]\)/.test(catchPart), 'a refused outside scan counts poolscan:err:<code> and its client');
check(/poolscan:nooffer:\$\{scanShape\(read\)\}/.test(src), 'MCP counts with the same shape');
check(!/poolscan:nooffer:\$\{String\([a-z]+\?\.pool\?\.kind \|\| 'none'\)/.test(src), "no counter still lumps every poolless scan under 'none'");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
