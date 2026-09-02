// Builds the Brain On BNB AI code library that the homepage links to.
//
// The GitHub account has been flagged since 2026-07-24, so every repo under it
// answers 404. This script takes the code that would have been there and turns
// it into something a stranger can actually use without an account anywhere:
// one .zip per project to download, and the same project flattened into one
// .txt so it can be handed to an AI in a single fetch.
//
// It is a build, not a copy. Every file is put through the redaction pass, and
// the whole thing REFUSES to write anything if a secret-shaped string survives
// it. Publishing is a one-way door, so the check runs on the output, not on the
// input, and it fails loudly rather than quietly dropping a file.
//
//   node scripts/build-library.mjs           # build
//   node scripts/build-library.mjs --check   # scan only, write nothing
//
// Output: dashboard/code/{slug}.zip, {slug}.txt, manifest.json, index.txt
//         scripts/library-block.html — the markup for the homepage section

import {readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Local-only, gitignored: see scripts/lib/personal-identifiers.mjs. Loaded
// with a fallback so a checkout without it still builds — the gate then has one
// rule fewer, and reports that rather than pretending to have applied it.
let PERSONAL = [], PERSONAL_SAMPLES = [];
try {
  const m = await import('./lib/personal-identifiers.mjs');
  PERSONAL = m.PERSONAL ?? [];
  PERSONAL_SAMPLES = m.SAMPLES ?? [];
} catch { /* absent on a machine that has nothing to redact */ }

const ROOT = join(import.meta.dirname, '..');
const OUT  = join(ROOT, 'dashboard', 'code');
const SITE = 'https://brainonbnb.com/code';
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// The shelf, in two rows. The bots come first because they are the part that
// runs unattended and the part nobody publishes — every project ships its front
// end, almost none ship the thing that moves the money. `needs` is what a reader
// wants before downloading anything: what it costs to run, and whether it needs
// a backend at all.
// ---------------------------------------------------------------------------
const GROUPS = [
  {key: 'bots', title: 'The Bots',
   blurb: 'Everything that runs on its own. Cron triggers, signed transactions, no human at the wheel.'},
  {key: 'apps', title: 'The Projects',
   blurb: 'The things people click. Each one shipped, each one still live or archived on this domain.'},
];

const BUNDLES = [
  {
    group: 'bots',
    slug: 'buyback-bot',
    title: 'Buyback & Burn Bot',
    tagline: 'The bot that has run every ten minutes since launch.',
    about: `Collects the trading tax, swaps it to BNB, buys $BOBAI back off the market
and sends it to the dead address. Runs as a Cloudflare Worker on a cron trigger, writes
one log entry per cycle to KV, and serves that log publicly so the dashboard can read it.
The local Node script is the same logic as a manual fallback.`,
    run: ['npx wrangler deploy', 'or locally: npm i && node -r dotenv/config buyback-bot.js'],
    entries: ['buyback-bot.js', 'worker/index.js', 'worker/wrangler.toml'],
    reqs: [
      {what: 'A wallet with a little gas in it', ours: 'one BSC wallet, topped up from the tax itself',
       alt: 'the token was launched on four.meme and trades on PancakeSwap V2; the swap calls are the only PancakeSwap-specific part'},
      {what: 'Somewhere that runs code on a schedule', ours: 'a Cloudflare Worker on a 10-minute cron',
       alt: 'a VPS with crontab, GitHub Actions, Fly.io, Railway, a Raspberry Pi, or node on your own machine'},
      {what: 'Somewhere to keep a small run log', ours: 'one Cloudflare KV namespace',
       alt: 'Redis, SQLite, Postgres, or a JSON file on disk — it writes one entry per cycle'},
      {what: 'A BSC RPC endpoint', ours: 'the public endpoints, with failover',
       alt: 'NodeReal, Ankr, QuickNode or your own node if you want the headroom'},
      {what: 'One secret at runtime: PRIVATE_KEY', ours: 'wrangler secret put',
       alt: 'a .env file, your host\'s secret store — anything but the source code'},
    ],
  },
  {
    group: 'bots',
    slug: 'dev-sweep-bot',
    title: 'Dev Sweep Bot',
    tagline: 'The hourly one that empties the tax wallet.',
    about: `Sweeps the creator share out of the tax wallet on its own schedule and unwraps
WBNB back to native BNB so the buyback bot always finds spendable gas. Small on purpose —
it is the piece that keeps the big bot from starving.`,
    reqs: [
      {what: 'A wallet that receives the tax', ours: 'the same wallet the buyback bot spends from',
       alt: 'any wallet — it only needs to be the one your token routes its fee to'},
      {what: 'Somewhere that runs code hourly', ours: 'a Cloudflare Worker on a cron trigger',
       alt: 'crontab, systemd timer, GitHub Actions, or any scheduler you already run'},
      {what: 'Somewhere to keep a cursor', ours: 'one KV namespace, shared with the buyback bot',
       alt: 'a file, a Redis key, a single database row — it stores very little'},
      {what: 'One secret at runtime: PRIVATE_KEY', ours: 'wrangler secret put',
       alt: 'a .env file or your host\'s secret store'},
    ],
    run: ['npx wrangler deploy', 'or locally: node -r dotenv/config dev-buyback.js'],
    entries: ['dev-buyback.js', 'worker-dev-buyback/index.js', 'worker-dev-buyback/wrangler.toml'],
  },
  {
    group: 'bots',
    slug: 'liquidity-bot',
    title: 'Liquidity Add & LP Burn',
    tagline: 'Adds liquidity, then burns the LP token it just received.',
    about: `Takes BNB and tokens, adds them to the PancakeSwap V2 pair and sends the LP
tokens straight to the dead address, so the liquidity can never be pulled again — not by
us either. Handles the fee-on-transfer case, which is where most naive add-liquidity
scripts revert. Includes the creator-share burn script.`,
    reqs: [
      {what: 'A wallet holding both sides of the pair', ours: 'BNB and the token, in one wallet',
       alt: 'any PancakeSwap V2 pair, and any BSC DEX sharing that router interface — the router is one constant'},
      {what: 'A machine that can run Node 18+', ours: 'run by hand, when we decide to add',
       alt: 'put it on a cron if you want it automatic; nothing in it needs a human'},
      {what: 'Slippage set for a fee-on-transfer token', ours: '≥1500 bps',
       alt: 'none — a normal 1% simply reverts. This is the single thing that breaks naive add-liquidity scripts'},
      {what: 'One secret at runtime: PRIVATE_KEY', ours: 'a local .env file',
       alt: 'your shell environment, a secret manager, a hardware signer'},
    ],
    run: ['npm i', 'node -r dotenv/config add-liquidity-safe.js'],
    entries: ['add-liquidity-safe.js', 'burn-creator-bobai.js'],
  },
  {
    group: 'bots',
    slug: 'telegram-bot',
    title: 'Telegram Bot',
    tagline: 'Buy alerts, burn alerts, price, whale tracking, captcha.',
    about: `A full community bot as a single Cloudflare Worker: reads Swap and Transfer
logs off the chain to post buy and burn alerts with generated images, answers /price,
/burns, /security and friends, tracks a watchlist of whale wallets, and gates new joiners
with a captcha. No polling server — a one-minute cron plus a webhook.`,
    reqs: [
      {what: 'A bot token', ours: 'one from @BotFather, two minutes of work',
       alt: 'none — this is Telegram\'s only door'},
      {what: 'Somewhere to receive a webhook and run a cron', ours: 'a single Cloudflare Worker doing both',
       alt: 'any HTTPS endpoint: a small VPS, Deno Deploy, Vercel, Fly.io. Long-polling works too, at the cost of a process that never sleeps'},
      {what: 'Somewhere to keep state', ours: 'one Cloudflare KV namespace',
       alt: 'Redis, SQLite, Postgres — it stores the block cursor, the watchlist and the captcha queue'},
      {what: 'A BSC RPC endpoint that allows eth_getLogs', ours: 'a keyed endpoint, with free ones as fallback',
       alt: 'NodeReal, Ankr, QuickNode. Note that bsc-dataseed refuses log queries outright'},
      {what: 'One secret at runtime: BOT_TOKEN', ours: 'wrangler secret put',
       alt: 'any secret store your host offers'},
    ],
    run: ['npx wrangler deploy', 'then point the Telegram webhook at the worker URL'],
    entries: ['worker-tg-bot/index.js', 'worker-tg-bot/wrangler.toml', 'scripts/tg'],
  },
  {
    group: 'bots',
    slug: 'nft-mint-bot',
    title: 'NFT Auto-Mint Bot',
    tagline: 'Watches the pair and mints to the buyer, unasked.',
    about: `Reads Swap logs off the pair block by block, prices each buy in dollars, and
mints an NFT straight to any wallet that crossed the threshold — no claim page, no
signature from the buyer, no gas for them. Keeps its own cursor in KV so a restart never
double-mints and never skips a block.`,
    reqs: [
      {what: 'A deployed ERC-721 it is allowed to mint from', ours: 'the contract in the NFT Buy Drops bundle',
       alt: 'any ERC-721 with a mint function and a minter role'},
      {what: 'A wallet with gas', ours: 'the bot pays the mint, so the buyer pays nothing',
       alt: 'you could make the buyer claim and pay — but then it is a claim page, not a drop'},
      {what: 'Somewhere that runs code on a schedule', ours: 'a Cloudflare Worker cron',
       alt: 'crontab, GitHub Actions, any always-on process'},
      {what: 'Somewhere to keep the block cursor', ours: 'one KV namespace',
       alt: 'a file or a database row. Whatever it is, it must be durable: this is what stops a restart double-minting'},
      {what: 'One secret at runtime: PRIVATE_KEY', ours: 'wrangler secret put',
       alt: 'a .env file or your host\'s secret store'},
    ],
    run: ['npx wrangler deploy'],
    entries: ['worker-nft-mint/index.js', 'worker-nft-mint/wrangler.toml'],
  },
  {
    group: 'bots',
    slug: 'prize-pool-bot',
    title: 'Prize Pool & Payout Bot',
    tagline: 'Filled a prize pool from trading tax, then paid 39 wallets out.',
    about: `The bot behind the World Cup prize pool: it took a slice of every trade into a
pool wallet, tracked what the pool was worth as the price moved, and at the end sent the
prizes out on-chain — 8.94M tokens across 39 winners, group stage and finals, each with
its transaction hash. The price-capture script pins the token price at kickoff so a payout
promised in dollars settles in tokens at an agreed, recorded rate.`,
    reqs: [
      {what: 'A wallet holding the pool', ours: 'a dedicated wallet, funded by a slice of the tax',
       alt: 'a multisig if the pool is large enough to be worth arguing about'},
      {what: 'Somewhere the entries and scores live', ours: 'the Supabase project from the Worldcup bundle',
       alt: 'any Postgres, or any store you can read a winners list out of'},
      {what: 'A machine that can run Node 18+', ours: 'run by hand, watched, one round at a time',
       alt: 'none worth having. This one sends money to strangers — do not put it on a cron'},
      {what: 'Secrets at runtime: PRIVATE_KEY, database URL and key', ours: 'a local .env file',
       alt: 'a secret manager. Never the source'},
      {what: 'A dry run first', ours: '--dry-run, every single time',
       alt: 'there is no alternative. Read the script before you copy it'},
    ],
    run: ['node -r dotenv/config worldcup-bot.js', 'node scripts/worldcup/wc-payout-final.js --dry-run'],
    entries: ['worldcup-bot.js', 'scripts/worldcup'],
  },
  {
    group: 'apps',
    slug: 'pool-scanner',
    title: 'Pool Scanner',
    tagline: 'Reads any BNB Chain pool. No backend at all.',
    about: `Paste a token, a pool or a DexScreener link and it measures what a trader
actually meets: price impact and real cost per trade size, the transfer tax derived from
executed trades rather than from a label, and whether the LP is burned, locked or
withdrawable. Everything happens in the visitor's browser — it costs the operator nothing
to run, because there is nothing to run.`,
    reqs: [
      {what: 'A static host', ours: 'Cloudflare Pages',
       alt: 'GitHub Pages, Netlify, Vercel, S3, nginx, or python -m http.server on your laptop'},
      {what: 'Public RPC endpoints', ours: 'six, with failover, all free',
       alt: 'your own node if you expect traffic. Note the requests leave from the visitor\'s browser, not your server — which is why this costs nothing to run'},
      {what: 'Nothing else', ours: 'no backend, no database, no API key, no build step',
       alt: 'that is the whole point of it'},
    ],
    run: ['drop the files on any static host, or: python -m http.server'],
    // scanner-scan.js is in here even though the page does not load it: it is
    // the same measurement without a browser, and it is what the installable
    // skill and the MCP tool both run. Leaving it out would make the bundle a
    // copy of the page rather than of the thing.
    entries: ['dashboard/scanner.html', 'dashboard/scanner.js', 'dashboard/scanner-chain.js', 'dashboard/scanner-scan.js', 'dashboard/tier-scan.js', 'dashboard/styles.css'],
  },
  {
    group: 'apps',
    slug: 'nft-drop',
    title: 'NFT Buy Drops',
    tagline: 'The contract, the metadata server and the collection page.',
    about: `An ERC-721 of 1,925 pieces that mints itself to buyers. In here: the Solidity
source, the deploy, base-URI and renounce scripts, the worker that serves the metadata,
and the public collection page. The bot that decides who gets one is its own bundle.`,
    reqs: [
      {what: 'A wallet with gas for the deployment', ours: 'one transaction on BSC, a few cents',
       alt: 'any EVM chain — the contract is plain Solidity with no chain-specific parts'},
      {what: 'Somewhere to serve the metadata', ours: 'a small Cloudflare Worker',
       alt: 'static JSON files on any host. It is one file per token id and nothing else'},
      {what: 'Somewhere to host the images', ours: 'our own domain, over plain HTTPS',
       alt: 'IPFS or Arweave — but link them by https gateway. Several marketplaces will not resolve an ipfs:// URL'},
      {what: 'Your marketplace metadata set BEFORE you renounce', ours: 'set, checked, then renounced',
       alt: 'none. After renouncing it is permanent, and no marketplace can help you'},
    ],
    run: ['node scripts/deploy.js', 'npx wrangler deploy'],
    entries: ['nft/contract/src', 'nft/contract/scripts', 'worker-nft-meta/index.js',
              'worker-nft-meta/wrangler.toml', 'dashboard/nft/index.html'],
  },
  {
    group: 'apps',
    slug: 'worldcup-tipgame',
    title: 'Worldcup Tipping Game',
    tagline: 'A full tournament game that paid out on-chain.',
    about: `Signup, tips locked at kickoff, live brackets through the knockout rounds,
penalties and extra time, a leaderboard, a bonus round and an on-chain prize payout —
8.94M tokens across 39 wallets, each with its transaction hash. The Postgres schema and
every migration are in here, so the scoring rules are readable rather than described.`,
    reqs: [
      {what: 'A Postgres with row-level security and auth', ours: 'Supabase, free tier, all the way through',
       alt: 'any Postgres plus an auth layer. The schema is plain SQL; the RLS policies are the part worth reading'},
      {what: 'Somewhere that pulls fixtures on a schedule', ours: 'a Cloudflare Worker cron',
       alt: 'any scheduler. It fetches, compares and writes — nothing exotic'},
      {what: 'A fixtures and results feed', ours: 'football-data.org, free tier',
       alt: 'any sports API, or type the results in by hand for a small tournament'},
      {what: 'A wallet, only if you pay out on-chain', ours: 'one wallet, one payout script, 39 transactions',
       alt: 'skip it entirely and the game still works — the prize pool is optional scaffolding'},
    ],
    run: ['run the SQL in app/sql/schema.sql, then the migrations in order', 'npx wrangler deploy'],
    entries: ['dashboard/worldcup/index.html', 'dashboard/worldcup/app', 'worker-wc/index.js',
              'worker-wc/wrangler.toml', 'worker-wc/migrations'],
  },
  {
    group: 'apps',
    slug: 'browser-game',
    title: 'Burn & Add Liq — Browser Game',
    tagline: 'One HTML file. Jump, burn, dodge the dumps.',
    about: `A side-scrolling browser game in a single document — canvas rendering, its own
sprite work, touch and keyboard controls, and a public highscore board. The only moving
part outside the file is the score table.`,
    reqs: [
      {what: 'A static host', ours: 'Cloudflare Pages',
       alt: 'anything that can serve one HTML file. Open it from disk and it plays'},
      {what: 'A score table, only if you want the board', ours: 'one Supabase table; the SQL is in the bundle',
       alt: 'any database with an HTTP API, or leave it out — the game runs fine and keeps scores locally'},
      {what: 'To know what a public score table means', ours: 'anyone holding the browser key can post a score',
       alt: 'put the insert behind your own endpoint, or add an upper bound, if the board is meant to be competitive'},
    ],
    run: ['open index.html'],
    entries: ['dashboard/game/index.html', 'game/bobai_scores_setup.sql'],
  },
  {
    group: 'apps',
    slug: 'brainscreener',
    title: 'brainScreener',
    tagline: 'Thirteen self-tests. No accounts, no tracking, no backend.',
    about: `ADHD, IQ, depression, anxiety, trauma, personality and more — each an
established instrument with its scoring implemented in the page itself. Nothing is sent
anywhere: the answers never leave the browser, which is also why there is no server here
to speak of.`,
    reqs: [
      {what: 'A static host', ours: 'Cloudflare Pages',
       alt: 'any of them. There is no build step and no framework'},
      {what: 'Nothing else', ours: 'no database, no accounts, no analytics, no cookies',
       alt: 'the answers never leave the browser, which is a design decision rather than a shortcut'},
    ],
    run: ['serve the folder'],
    entries: ['dashboard/brainscreener'],
    exts: ['.html', '.js', '.css'],
  },
  {
    group: 'apps',
    slug: 'agent-tools',
    title: 'Agent Tools — MCP & llms.txt',
    tagline: 'What an AI agent sees when it asks this project a question.',
    about: `The MCP server and the HTTP tool endpoints that let an agent read live token
data straight off the chain, plus the agent card, the ERC-8004 registration and the
llms.txt that tells a crawler what is here. This is the piece that made the project
discoverable to agents rather than only to people.`,
    reqs: [
      {what: 'A machine that can run Node 18+', ours: 'the MCP server over stdio, locally',
       alt: 'point any MCP client at it — Claude Desktop, Claude Code, Cursor, or your own'},
      {what: 'Somewhere to serve the HTTP tools', ours: 'the Pages worker already serving the site',
       alt: 'any HTTPS endpoint, or skip it and run the MCP server only'},
      {what: 'No keys at all', ours: 'every tool reads public chain data',
       alt: 'there is nothing to secure here, which is why it can be pointed at an agent without a second thought'},
    ],
    run: ['node mcp/server.mjs', 'or deploy the Pages worker and point your client at /mcp'],
    entries: ['mcp/server.mjs', 'dashboard/_worker.js', 'dashboard/llms.txt', 'scripts/bobai-agent-card.json'],
  },
  {
    group: 'apps',
    slug: 'agent-service',
    title: 'The Agent Service — x402, Broker & Census',
    tagline: 'An agent that sells something, and gets paid without a human in the loop.',
    about: `The paid half of the agent surface. It answers HTTP 402 with a price, takes USD1
on BNB Chain by two routes — standard x402 through a public facilitator, or a plain transfer
plus the transaction hash — verifies the money actually arrived, and only then starts the work.
It also publishes a catalogue at /.well-known/x402 so an agent holding nothing but the domain
can discover what is for sale, a broker that searches every ERC-8004 agent on the chain, a
dispatcher that routes a task to whichever of them can answer it, and the census that keeps
that picture current. The dispatcher is deliberately read-only: anything that signs, sends or
swaps is handed back for the caller to do themselves, never executed on their behalf.`,
    reqs: [
      {what: 'A wallet to be paid into', ours: 'one BSC wallet, separate from the bots',
       alt: 'any address — it is only ever a recipient, and the worker never holds its key'},
      {what: 'Somewhere that runs code on a schedule', ours: 'a Cloudflare Worker, 15-minute cron',
       alt: 'anything with a timer — the cron drives the watch sweep, the daily census and the canary'},
      {what: 'Somewhere to keep watches and the census', ours: 'one KV namespace',
       alt: 'Redis, SQLite, Postgres — it stores one record per watch and one blob per census tick'},
      {what: 'A payment facilitator, or none', ours: 'the public Dexter facilitator for the standard route',
       alt: 'the direct-transfer route needs no facilitator at all, which is why both are offered'},
      {what: 'A BSC RPC endpoint', ours: 'the public endpoints, with failover',
       alt: 'any node — note that some public RPCs cannot serve eth_getTransactionReceipt, which payment verification needs'},
      {what: 'Two secrets at runtime: X402_WALLET and the admin trigger secret', ours: 'wrangler secret put',
       alt: 'the ownership proofs in the catalogue are signed offline and pasted in as constants — the private key never reaches the worker'},
    ],
    run: ['npx wrangler deploy', 'node scripts/x402-catalog-proof.mjs --verify  # check the catalogue signs what it claims'],
    entries: ['worker-agent', 'worker-lp', 'shared', 'scripts/lp-agent.mjs', 'scripts/x402-catalog-proof.mjs', 'docs/x402-catalog.md'],
  },
  {
    group: 'apps',
    slug: 'chain-census',
    title: 'The Census — reading a whole registry',
    tagline: 'Every agent id on BNB Chain, and every job they were ever paid for.',
    about: `The measurement behind Brain Plaza, and the reason its numbers can be checked
rather than believed. Two exhaustive scans, no sampling: one reads all 285,447 ids in the
ERC-8004 identity registry and contacts every endpoint they name; the other reads all 56,655
jobs in the ERC-8183 escrow kernel and works out who has actually been hired and paid. Both
resume after interruption, both treat a node refusing a batch as a fact about the node
rather than about the chain, and both report what stayed unreadable instead of quietly
dropping it. The publisher turns the two into the page and the JSON endpoints, and refuses
to publish a scan that did not finish.`,
    reqs: [
      {what: 'Node 18+ and time', ours: 'about three hours for the registry, twenty minutes for the jobs',
       alt: 'both resume, so it can be run in pieces — the state file is the progress'},
      {what: 'RPC endpoints', ours: 'eleven public BSC nodes in rotation, 25 calls per batch',
       alt: 'any node list. Breadth matters more than speed: each one rate-limits separately, and 40 per batch is refused where 25 goes through'},
      {what: 'No keys', ours: 'every call is a read',
       alt: 'nothing here can move anything, which is why it can be pointed at a stranger’s contract without a second thought'},
    ],
    run: [
      'node scripts/erc8004-scan.mjs           # the identity registry, every id',
      'node scripts/erc8004-probe.mjs          # does the endpoint answer?',
      'node scripts/erc8183-job-scan.mjs       # the job escrow, every job',
      'node scripts/erc8183-job-scan.mjs --owners --report',
      'node scripts/erc8004-publish.mjs        # writes the page and the JSON',
    ],
    entries: [
      'scripts/erc8004-scan.mjs', 'scripts/erc8004-probe.mjs', 'scripts/erc8004-enrich.mjs',
      'scripts/erc8004-publish.mjs', 'scripts/erc8183-job-scan.mjs',
      'scripts/lib/group-agents.mjs', 'scripts/lib/job-aggregate.mjs',
    ],
  },
];

// ---------------------------------------------------------------------------
// Collecting files
// ---------------------------------------------------------------------------
const TEXT_EXT = ['.js', '.mjs', '.cjs', '.ts', '.html', '.css', '.json', '.toml',
                  '.sol', '.sql', '.md', '.py', '.txt', '.yml', '.yaml'];
// `assets` is NOT skipped: in these apps it holds the actual JavaScript and CSS,
// and dropping it shipped a brainScreener with no scoring code in it. Images are
// kept out by the extension filter instead, which is the honest way to do it.
const SKIP_DIR  = new Set(['node_modules', '.git', 'build', 'dist', '.wrangler', 'illus', '_refs', 'refs']);
const SKIP_FILE = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
const MAX_FILE  = 400 * 1024;

function walk(abs, exts, acc = []) {
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIR.has(name)) walk(p, exts, acc); continue; }
    if (SKIP_FILE.has(name) || name.startsWith('.env') || name.endsWith('.dev.vars')) continue;
    if (!exts.some(e => name.toLowerCase().endsWith(e))) continue;
    if (st.size > MAX_FILE) continue;
    acc.push(p);
  }
  return acc;
}

