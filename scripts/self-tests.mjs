#!/usr/bin/env node
// Runs every script's own --self-test, one after the other, and says which passed.
//
// Why this exists: on 2026-09-20 `build-services.mjs --self-test` was found
// throwing "Cannot access 'ASKED_FLOOR' before initialization" — since the day
// the requests floor was added, weeks earlier. Every checker here carries a
// self-test so that a broken checker cannot pass for a clean result, and no run
// ever started them all: a self-test nobody runs is a promise nobody keeps.
//
//   node scripts/self-tests.mjs             the offline ones (no browser)
//   node scripts/self-tests.mjs --browser   also scripts/dashboard-check/* (needs Chrome, reads the live site)
//   node scripts/self-tests.mjs --only lp   only files whose name contains "lp"
//
// The list is discovered, not written down: a file counts when its code tests
// for the argument (includes('--self-test') / has('self-test')), so a new
// checker is picked up the day it is written. A file that only MENTIONS the
// argument in a comment is not run — starting a script that has no self-test
// branch with an argument it ignores would start the script itself.
// Nothing here moves money or writes on-chain: every script in this folder
// acts only with --confirm, and none is given it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const BROWSER = args.includes('--browser');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const TIMEOUT_MS = 5 * 60 * 1000;

const BRANCH = /includes\((['"])--self-test\1\)|has\((['"])-{0,2}self-test\2\)/;
const SELF = path.basename(import.meta.filename);
// Scripts in scripts/ whose self-test drives a real browser over the live site
// (found on the first run, 2026-09-20: layout-audit walks every page before its
// canary and gave no verdict in five minutes). They run with --browser only.
const NEEDS_BROWSER = new Set(['layout-audit.mjs']);

const dirs = ['scripts', ...(BROWSER ? ['scripts/dashboard-check'] : [])];
const files = dirs.flatMap((d) => fs.readdirSync(path.join(ROOT, d))
  .filter((f) => f.endsWith('.mjs') && f !== SELF)
  .map((f) => path.join(d, f)))
  .filter((rel) => BRANCH.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')))
  .filter((rel) => BROWSER || !NEEDS_BROWSER.has(path.basename(rel)))
  .filter((rel) => !only || path.basename(rel).includes(only))
  .sort();

if (!files.length) { console.error('no script with a self-test matched.'); process.exit(1); }

console.log(`Self-tests — ${files.length} scripts${BROWSER ? ' (browser checks included)' : ''}\n`);
const failed = [];
const t0 = Date.now();
for (const rel of files) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, rel), '--self-test'], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  const pass = !r.error && r.status === 0;
  // The last line a test printed is its verdict in its own words; on a failure the
  // end of stderr says why.
  const lastOf = (s) => String(s || '').trim().split('\n').filter((l) => l.trim()).slice(-1)[0] || '';
  const verdict = pass ? lastOf(r.stdout) : (timedOut ? `no verdict within ${TIMEOUT_MS / 60000} min` : (lastOf(r.stderr) || lastOf(r.stdout) || `exit ${r.status}`));
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${rel.replace(/\\/g, '/').padEnd(46)} ${secs.padStart(6)} s  ${verdict.trim().slice(0, 110)}`);
  if (!pass) failed.push(rel);
}
console.log(`\n${files.length - failed.length}/${files.length} self-tests pass (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
if (failed.length) console.log('failing: ' + failed.map((f) => f.replace(/\\/g, '/')).join(', '));
process.exitCode = failed.length ? 1 : 0;
