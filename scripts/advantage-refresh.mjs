#!/usr/bin/env node
// THE ADVANTAGE REPORT, KEPT CURRENT WITHOUT EVER PUBLISHING A BROKEN RUN (2026-11-19). /advantage was submitted to
// the TermiX bounty of Build the Era and judges read it live; on 19.11. it still said "measured 2026-11-02" and quoted
// the agents at 0.01 $U, the sale price that ended on 5 Nov. A re-run from this machine that day failed twice on its
// own line ("fetch failed" on the public node and the agent side) — a page built from that would have said the agent
// failed. So: back up the report, measure, and publish only when the run is whole:
//   - every agent path answered, with no error of its own
//   - the hand-done path has no transport error (a refusal by the public node is a finding and stays; "fetch failed"
//     is our line and is not)
//   - every marketplace quote came back
// Otherwise the old report is put back and the page is left as it was (exit 0, said in the log: the weekly chain
// carries on). Step "advantage" of scripts/plaza-refresh.mjs, before its publish + deploy; by hand:
//   node scripts/advantage-refresh.mjs        (then deploy the site)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT = path.join(ROOT, 'data', 'advantage', 'report.json');

// why a report must not be published; [] = whole
export function reportGaps(r) {
  const gaps = [];
  if (!Array.isArray(r?.tasks) || r.tasks.length < 3) return ['fewer than three tasks'];
  for (const [i, t] of r.tasks.entries()) {
    const n = `task ${i + 1}`;
    if (t.agent?.error || t.agent?.answer?.answered === false || !t.agent?.answer) gaps.push(`${n}: agent ${t.agent?.error || 'did not answer'}`);
    if (t.manual?.error) gaps.push(`${n}: hand path ${t.manual.error}`);
    if (t.marketplace && t.marketplace.quote?.quoted !== true) gaps.push(`${n}: no marketplace quote (${t.marketplace.quote?.reason || 'none'})`);
  }
  return gaps;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const old = fs.existsSync(REPORT) ? fs.readFileSync(REPORT) : null;
  const run = spawnSync('node', ['scripts/advantage-report.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 1800e3, maxBuffer: 16 * 1024 * 1024 });
  let gaps;
  try { gaps = run.status === 0 ? reportGaps(JSON.parse(fs.readFileSync(REPORT, 'utf8'))) : [`the measurement exited ${run.status}`]; } catch (e) { gaps = [`report unreadable: ${e.message}`]; }
  if (gaps.length) {
    if (old) fs.writeFileSync(REPORT, old);
    console.log(`kept the previous report — this run was not whole: ${gaps.join('; ')}`);
    process.exit(0);
  }
  const pub = spawnSync('node', ['scripts/advantage-publish.mjs'], { cwd: ROOT, encoding: 'utf8' });
  if (pub.status !== 0) { if (old) fs.writeFileSync(REPORT, old); console.log(`publish failed, previous report kept: ${(pub.stderr || pub.stdout).slice(-300)}`); process.exit(1); }
  console.log(`advantage report renewed: ${JSON.parse(fs.readFileSync(REPORT, 'utf8')).measured_at}`);
}
