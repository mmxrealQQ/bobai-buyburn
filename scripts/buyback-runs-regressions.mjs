// THE BUYBACK-RUN CHECK READS THE BOT'S OWN WINDOWS (15.11., the A-Z pass). scripts/lib/health-checks.mjs
// buybackRunsVerdict asks every run for the steps that were on at its time; its BUYBACK_WINDOWS must be the windows
// worker/index.js switches on, or the check asks for a share the bot no longer sends (red for nothing) or forgets one it
// still sends. Also: the rule against the real log of the last 60 runs (no step of theirs was left out, so all green),
// and the gas floors and prize date of the same pass.
// node scripts/buyback-runs-regressions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
let bad = 0; const say = (ok, t, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ' — ' + d : ''}`); };
const H = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/health-checks.mjs')).href);
const W = H.BUYBACK_WINDOWS;
say(!!W && typeof H.buybackRunsVerdict === 'function', 'health-checks exports BUYBACK_WINDOWS and buybackRunsVerdict');
say(typeof H.buybackRunsHolds === 'function' && H.buybackRunsHolds() === true, 'the rule passes its own pins (missing step red, small run skips liquidity, no BOB burn asked after Dec 1)');
const bot = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
const c = (name) => { const m = bot.match(new RegExp(`const ${name}\\s*=\\s*new Date\\('([^']+)'\\)`)); return m ? Date.parse(m[1]) : NaN; };
if (W) {
  say(W.lpShare[0] === c('LP_SHARE_START') && W.lpShare[1] === c('LP_SHARE_END'), 'LP agent share window = worker/index.js LP_SHARE_START/END');
  say(W.giggle[0] === c('GIGGLE_START') && W.giggle[1] === c('GIGGLE_END'), 'Giggle window = GIGGLE_START/END');
  say(W.bobaiLiqBoost3[0] === c('BOBAI_LIQ_BOOST3_START') && W.bobaiLiqBoost3[1] === c('BOBAI_LIQ_BOOST3_END'), 'Boost III window = BOBAI_LIQ_BOOST3_START/END');
  say(W.bobaiLiqPhase === c('BOBAI_LIQ_PHASE_START'), 'BOBAI liquidity for good = BOBAI_LIQ_PHASE_START');
}
// the bot still writes the fields the check reads
for (const f of ['creatorTx', 'bobaiSwapTx', 'bobaiBurnTx', 'bobSwapTx', 'bobBurnTx', 'lpAgentTx', 'giggleTx']) say(new RegExp(`\\b${f}\\b`).test(bot), `worker/index.js still logs ${f}`);
say(/kvAppend\(env, 'bobai-liq-log\.json'/.test(bot), 'worker/index.js still logs bobai-liq-log.json');
// the real log: the last 60 runs, each judged at its own time
try {
  const [runs, liq] = await Promise.all(['burns.json', 'bobai-liq-log.json'].map((f) => fetch('https://logs.brainonbnb.com/logs/' + f, { signal: AbortSignal.timeout(15000) }).then((r) => r.json())));
  const last = runs.slice(-60), reds = last.filter((r) => !H.buybackRunsVerdict([r], liq, Date.parse(r.time) + 60e3).good);
  say(reds.length === 0, `the real log: ${last.length} runs judged at their own time, none left a step out`, reds.slice(0, 3).map((r) => r.time + ' ' + H.buybackRunsVerdict([r], liq, Date.parse(r.time) + 60e3).detail).join(' | '));
} catch (e) { console.log(`SKIP  the real log (offline: ${e.message})`); }
const src = fs.readFileSync(path.join(ROOT, 'scripts/lib/health-checks.mjs'), 'utf8');
say(/'0x690E950214980BC329823A2DB2fD90C06Bd54dE4', 0\.001\]/.test(src) && /'0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2', 0\.025\]/.test(src), 'the gas check reads the x402 income wallet (0.001) and the NFT relayer (0.025)');
say(H.PRIZE_PAID_FROM === Date.parse('2026-12-01T00:15:00Z'), 'the prize pool is judged through 30 Nov (PRIZE_PAID_FROM = 1 Dec 00:15 UTC)');
// exitCode, not process.exit(): on Windows a hard exit with the log fetches' sockets still open aborts in libuv
// (UV_HANDLE_CLOSING) and the run reads as failed
console.log(bad ? `\n${bad} FAIL` : '\nbuyback runs: all PASS'); process.exitCode = bad ? 1 : 0;
