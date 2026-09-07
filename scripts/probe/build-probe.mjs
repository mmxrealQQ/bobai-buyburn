#!/usr/bin/env node
// Compiles SellProbe.sol and prints the runtime bytecode the scanner places at
// a fresh address by state override. Not a build step of the site: the bytes
// are pasted into dashboard/scanner-chain.js once, with the compiler version,
// and this script exists so anyone can reproduce them.
//
//   npm i --no-save solc@0.8.36
//   node scripts/probe/build-probe.mjs            prints runtime bytecode + selectors
//   node scripts/probe/build-probe.mjs --check    exits 1 if scanner-chain.js carries different bytes
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = fs.readFileSync(path.join(here, 'SellProbe.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'SellProbe.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { SellProbe: ['evm.deployedBytecode.object', 'evm.methodIdentifiers'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
if (errors.length) { for (const e of errors) console.error(e.formattedMessage); process.exit(1); }
const c = out.contracts['SellProbe.sol'].SellProbe;
const code = '0x' + c.evm.deployedBytecode.object;
const sel = c.evm.methodIdentifiers;

if (process.argv.includes('--check')) {
  const chain = fs.readFileSync(path.join(here, '..', '..', 'dashboard', 'scanner-chain.js'), 'utf8');
  const m = /const SELL_PROBE_CODE='(0x[0-9a-f]+)'/.exec(chain);
  const same = m && m[1] === code;
  console.log(same ? 'scanner-chain.js carries the bytes this source compiles to' : 'scanner-chain.js carries DIFFERENT bytes — recompile and paste');
  process.exit(same ? 0 : 1);
}
console.log(`// solc ${solc.version()} · optimizer 200 · evm paris · ${(code.length - 2) / 2} bytes`);
console.log(`const SELL_PROBE_CODE='${code}';`);
for (const [sig, id] of Object.entries(sel)) console.log(`// ${sig} → 0x${id}`);
