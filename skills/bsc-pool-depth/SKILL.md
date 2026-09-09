---
name: bsc-pool-depth
description: Measure what a trade on BNB Smart Chain actually costs before placing it — real pool depth, price impact per trade size, and the transfer tax read off executed trades rather than off a label. Also compares the PancakeSwap fee tiers a pair lives in (V2 0.25%, V3 0.01/0.05/0.25/1.00%) by the fees each pool actually paid — per dollar of capital in it, and per dollar of capital standing within 2% of the price, which is the only part of it earning. And it replays candidate V3 price ranges against the swaps that really happened, reporting what each width would have collected and how much of the window it stayed in range. Works on any BEP-20 token or pool address. Use when asked whether a token is liquid enough to trade, what slippage to expect, how big a position a pool can absorb, why a swap quote looks worse than the headline price, which fee tier and which price range to provide liquidity in, or which PancakeSwap route a swap should take and whether the proceeds can be sold back.
version: 1.3.0
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
| `sellability` | Our own sell test: a sell of one part in a thousand of the reserve, simulated on the router from a fresh address at this block. `ok:false` means not checked, never "safe" |
| `curve` | Present when the token is still raising on four.meme and has no pool yet: `raised`/`maxRaising`/`progressPct`, `priceUsd`, the platform `feePct`, and `tradeCost[]` quoted by four.meme's own contract for the same sizes as a pool ladder. `quotable` stays `false` because there is no pool |

## Reading the result

**A token still on its four.meme launch curve has no pool, by design.** It comes
back `quotable: false` with a `curve` object instead: how much of the raise is
done, the price, what a buy and a sell of each size would cost through four.meme's
contract (fee included), and where the money sits (in that contract until the
raise completes). A `tradeCost[]` row with `note` "more than the curve has left to
sell" is a size the curve cannot fill — report it as such, not as cheap.

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

## The other question: which fee tier to provide liquidity in

```bash
node scripts/tiers.mjs <token-or-pool-address>
```

A pair on PancakeSwap does not live in one pool. It lives in up to five at
once — V2 at 0.25%, and V3 at 0.01%, 0.05%, 0.25% and 1.00% — sharing a price
and competing for the same flow. Every source an LP can consult ranks those
pools by the money already parked in them, which is the one number that does not
answer the question.

This measures each tier over a live window and returns
`fees_per_1000_usd_parked`: the swap fees that pool actually paid out, divided
by both sides of its capital in dollars. Measured on the busiest pairs on the
chain, the tier holding the most capital was routinely not the one paying best,
and a 1.00% pool held real money on every pair while trading on none of them —
`idle_capital` names those.

Three things to hold on to when reporting it:

**It is a sample, not a rate.** The window is around an hour of chain and
is returned with the answer in `measured_window`. Do not annualise it. An
hour of flow says what happened in that hour.

**Capital is both sides of the pool.** Dividing by one side makes the identical
V3 pool look several times better or worse depending on which token you call the
quote, because concentrated liquidity is not balanced.

**A V3 tier figure has two denominators and they disagree.** `capital_usd` is
what the contract holds, which includes liquidity parked outside the current
price range earning nothing; `working_capital_usd` is the part standing within
2% of the price, read from the pool's own tick book. The first is what a
committed position returns on, the second is what a dollar you have not placed
yet would compete with, and `working_capital_changes_the_answer` says when the
choice of denominator flips which tier wins. Impermanent loss is in neither.

## The third question: which price range

```bash
node scripts/ranges.mjs <token-or-v3-pool-address> --usd 1000
```

Having picked a tier, a V3 provider still has to say between which two prices
the money sits, and that decision moves the result far more than the tier does.
On CAKE/BNB a ±0.5% range collected roughly 400 times what the same money
collects spread across every price.

This does not model and does not forecast. The V3 `Swap` event carries the
liquidity that was active when the trade went through, so a position of the
stated size is walked through the swaps that actually happened: in range or not,
and what share of the liquidity standing there it would have been — with its own
size in the denominator, because arriving is what dilutes it.

Per candidate width it returns the fees collected, `share_of_window_in_range_pct`,
and `times_it_crossed_the_edge`. Two things to hold on to:

**"Held" means in range for the whole window**, not "was never seen leaving".
The position is centred on today's price and replayed backwards, so a narrow
range the price wandered into halfway through has left nothing — and reporting
that as held is a real mistake this made once.

**Impermanent loss is not in it, and it is worst exactly where the fees are
best.** The narrow range that collected the most is also the one that ends
furthest from the composition it started in. Fees are not returns.

## Before a swap: which route, and can you get back out

```bash
node scripts/route.mjs <token-or-pool-address> --usd 250
```

Two questions, both of which an automated swap has to answer before it signs.

**Which route.** The pair lives in up to five PancakeSwap pools. Each is quoted
by the venue for the exact size, and the winner is whichever really returns the
most. The deepest pool is regularly not the cheapest one for the trade being
made — depth is a fact about the pool, cost is a fact about the trade. Every
losing route is returned with how much worse it was.

**And whether you can get out.** The proceeds are sold straight back on the same
route, both legs quoted, with the transfer tax measured from executed trades
applied to the amounts carried between them — the tax is taken outside the pool,
where no quoter can see it. `you_keep_pct` includes it;
`you_keep_pct_pools_only` is the same trip through the pools alone, so the tax
appears as its own cost rather than as bad depth.

`slippage_bps_needed` is what that size really needs. A fee-on-transfer token
gets 1500 bps, because a router compares its pre-tax quote against a post-tax
delivery and anything tighter reverts every time — the tolerance is not the
loss, the tax is taken either way.

It does not use the word "safe" and is not a certificate. It cannot see an owner
who has not acted yet, a proxy that has not been upgraded yet, or a blacklist
you are not on today, and `cannot_see` says so in every answer.

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