function collect(bundle) {
  const exts = bundle.exts || TEXT_EXT;
  const files = [];
  for (const entry of bundle.entries) {
    const abs = join(ROOT, entry);
    if (!existsSync(abs)) { throw new Error(`${bundle.slug}: ${entry} does not exist`); }
    if (statSync(abs).isDirectory()) files.push(...walk(abs, exts));
    else files.push(abs);
  }
  // Line endings are normalised to LF and trailing blank lines dropped. Both are
  // hygiene for published code, and both are load-bearing here: the browser hands
  // back LF regardless of what was served, so a CRLF file rendered in the viewer
  // no longer matches its own source, and the line count printed on the page no
  // longer matches the one printed in the viewer.
  return [...new Set(files)].sort().map(abs => ({
    path: relative(ROOT, abs).replace(/\\/g, '/'),
    body: readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, ''),
  }));
}

// ---------------------------------------------------------------------------
// Redaction, then the bolt on the door.
//
// REDACT rewrites what is ours but useless to a reader (our own Cloudflare
// resource ids, absolute paths off this machine). FORBIDDEN is checked AFTER
// redaction and aborts the build: no output is written if anything matches.
// ---------------------------------------------------------------------------
const REDACT = [
  // Cloudflare KV namespace / account ids. Harmless without our credentials, but
  // a copied config should point at the reader's resources, not at ours.
  [/^(\s*id\s*=\s*)"[0-9a-f]{32}"/gmi,          '$1"<your-kv-namespace-id>"'],
  [/^(\s*preview_id\s*=\s*)"[0-9a-f]{32}"/gmi,  '$1"<your-kv-preview-id>"'],
  [/^(\s*account_id\s*=\s*)"[0-9a-f]{32}"/gmi,  '$1"<your-cloudflare-account-id>"'],
  // Absolute paths from the machine this was built on.
  [/[a-z]:[\\/]ai[\\/]fourmeme/gi, '<repo>'],
  [/[Cc]:[\\/]Users[\\/][A-Za-z0-9_.-]+/g, '<home>'],
];

