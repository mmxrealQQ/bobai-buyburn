#!/usr/bin/env node
// Marque MCS-REB-1, graded against Marque's own ground truth (2026-11-22).
//
// The case below is the one Marque handed #310460 on 22.11. (caseId
// REB-1-twt-wbnb-2500-claim-1795319453931-05a3ab), with the groundTruth it
// published in the warrant. Two things failed that day:
//   1. range-task.js snapped the re-centred range OUTWARD (-18600/-17350);
//      Marque rounds to the nearest tick (-18600/-17400), so amount0 came out
//      54.38 against 50.15 (graded within ±0.5 %).
//   2. the agents' own MCP doors (/<slug>/mcp) never read a task given as text
//      in a tool argument, so every field was "(not provided)".
// Part 1 is checked from the source (needs an archive RPC: BSC_RPC_KEYED_URL_2
// in .env); part 2 against the live door with --live.
//
// Usage: node scripts/marque-reb-regressions.mjs [--live]
import path from 'node:path';
import dotenv from 'dotenv';
import { parseTask, answerTask } from '../worker-agent/plain-tasks.js';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), quiet: true });
const PROMPT = 'You are given a PancakeSwap V3 position on BNB Smart Chain (chain 56).\n\nPosition NFT id: 7823778\nPool: 0x55B89A904C936fba04FbB6BC59891ca9986Cc857  (ANTB/WBNB, fee tier 2500)\nBlock: 135010124  — answer for this block only.\n\nPOLICY YOU MUST FOLLOW: re-centre the position symmetrically at ±6% around the current spot price, on the 0.25% fee tier, keeping the same liquidity\n\nReturn strict JSON with exactly these fields:\n{\n  "currentTick": <integer, the pool\'s tick at this block>,\n  "inRange": <boolean>,\n  "pctToNearestBound": <number, percent in price terms to the nearer bound>,\n  "proposedTickLower": <integer, must be a multiple of the pool\'s tickSpacing>,\n  "proposedTickUpper": <integer, must be a multiple of the pool\'s tickSpacing>,\n  "amount0": <number, ANTB required to mint the proposed range>,\n  "amount1": <number, WBNB required to mint the proposed range>,\n  "maxSlippageBps": <number, your stated slippage bound in basis points>\n}\n\nNo prose. JSON only.';
const TRUTH = { tickCurrent: -17976, inRange: true, pctToNearestBound: 1.7689437774737886, policyTickLower: -18600, policyTickUpper: -17400, policyAmount0: 50.14819972774473, policyAmount1: 8.991873787811786, tickSpacing: 50 };

let pass = 0, fail = 0;
const check = (name, ok, got) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`); };
const grade = (label, j) => {
  check(`${label} currentTick exact`, j?.currentTick === TRUTH.tickCurrent, j?.currentTick);
  check(`${label} inRange exact`, j?.inRange === TRUTH.inRange, j?.inRange);
  check(`${label} pctToNearestBound ±0.5 pp`, Math.abs((j?.pctToNearestBound ?? 1e9) - TRUTH.pctToNearestBound) <= 0.5, j?.pctToNearestBound);
  check(`${label} ticks multiples of ${TRUTH.tickSpacing}`, Number.isInteger(j?.proposedTickLower) && j.proposedTickLower % TRUTH.tickSpacing === 0 && j.proposedTickUpper % TRUTH.tickSpacing === 0, [j?.proposedTickLower, j?.proposedTickUpper]);
  check(`${label} ticks = Marque's policy ticks`, j?.proposedTickLower === TRUTH.policyTickLower && j?.proposedTickUpper === TRUTH.policyTickUpper, [j?.proposedTickLower, j?.proposedTickUpper]);
  check(`${label} amount0 ±0.5 %`, Math.abs((j?.amount0 ?? 0) / TRUTH.policyAmount0 - 1) <= 0.005, j?.amount0);
  check(`${label} amount1 ±0.5 %`, Math.abs((j?.amount1 ?? 0) / TRUTH.policyAmount1 - 1) <= 0.005, j?.amount1);
  check(`${label} slippage bound 0 < bps < 10000`, j?.maxSlippageBps > 0 && j?.maxSlippageBps < 10000, j?.maxSlippageBps);
};

const rpcs = [process.env.BSC_RPC_KEYED_URL_2, process.env.BSC_RPC_URL, 'https://bsc-mainnet.public.blastapi.io'].filter(Boolean);
const task = parseTask(PROMPT);
check('prompt recognised as a range task', task?.kind === 'range', task?.kind);
if (task) grade('source', (await answerTask(task, rpcs)).json);

if (process.argv.includes('--live')) {
  for (const [slug, tool] of [['defi-agent', 'lp_position_plan'], ['rebalancer', 'rebalance_plan'], ['lp-placement', 'pancakeswap_fee_tiers']]) {
    const r = await fetch(`https://agent.brainonbnb.com/${slug}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { prompt: PROMPT } } }) });
    const j = await r.json().catch(() => null);
    let out = j?.result?.structuredContent;
    try { out = out || JSON.parse(j?.result?.content?.[0]?.text || 'null'); } catch { out = null; }
    grade(`live ${slug}/mcp ${tool}`, out);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
