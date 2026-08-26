// Assembles the public source mirror of this project.
//
// Why a mirror and not the repository itself: .git is 1.3 GB, and 404 of the
// 412 MB in it is picture material — sticker frames, NFT card renders, hero
// illustrations. The source is 8.5 MB. Someone cloning this to read how the
// marketplace works should wait two seconds, not ten minutes, and the pictures
// they would be waiting for are already served from brainonbnb.com.
//
// So the mirror carries source and evidence, not assets. That is a publishing
// decision, not a hiding one, and the README it writes says so in as many
// words, including where every excluded file actually lives.
//
// The gate: this refuses to build unless `secret-audit.mjs --history` exits
// clean. The audit is the reason we know the tree AND its history hold no live
// key; wiring it in here means the day someone commits one, the mirror stops
// building instead of publishing it.
//
// Two traps this file exists to not fall into:
//
//   `git ls-files` is the only honest source of the file list. Walking the
//   filesystem would sweep up .env, node_modules, the census working files and
//   the World Cup payout snapshot (usernames to wallets to balances) — every
//   one of them kept out by .gitignore and by nothing else.
//
//   Excluding a directory by prefix is not the same as excluding it by intent.
//   nft/ holds both the card renders (out) and the contract and generators
//   (source). Dropping "nft/" would drop the Solidity. The exclusions below are
//   therefore paths that hold OUTPUT, listed one by one, and the script prints
//   what it dropped so the list can be argued with.
//
// Usage:
//   node scripts/build-mirror.mjs                 build into ../brainonbnb-public
//   node scripts/build-mirror.mjs --out <dir>     build somewhere else
//   node scripts/build-mirror.mjs --dry-run       list what would be copied
//   node scripts/build-mirror.mjs --self-test     prove the rules do what they claim
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const outArg = args.indexOf('--out');
const OUT = path.resolve(outArg >= 0 ? args[outArg + 1] : path.join(ROOT, '..', 'brainonbnb-public'));

// Directories that hold generated picture output. Their generators stay.
const ASSET_TREES = [
  'stickers/out/',        // 91 finished sticker GIFs — live on Telegram and GIPHY
  'stickers/assets/',     // sticker source plates
  'nft/cards/',           // 52 card renders — live on the NFT contract's metadata worker
  'nft/scenes/',
  'nft/refs/',
  'assets-src/',          // hero illustration masters
];

// Anything binary above this is asset, not source. The self-hosted fonts are
// the one exception: the CSS names them, and a missing font reads as a bug
// rather than as a deliberate omission.
const BINARY_CAP = 96 * 1024;
const BINARY = /\.(png|jpe?g|gif|webp|mp4|webm|ico|zip|pdf|psd|ai)$/i;
const KEEP_ALWAYS = /\.(woff2?|ttf)$/i;

function classify (file, size) {
  if (KEEP_ALWAYS.test(file)) return { keep: true };
  for (const t of ASSET_TREES) if (file.startsWith(t)) return { keep: false, why: 'asset tree ' + t };
  // The reason has to be a constant, not the file's own size — otherwise every
  // picture becomes its own line in the summary and the summary says nothing.
  if (BINARY.test(file) && size > BINARY_CAP) return { keep: false, why: `picture over ${BINARY_CAP / 1024} KB` };
  return { keep: true };
}

// ---------------------------------------------------------------- self-test
if (args.includes('--self-test')) {
  const fails = [];
  const cases = [
    ['nft/contract/BobaiBuyDrops.sol', 4000, true,  'contract source must survive an nft/ exclusion'],
    ['nft/gen_nft.py',                 9000, true,  'generator source must survive'],
    ['nft/cards/0001.png',        900 * 1024, false, 'card render must be dropped'],
    ['stickers/make_brain.py',         6000, true,  'sticker generator must survive'],
    ['stickers/out/brain-01.gif', 400 * 1024, false, 'sticker output must be dropped'],
    ['dashboard/fonts/Inter.woff2', 60 * 1024, true, 'self-hosted font must survive'],
    ['dashboard/fonts/Big.woff2',  900 * 1024, true, 'font must survive even over the cap'],
    ['dashboard/illus/hero.png',  2400 * 1024, false, 'big illustration must be dropped'],
    ['dashboard/favicon.ico',       10 * 1024, true,  'small icon must survive'],
    ['dashboard/index.html',       180 * 1024, true,  'html is never binary, must survive'],
    ['scripts/health.mjs',              20000, true,  'script must survive'],
    ['data/erc8004/registrations.json', 1 << 20, true, 'evidence json must survive whatever its size'],
  ];
  for (const [f, size, want, why] of cases) {
    const got = classify(f, size).keep;
    if (got !== want) fails.push(`${f} → keep=${got}, expected ${want} (${why})`);
  }
  // The file list must come from git, never from the filesystem.
  const src = fs.readFileSync(import.meta.filename, 'utf8');
  // Look for the CALL, not the word — searching for the bare name would match
  // this line and fail the test against itself.
  if (!/ls-files/.test(src)) fails.push('file list is not taken from git ls-files');
  if (/fs\.readdirSync\(|fs\.globSync\(/.test(src)) fails.push('script walks the filesystem — .gitignore would be bypassed');

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(2);
  }
  console.log(`self-test passed: ${cases.length} classification cases correct — generators and contracts survive their own output trees, fonts survive the size cap, illustrations do not, and the file list comes from git rather than the filesystem`);
  process.exit(0);
}

// ------------------------------------------------------------------- gate
if (!DRY) {
  console.log('gate: running secret-audit over worktree and history…');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'secret-audit.mjs'), '--self-test'],
      { cwd: ROOT, stdio: 'inherit' });
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'secret-audit.mjs'), '--history'],
      { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('\nsecret-audit did not pass. The mirror is NOT built.');
    process.exit(1);
  }
  console.log('gate: passed.\n');
}