// The only 64-hex constants allowed through: public event topic hashes, which
// every contract on the chain shares. Anything else that shape is treated as a key.
const ALLOWED_HEX64 = new Set([
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822', // Swap (V2)
  '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83', // Swap (PancakeSwap V3)
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67', // Swap (Uniswap V3)
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', // Approval
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1', // Sync
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f', // Mint
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496', // Burn
  '0x799b2cd04630260020ee5b9f8e761cdf644383855739696bf8f1aadbc73dfd2a', // NFT buy-drop marker
]);

const FORBIDDEN = [
  // Length is deliberately open-ended: pinned to exactly 35 this let a 36-char
  // token walk straight through, which the self-test caught.
  [/\b\d{8,12}:[A-Za-z0-9_-]{30,}/g,                        'Telegram bot token'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g,          'JWT (Supabase service role?)'],
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/g,                       'Supabase secret key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g,                              'OpenAI-style secret key'],
  [/\b(sk|rk)_live_[A-Za-z0-9]{10,}/g,                      'live secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/g,                                 'AWS access key id'],
  [/\bghp_[A-Za-z0-9]{20,}/g,                               'GitHub token'],
  [/(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SECRET|PASSWORD|API_KEY|BOT_TOKEN|SERVICE_ROLE[A-Z_]*)\s*[:=]\s*["'][^"'\n]{16,}["']/g,
                                                            'assigned secret literal'],
  // The operator's personal identifiers are NOT written here. A rule that
  // spells out the name it protects publishes that name in every copy of this
  // script — which is exactly what happened, and what the mirror caught.
  // They live in scripts/lib/personal-identifiers.mjs, which is gitignored and
  // never bundled. Without it the gate has one rule fewer and says so.
  ...PERSONAL.map((re) => [re, 'personal identifier']),
];

function redact(body) {
  let out = body;
  for (const [re, to] of REDACT) out = out.replace(re, to);
  return out;
}

function scan(path, body) {
  const hits = [];
  for (const [re, what] of FORBIDDEN) {
    // These regexes are shared, global and therefore STATEFUL. matchAll starts
    // from lastIndex, so any earlier .test() on the same object makes this scan
    // begin partway through the text and miss what is in front of it — a gate
    // that silently checks the second half of every file. Cost an hour to find
    // when a planted identifier came back clean.
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      hits.push({path, what, at: body.slice(0, m.index).split('\n').length, sample: m[0].slice(0, 40)});
    }
  }
  // Match the WHOLE hex run, not the first 64 characters of it. Pinned to {64}
  // this flagged every 130-hex signature as a private key, because a key is a
  // prefix of one — the gate then refused to build over strings that are public
  // by design. Reading the full run is what makes the length meaningful.
  for (const m of body.matchAll(/0x[0-9a-fA-F]{64,}(?![0-9a-fA-F])/g)) {
    const hex = m[0].slice(2);
    const before = body.slice(Math.max(0, m.index - 40), m.index);

    // Exactly 65 bytes is an ECDSA signature (r,s,v) and cannot be a 32-byte
    // key. Ours are the ownership proofs from the x402 catalogue — published on
    // purpose, at a public URL, and worthless to anyone holding them.
    if (hex.length === 130) continue;

    // A hash inside a block-explorer transaction link is a public transaction.
    // The URL is the proof: a private key does not appear after /tx/.
    if (hex.length === 64 && /(bscscan\.com|etherscan\.io|solscan\.io)\/tx\/$/.test(before)) continue;

    if (hex.length === 64 && ALLOWED_HEX64.has(m[0].toLowerCase())) continue;

    hits.push({path, what: `${hex.length}-hex — private key?`, at: body.slice(0, m.index).split('\n').length,
               sample: m[0].slice(0, 12) + '…'});
  }
  return hits;
}

