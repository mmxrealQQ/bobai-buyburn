#!/usr/bin/env node
// Command-line front end for the PancakeSwap route and round-trip check.
//
// The two questions to answer before signing a swap. Which of the up-to-five
// pools the pair lives in actually returns the most AT THIS SIZE — quoted by
// the venue, not ranked by depth, because the deepest pool is regularly not the
// cheapest one for the trade being made. And what comes back if the proceeds
// are sold straight back on the same route, with the transfer tax measured from
// executed trades applied to the amounts carried between the legs: the tax is
// taken outside the pool, where no quoter can see it.
//
// It is not a safety certificate and does not use the word. It cannot see an
// owner who has not acted yet, and it says so in the answer.
//
// As with the others here, the measurement lives one layer down in
// swap-route.mjs, pulled in at build time from the site's own source rather
// than kept as a second copy.
//
// Usage:  node route.mjs <token-or-pool-address> [--usd 250]
import { swapRoute } from './swap-route.mjs';

const argv = process.argv.slice(2);
const m = String(argv.find((a) => !a.startsWith('--')) || '').match(/0x[a-fA-F0-9]{40}/);
const usdArg = argv.find((a) => a.startsWith('--usd'));
const usd = usdArg
  ? Number(usdArg.includes('=') ? usdArg.split('=')[1] : argv[argv.indexOf(usdArg) + 1])
  : undefined;

if (!m) {
  console.error('Usage: node route.mjs <bsc-token-or-pool-address> [--usd 250]');
  console.error('Quotes every PancakeSwap route for that size and simulates selling straight back.');
  process.exit(2);
}

try {
  console.log(JSON.stringify(await swapRoute(m[0].toLowerCase(), { usd }), null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: e.headline || 'Route check failed.', detail: e.detail || e.message || null }, null, 2));
  process.exitCode = 1;
}
