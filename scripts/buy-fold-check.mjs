#!/usr/bin/env node
// One transaction, one buy: the Telegram buy alert (worker-tg-bot) and the
// Buy Drops minter (worker-nft-mint) fold a pair's Swap logs per transaction
// before they size a buy. Offline; the fixture is the transaction that showed
// the fault on 2026-09-18 (0x531f2bfb…, an aggregator order routed as two
// swaps on the pair, $366 together, alerted and minted as a $184 buy).
//
//   node scripts/buy-fold-check.mjs
import fs from 'node:fs';
import { foldBuysByTx as foldBot } from '../worker-tg-bot/index.js';
import { foldBuysByTx as foldMint } from '../worker-nft-mint/index.js';

let failed = 0, n = 0;
const ok = (label, pass) => { n++; if (!pass) failed++; console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}`); };
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const swap = (tx, { in0 = 0n, in1 = 0n, out0 = 0n, out1 = 0n }, block = '0x74e2aa8') => ({ transactionHash: tx, blockNumber: block, data: '0x' + word(in0) + word(in1) + word(out0) + word(out1) });

const TX = '0x531f2bfb4ff6d0e1a872c96b1a062931629c5e7505306ae4065443552375b483';
const A = swap(TX, { in1: 243572282181837097n, out0: 1153098061941368145333235n });
const B = swap(TX, { in1: 242657614712796013n, out0: 1134472845979883642332390n });
const SELL = swap('0xsell', { in0: 5n * 10n ** 23n, out1: 10n ** 17n });
const OTHER = swap('0xother', { in1: 2n * 10n ** 17n, out0: 9n * 10n ** 23n });

for (const [name, fold] of [['worker-tg-bot', foldBot], ['worker-nft-mint', foldMint]]) {
  const f = fold([A, SELL, OTHER, B]);
  ok(`${name}: two swaps of one transaction are one buy of their sum`, f.length === 2 && f[0].transactionHash === TX && f[0].amount1In === 486229896894633110n && f[0].swaps === 2 && f[0].amount0Out === A_out() + B_out());
  ok(`${name}: … in the order the transactions appeared, the block kept, a sell folded to nothing`, f[1].transactionHash === '0xother' && f[0].blockNumber === '0x74e2aa8' && !f.some((x) => x.transactionHash === '0xsell'));
  ok(`${name}: … and at $750 a BNB that is a $365 buy — HUGE (≥ $250), where each half alone read BIG`, (Number(f[0].amount1In) / 1e18) * 750 >= 250 && (Number(A_in()) / 1e18) * 750 < 250);
  ok(`${name}: a single swap is itself; nothing and short data fold to nothing`, fold([OTHER])[0].amount1In === 2n * 10n ** 17n && fold([]).length === 0 && fold(null).length === 0 && fold([{ transactionHash: '0xx', data: '0x00' }]).length === 0);
}
function A_out() { return 1153098061941368145333235n; } function B_out() { return 1134472845979883642332390n; } function A_in() { return 243572282181837097n; }

// Two copies of one rule: the text must be the same, and each loop must read the fold.
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const fn = (s) => (s.match(/export function foldBuysByTx\(logs\) \{[\s\S]*?\n\}\n/) || [''])[0];
const bot = src('../worker-tg-bot/index.js'), mint = src('../worker-nft-mint/index.js');
ok('the two workers carry the same fold, letter for letter', fn(bot).length > 200 && fn(bot) === fn(mint));
ok('both loops run over the fold, not over the raw logs', /for \(const log of foldBuysByTx\(logs\)\)/.test(bot) && /for \(const log of foldBuysByTx\(logs\)\)/.test(mint) && !/for \(const log of logs\) \{\s*const txHash = log\.transactionHash;\s*if \((postedSet|processed)\.has/.test(bot + mint));

console.log(`\n${n - failed}/${n} checks pass`);
process.exitCode = failed ? 1 : 0;