// A gate nobody has watched fail is not a gate. These are the shapes it exists
// to stop; if any of them walks through, the build is wrong and says so before
// it has written a byte.
function selftest() {
  const cases = [
    ['0x' + 'a3f9'.repeat(16),                                   'private key'],
    ['const k = "0x' + 'b7'.repeat(32) + '";',                    'private key in an assignment'],
    ['BOT_TOKEN=7412345678:AAH9xKqLmNoPqRsTuVwXyZ012345678901ab', 'telegram token'],
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2Vydmlj.x', 'supabase service jwt'],
    ['sb_secret_9fKq2LmZx8RtVw4NpQ', 'supabase secret'],
    ['OPENAI_API_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345"', 'openai key'],
    ['PRIVATE_KEY: "correct horse battery staple hunter2!!"',     'assigned secret literal'],
    // Personal identifiers are checked separately, below: this pipeline REDACTS
    // some of them and REFUSES others, and both outcomes are correct. Listing
    // them here would demand a refusal for a home path that redact() has
    // already turned into <home>, and the test would fail on a gate doing its
    // job.
  ];
  let failed = 0;
  for (const [text, what] of cases) {
    if (!scan('selftest', redact(text)).length) { console.error(`  MISSED: ${what}`); failed++; }
  }

  // Personal identifiers: the property that matters is that none of them
  // SURVIVES the pipeline. Redaction rewriting a home path to <home> and the
  // forbidden scan refusing the operator's name are both passes; the failure is
  // a specimen coming out the far end unchanged. The specimens live in the
  // local-only file so this script carries no example of what it protects.
  for (const sample of PERSONAL_SAMPLES) {
    const after = redact(sample);
    const stillThere = PERSONAL.some((re) => { re.lastIndex = 0; return re.test(after); });
    const refused = scan('selftest', after).length > 0;
    if (stillThere && !refused) { console.error('  SURVIVED: a personal identifier passed through untouched'); failed++; }
  }
  if (PERSONAL.length && !PERSONAL_SAMPLES.length) {
    console.error('  personal identifier rules loaded with no specimen to prove them'); failed++;
  }
  // And the other direction: a public event topic must not trip it, or the gate
  // cries wolf on every file and gets switched off.
  // The other direction: things that are public by design must NOT trip it, or
  // the gate cries wolf on every file and gets switched off. Each of these was
  // a real false positive that stopped a real build.
  const clean = [
    ['const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";', 'a public event topic'],
    ['burn: https://bscscan.com/tx/0x0da33c6339fd88de8fa443f7d41d0e0749fbac14e678c976fd3dc0f6ea39b27e', 'a transaction link'],
    [`proof: "0x${'ab'.repeat(65)}"`, 'a 65-byte signature'],
  ];
  for (const [text, what] of clean) {
    if (scan('selftest', redact(text)).length) { console.error(`  FALSE POSITIVE on ${what}`); failed++; }
  }
  // Loosening the length check must not open a hole: a bare 64-byte hex run is
  // the shape of a raw keypair, and a key merely sitting near a transaction
  // link is still a key.
  for (const [text, what] of [
    [`const k = "0x${'7f'.repeat(64)}";`, 'a 64-byte hex blob'],
    [`0x${'d4'.repeat(32)} // near bscscan.com/tx/ but not inside the link`, 'a bare key beside a tx link'],
  ]) {
    if (!scan('selftest', redact(text)).length) { console.error(`  MISSED: ${what}`); failed++; }
  }
  const total = cases.length + clean.length + 2;
  if (failed) { console.error(`\nself-test failed (${failed}) — the redaction gate is not doing its job.`); process.exit(1); }
  // The personal-identifier count is stated, not implied. When the specimen
  // list grew from one to four, the old hook kept printing the same green line
  // while three of the rules went untested — a number that moves is the only
  // way that shows.
  console.log(`redaction self-test: ${total}/${total} passed, plus ${PERSONAL_SAMPLES.length} personal-identifier specimen(s) against ${PERSONAL.length} rule(s)`);
}
selftest();

