// The whale tracker's two rules and its recap, pinned in both directions.
//
//   node scripts/smoke-whale.mjs            the pins, no network
//   node scripts/smoke-whale.mjs --render   plus the recap and the small-wallet
//                                           line rendered from the live KV
//                                           (needs wrangler, reads only)
//
// Pure functions are imported straight from the worker; nothing is posted.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = await import(pathToFileURL(path.join(ROOT, 'worker-tg-bot', 'index.js')).href);
const { isQuietMove, walletsEmptyFor, renderDailyRecap, renderSmallWalletsLine } = worker;

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const DAY = 86_400_000;

// Quiet floor: under $5 on the wallet's own trades and transfers in, never on
// a transfer out (pre-funding), never without a price, never at $5 or above.
ok(isQuietMove('BUY', 0.61) === true, 'a $0.61 buy is quiet');
ok(isQuietMove('SELL', 4.99) === true, 'a $4.99 sell is quiet');
ok(isQuietMove('INTERNAL_T', 1) === true, 'a $1 internal move is quiet');
ok(isQuietMove('BUY', 5) === false, 'a $5 buy posts');
ok(isQuietMove('BUY', 0) === false, 'a buy without a price posts');
ok(isQuietMove('TRANSFER_OUT', 0.1) === false, 'dust to a fresh wallet posts (pre-funding)');
ok(isQuietMove('NEW_WHALE', 1) === false && isQuietMove('EX_WHALE', 1) === false, 'status changes are never quiet');

// Retire rule: zero in each of the last seven snapshots, nothing shorter.
const snap = (i, wallets) => ({ date: `d${i}`, ts: i * DAY, total: 0, wallets });
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40);
const seven = Array.from({ length: 7 }, (_, i) => snap(i, { [A]: 0, [B]: 5, [C]: i < 6 ? 0 : 1 }));
ok(walletsEmptyFor(seven).join() === A, `only the wallet empty in all seven is retired, got ${walletsEmptyFor(seven).join()}`);
ok(walletsEmptyFor(seven.slice(1)).length === 0, 'six snapshots are not seven');
const fresh = [...seven.slice(0, 6), snap(6, { [A]: 0, [B]: 5 })];
ok(walletsEmptyFor(fresh).join() === A, 'a wallet missing from an older snapshot is not retired');
const newcomer = [...seven.slice(0, 6), snap(6, { [A]: 0, [B]: 5, ['0x' + 'd'.repeat(40)]: 0 })];
ok(walletsEmptyFor(newcomer).join() === A, 'a wallet that joined empty today waits its seven days');
ok(walletsEmptyFor([]).length === 0 && walletsEmptyFor(null).length === 0, 'no snapshots, nothing retired');

// Recap: holdings first, quiet count, retired line; a quiet day says so.
const now = Date.now();
const ev = [
  { kind: 'BUY', from: '0x6ead', to: A, amount: 5000, usdValue: 0.7, txHash: '0x1', ts: now - 3600e3, quiet: true },
  { kind: 'BUY', from: '0x6ead', to: B, amount: 2e6, usdValue: 280, txHash: '0x2', ts: now - 7200e3 },
  { kind: 'SELL', from: C, to: '0x6ead', amount: 5e5, usdValue: 70, txHash: '0x3', ts: now - 1800e3 },
  { kind: 'BUY', from: '0x6ead', to: B, amount: 9e5, usdValue: 120, txHash: '0x4', ts: now - 2 * DAY },
];
const holdings = { tracked_total_bobai: 485430632, percent_of_total_supply: 48.54, wallets_tracked: 26, wallets_at_or_above_threshold: 19, wallets_below_threshold: 7, wallets_empty: 0, change_7d: { window_days: 7, bobai_change: 6533719, percent_change: 1.36 } };
const text = renderDailyRecap(ev, [A, B, C], 0.00014, true, holdings, ['0x' + 'f'.repeat(40)]);
const plain = text.replace(/<[^>]+>/g, '');
ok(plain.split('\n')[1].startsWith('💼 485.43M BOBAI'), `holdings are the second line: ${plain.split('\n')[1]}`);
ok(/7d \+6\.53M \(\+1\.36%\)/.test(plain), 'the 7d trend sits on the holdings line');
ok(/🐋 3 wallets · 19 hold 10M\+ · 7 below$/m.test(plain), `the wallet split omits a zero "empty": ${plain.split('\n')[2]}`);
ok(/24h net 🟢 \+\$210\.70 · 3 moves · accumulating/.test(plain), `net and count from the last 24 h only: ${plain.split('\n')[4]}`);
ok(/🟢 2 buys \+\$280\.70/.test(plain) && /🔴 1 sell −\$70\.00/.test(plain), 'one line per kind, plural only when plural');
ok(!/burn|cascade|internal/.test(plain), 'kinds with no move are not listed');
ok(/🔕 1 under \$5 — logged, not alerted/.test(plain), 'the quiet count is on the recap');
ok(/🏆 Top moves\n1\. 🟢/.test(plain) && !/\$0\.70\)/.test(plain), 'top moves follow the flow and skip the quiet ones');
ok(/🧹 Retired 1 wallet empty for 7 days: 0xffff/.test(plain), 'the recap names what it retired');
ok(text.length < 900, `one screen: ${text.length} chars`);
const quietDay = renderDailyRecap([], [A], null, true, holdings, []).replace(/<[^>]+>/g, '');
ok(/😴 No whale move in the last 24 hours/.test(quietDay) && /💼 485\.43M/.test(quietDay), 'a quiet day still shows the holdings');
ok(!/🧹/.test(quietDay), 'no retired line when nothing was retired');
const noHold = renderDailyRecap([], [A, B], null, false).replace(/<[^>]+>/g, '');
ok(/Whale Watcher · Last 24h\n🐋 2 wallets tracked/.test(noHold), '/whales24h without a snapshot says only the count');

