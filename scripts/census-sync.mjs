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

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DIR = path.join(ROOT, 'data', arg('dir', 'erc8004'));
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
