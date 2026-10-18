// The daily second opinion must leave a trace, whatever happens (2026-10-18). On 18.10. the 04:23 hire (job 57021)
// was paid and answered, but the hire took over two minutes, the LP worker gave up after 60 s, and the attempt died
// before its row: no log line, no settle, a red health line that only said "29.9 h ago". Pinned in the source:
//
//   node scripts/smoke-second-opinion.mjs      no network, nothing is sent
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SMOKE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const so = read('worker-agent/second-opinion.js'), agent = read('worker-agent/index.js'), own = read('worker-agent/own-jobs.js');
const lp = read('worker-lp/index.js'), health = read('scripts/lib/health-checks.mjs');

const fails = [];
let pins = 0;
const ok = (cond, what) => { pins++; if (!cond) fails.push(what); };

// the agent worker: a row before the hire, updated after; nothing thrown vanishes; no fetch can hang
const hiring = so.indexOf("status: 'hiring'"), hire = so.indexOf('await hireErc8183Agent(');
ok(hiring > 0 && hire > hiring, 'a "hiring" row is written before the hire goes out');
ok(/status: 'hired, no answer yet', job: jobId[\s\S]*?\/api\/escrow\/jobs`, \{ method: 'POST'/.test(so), 'the job is logged right after the hire, before Mandate is told and polled');
ok(/findIndex\(\(r\) => r\.at === row\.at\)/.test(so), 'one attempt is one row: a later state replaces the earlier one');
ok(/try \{ return await buyOpinion\([\s\S]*?catch \(e\) \{ return log\(env, \{[^}]*status: 'failed'/.test(so), 'anything thrown is logged as failed');
ok((so.match(/fetch\([^;]*signal: AbortSignal\.timeout\(/g) || []).length >= 3, 'every fetch to Mandate has a time limit');
ok(/ctx\.waitUntil\(work\.then\(/.test(agent) && /return json\(await work\)/.test(agent), 'the hire is kept alive by waitUntil when the caller stops waiting');
ok(/Promise\.race\(\[lpPositionLook\(\{ address: SUBJECT \}/.test(agent), 'the agent\'s own look has a time limit');
ok(/last_ask: await env\.AGENT\.get\('opinion:ask:last'/.test(agent), 'GET /second-opinion shows the LP worker\'s last ask');
ok(/readOpinions\(env\)\)\.map\(\(o\) => o\.job\)/.test(own) && /\.\.\.bought,/.test(own), 'every bought job joins our own jobs, so it is settled');

// the LP worker: waits long enough, keeps every outcome, asks again only when nothing was hired
const t = Number((lp.match(/second-opinion', \{[^\n]*AbortSignal\.timeout\((\d+)\)/) || [])[1]);
ok(t >= 300000, `the LP worker waits at least five minutes for a hire (waits ${t} ms)`);
ok(/put\('opinion:ask:last'/.test(lp), 'the LP worker keeps the outcome of every ask in KV');
ok(/ctx\.waitUntil\(dailySecondOpinion\(env\)/.test(lp), 'the daily cron uses the ask that asks again');
const again = lp.indexOf("askSecondOpinion(env, 'daily, asked again')"), check = lp.indexOf("o.job || o.status === 'hiring'");
ok(check > 0 && again > check, 'before asking again it reads the log: a first ask that hired after all is not bought twice');
ok(/if \(first\.job \|\| first\.status === 'refused'/.test(lp), 'a hire or a refusal is not asked again');

// the health line names the reason when it is red
ok(/last ask \$\{ask\.at/.test(health) && /fresh \? '' : askNote/.test(health), 'the red health line carries the last ask and its reason');

if (fails.length) { console.log(`smoke-second-opinion: ${fails.length} FAIL`); for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
console.log(`smoke-second-opinion: ${pins}/${pins} PASS`);
