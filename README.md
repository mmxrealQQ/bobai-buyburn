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
  <a href="https://glama.ai/mcp/servers/mmxrealQQ/bobai-buyburn"><img src="https://glama.ai/mcp/servers/mmxrealQQ/bobai-buyburn/badges/score.svg" alt="Glama MCP server score" /></a>
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
| 🤖 **AI-agent rails** | Remote MCP server in the [official MCP registry](https://registry.modelcontextprotocol.io) (as far as we can tell, the first memecoin there), 14 read-only on-chain tools, plain-REST mirror, [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on-chain identity `#49467` — details below |
| 🖼️ **[NFT buy-drop](https://brainonbnb.com/nft/)** | Buy ≥ $100 of $BOBAI → a collectible NFT auto-mints to your wallet. 1925 supply, tiered rarity, [renounced contract](https://bscscan.com/address/0xd56226b3b8297a57f4361fca28aa43babdc9789d) |
| 💬 **[Telegram bot](https://t.me/bobai_official)** | Live buy/burn alerts, price & security commands, and a whale tracker with 1d/7d/30d holdings trends |
| 🧠 **[brainScreener](https://brainonbnb.com/brainscreener/)** | 13 free self-tests (IQ, ADHD screening & more) — runs in your browser, no signup |
| 🎮 **[Browser game](https://brainonbnb.com/game/)** | BOBAI arcade game with global highscores |
| ⚽ **[WC26 tip game](https://brainonbnb.com/worldcup/)** | Community World Cup 2026 prediction game with $BOBAI prize pools, paid out on-chain |
| 📄 **[Lite paper](https://brainonbnb.com/whitepaper)** | The whole design in one document |

Nothing above is a roadmap — it's all live.

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

### Tools (14, all read-only)

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
| `bobai_trade_info` | PancakeSwap V2 router/pair/paths + the critical fee-on-transfer params (3% tax, ≥15% slippage, `SupportingFeeOnTransferTokens`) |
| `bobai_how_to_buy` | Ready-to-run viem code to buy $BOBAI 0-shot |
| `bobai_tokenomics` | Neutral, verifiable value-accrual mechanics (tax → buyback → burn) |
| `bobai_wallet_balance` | BNB + $BOBAI balance of any BSC address |
| `bobai_nft_drop` | Earnable NFT buy-drop: live remaining supply per tier + how to earn one |
| `bobai_links` | Official links (site, BscScan, X, Telegram, DexScreener, …) |

Plus 2 guided prompts and MCP resources (llms.txt, agent card). Every read tool is also mirrored as a **plain REST GET** endpoint for agents that don't speak MCP — see [brainonbnb.com/skill.md](https://brainonbnb.com/skill.md).

## What else is in this repo

| Path | What it is |
|---|---|
| `dashboard/` | brainonbnb.com (Cloudflare Pages) incl. the MCP server (`_worker.js`) |
| `buyback-bot.js` | Autonomous BOB buyback-and-burn bot (runs 24/7 via GitHub Actions) |
| `dev-buyback.js` | Creator-fee buyback bot |
| `add-liquidity-safe.js` | Manual liquidity add + LP burn to the dead address |
| `worker-*/` | Cloudflare Workers (Telegram bot, NFT mint/metadata, World Cup game, …) |
| `burns.json`, `*-log.json` | Public audit logs — every burn/buyback verifiable on-chain |

## Trust properties

- Ownership renounced, LP tokens burned to `0x…dEaD`, fair launch on four.meme
- Price and liquidity data computed **on-chain only** (no third-party price API in the money path)
- All bot activity lands in public audit logs with BscScan tx links
- Nothing here is financial advice — verify everything yourself, that's the point

## License

[MIT](LICENSE)
