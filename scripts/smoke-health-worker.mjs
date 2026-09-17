// The morning health worker's two decisions, pinned in both directions:
// what counts as failing (twice, not once) and what the operator is told.
//
//   node scripts/smoke-health-worker.mjs      no network, nothing is sent
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { renderHealthMessage, failedTwice } = await import(pathToFileURL(path.join(ROOT, 'worker-health', 'index.js')).href);

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

if (fails.length) { console.error('SMOKE-HEALTH-WORKER FAILED'); for (const f of fails) console.error('  ' + f); process.exit(1); }
console.log('smoke-health-worker ok: 9 pins');