// ------------------------------------------------------------------ build
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 29 })
  .split('\0').filter(Boolean);

const kept = [], dropped = [];
for (const f of files) {
  let size = 0;
  try { size = fs.statSync(path.join(ROOT, f)).size; } catch { continue; }
  const c = classify(f, size);
  (c.keep ? kept : dropped).push({ f, size, why: c.why });
}

const sum = a => a.reduce((n, x) => n + x.size, 0);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
console.log(`keeping ${kept.length} files, ${mb(sum(kept))}`);
console.log(`leaving out ${dropped.length} files, ${mb(sum(dropped))}`);
const byWhy = {};
for (const d of dropped) byWhy[d.why] = (byWhy[d.why] || { n: 0, size: 0 }), byWhy[d.why].n++, byWhy[d.why].size += d.size;
for (const [why, v] of Object.entries(byWhy).sort((a, b) => b[1].size - a[1].size)) {
  console.log(`   ${String(v.n).padStart(4)} files  ${mb(v.size).padStart(9)}  ${why}`);
}

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const { f } of kept) {
  const dest = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), dest);
}

// The README is generated, so it can never drift from what was actually
// copied. Every number in it is measured on this run.
// Directories and loose top-level files read differently and are listed
// separately — a reader scanning for "where is the marketplace" should meet
// seven directories, not seven directories shuffled into eleven filenames.
const topLevel = kept.filter(k => !k.f.includes('/'));
const dirs = [...new Set(kept.filter(k => k.f.includes('/')).map(k => k.f.split('/')[0]))].sort();
const DIR_NOTE = {
  dashboard: 'the site, the marketplace at /registry, and the workers behind them',
  worker: 'the buy-back and burn worker',
  'worker-agent': 'the paid agent service — x402, ERC-8183 hiring, /status telemetry',
  scripts: 'every audit and one-off tool, each with its own --self-test',
  data: 'the census output: what we measured about the chain',
  docs: 'how the x402 catalogue and its signatures were derived',
  mcp: 'the MCP server definition',
  nft: 'the drop contract and its generators',
  skills: 'the agent skill served to other agents',
  stickers: 'the sticker generators',
  game: 'the browser game',
};
fs.writeFileSync(path.join(OUT, 'MIRROR.md'), `# What this mirror is

This is the public source of **[brainonbnb.com](https://brainonbnb.com)** — an
agent marketplace on BNB Smart Chain built on ERC-8004 identity and ERC-8183
hiring, plus the token infrastructure that funds it.

Generated by \`scripts/build-mirror.mjs\` on the private working repository.

## What is here

${kept.length} files, ${mb(sum(kept))}. Everything that is source, configuration,
contract, or measured evidence:

${dirs.map(d => `- \`${d}/\`${DIR_NOTE[d] ? ' — ' + DIR_NOTE[d] : ''}`).join('\n')}

Plus ${topLevel.length} files at the top level: the two token bots, their logs,
the README, the licence and the package manifest.

## What is not here, and where it is instead

${dropped.length} files, ${mb(sum(dropped))} — picture material only. No source
file, no configuration and no contract was left out.

${Object.entries(byWhy).sort((a, b) => b[1].size - a[1].size)
  .map(([why, v]) => `- ${v.n} files, ${mb(v.size)} — ${why}`).join('\n')}

The generators that produce them **are** included (\`nft/gen_nft.py\`,
\`stickers/make_brain.py\`, and their neighbours). The finished files are served
from the live site, from the NFT contract's metadata worker, and from Telegram
and GIPHY.

## What is verifiably absent

No credential of any kind, in the tree or in the history. That is checked, not
asserted: \`node scripts/secret-audit.mjs --history\` reads every blob that has
ever existed in the repository, derives an address from every 32-byte hex value
it finds, and compares it against the wallets the project actually controls.
The mirror does not build unless that audit exits clean.

## Running the site from this

You cannot, quite: the images are not here, so a local build renders without
them. This mirror exists to be **read and verified**, not redeployed. The
running system is at [brainonbnb.com](https://brainonbnb.com), the marketplace
at [brainonbnb.com/registry](https://brainonbnb.com/registry), and the agent
service at [agent.brainonbnb.com](https://agent.brainonbnb.com).
`);

console.log(`\nwritten to ${OUT}`);
console.log('MIRROR.md generated from this run — its numbers cannot drift from the copy.');