// The small-wallet line: address, balance in M/K, a dot for the active ones.
const bal = new Map([[A, 4_200_000], [B, 0], [C, 12_500]]);
const line = renderSmallWalletsLine([A, B, C], bal, new Set([A])).replace(/<[^>]+>/g, '');
ok(line === '💀 below 10M (3): 0xaaaa 4.2M🟢 · 0xcccc 13K · 0xbbbb 0', `small wallets on one line, largest first, got: ${line}`);

// The cron itself, run dry at 06:05 UTC: an empty KV, a network that answers
// 503. Every gate in scheduled() catches its own errors, so a name that is out
// of scope throws into a catch and the recap just never goes out (2026-09-12
// to 09-17: "tick is not defined", every minute, six days). Nothing a gate
// logs may be a ReferenceError, and the 06:00 gate must reach the recap.
{
  const logged = [];
  const real = { error: console.error, log: console.log, warn: console.warn, fetch: globalThis.fetch };
  console.error = (...a) => logged.push(a.map(String).join(' '));
  console.log = () => {}; console.warn = () => {};
  globalThis.fetch = async () => { return new Response('{}', { status: 503 }); };
  const reads = [];
  const KV = { get: async (k) => { reads.push(k); return null; }, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) };
  try {
    await worker.default.scheduled({ scheduledTime: Date.UTC(2026, 8, 17, 6, 5) }, { KV, TG_BOT_TOKEN: 'x', TG_INTERNAL_CHAT_ID: '-1' });
  } catch (e) { logged.push('scheduled threw: ' + (e && e.message || e)); }
  Object.assign(console, { error: real.error, log: real.log, warn: real.warn }); globalThis.fetch = real.fetch;
  const undef = logged.filter((l) => /is not defined|scheduled threw/.test(l));
  ok(undef.length === 0, `the cron reads a name that is out of scope: ${undef.join(' | ')}`);
  ok(reads.includes('last_daily_summary'), 'the 06:00 gate reaches the recap flag');
}

// A person's wallet can carry code (EIP-7702): the delegation designator is a wallet, anything else with code is a contract.
{
  const { codeIsContract } = worker;
  const delegated = '0xef0100' + 'ab'.repeat(20);
  ok(codeIsContract('0x') === false && codeIsContract('0x0') === false, 'a wallet without code is not a contract');
  ok(codeIsContract(delegated) === false && codeIsContract(delegated.toUpperCase().replace('0X', '0x')) === false, 'a 7702-delegated wallet (0xef0100 + 20 bytes) is still a wallet');
  ok(codeIsContract('0xef0100' + 'ab'.repeat(21)) === true && codeIsContract('0x6080604052') === true && codeIsContract('0xef01') === true, 'anything else with code is a contract — the designator is exactly 23 bytes');
  ok(codeIsContract(null) === true && codeIsContract(undefined) === true, 'a code read that did not answer stays "contract": a router is never cascade-added on a guess');
}

// The burn bar is capped like the buy bar: a caption Telegram refuses is a burn nobody hears about.
{
  const { getBurnEmojis } = worker;
  const big = getBurnEmojis(5000);
  ok([...getBurnEmojis(10).bar].length === 5 && !getBurnEmojis(10).bar.includes('×'), 'a small burn draws one flame per $2');
  ok([...big.bar].filter((ch) => ch === '🔥').length === 60 && big.bar.endsWith('×2500') && big.bar.length < 200, 'a $5000 burn draws 60 flames and spells the count — the caption stays inside the limit');
}

// The free endpoints' cut is counted from the head that was read, never before the range asked for.
{
  const { narrowedFrom } = worker;
  ok(narrowedFrom('0x' + (1000000 - 1600).toString(16), 1000000) === '0x' + (1000000 - 50).toString(16), 'a 1,600-block range is cut to the last 50 blocks before the head');
  ok(narrowedFrom('0x' + (1000000 - 20).toString(16), 1000000) === '0x' + (1000000 - 20).toString(16), 'a range already inside the cap is left alone');
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'worker-tg-bot', 'index.js'), 'utf8');
  ok(/const SCAN_BLOCKS = 1600;/.test(src) && !/latest - 300\b/.test(src), 'the alert scans look back 1,600 blocks (~12 min), not 300 (135 s)');
}

