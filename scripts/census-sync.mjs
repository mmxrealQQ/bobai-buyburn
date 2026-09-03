#!/usr/bin/env node
// Hands the finished offline scan to the live worker.
//
// This step used to be three curl commands typed from memory after every full
// scan, and on 25 August it was simply forgotten: the page published 302,828
// while the worker's live counter still read 299,783 from the previous
// baseline — so the headline on /registry loaded correct and was then
// overwritten downward by its own "live" figure. A step that only exists in a
// human's head is a step that gets skipped, so it is a script now and it runs
// as part of the publish ritual.
//
//   node scripts/census-sync.mjs --dir erc8004-v2
//
// Sends the endpoint list the rotating reachability check walks through, plus
// the scan's high-water mark as the new baseline. Verifies afterwards, because
// a sync that reports success without reading back what the worker now serves
// is the same trust-me step in a new costume.

import fs from 'node:fs';
import path from 'node:path';
import { CENSUS_DIR } from './lib/census-dir.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DIR = path.join(ROOT, 'data', arg('dir', CENSUS_DIR));
const ORIGIN = arg('origin', 'https://agent.brainonbnb.com');

const secret = (() => {
  if (process.env.HIT_SECRET) return process.env.HIT_SECRET;
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return null;
  const m = fs.readFileSync(envFile, 'utf8').match(/^HIT_SECRET=(.*)$/m);
  return m ? m[1].trim() : null;
})();
if (!secret) {
  console.error('HIT_SECRET not found in the environment or .env — cannot sync.');
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(path.join(DIR, 'scan-state.json'), 'utf8'));
const highestId = state.highestId;
if (!Number.isInteger(highestId) || highestId < 1) {
  console.error(`scan-state.json has no usable highestId (${highestId}).`);
  process.exit(1);
}

// One entry per id, first http endpoint it names — the same rule the worker
// applies to registrations it reads itself, so the two halves of the rotation
// stay comparable.
const endpoints = [];
for (const line of fs.readFileSync(path.join(DIR, 'agents-with-endpoints.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  const url = (rec.endpoints || []).find((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  if (!url || !Number.isInteger(rec.id)) continue;
  endpoints.push({ id: rec.id, url: url.slice(0, 300) });
}
if (!endpoints.length) {
  console.error('No endpoints parsed — refusing to overwrite the live list with nothing.');
  process.exit(1);
}

console.log(`Scan ${path.basename(DIR)}: highest id ${highestId.toLocaleString('en-US')}, ${endpoints.length} endpoints.`);

const post = async (url, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hit-secret': secret },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
};

const put = await post(`${ORIGIN}/census-endpoints?highestId=${highestId}`, endpoints);
console.log(`  stored ${put.stored} endpoints, baseline ${put.baseline_highest_id}`);

// Read back what the worker now publishes. The whole failure this script exists
// to prevent was invisible from the sending side.
const live = await fetch(`${ORIGIN}/census`, { cache: 'no-store' }).then((r) => r.json());
console.log(`  /census now reports highest_id ${Number(live.highest_id).toLocaleString('en-US')}`);
if (live.highest_id < highestId) {
  console.error(`\nSync did not take: /census still reads below the scan (${live.highest_id} < ${highestId}).`);
  process.exit(1);
}
console.log('\nLive counter is level with the scan.');

// The scan as a fixed point in the series. /census-full existed from the
// start and nothing ever called it: the 29 August scan (316,472 ids, 796
// answering, 72 operators) synced its baseline but never its record, so the
// "How it is moving" block on /registry kept quoting the 21 August scan as
// "the last full scan" while the growth figure beside it was measured against
// the newer one — two numbers on one line that could not both be true.
const censusFile = path.join(DIR, 'census.json');
const operatorsFile = path.join(ROOT, 'dashboard', 'api-operators.json');
if (fs.existsSync(censusFile)) {
  const c = JSON.parse(fs.readFileSync(censusFile, 'utf8'));
  const ops = fs.existsSync(operatorsFile) ? JSON.parse(fs.readFileSync(operatorsFile, 'utf8')) : {};
  const point = {
    date: String(c.measured_at || '').slice(0, 10) || undefined,
    registered_ids: c.registered_ids,
    parse: c.registrations?.valid ?? null,
    with_endpoint: c.endpoints?.claim_an_endpoint ?? null,
    reachable: c.endpoints?.reachable ?? null,
    operators: ops.independent_operators ?? null,
    mcp: c.endpoints?.answering_mcp ?? null,
  };
  const rec = await post(`${ORIGIN}/census-full`, point);
  console.log(`  full scan recorded: ${rec.recorded.date} — ${rec.recorded.registered_ids.toLocaleString('en-US')} ids, ${rec.recorded.reachable} answering, ${rec.recorded.operators} operators (${rec.points} points in the series)`);
  const hist = await fetch(`${ORIGIN}/census-history`, { cache: 'no-store' }).then((r) => r.json());
  const lastFull = (hist.full_scans || []).slice(-1)[0];
  if (!lastFull || lastFull.registered_ids !== c.registered_ids) {
    console.error(`\nThe series did not take: last full scan reads ${lastFull?.registered_ids} not ${c.registered_ids}.`);
    process.exit(1);
  }
  console.log('The series carries this scan as its last full point.');
} else {
  console.log('  (no census.json in this directory — the series keeps its last full point)');
}