// ---------------------------------------------------------------------------
// Zip, written by hand. A dependency for this would be a dependency to audit,
// and the format is thirty lines: local header, deflated body, central directory.
// ---------------------------------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) { let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c; }
  return b => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const raw = Buffer.from(f.body, 'utf8');
    const body = deflateRawSync(raw, {level: 9});
    const crc = CRC(raw);
    // Fixed timestamp: the same input must produce the same archive, so a
    // rebuild that changed nothing is visibly identical (same sha).
    const time = 0, date = (2026 - 1980) << 9 | 1 << 5 | 1;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

// ---------------------------------------------------------------------------
const LICENSE = `MIT License

Copyright (c) 2026 Brain On BNB AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function readme(b, files) {
  return `# ${b.title}

${b.tagline}

${b.about.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()}

## What you need

Written as: the requirement, then how we solved it, then what else works. None of
it is tied to the hosting we happen to use.

${b.reqs.map(r => `- **${r.what}**\n    ours: ${r.ours}\n    also: ${r.alt}`).join('\n')}

## Run it

${b.run.map(r => '    ' + r).join('\n')}

## What is in here

${files.map(f => '- `' + f.path + '`  (' + f.body.split('\n').length + ' lines)').join('\n')}

## What is NOT in here

No private keys, no API tokens, no bot tokens, no wallet files. Every secret is
supplied at runtime through the environment — in the Cloudflare workers via
\`wrangler secret put\`, locally via a \`.env\` file you create yourself. The
config files name the variables and nothing more.

Cloudflare KV namespace ids have been replaced with placeholders, so a copied
config points at your resources rather than at ours.

Contract and wallet addresses are left as they are. They are public on the
chain and printed on the site, and leaving them in is what lets you hold this
code against the transactions it actually produced.

## Where this came from

Brain On BNB AI — https://brainonbnb.com
This bundle: ${SITE}/${b.slug}.zip
The same files as one text file, for handing to an AI: ${SITE}/${b.slug}.txt

Built by AI, start to finish. MIT licensed — see LICENSE.
`;
}

