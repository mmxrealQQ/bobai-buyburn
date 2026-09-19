// The tax split lives in two files, and nothing checked that they agree.
//
// `worker/index.js` is what actually runs — a Cloudflare Worker on a cron. It
// is where the tax that has accumulated on the token gets split into burns,
// liquidity and the creator share. `buyback-bot.js` is the same logic as a
// local script, kept as the fallback for when the Worker cannot run.
//
// A phase change has to be made in both. That instruction has lived in a note
// and in people's heads since the first boost window, and the failure it
// guards against is silent in the worst possible way: the fallback would split
// the money differently from the Worker, and nobody would find out until the
// day the fallback was needed — which is the day everything else is already
// going wrong.
//
// This compares the two mechanically. Two things have to match:
//   the WINDOWS   when each phase is on
//   the SPLIT     what each phase does to the basis points
// The split is compared by simulating every combination of phases rather than
// by matching source text, because two files can compute the same allocation
// with differently-shaped code and that is not a defect.
//
// Usage:
//   node scripts/phase-parity.mjs               compare, and print today's split
//   node scripts/phase-parity.mjs --self-test   prove the comparison can fail
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKER = path.join(ROOT, 'worker', 'index.js');
const BOT = path.join(ROOT, 'buyback-bot.js');
const args = process.argv.slice(2);

// The phase windows: every `const NAME_START/END = new Date('…')` whose name
// belongs to a phase. Read from the source rather than imported, because these
// two files are a Worker module and a Node script and neither imports cleanly
// into the other.
const windowsOf = (src) => {
  const out = {};
  for (const m of src.matchAll(/const\s+([A-Z0-9_]*(?:BOOST|EXTRA|WC26|PHASE|SHARE|GIGGLE)[A-Z0-9_]*)\s*=\s*new Date\('([^']+)'\)/g)) {
    out[m[1]] = m[2];
  }
  return out;
};

// The split: the `if (phase) { a -= n; b += n; }` block, lifted out and run.
// Matching the text would fail on a reordered line that changes nothing; this
// runs both versions over all 32 phase combinations and compares the numbers.
const splitOf = (src, label) => {
  const m = src.match(/\/\/ Build per-phase BPS allocation from baseline[\s\S]*?const bpsSum\s*=/);
  if (!m) throw new Error(`${label}: could not find the BPS allocation block`);
  const body = m[0].replace(/const bpsSum\s*=$/, '');
  // Declared with let inside the block, so the function body is the block plus
  // a return. Nothing else from either file is in scope, which is the point:
  // if the allocation ever starts depending on something outside itself, this
  // throws rather than quietly comparing two different things.
  return new Function(
    'bobLiqBoost', 'bobaiLiqBoost', 'bobaiLiqExtra', 'wc26Active', 'bobaiLiqBoost2', 'bobaiLiqBoost3', 'lpShare', 'giggle',
    `${body}\nreturn { bobaiBurnBps, bobBurnBps, creatorBps, bobLiqBps, bobaiLiqBps, wc26PoolBps, lpAgentBps, giggleBps };`,
  );
};

// Eight programs (2026-09-09: the DeFi Agent share and the Giggle pot joined; 2026-09-19: Liq Boost III), so 256 combinations.
const COMBOS = [];
for (let i = 0; i < 256; i++) {
  COMBOS.push([!!(i & 1), !!(i & 2), !!(i & 4), !!(i & 8), !!(i & 16), !!(i & 32), !!(i & 64), !!(i & 128)]);
}

const compare = (aSrc, bSrc) => {
  const problems = [];

  const aw = windowsOf(aSrc), bw = windowsOf(bSrc);
  const keys = [...new Set([...Object.keys(aw), ...Object.keys(bw)])].sort();
  for (const k of keys) {
    if (aw[k] !== bw[k]) {
      problems.push(`${k}: worker has ${aw[k] || '(absent)'}, the fallback has ${bw[k] || '(absent)'}`);
    }
  }

  const af = splitOf(aSrc, 'worker/index.js');
  const bf = splitOf(bSrc, 'buyback-bot.js');
  for (const c of COMBOS) {
    const x = af(...c), y = bf(...c);
    for (const field of Object.keys(x)) {
      if (x[field] !== y[field]) {
        problems.push(`split differs with phases [${c.map((v) => (v ? 1 : 0)).join('')}]: ${field} is ${x[field]} in the worker and ${y[field]} in the fallback`);
      }
    }
  }
  return { problems, keys, af };
};

