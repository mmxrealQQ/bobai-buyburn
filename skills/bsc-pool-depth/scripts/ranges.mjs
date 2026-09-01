#!/usr/bin/env node
// Command-line front end for the PancakeSwap range replay.
//
// A third question, after scan.mjs ("what does a trade cost") and tiers.mjs
// ("which of the five pools should the liquidity be in"). This is the one
// concentrated liquidity actually forces: a V3 position is not in a pool, it is
// between two prices, and the range moves the outcome by orders of magnitude
// more than the tier does.
//
// It does not forecast. The V3 Swap event carries the liquidity that was active
// when each trade went through, so a position of the size given is walked back
// through the swaps that really happened and asked, at each one, whether it was
// in range and what share of the liquidity standing there it would have been.
//
// As with the other two, every measurement lives one layer down in
// range-scan.mjs, which is pulled in at build time from the site's own source
// (see scripts/build-skill.mjs) rather than kept here as a second copy.
//
// Usage:  node ranges.mjs <token-or-v3-pool-address> [--usd 1000]
import { rangePlan } from './range-scan.mjs';

const argv = process.argv.slice(2);
const parseInput = (s) => {
  const m = String(s || '').match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
};
const addr = parseInput(argv.find((a) => !a.startsWith('--')));
const usdArg = argv.find((a) => a.startsWith('--usd'));
const capitalUsd = usdArg
  ? Number(usdArg.includes('=') ? usdArg.split('=')[1] : argv[argv.indexOf(usdArg) + 1])
  : undefined;

if (!addr) {
  console.error('Usage: node ranges.mjs <bsc-token-or-v3-pool-address> [--usd 1000]');
  console.error('A token address picks the V3 tier standing the most capital at the price.');
  console.error('A pool address pins the replay to that pool.');
  process.exit(2);
}

try {
  console.log(JSON.stringify(await rangePlan(addr, { capitalUsd }), null, 2));
} catch (e) {
  console.log(JSON.stringify({
    error: e.headline || 'Range replay failed.',
    detail: e.detail || e.message || null,
  }, null, 2));
  process.exit(1);
}