function flatten(b, files) {
  const head = `# ${b.title} — Brain On BNB AI
# ${b.tagline}
#
# This is the complete ${b.slug} bundle as a single file, so it can be read in
# one fetch. ${files.length} files, ${files.reduce((s, f) => s + f.body.split('\n').length, 0)} lines.
# Download as a zip: ${SITE}/${b.slug}.zip
# Everything else:   ${SITE}/index.txt
#
# No secrets are present: they are supplied at runtime through the environment.
# MIT licensed.

`;
  return head + files.map(f =>
    `\n${'='.repeat(78)}\n=== FILE: ${f.path}\n${'='.repeat(78)}\n\n${f.body}\n`).join('');
}

// ---------------------------------------------------------------------------
const built = [];
const problems = [];

for (const b of BUNDLES) {
  const src = collect(b);
  const files = src.map(f => ({path: f.path, body: redact(f.body)}));
  for (const f of files) problems.push(...scan(f.path, f.body));
  built.push({b, files});
}

if (problems.length) {
  console.error('\nREFUSING TO BUILD — secret-shaped strings survived redaction:\n');
  for (const p of problems) console.error(`  ${p.path}:${p.at}  ${p.what}  →  ${p.sample}`);
  console.error(`\n${problems.length} finding(s). Nothing was written.`);
  process.exit(1);
}
console.log(`redaction pass clean across ${built.reduce((s, x) => s + x.files.length, 0)} files`);
if (CHECK_ONLY) process.exit(0);

