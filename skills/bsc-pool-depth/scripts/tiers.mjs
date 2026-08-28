#!/usr/bin/env node
// Command-line front end for the PancakeSwap fee-tier comparison.
//
// A different question from scan.mjs. That one asks what a trade costs; this
// one asks a liquidity provider which of the five pools that share a pair is
// worth being in — V2 at 0.25%, and V3 at 0.01%, 0.05%, 0.25% and 1.00%.
//
// As with scan.mjs, every measurement and caveat lives one layer down, in
// tier-scan.mjs, which is pulled in at build time from the site's own source
// (see scripts/build-skill.mjs) rather than kept here as a copy.
//
// Usage:  node tiers.mjs <token-or-pool-address>
import { feeTiers } from './tier-scan.mjs';

const parseInput = (s) => {
  const m = String(s || '').match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
};

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const addr = parseInput(arg);
if (!addr) {
  console.error('Usage: node tiers.mjs <bsc-token-or-pool-address>');
  console.error('A token address compares the tiers against whichever quote its own liquidity is deepest in.');
  console.error('A pool address pins the pair to that pool\'s two tokens.');
  process.exit(2);
}
try {
  console.log(JSON.stringify(await feeTiers(addr), null, 2));
} catch (e) {
  console.log(JSON.stringify({
    error: e.headline || 'Tier scan failed.',
    detail: e.detail || e.message || String(e),
    address: addr,
  }, null, 2));
  process.exit(1);
}
