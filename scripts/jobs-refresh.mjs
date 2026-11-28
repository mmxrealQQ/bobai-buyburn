#!/usr/bin/env node
// THE ESCROW JOBS, READ EVERY DAY (2026-11-19). The health check "the screener's paid work was read from the escrow
// within 3 days" went red on 18.11.: the jobs were read only by the weekly Plaza refresh (Sunday), so the file was
// 3+ days old from every Wednesday on — a red point each week by design, and every agent chart a few days behind.
// This is the short, daily part of that chain (about a minute): job scan (resumes, only new ids) → agent jobs →
// publish (the registry page carries the same totals, so chart and page stay level — the 28.10. "8 beside 9") →
// deploy site → read measured_at back from brainonbnb.com. Stops at the first step that fails (a half-run never
// deploys). Run daily by the Windows task "BOBAI jobs refresh" (scripts/jobs-refresh-task.cmd); by hand:
//   node scripts/jobs-refresh.mjs
//
// It never ships someone's unfinished work: before it starts and again before the deploy, every changed file under
// dashboard/ must be one this chain writes (api-*.json, registry.html); anything else and it stops without deploying.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tellOperator } from './lib/task-alarm.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG = path.join(ROOT, 'data', 'jobs-refresh.log');
const say = (t) => { const l = `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${t}`; console.log(l); fs.appendFileSync(LOG, l + '\n'); };
// what this chain writes, AND what the Plaza refresh (05:00, an hour before) writes and leaves uncommitted: advantage.html
// was missing, so from 21.11. to 28.11. every daily run stopped on the Plaza refresh's own output (2026-11-28)
export const OWN_OUTPUT = /^dashboard\/(api-[a-z0-9-]+\.json|registry\.html|advantage\.html)$/;
// a stopped run tells the operator (scripts/lib/task-alarm.mjs, 2026-11-28)
const stop = async (msg) => { say(msg); await tellOperator('⚠️ Jobs refresh (local task): ' + msg + ' · log data/jobs-refresh.log'); process.exit(1); };

function foreignChanges() {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'dashboard'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return ['(git status failed)'];
  return r.stdout.split('\n').filter(Boolean).map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter((f) => !OWN_OUTPUT.test(f));
}

const STEPS = [
  ['job scan', 'node', ['scripts/erc8183-job-scan.mjs']],
  ['agent jobs', 'node', ['scripts/agent-jobs-export.mjs']],
  ['publish', 'node', ['scripts/erc8004-publish.mjs', '--dir', 'erc8004-v2']],
  ['deploy site', 'node', ['scripts/deploy-dashboard.mjs']],
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  say('jobs refresh started');
  for (const [name, cmd, args] of STEPS) {
    if (name === 'job scan' || name === 'deploy site') {
      const other = foreignChanges();
      if (other.length) await stop(`stopped before "${name}": dashboard/ holds work this chain did not write (${other.slice(0, 5).join(', ')}${other.length > 5 ? ' …' : ''}) — nothing deployed`);
    }
    const t0 = Date.now();
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 3600e3, maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').filter((l) => !/UV_HANDLE_CLOSING/.test(l));
    const ok = r.status === 0;
    say(`${ok ? 'ok  ' : 'FAIL'} ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n${out.slice(-3).map((l) => '    ' + l.slice(0, 200)).join('\n')}`);
    if (!ok) await stop(`stopped at "${name}" — nothing after it ran`);
  }
  const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'dashboard', 'api-agent-jobs.json'), 'utf8')).measured_at;
  let live = null;
  for (let i = 0; i < 6 && live !== local; i++) {
    if (i) await new Promise((r) => setTimeout(r, 20e3));
    live = await fetch('https://brainonbnb.com/api-agent-jobs.json?r=' + Date.now(), { cache: 'no-store' }).then((r) => r.json()).then((j) => j.measured_at).catch(() => null);
  }
  if (live !== local) await stop(`FAIL live measured_at ${live} ≠ local ${local}`);
  say(`done · live measured_at ${live}`);
  process.exit(0);
}