// --verify [origin] — is what is published still what the repo says?
// Answers "are the bundles up to date" by comparing, not by trusting a build
// that may have run before the last edit. Compares the freshly collected files
// against the .txt actually being served.
if (process.argv.includes('--verify')) {
  const origin = process.argv[process.argv.indexOf('--verify') + 1] || 'https://brainonbnb.com';
  let stale = 0, checked = 0;
  for (const {b, files} of built) {
    const res = await fetch(`${origin}/code/${b.slug}.txt`);
    if (!res.ok) { console.log(`STALE ${b.slug}: not published (${res.status})`); stale++; continue; }
    const live = await res.text();
    const drift = [];
    for (const f of files) {
      checked++;
      const marker = `=== FILE: ${f.path}\n`;
      const i = live.indexOf(marker);
      if (i < 0) { drift.push(`${f.path}: missing from the published bundle`); continue; }
      const rest = live.slice(i + marker.length).replace(/^={70,}\n\n/, '');
      const end = rest.indexOf('\n' + '='.repeat(78) + '\n=== FILE: ');
      const body = (end < 0 ? rest : rest.slice(0, end)).replace(/\n+$/, '');
      if (body !== f.body) drift.push(`${f.path}: differs from the repo`);
    }
    // A file deleted from a bundle would otherwise pass unnoticed.
    const liveCount = (live.match(/\n=== FILE: /g) || []).length;
    if (liveCount !== files.length) drift.push(`published bundle has ${liveCount} files, the repo has ${files.length}`);
    if (drift.length) stale++;
    console.log(`${drift.length ? 'STALE' : 'ok   '} ${b.slug.padEnd(18)} ${files.length} files`);
    drift.slice(0, 5).forEach(d => console.log('    !! ' + d));
  }
  console.log(`\n${checked} files compared against ${origin} — ${stale} bundle(s) out of date`);
  process.exit(stale ? 1 : 0);
}

rmSync(OUT, {recursive: true, force: true});
mkdirSync(OUT, {recursive: true});

