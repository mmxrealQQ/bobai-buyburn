#!/usr/bin/env node
// scripts/advantage-refresh.mjs publishes /advantage only from a whole run (2026-11-19: two runs that day failed on our
// own line, "fetch failed"). Pins the gate on the published report and on the shapes of those two failed runs.
import fs from 'node:fs';
import path from 'node:path';
import { reportGaps } from './advantage-refresh.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

const good = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'advantage', 'report.json'), 'utf8'));
check(reportGaps(good).length === 0, 'the published report is whole', reportGaps(good).join('; '));
// a refusal by the public node is a finding, not a gap
const copy = () => JSON.parse(JSON.stringify(good));
let refused = copy(); refused.tasks[0].manual = { ms: 900, requests: 22, answer: { answered: false, could_not_answer: 'the public node refused the log range' } };
check(reportGaps(refused).length === 0, 'a hand path the public node refused still publishes');
let r = copy(); r.tasks[0].agent = { error: 'fetch failed' }; r.tasks[0].manual = { error: 'fetch failed' };
check(reportGaps(r).length === 2, '19.11. run 1: agent and hand path "fetch failed" -> kept', reportGaps(r).join('; '));
r = copy(); r.tasks[0].manual = { error: 'fetch failed' }; r.tasks[0].marketplace.quote = { quoted: false, reason: 'fetch failed' };
check(reportGaps(r).length === 2, '19.11. run 2: hand path + quote "fetch failed" -> kept', reportGaps(r).join('; '));
r = copy(); r.tasks[2].agent.answer.answered = false;
check(reportGaps(r).length === 1, 'an agent that did not answer -> kept');
check(reportGaps({ tasks: [] }).length === 1, 'an empty report -> kept');

console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
