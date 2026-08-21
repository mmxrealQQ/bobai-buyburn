#!/usr/bin/env node
// Command-line front end for the pool scan.
//
// Every measurement, guard and caveat lives in scanner-scan.mjs, which is the
// same file the website's MCP tool imports and which sits on top of the same
// chain layer the browser scanner uses. This file only turns an argument into
// an address and a result into stdout.
//
// Both scanner-scan.mjs and scanner-chain.mjs are pulled in at build time from
// the site's own source (see scripts/build-skill.mjs) rather than kept here as
// copies, so a fix to a fee table or an impact formula reaches this skill on
// the next build instead of drifting quietly out of date.
//
// Usage:  node scan.mjs <token-or-pool-address>
//         node scan.mjs https://bscscan.com/token/0x…
import { scan } from './scanner-scan.mjs';

const parseInput = (s) => {
  const m = String(s || '').match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
};

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const addr = parseInput(arg);
if (!addr) {
  console.error('Usage: node scan.mjs <bsc-token-or-pool-address>');
  console.error('Accepts a bare address or any BscScan / DexScreener / PancakeSwap link containing one.');
  process.exit(2);
}
try {
  console.log(JSON.stringify(await scan(addr), null, 2));
} catch (e) {
  console.log(JSON.stringify({
    error: e.headline || 'Scan failed.',
    detail: e.detail || e.message || String(e),
    address: addr,
  }, null, 2));
  process.exit(1);
}
