// The morning health worker's two decisions, pinned in both directions:
// what counts as failing (twice, not once) and what the operator is told.
//
//   node scripts/smoke-health-worker.mjs      no network, nothing is sent
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { renderHealthMessage, failedTwice, defiLine } = await import(pathToFileURL(path.join(ROOT, 'worker-health', 'index.js')).href);

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const r = (name, good, detail = '') => ({ area: 'Bots', name, good, detail });

// Red is asked twice: a check that recovers is not reported, one that stays red is.
const first = [r('a', true), r('b', false, 'throttled'), r('c', false, 'dead')];
const second = [r('a', true), r('b', true), r('c', false, 'still dead')];
ok(failedTwice(first, second).map((x) => x.name).join() === 'c', 'only the check red in both runs is failing');
ok(failedTwice(first, second)[0].detail === 'still dead', 'the detail is the second run\'s, the fresher one');
ok(failedTwice(first, [r('a', false)]).map((x) => x.name).join() === 'b,c', 'a check green first and red second is not reported; one missing from the second run stays red');
ok(failedTwice([r('a', true)], []).length === 0, 'a green first run needs no second');

// The message: one line when green, the failing checks by name when red.
const green = renderHealthMessage(first, [], '2026-09-17');
ok(/^✅/.test(green) && /3\/3 checks/.test(green) && !green.includes('\n'), `green is one line: ${green}`);
const red = renderHealthMessage(first, [r('whale recap went out', false, 'last sent 2026-09-11 <b>')], '2026-09-17');
ok(/^🚨/.test(red) && /1 of 3 checks FAILING/.test(red), 'red leads with the count');
ok(red.includes('whale recap went out') && red.includes('last sent 2026-09-11'), 'red names the check and its detail');
ok(red.includes('&lt;b&gt;') && !red.includes('2026-09-11 <b>'), 'a detail cannot inject markup');
const many = renderHealthMessage(first, Array.from({ length: 30 }, (_, i) => r('check ' + i, false, 'x'.repeat(400))), '2026-09-17');
ok(many.length < 4096 && /and 18 more/.test(many), `thirty failures still fit one Telegram message: ${many.length} chars`);

// The DeFi agent's own line (2026-09-18): there whenever the run carries DeFi checks, green or red.
const dOk = [{ area: 'DeFi', name: 'DeFi agent looked at its position in the last 35 min', good: true, detail: 'last look 4 min ago' }, { area: 'DeFi', name: 'the wallet holds the ranges the ladder record names', good: true, detail: '#7451444 held, #7461743 held' }];
const withDefi = renderHealthMessage([...first.filter((x) => x.good), ...dOk], [], '2026-09-18');
ok(withDefi.split('\n').length === 2 && /DeFi agent<\/b> · 2\/2 ok · last look 4 min ago · #7451444 held/.test(withDefi), `a green day names the agent on a second line: ${withDefi.split('\n')[1]}`);
const dBad = [{ ...dOk[0], good: false, detail: 'last look 300 min ago' }, dOk[1]];
ok(/1 of 2 checks FAILING — DeFi agent looked/.test(defiLine(dBad)) && renderHealthMessage(dBad, [dBad[0]], '2026-09-18').includes('🤖'), 'a red agent is said on its line too');
ok(defiLine(first) === '' && defiLine([]) === '', 'a run without DeFi checks has no such line');

// The buyback wallet's two looks: only a red second look is told, and the line it is measured against is the bot's own.
{
  const { secondLookMessage } = await import(pathToFileURL(path.join(ROOT, 'worker-health', 'index.js')).href);
  const { buybackWalletVerdict, BUYBACK_ACTS_ABOVE_BNB, BUYBACK_WALLET } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'health-checks.mjs')).href);
  const fs = await import('node:fs');
  const bot = fs.readFileSync(path.join(ROOT, 'worker', 'index.js'), 'utf8');
  const eth = (name) => Number((bot.match(new RegExp('const ' + name + " = parseEther\\('([0-9.]+)'\\)")) || [])[1]);
  ok(Math.abs(eth('GAS_RESERVE') + eth('MIN_BNB') - BUYBACK_ACTS_ABOVE_BNB) < 1e-12, 'the line the check draws is the bot\'s own: GAS_RESERVE + MIN_BNB');
  ok(fs.readFileSync(path.join(ROOT, 'buyback-bot.js'), 'utf8').includes(BUYBACK_WALLET), 'the wallet looked at is the one the bot\'s fallback script insists on');
  const first = { bnb: 0.06, nonce: 10, at: 1000 };
  const stuck = secondLookMessage(buybackWalletVerdict({ bnb: 0.07, nonce: 10, at: 661000 }, first));
  ok(/Buyback bot/.test(stuck) && /nonce 10 at both looks, 11 min apart/.test(stuck), 'tax held through a run of the bot is told, with the nonce and the minutes');
  ok(secondLookMessage(buybackWalletVerdict({ bnb: 0.07, nonce: 17, at: 661000 }, first)) === '' && secondLookMessage(buybackWalletVerdict({ bnb: 0.0031, nonce: 17 }, first)) === '', 'a bot that has sent since the first look is told to nobody');
}

if (fails.length) { console.error('SMOKE-HEALTH-WORKER FAILED'); for (const f of fails) console.error('  ' + f); process.exit(1); }
console.log('smoke-health-worker ok: 16 pins');
