#!/usr/bin/env node
// Command-line front end for the pre-trade check: the pool scan and the route
// check in one answer, at the size about to be traded.
//
// What an automated trade asks before it signs is always the same two things —
// can I get in and out again, and what does the trip cost — and the answers
// were spread over scan.mjs and route.mjs, to be joined by whoever called them.
// This returns the short form: `stop[]` (facts that end the trade: the sell
// does not go through, nothing quotes, the route's own refusal), `caution[]`
// (facts to weigh, each with its figure and the line it was measured against,
// so the caller can disagree with the line), then entry, exit, tax and depth.
//
// No "safe", no score. A figure that could not be measured stays null: an
// unknown tax is never 0, a simulation that did not run is never "sellable".
//
// As with the others here, nothing is measured in this file. token-preflight.mjs
// is pulled in at build time from the site's own source (dashboard/preflight.js,
// the module behind the bsc_token_preflight MCP tool) and asks the same scan
// and the same route check the other scripts print in full.
//
// Usage:  node preflight.mjs <token-or-pool-address> [--usd 250]
import { preflight } from './token-preflight.mjs';

const argv = process.argv.slice(2);
const m = String(argv.find((a) => !a.startsWith('--')) || '').match(/0x[a-fA-F0-9]{40}/);
const usdArg = argv.find((a) => a.startsWith('--usd'));
const usd = usdArg
  ? Number(usdArg.includes('=') ? usdArg.split('=')[1] : argv[argv.indexOf(usdArg) + 1])
  : undefined;

if (!m) {
  console.error('Usage: node preflight.mjs <bsc-token-or-pool-address> [--usd 250]');
  console.error('One answer before a trade: what stops it, what to weigh, entry, exit, tax and depth at that size.');
  process.exit(2);
}

try {
  // process.env only so that your own GOPLUS_APP_KEY / GOPLUS_APP_SECRET are
  // picked up, exactly as in scan.mjs. Without them the contract flags come
  // back as not checked; everything measured on-chain needs no key.
  console.log(JSON.stringify(await preflight(m[0].toLowerCase(), { usd }, process.env), null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: e.headline || 'Preflight failed.', detail: e.detail || e.message || null }, null, 2));
  process.exitCode = 1;
}
