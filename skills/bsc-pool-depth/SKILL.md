---
name: bsc-pool-depth
description: Measure what a trade on BNB Smart Chain actually costs before placing it — real pool depth, price impact per trade size, and the transfer tax read off executed trades rather than off a label. Works on any BEP-20 token or pool address. Use when asked whether a token is liquid enough to trade, what slippage to expect, how big a position a pool can absorb, or why a swap quote looks worse than the headline price.
version: 1.0.0
license: MIT
metadata:
  author: brainonbnb
  homepage: https://brainonbnb.com/scanner
---

# BSC Pool Depth

Answers one question for any token on BNB Smart Chain: **what would this trade actually cost me?**

Not the headline price. Not the router's slippage estimate. The whole cost — swap
fee, price impact at the size you are trading, and the token's transfer tax —
measured against the pool as it stands right now.

## Why this exists

A swap quote flatters the trade. A token can show a healthy market cap and a
tidy chart while its pool holds $17,000, where a $1,000 buy costs 8.5% before
anyone has done anything wrong. Nothing on a price chart shows that. This does.

Two things here are measured rather than assumed, and both matter:

**The transfer tax comes from executed trades, not from a reputation service.**
A token security API once reported 4.45% sell tax for a token whose last four
on-chain sells were charged exactly 3.000%. This reads the pool's own swap logs
and the token's Transfer events in the same transaction; the gap between what
the pool sent and what the wallet received is what was actually charged. When
too few recent trades exist to measure, the result says so — `measured: false`,
with the label attributed to its source. Never silently.

**Every venue's swap fee was derived on-chain, not read off a docs page.** For
each router, `factory()` was confirmed and `getAmountsOut` solved against live
reserves. A venue whose fee has not been verified is not scanned and not
guessed at, because applying PancakeSwap's 0.25% to a Uniswap pool understates
the cost by 0.05 points with nothing to say so.

## Usage

```bash
node scripts/scan.mjs <token-or-pool-address>
```

Accepts a bare address, or any BscScan / DexScreener / PancakeSwap link
containing one. Pass a **token** address to have the deepest verified pool
found for you; pass a **pool** address to ask about that specific pool.

Requires Node.js 18+. No API key, no account, no install — it reads public BSC
RPC endpoints directly, so it costs nothing and rate-limits nobody.

## What comes back

JSON on stdout. The fields that carry the answer:

| Field | What it tells you |
|---|---|
| `tradeCost[]` | Total cost in percent at $100 / 150 / 250 / 500 / 1k / 2.5k, buy and sell separately — tax, fee and impact combined |
| `onePercentDepth` | USD size that moves the price 1% in each direction. The plainest one-number answer to "how deep is this really" |
| `tax.measured` | **Check this.** `true` = read off real trades. `false` = a label nobody verified |
| `pool.shareOfLiquidity` | What fraction of the token's liquidity this pool holds. A low number means you are looking at a side pocket |
| `lp.burnedPct` | Share of LP tokens sent to a burn address and therefore unwithdrawable (V2 pools only) |
| `quotable` | `false` when no pool is deep or representative enough to quote honestly — read `reason` |

## Reading the result

**`quotable: false` is an answer, not a failure.** It means no pool held enough
of this token's liquidity to describe its market. Quoting a ladder off a $338
side pool for a token with $2M in depth elsewhere would produce a confident,
wrong number — so it produces none.

**`tax.measured: false` weakens everything downstream.** The cost figures still
compute, but on an unverified tax rate. Say so when reporting them.

**Cost is not a verdict.** A 3% tax is a design choice on some tokens and a trap
on others; this tool reports the number, not a judgement about the project. Do
not translate a high cost into "scam", or a low one into "safe".

**Depth changes block to block.** A scan describes the pool at the moment it
ran. For anything time-sensitive, re-run rather than reuse.

## What this does not do

It does not place trades, hold keys, or sign anything — it only reads. It does
not detect honeypots, malicious contract logic, or ownership traps; pair it with
a dedicated security scanner for that. It covers BNB Smart Chain only.

## Where the numbers come from

Public BSC RPC endpoints (`eth_call`, `eth_getLogs`), a pool of them ordered by
measured latency so one node dropping a request does not become a claim about
someone's token. Pool discovery cross-checks a DEX index so that small venues
are not missed. Contract properties that no `eth_call` reveals — proxy,
mintable, open source — come from GoPlus, always attributed, never allowed to
override a measured figure.

The same chain layer runs the browser version at
[brainonbnb.com/scanner](https://brainonbnb.com/scanner), which is where this
code comes from. That site also exposes an MCP server and plain REST endpoints
for agents that would rather call an API than run a script.

---

Measurement, not financial advice. Verify anything that matters before acting on it.
