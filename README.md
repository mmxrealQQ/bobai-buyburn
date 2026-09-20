<p align="center">
  <img src="https://brainonbnb.com/logo-200x200.png" width="110" alt="BOBAI logo" />
</p>

<h1 align="center">Brain On BNB AI ($BOBAI)</h1>

<p align="center"><i>Still a meme — it just answers API calls now. 🧠</i></p>

<p align="center">
  <a href="https://brainonbnb.com/">Website</a> ·
  <a href="https://x.com/BrainOnBNB">X</a> ·
  <a href="https://t.me/bobai_official">Telegram</a> ·
  <a href="https://dexscreener.com/bsc/0x245c386dcfed896f5c346107596141e5edcbffff">DexScreener</a> ·
  <a href="https://brainonbnb.com/skill.md">Agent guide</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

---

**$BOBAI** is a fair-launched memecoin on BNB Chain with a simple thesis: don't ask for trust — make everything verifiable on-chain, then build things people (and AI agents) actually use.

- Token: [`0x245c386dcfed896f5c346107596141e5edcbffff`](https://bscscan.com/token/0x245c386dcfed896f5c346107596141e5edcbffff) (BEP-20, verified, ownership renounced)
- 3% on-chain tax powers a fully autonomous **24/7 buyback-and-burn flywheel** — every burn lands in a public audit log with a BscScan tx link
- LP tokens burned to `0x…dEaD` · fair launch on four.meme · no team allocation
- This repo is the public source for all of it — **read-only and keyless**: no private keys, no API keys, no custody

## What we've built

| | |
|---|---|
| 📊 **[Live dashboard](https://brainonbnb.com/)** | Price, burns, liquidity, buyback reserve — computed on-chain, every number verifiable |
| 🔍 **[Pool Scanner](https://brainonbnb.com/scanner)** | Paste any BNB Chain token or pool and read it the way a trader meets it: price impact and real cost per trade size, the transfer tax measured from executed trades, and whether the LP is burned, locked or withdrawable |
| 💧 **[DeFi agent](https://brainonbnb.com/defi)** | One PancakeSwap V3 position that runs itself: sweeps income, collects fees, re-sets its range one-sided, and buys $BOBAI with half of every fee. Daily run at 04:23 UTC, hourly range check, every step a transaction |
| 🏛 **[Brain Plaza](https://brainonbnb.com/registry)** | ERC-8004 agent census and ERC-8183 hiring on BNB Chain — search agents that actually answer, see who has been paid |
| 💵 **[Paid answers](https://brainonbnb.com/services)** | Six answers sold over x402 for 0.10 USD1 (or the same in $BOBAI). Agents pay without a page |
| 📚 **[The Library](https://brainonbnb.com/library)** · **[Source mirror](https://brainonbnb.com/source)** | Every subsystem as a readable bundle, plus `git clone https://brainonbnb.com/source.git` — a second copy on infrastructure we run ourselves |
| 🤖 **AI-agent rails** | Remote MCP server in the [official MCP registry](https://registry.modelcontextprotocol.io) (as far as we can tell, the first memecoin there), 21 read-only on-chain tools, plain-REST mirror, [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on-chain identity `#49467` — details below |
| 🖼️ **[NFT buy-drop](https://brainonbnb.com/nft/)** | Buy ≥ $100 of $BOBAI → a collectible NFT auto-mints to your wallet. 1925 supply, tiered rarity, [renounced contract](https://bscscan.com/address/0xd56226b3b8297a57f4361fca28aa43babdc9789d) |
| 💬 **[Telegram bot](https://t.me/bobai_official)** | Live buy/burn alerts, price & security commands, and a whale tracker with 1d/7d/30d holdings trends |
| 🧠 **[brainScreener](https://brainonbnb.com/brainscreener/)** | 13 free self-tests (IQ, ADHD screening & more) — runs in your browser, no signup |
| 🎮 **[Browser game](https://brainonbnb.com/game/)** | BOBAI arcade game with global highscores |
| ⚽ **[WC26 tip game](https://brainonbnb.com/worldcup/)** | The World Cup 2026 prediction game, finished — $BOBAI prize pools paid out on-chain, results and payouts still public |
| 📄 **[Whitepaper](https://brainonbnb.com/whitepaper)** | v2.2 — the whole design in one document |

Nothing above is a roadmap — it is all live, or finished and still public.

## MCP server

Live remote MCP endpoint (streamable HTTP, JSON-RPC 2.0, protocol `2025-06-18`, no auth, CORS open):

```
POST https://brainonbnb.com/mcp
```

Quick check:

```bash
curl -s https://brainonbnb.com/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Use with an MCP client

Remote (Claude Code, or any client that speaks streamable HTTP):

```bash
claude mcp add --transport http bobai https://brainonbnb.com/mcp
```

Local stdio (Claude Desktop and other stdio-only clients) — [`mcp/server.mjs`](mcp/server.mjs) is a zero-dependency stdio server (Node ≥ 18, no `npm install`):

```json
{
  "mcpServers": {
    "bobai": {
      "command": "node",
      "args": ["/path/to/bobai-buyburn/mcp/server.mjs"]
    }
  }
}
```

Or with Docker (uses the [`Dockerfile`](Dockerfile) in this repo):

```bash
docker build -t bobai-mcp . && docker run -i bobai-mcp
```

No clone at hand? [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridges stdio clients to the hosted endpoint: `npx -y mcp-remote https://brainonbnb.com/mcp`

### Tools (21, all read-only)

**Brain Plaza & PancakeSwap (any token, any wallet — not just $BOBAI)**

| Tool | What it returns |
|---|---|
| `find_agents_on_bnb_chain` | Every ERC-8004 agent on BNB Chain that actually answers when contacted, matched to what you need done |
| `bnb_agent_census` | The measured state of the ERC-8004 registry: registered, readable, reachable |
| `bnb_agent_employment` | Who has actually been hired and paid — the ERC-8183 job escrow, jobs created/funded/delivered |
| `bsc_token_preflight` | Before any trade, at your size: what stops it, what to weigh, route, slippage, round trip — one short answer |
| `bsc_pool_scan` | What a trade would really cost for any token or pool, read live from the chain |
| `pancakeswap_fee_tiers` | The up-to-five pools a pair lives in, compared on measured volume and fees |
| `pancakeswap_range_plan` | For a V3 liquidity provider: which price range, and what each width costs |
| `pancakeswap_best_route` | Which pool to swap through, and the round trip before signing |

**$BOBAI**

| Tool | What it returns |
|---|---|
| `bobai_guide` | START HERE — what an agent can ask/do and which tool to call |
| `bobai_token_info` | Contract, symbol, decimals, total/circulating supply, burned |
| `bobai_price` | Live price in USD/BNB + market cap, computed fully on-chain (pair reserves × Chainlink BNB/USD) — no off-chain price API to trust |
| `bobai_liquidity` | Pool reserves, liquidity USD, LP-burned %, price-impact estimates per buy size |
| `bobai_burned` | Total $BOBAI permanently burned by the 24/7 buyback bot |
| `bobai_circulating_supply` | Total supply minus burned |
| `bobai_activity` | Proof the flywheel runs: last burn tx, 7/30-day burns, total bot runs — every entry verifiable on BscScan |
| `bobai_smart_money` | Smart-money signals: tax reserve charging the next buyback, whale flows & holdings trends (1d/7d/30d), immutable ledger of recent $100+ buys, burn momentum |
| `bobai_dex_info` | PancakeSwap V2 router/pair/paths + the critical fee-on-transfer params (3% tax, ≥15% slippage, `SupportingFeeOnTransferTokens`) — the old name `bobai_trade_info` still answers |
| `bobai_purchase_guide` | Ready-to-run viem code to buy $BOBAI 0-shot — the old name `bobai_how_to_buy` still answers |
| `bobai_tokenomics` | Neutral, verifiable value-accrual mechanics (tax → buyback → burn) |
| `bobai_wallet_balance` | BNB + $BOBAI balance of any BSC address |
| `bobai_nft_drop` | Earnable NFT buy-drop: live remaining supply per tier + how to earn one |
| `bobai_links` | Official links (site, BscScan, X, Telegram, DexScreener, …) |

Plus 2 guided prompts and MCP resources (llms.txt, agent card). Every read tool is also mirrored as a **plain REST GET** endpoint for agents that don't speak MCP — see [brainonbnb.com/skill.md](https://brainonbnb.com/skill.md).

## What else is in this repo

| Path | What it is |
|---|---|
| `dashboard/` | brainonbnb.com (Cloudflare Pages) incl. the MCP server and the REST mirror (`_worker.js`) |
| `worker/` | Autonomous buyback-and-burn bot — Cloudflare Worker, cron every 10 min |
| `worker-dev-buyback/` | Creator-fee buyback bot — Cloudflare Worker, hourly cron |
| `worker-lp/` | The DeFi agent — Cloudflare Worker, daily 04:23 UTC + hourly range check |
| `worker-agent/` | The paid agent service: x402, ERC-8183 hiring, the portfolio model behind /defi |
| `worker-tg-bot/` | Telegram bot: buy & burn alerts, commands, the 05:00 UTC DeFi card |
| `worker-health/` | The morning health run — 09:10 UTC, reports to the operator on Telegram |
| `worker-*/` | The rest (NFT mint & metadata, World Cup game, redirects) |
| `shared/` | The code the workers and the hand scripts both run — one copy, never two |
| `scripts/` | Every audit and one-off tool, each with its own `--self-test` — see [scripts/README.md](scripts/README.md) |
| `mcp/` · `skills/` | Local stdio MCP server; the agent skill served to other agents |
| `nft/` · `stickers/` · `game/` | The drop contract and its generators, the sticker generators, the browser game |
| `data/` · `docs/` | Measured evidence from the chain; how the x402 catalogue and the LP service stage 2 were derived |
| `buyback-bot.js`, `dev-buyback.js`, `add-liquidity-safe.js` | The bots as plain Node scripts (manual fallback), and the manual liquidity add + LP burn |
| `burns.json`, `*-log.json` | Public audit logs — live at [logs.brainonbnb.com/logs/burns.json](https://logs.brainonbnb.com/logs/burns.json), every burn verifiable on-chain |

Every bot is a Cloudflare Worker; there is no CI runner and no `.github/` in this tree.

## Verify it yourself

Nothing here asks to be believed. Node ≥ 18, no `npm install`, no key:

```bash
node scripts/health.mjs                    # is everything running — bots, agents, site, gas, the two daily posts
node scripts/secret-audit.mjs --history    # no credential in the tree or in any blob that ever existed
node scripts/build-mirror.mjs --self-test  # the publishing rules, proven against their own cases
node scripts/lp-agent.mjs --self-test      # the DeFi agent's rules, pinned in both directions
```

Every script in [`scripts/`](scripts/README.md) is plan-by-default: run bare it reads and prints, and moves
money or writes on-chain only with `--confirm`. Every checker has a `--self-test` that fails if the
checker itself is wrong. Nothing in that folder is a cron — the crons are the `worker-*` folders.

## Trust properties

- Ownership renounced, LP tokens burned to `0x…dEaD`, fair launch on four.meme
- Price and liquidity data computed **on-chain only** (no third-party price API in the money path)
- All bot activity lands in public audit logs with BscScan tx links
- Nothing here is financial advice — verify everything yourself, that's the point

## License

[MIT](LICENSE)