// A name somebody else chose is text; the buyer an alert names is the wallet the NFT went to.
{
  const { escHtml, shownName, alertTrade } = worker;
  ok(shownName('<a href="https://x.y">free</a>') === '&lt;a href=&quot;https://x.y&quot;&gt;free&lt;/a&gt;' && escHtml('Tom & <b>') === 'Tom &amp; &lt;b&gt;', 'markup in a name arrives as text');
  ok(shownName('Anna') === 'Anna' && shownName('') === 'User' && shownName(null) === 'User' && [...shownName('x'.repeat(200))].length === 65, 'a plain name is left alone, an empty one is "User", a long one is cut');
  const p = { buyer: '0x' + '1'.repeat(40), txHash: '0xabc', usdValue: 1390 };
  ok(alertTrade(p, { to: '0x' + '2'.repeat(40), tokenId: 7 }).buyer === '0x' + '2'.repeat(40) && alertTrade(p, { to: '0x' + '2'.repeat(40) }).txHash === '0xabc', 'a minted buy names the wallet the NFT went to, not the relayer that sent the transaction');
  ok(alertTrade(p, null) === p && alertTrade(p, { to: 'nonsense' }) === p && alertTrade(p, {}).buyer === p.buyer, 'without a drop, or with a broken one, the sender stays');
}

// The other side of a whale's transfer, and a retried transaction.
{
  const { pickOtherSide, toldAlready } = worker;
  const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40);
  const kinds = new Map([[A, true], [B, false], [C, true]]);
  const get = (x) => kinds.get(x);
  ok(pickOtherSide([[A, 9n], [B, 5n], [C, 1n]], get).addr === B && pickOtherSide([[A, 9n], [B, 5n]], get).viaContract === false, 'a person on the other side is preferred, even a smaller one');
  ok(pickOtherSide([[A, 9n], [C, 1n]], get).addr === A && pickOtherSide([[A, 9n], [C, 1n]], get).viaContract === true, 'with contracts only, the largest contract is the other side and is marked as one (it was: no alert at all)');
  ok(pickOtherSide([], get) === null && pickOtherSide([[A, 1n]], () => undefined).viaContract === true, 'nothing on the other side is nothing; an unread address counts as a contract and is never tracked');
  const ev = [{ txHash: '0x1', kind: 'SELL', from: A, to: B }];
  ok(toldAlready(ev, '0x1', 'SELL', A, B) === true && toldAlready(ev, '0x1', 'EX_WHALE', A, B) === false && toldAlready(ev, '0x2', 'SELL', A, B) === false && toldAlready(null, '0x1', 'SELL', A, B) === false, 'a retried transaction skips what it has told and nothing else');
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'worker-tg-bot', 'index.js'), 'utf8');
  ok(/if \(!retryTx\) postedWhaleSet\.add\(txHash\);/.test(src) && !/MAX_ALERTS_PER_RUN\) \{ postedSet\.add\(txHash\); continue; \}/.test(src), 'a failed whale send leaves its transaction open, and the buy cap no longer marks a buy as posted');
}

if (fails.length) { console.error('SMOKE-WHALE FAILED'); for (const f of fails) console.error('  ' + f); process.exit(1); }
console.log('smoke-whale ok: 47 pins');

// ---------------------------------------------------------------- --render
if (process.argv.includes('--render')) {
  const NS = '13bc5a0a65c34fe1839e806ae2d5e3fa';
  const kv = (key) => JSON.parse(execSync(`npx wrangler kv key get --remote --namespace-id ${NS} ${key}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const [events, snaps, tracked] = [kv('whale_events'), kv('whale_snapshots'), kv('tracked_wallets')];
  const { snapshotHoldings } = worker;
  const retired = walletsEmptyFor(snaps).filter((a) => tracked.includes(a));
  const h = snapshotHoldings(snaps);
  if (h && retired.length) { h.wallets_tracked -= retired.length; h.wallets_empty = Math.max(0, h.wallets_empty - retired.length); }
  console.log(`\nlive: ${events.length} events, ${snaps.length} snapshots, ${tracked.length} tracked, ${retired.length} would retire at the next recap`);
  console.log('\n' + renderDailyRecap(events, tracked.filter((a) => !retired.includes(a)), null, true, h, retired).replace(/<[^>]+>/g, ''));
  const last = snaps[snaps.length - 1];
  const balByAddr = new Map(Object.entries(last.wallets));
  const small = tracked.filter((a) => (balByAddr.get(a) || 0) < 10_000_000 && !retired.includes(a));
  console.log('\n' + renderSmallWalletsLine(small, balByAddr).replace(/<[^>]+>/g, ''));
}