if (args.includes('--self-test')) {
  const fails = [];
  const a = fs.readFileSync(WORKER, 'utf8');

  // A changed window must be seen.
  const movedWindow = a.replace("new Date('2026-09-16T23:59:59Z')", "new Date('2026-10-16T23:59:59Z')");
  if (movedWindow === a) fails.push('the self-test could not plant a changed window — the constant it edits has moved');
  else if (!compare(a, movedWindow).problems.length) fails.push('a phase window changed in one file only was not reported');

  // A changed split must be seen, including one that keeps the total at 300.
  const movedSplit = a.replace('{ bobBurnBps -= 80; bobaiLiqBps += 80; }', '{ bobBurnBps -= 60; bobaiLiqBps += 60; }');
  if (movedSplit === a) fails.push('the self-test could not plant a changed split — the line it edits has moved');
  else if (!compare(a, movedSplit).problems.length) fails.push('a basis-point change in one file only was not reported');

  // A changed share in one of the two new programs must be seen too.
  const movedShare = a.replace('creatorBps -= 10; lpAgentBps += 30;', 'creatorBps -= 20; lpAgentBps += 40;');
  if (movedShare === a) fails.push('the self-test could not plant a changed LP share - the line it edits has moved');
  else if (!compare(a, movedShare).problems.length) fails.push('a changed LP-agent share in one file only was not reported');

  // And an identical file must be quiet.
  if (compare(a, a).problems.length) fails.push('a file compared against itself reported a difference');

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error(`  x ${f}`);
    process.exit(1);
  }
  console.log('self-test passed: a moved window is caught, a changed basis point is caught, an identical file is quiet');
  if (!args.includes('--live')) process.exit(0);
}

const workerSrc = fs.readFileSync(WORKER, 'utf8');
const botSrc = fs.readFileSync(BOT, 'utf8');
const { problems, keys, af } = compare(workerSrc, botSrc);

console.log(`\nTax phase parity — worker/index.js against buyback-bot.js`);
console.log(`  ${keys.length} phase windows, ${COMBOS.length} phase combinations compared`);

// What is running right now, so a reader can check the split against the
// calendar rather than trusting that the constants say what was intended.
const now = Date.now();
const at = (name) => {
  const w = windowsOf(workerSrc);
  const s = w[`${name}_START`], e = w[`${name}_END`];
  return s && e ? now >= Date.parse(s) && now <= Date.parse(e) : false;
};
const active = {
  bobLiqBoost: at('LIQ_BOOST'),
  bobaiLiqBoost: at('BOBAI_LIQ_BOOST'),
  bobaiLiqExtra: at('BOBAI_LIQ_EXTRA'),
  wc26Active: at('WC26'),
  bobaiLiqBoost2: at('BOBAI_LIQ_BOOST2'),
  bobaiLiqBoost3: at('BOBAI_LIQ_BOOST3'),
  lpShare: at('LP_SHARE'),
  giggle: at('GIGGLE'),
};
const on = Object.entries(active).filter(([, v]) => v).map(([k]) => k);
const split = af(active.bobLiqBoost, active.bobaiLiqBoost, active.bobaiLiqExtra, active.wc26Active, active.bobaiLiqBoost2, active.bobaiLiqBoost3, active.lpShare, active.giggle);
const sum = Object.values(split).reduce((s, v) => s + v, 0);
console.log(`  active today: ${on.length ? on.join(', ') : 'none — standard 1/1/1'}`);
console.log(`  split: ${Object.entries(split).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
// The three percent is the whole tax. A split that does not add back up to it
// is either sending money nowhere or sending it twice.
if (sum !== 300) {
  console.error(`\n  the split adds to ${sum} basis points, not 300 — the tax is 3% and every point has to go somewhere`);
  process.exitCode = 1;
}

if (problems.length) {
  console.error(`\n${problems.length} difference(s) between the two — money would split differently depending on which one ran:`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exitCode = 1;
} else {
  console.log('\nthe two agree on every window and every combination.');
}
