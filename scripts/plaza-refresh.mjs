#!/usr/bin/env node
// THE BRAIN PLAZA, KEPT CURRENT BY ITSELF (2026-10-24, operator: "ist das ganze Ecosystem aktuell mit den Zahlen? Brain
// Plaza usw." — the page still said "Measured 2026-10-13": the full pipeline only ran by hand; then "ja, beide Punkte
// machen"). One command for the whole chain in erc8004-publish.mjs's header, in its order, stopping at the first step
// that fails (a half-run must never deploy): scan (resumes, only new ids) → enrich → probe → a2a-confirm → publish →
// deploy site + worker → hire-confirm → publish → deploy site → census-sync → the Plaza page check live. Every step's
// tail and the result go to data/plaza-refresh.log. Run weekly by the Windows task "BOBAI Plaza refresh"
// (scripts/plaza-refresh-task.cmd); by hand: node scripts/plaza-refresh.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG = path.join(ROOT, 'data', 'plaza-refresh.log');
const say = (t) => { const l = `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${t}`; console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const STEPS = [
  ['scan', 'node', ['scripts/erc8004-scan.mjs', '--dir', 'erc8004-v2']],
  ['enrich', 'node', ['scripts/erc8004-enrich.mjs', '--dir', 'erc8004-v2']],
  ['probe', 'node', ['scripts/erc8004-probe.mjs', '--dir', 'erc8004-v2']],
  ['a2a-confirm', 'node', ['scripts/erc8004-a2a-confirm.mjs', '--dir', 'erc8004-v2']],
  // the jobs too (2026-10-30): the page said 'jobs 28 Oct' beside fresh quotes, and four of our agents' charts stood empty
  ['job scan', 'node', ['scripts/erc8183-job-scan.mjs']],
  ['agent jobs', 'node', ['scripts/agent-jobs-export.mjs']],
  ['publish', 'node', ['scripts/erc8004-publish.mjs', '--dir', 'erc8004-v2']],
  ['deploy site', 'node', ['scripts/deploy-dashboard.mjs']],
  ['deploy worker', 'npx', ['wrangler', 'deploy', '--config', 'worker-agent/wrangler.toml']],
  ['hire-confirm', 'node', ['scripts/erc8004-hire-confirm.mjs', '--dir', 'erc8004-v2']],
  ['publish again', 'node', ['scripts/erc8004-publish.mjs', '--dir', 'erc8004-v2']],
  ['deploy site again', 'node', ['scripts/deploy-dashboard.mjs']],
  ['census-sync', 'node', ['scripts/census-sync.mjs', '--dir', 'erc8004-v2']],
  ['plaza page check (live)', 'node', ['temp/newpage/qa/reg1024.mjs', 'https://brainonbnb.com']],
];
say('Plaza refresh started');
for (const [name, cmd, args] of STEPS) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 3 * 3600e3, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').filter((l) => !/UV_HANDLE_CLOSING/.test(l));
  const tail = out.slice(-3).map((l) => '    ' + l.slice(0, 200)).join('\n');
  // the page check reads its own verdict: Node on Windows can abort on exit after the browser closed (UV_HANDLE_CLOSING)
  const ok = name.startsWith('plaza page check') ? /all PASS/.test(out.join('\n')) : r.status === 0;
  say(`${ok ? 'ok  ' : 'FAIL'} ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n${tail}`);
  if (!ok) { say(`stopped at "${name}" — nothing after it ran`); process.exit(1); }
}
const page = await fetch('https://brainonbnb.com/registry?r=' + Date.now()).then((r) => r.text()).catch(() => '');
say(`done · ${(page.match(/Measured [^<]{0,80}/) || ['the page did not answer'])[0]}`);