const manifest = [];
for (const {b, files} of built) {
  const payload = [
    {path: `${b.slug}/README.md`, body: readme(b, files)},
    {path: `${b.slug}/LICENSE`, body: LICENSE},
    ...files.map(f => ({path: `${b.slug}/${f.path}`, body: f.body})),
  ];
  const archive = zip(payload);
  const flat = flatten(b, files);
  writeFileSync(join(OUT, `${b.slug}.zip`), archive);
  writeFileSync(join(OUT, `${b.slug}.txt`), flat);
  const lines = files.reduce((s, f) => s + f.body.split('\n').length, 0);
  manifest.push({
    slug: b.slug, group: b.group, title: b.title, tagline: b.tagline,
    files: files.length, lines,
    zipBytes: archive.length, txtBytes: Buffer.byteLength(flat),
    sha256: createHash('sha256').update(archive).digest('hex').slice(0, 16),
    reqs: b.reqs, paths: files.map(f => f.path),
  });
  console.log(`${b.slug.padEnd(20)} ${String(files.length).padStart(3)} files  ${String(lines).padStart(6)} lines  ` +
              `${(archive.length / 1024).toFixed(0).padStart(4)} KB zip  ${(Buffer.byteLength(flat) / 1024).toFixed(0).padStart(4)} KB txt`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  name: 'Brain On BNB AI — code library',
  site: 'https://brainonbnb.com',
  license: 'MIT',
  note: 'No secrets are included in any bundle. They are supplied at runtime through the environment.',
  bundles: manifest,
}, null, 1));

// The index an agent is handed first: what exists, what it costs to run, where to get it.
writeFileSync(join(OUT, 'index.txt'), `Brain On BNB AI — code library
${'='.repeat(78)}

Everything this project has shipped, packaged to be read and run by someone
who is not us. Built by AI, start to finish. MIT licensed.

Each bundle exists twice:
  ${SITE}/<name>.zip   the files, to download and run
  ${SITE}/<name>.txt   the same files flattened into one, to hand to an AI

Machine-readable index: ${SITE}/manifest.json

No secrets are included anywhere. Every bundle takes its keys from the
environment at runtime, and the config files name the variables only.

${GROUPS.map(g => `
${'#'.repeat(78)}
## ${g.title.toUpperCase()} — ${g.blurb}
${'#'.repeat(78)}
${manifest.filter(m => m.group === g.key).map(m => `
${m.title}
${'-'.repeat(m.title.length)}
${m.tagline}
${m.files} files, ${m.lines} lines
needs:${m.reqs.map(r => `\n  - ${r.what}\n      ours: ${r.ours}\n      also: ${r.alt}`).join('')}
zip: ${SITE}/${m.slug}.zip
txt: ${SITE}/${m.slug}.txt`).join('\n')}`).join('\n')}

${'='.repeat(78)}
https://brainonbnb.com
`);

// The homepage section, generated so the copy and the figures cannot drift from
// what was actually built. Paste into dashboard/index.html under Block 04.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kb = n => n >= 1024 * 100 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
const BLOCK = GROUPS.map(g => `    <div class="lib-grp fi">
      <div class="lib-gh"><h3>${esc(g.title)}</h3><p>${esc(g.blurb)}</p></div>
${manifest.filter(m => m.group === g.key).map(m => `      <details class="lib-i">
        <summary>
          <span class="lib-h">
            <span class="lib-t">${esc(m.title)}</span>
            <span class="lib-s">${esc(m.tagline)}</span>
          </span>
          <span class="lib-m">${m.files} ${m.files === 1 ? 'file' : 'files'} &middot; ${m.lines.toLocaleString('en-US')} lines &middot; ${kb(m.zipBytes)}</span>
          <span class="lib-a">&#x25BE;</span>
        </summary>
        <div class="lib-b">
          <div class="lib-n"><b>What you need to run it &mdash; and what else works</b><ul>${
            m.reqs.map(r => `<li><span class="lib-q">${esc(r.what)}</span>` +
              `<span class="lib-o"><em>ours</em> ${esc(r.ours)}</span>` +
              `<span class="lib-o"><em>also</em> ${esc(r.alt)}</span></li>`).join('')}</ul></div>
          <div class="lib-g">
            <button class="lib-btn lib-view" type="button" data-slug="${m.slug}" data-title="${esc(m.title)}">&#x25A3; View the code</button>
            <a class="lib-btn" href="/code/${m.slug}.zip" download>&#x2193; Download .zip</a>
            <a class="lib-btn lib-alt" href="/code/${m.slug}.txt" target="_blank" rel="noopener">Plain text &#x2197;</a>
          </div>
          <div class="lib-c">
            <span class="lib-cl">Hand the whole thing to an AI</span>
            <code>curl -sL ${SITE}/${m.slug}.txt</code>
            <button class="lib-cp" type="button" data-copy="curl -sL ${SITE}/${m.slug}.txt">copy</button>
          </div>
        </div>
      </details>`).join('\n')}
    </div>`).join('\n');

// Spliced straight into the page between its markers rather than left in a file
// for someone to paste. A generated block that has to be copied by hand is a
// block that goes stale the first time nobody remembers to copy it.
// The library section lives on /classic since 2026-09-02: the homepage was
// cut down to the token, the tools, the burns and the community, and links
// here for the code. The markers moved with the page.
const INDEX = join(ROOT, 'dashboard', 'library.html');
const page = readFileSync(INDEX, 'utf8');
const B = '<!-- LIBRARY:BEGIN -->', E = '<!-- LIBRARY:END -->';
const i = page.indexOf(B), k = page.indexOf(E);
if (i < 0 || k < 0) throw new Error('classic.html is missing the LIBRARY markers');
writeFileSync(INDEX, page.slice(0, i + B.length) + '\n' + BLOCK + '\n' + page.slice(k));

console.log(`\nwrote ${manifest.length} bundles to dashboard/code/`);
console.log('spliced the section into dashboard/library.html');
