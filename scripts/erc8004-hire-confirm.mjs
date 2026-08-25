#!/usr/bin/env node
// Asks every agent the page offers for a price, and writes down what happened.
//
// Why this exists: on 25 August eleven rows carried a "Hire" button and three
// of them could actually quote. The rest answered with unparseable JSON, a
// permission error from their own wallet store, or an A2A schema complaint.
// Every one of those is a real state of this chain — but a page whose whole
// argument is "other people's agent numbers are unverified" cannot ship eleven
// buttons of its own on the strength of a capability flag it never tested.
//
//   node scripts/erc8004-hire-confirm.mjs --dir erc8004-v2
//   node scripts/erc8004-hire-confirm.mjs --dir erc8004-v2 --dry
//
// Reads data/<dir>/hireable.json (written by the publish step, so the
// population tested is exactly the set of buttons on the page) and writes
// data/<dir>/hire-confirm.json, which the next publish renders per row.
//
// What is sent is the ERC-8183 negotiation step and nothing else: a request for
// a price, matched to the category the agent is listed under. No skill is ever
// invoked — a stranger's agent should not do real work to satisfy our curiosity,
// and a quote is the one message a seller exists to answer.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DRY = process.argv.includes('--dry');
const DIR = path.join(ROOT, 'data', arg('dir', 'erc8004'));
const ORIGIN = arg('origin', 'https://agent.brainonbnb.com');

const INPUT = path.join(DIR, 'hireable.json');
const OUTPUT = path.join(DIR, 'hire-confirm.json');

if (!fs.existsSync(INPUT)) {
  console.error(`${INPUT} not found — run scripts/erc8004-publish.mjs first.`);
  process.exit(1);
}
const { agents } = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
if (!agents?.length) {
  console.error('hireable.json lists nobody.');
  process.exit(1);
}

// One task per category, phrased the way a buyer would phrase it. A seller that
// prices its own advertised service on a matching request is hireable; one that
// cannot is not, whatever its registration says. Generic wording is deliberately
// avoided — "give me a quote for your standard service" got a no-quote out of
// our own agents, which would have been a finding about the question.
const TASK = {
  rebalancing: 'quote rebalancing my liquidity position back to its target range',
  'grid-trading': 'quote a grid trading plan for the BNB/USDT pair',
  'yield-optimization': 'quote finding the best yield for my BNB on BNB Chain',
  'health-factor': 'monitor the health factor on my Venus position',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let quoting = 0;

for (const a of agents) {
  // Same origin, same endpoint, same negotiation the button on the page runs.
  // Testing a different path would prove something about the test.
  let body = null;
  let err = null;
  try {
    const r = await fetch(`${ORIGIN}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: String(a.id), task: TASK[a.category] || TASK.rebalancing }),
      signal: AbortSignal.timeout(90000),
    });
    body = await r.json();
  } catch (e) {
    err = String(e.message || e).slice(0, 160);
  }

  const price = body?.quote?.price || null;
  const quotes = !!(body?.negotiated && price);
  if (quotes) quoting++;

  // The reason is kept verbatim. A seller that fails with its own wallet-store
  // permission error is a different fact from one that is simply offline, and
  // flattening both to "unavailable" would throw away the more interesting half.
  const reason = quotes ? null : (err || body?.error || 'no quote in the answer').slice(0, 140);

  results.push({
    id: a.id,
    label: a.label,
    category: a.category,
    ours: !!a.ours,
    quotes,
    price,
    endpoint: body?.endpoint || null,
    reason,
  });

  console.log(`  ${quotes ? 'quotes' : '  --  '}  ${String(a.id).padEnd(7)} ${a.label.slice(0, 34).padEnd(35)} ${quotes ? price : reason}`);

  // One at a time, with a pause. These are strangers' servers and the whole
  // point is to be the kind of caller we wish other people's scanners were.
  await sleep(500);
}

console.log(`\n${quoting} of ${results.length} returned a price when asked.`);

if (DRY) {
  console.log('--dry: nothing written');
  process.exit(0);
}

const out = {
  what_this_is: 'What happened when every agent offered on /registry was asked for a price over ERC-8183. Only the negotiation step was sent; no skill was invoked.',
  measured_at: new Date().toISOString(),
  asked: results.length,
  quoted: quoting,
  agents: results,
};
fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
