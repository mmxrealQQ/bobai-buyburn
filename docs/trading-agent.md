# The trading agent — runbook (private)

Not published: this file, `scripts/trader*.mjs`, `shared/trader-core.js` and
`data/trader/` are kept out of the source mirror (`scripts/build-mirror.mjs`,
`PRIVATE_TREES`). The agent trades the operator's own money through his
Binance Agentic Wallet; it is not part of what brainonbnb.com offers.

## What it is (since 2026-09-09: the slow machine)

The operator's brief, 2026-09-09: *not fast money — slow, long-term, as much as possible.*
Four assets on BNB Chain — BNB, CAKE, BOB, USDT — plus $BOBAI as where the profit goes
(bought on its dips, never sold). One rule, chosen by measurement (below), plus the
operator's profit rule:

- **A target allocation, always invested.** A third each of BNB, CAKE and BOB; USDT only
  as the arrival buffer for deposits. `ALLOCATION` in `shared/trader-core.js`.
- **One tick a day, 00:20 UTC** (after the 00:00 close the backtest used). Any day: a
  *top-up pass* invests cash that arrived (a deposit) into the sleeves under target and
  sells nothing. **Every 30 days: the full pass** — sleeves that drifted more than 20% from
  target are sold down / bought up (`planRebalance`, band `REBALANCE_BAND`). Under ~$300
  the band never fires (a fifth of a third is under the $10 minimum), so the machine is
  buy-and-hold there; that is fine and was measured.
- **A wallet keep-alive at 12:20 UTC.** The Agentic Wallet session lasts a year but only
  while it is used at least every 48 hours. The tick is a use; the keep-alive is a second,
  read-only one (status + balances, no orders, no state) so that one failed tick can never
  cost the session. It speaks up only when the wallet is no longer connected; then a new
  QR sign-in on the server is needed (`baw auth signin`). `--keepalive` runs it by hand.
- **Profit rule.** Profit is the pot above its own high-water mark, measured at the
  monthly pass (`profitTake`). Half of the excess leaves the pot for the profit pool, the
  other half stays and compounds; the mark moves to the pot after the take, so a dollar
  is never taken twice. Deposits raise the mark, never count as profit. The pool buys
  BOBAI when BOBAI dips (z ≤ −1 over 168 h) — bought, held, never sold.
- **Costs** per side per leg in `DEFAULT_COSTS_PCT`, gas 0.00047 BNB (~$0.35) a swap on
  top. With three trades a month, gas is a dollar; costs × 1.5 move the result by about
  a dollar (measured). The hourly rule this replaced turned negative under costs × 1.5.
- **BNB is a sleeve and the gas token.** What the agent bought is `units.BNB`; the rest
  of the wallet's BNB is the gas reserve (0.006, refilled from cash under 0.003) and
  whatever the operator sent. Deposit and gas rules look only at that rest.
- **Pending orders.** A swap is done when the wallet's balance says so, not when the
  order list does (2026-09-09: the first buy went through on-chain while
  `market-order list --orderId` answered an empty list for three minutes). An order still
  unseen after 180 s is written into the state as `pending`; the next tick books what
  arrived, measured against the balances taken before the order.
- **Monthly re-measure**, 1st of the month 01:00 UTC: six months fetched, `trader-slow.mjs`
  run on the pot's size, result reported to the operator. It changes nothing — the
  allocation is his decision.

### The hourly dip-trader it replaced (2026-09-08 – 2026-09-09 04:25 UTC, no order placed)

Kept in `scripts/trader.mjs` (backtest, robust, plan) and `shared/trader-core.js`
(`replayLeg`, `replayRotation`, `signal`) as the measured alternative: USDT base, one pot,
hourly z-score rule per leg (`reversion` buys a dip, `trend` a breakout), 6% stop, 72 h
hold, parameters chosen by walk-forward and refit weekly. Its evidence is below under
*Evidence (2026-09-09)*; the reason it was replaced is in *The slow variant, measured*.

## Where it lives

| Piece | Path |
|---|---|
| arithmetic (pure, self-tested) | `shared/trader-core.js` |
| analysis: self-test, backtest, robust, plan, status | `scripts/trader.mjs` |
| prices (Binance spot + GeckoTerminal pools, hourly, USD) | `scripts/trader-fetch.mjs` → `data/trader/prices.json` (6 months), `prices-live.json` (400 h, the tick) |
| chosen parameters | `data/trader/picks.json` (written by `--backtest`) |
| the live agent: bootstrap, tick, loop, re-measure, reports | `scripts/trader-live.mjs` |
| the slow backtest (allocation × cadence, walk-forward, costs × 1.5) | `scripts/trader-slow.mjs` |
| the cash sleeve, measured and not built (25 % USDT buying dips); `--reserve 50` measures the dip reserve | `scripts/trader-sleeve.mjs` |
| its state and log (on the server) | `data/trader/state.json`, `data/trader/log.jsonl` |
| the server | Hetzner Cloud `bobai-trader`, Helsinki, `2.29.45.27` — see the memory note `reference_trader_vps` |
| the wallet | Binance Agentic Wallet `0xcCCf2F2198e229027f6F61379a36E82D8F45958c` (BSC), signed in on the server for 365 days, CLI `baw` |
| reports | Telegram, the operator's private chat with @bobai_official_bot, via the bot worker's `/broadcast` with `target: 'operator'` |

## Commands

```
node scripts/trader.mjs --self-test          # 31 checks, both directions, no network
node scripts/trader-fetch.mjs --hours 4320   # six months of hourly closes
node scripts/trader.mjs --backtest           # choose parameters, report unseen results, write picks.json
node scripts/trader.mjs --robust             # four split points, costs × 1.5
node scripts/trader.mjs --plan               # what the rule says at the last close, no order
node scripts/trader-live.mjs --tick          # one hour, dry (--confirm sends)
node scripts/trader-live.mjs --state         # what the agent holds
node scripts/trader-live.mjs --notify-test   # a message to the operator's chat
```

On the server (as root, the agent runs as user `trader`):

```
ssh -i ~/.ssh/bobai-trader root@2.29.45.27
systemctl status bobai-trader            # the loop: a tick now and daily at 00:20 UTC, a wallet keep-alive at 12:20 UTC, a re-measure on the 1st at 01:00 UTC
journalctl -u bobai-trader -n 50         # what the ticks said
sudo -u trader node /home/trader/bobai/scripts/trader-live.mjs --state
touch /home/trader/bobai/data/trader/STOP   # halt: the loop keeps running but does nothing; rm to resume
```

After a change to any file in the table above: `scp -i ~/.ssh/bobai-trader <file> root@2.29.45.27:/home/trader/bobai/<path>`,
`chown -R trader:trader /home/trader/bobai`, `systemctl restart bobai-trader`.

## Guards

- never more than the cash there is in one buy and never more than $1,000 in one order (BOB's pool moves 0.3% at $500); the rest waits for tomorrow's pass
- nothing under $10; the BNB gas reserve (0.006, outside the BNB sleeve) is never traded and refills itself from cash under 0.003 BNB
- deposits are taken in by the next tick: BNB above the reserve becomes USDT, USDT beyond what the agent counts as its own raises the capital and the high-water mark; the next top-up pass invests it
- a leg whose price cannot be read (wallet and live file both silent) is not valued and not traded that day
- a refused or failed order ends the tick and is reported; an order unseen after 180 s becomes `pending` and is booked next tick from the balance; nothing is retried blind
- the wallet's own rules, set in the Binance App: 365-day sign-in, high-risk transactions need app confirmation, developer mode off

## Evidence (2026-09-09, six months 12.3.–8.9., $25 a leg, unseen last 40% = 72 days, gas charged)

The 2026-09-08 figures below were computed without gas and are kept for the record;
the ones that count are the second set.

Without gas (2026-09-08): per leg BNB +2.25, CAKE +3.72, BOB +4.62; rotation on $75 +62.20
realised, at four split points +48 / +66 / +99 / +37, with costs × 1.5 +31 / +47 / +79 / +29.

**With gas ($0.35 a swap, 2026-09-09):** per leg on $25 every leg is negative on the unseen
40% (BNB −0.71, CAKE −0.80, BOB −8.05; holding: +29.15 on 100). The rotation on a $75 pot
still nets +67.98 on the unseen 40% at the 60% split (18 trades, 9 won, BOB 13 of them),
but at the other split points only +4.89 / +6.79 / +18.08, and **with costs × 1.5 it loses at
every split: −17.44 / −4.34 / −2.29 / −2.30, and buys no BOBAI at all.** The edge, if there
is one, is thin, sits in BOB's few large breakouts, and is smaller than a bad month of costs.
Gas is a fixed dollar amount, so the pot size decides: at $110 the two swaps of a round trip
cost 0.64% before any fee; at $500 they cost 0.14%. An expectation, not a promise — and a
thin one.

## The slow variant, measured (2026-09-09, `scripts/trader-slow.mjs`)

The operator's brief on 2026-09-09: not fast money — slow, long-term, as much as possible.
That is a different machine (daily closes, a target allocation, monthly rebalancing, capital
always invested), so it was measured on the same 180 daily closes (13.3.–8.9.) with the same
costs and gas before anything was built. Chosen on the first 108 days, judged on the last 72:

| pot | chosen | unseen 72 d | costs × 1.5 | other splits (50/70/80%) | trades | gas |
|---|---|---|---|---|---|---|
| $110 | thirds BNB/CAKE/BOB, monthly | +43.23 (+39.3%) | +42.19 | +54 / +38 / +36 | 3 | $1.05 |
| $135 | same | +53.40 (+39.6%) | +52.28 | +50 / +48 / +45 | 3 | $1.05 |
| $500 | thirds, monthly, 20% band | +201.78 (+40.4%) | +199.65 | +190 / +180 / +171 | 3 | $1.05 |
| $1000 | same | +405.04 (+40.5%) | +401.53 | +381 / +361 / +343 | 3 | $1.05 |

Read honestly: (1) the first 108 days were flat (train P&L +0.25 on $110) and the whole gain
is the last 72, when BNB, CAKE and BOB rose — this is market exposure, not an edge; the same
machine loses when they fall (max drawdown over the six months 25–28%). (2) Rebalancing adds
nothing under ~$300: a third of $110 is $36, and a 20% drift is $7, under the $10 minimum, so
the machine is buy-and-hold there; at $500–1000 monthly rebalancing added 4–6 points over six
months and cut the drawdown by ~3 points. (3) Costs stop mattering: × 1.5 moves the result by
about one dollar, where the hourly agent turned negative. (4) Single assets did better in
hindsight (CAKE +58%, BOB +49% with a 40% drawdown) — that is a look-back, not a rule. Yield on
the parked assets (staking BNB/CAKE, lending USDT) is not in these numbers and is the next
thing to measure.

## The cash sleeve, measured and not built (2026-09-10, `scripts/trader-sleeve.mjs`)

On 2026-09-09 the operator saw that the thirds leave the agent with no USDT when a dip comes.
Measured before building, on the same 180 daily closes (13.3.–8.9.), same costs and gas, the
live monthly pass with the 20% band: weights 25/25/25 + 25 USDT; on every close a leg that is
X% under its trailing 7-day mean gets a lot (a third of the sleeve) from the cash, and the lot
goes back to USDT when a close is at or above that mean; on the monthly pass open lots fold
into their legs and the sleeve is refilled. X was chosen blind on the first 108 days from
3/4/5/6/8/10% and judged on the last 72, then again at the 50/70/80% splits and with costs × 1.5.
The rule agreed the day before: live only if the sleeve beats the thirds at every split.

| pot | X chosen | sleeve, unseen 72 d | thirds (live), same days | sleeve at 50/70/80% | thirds at 50/70/80% | verdict |
|---|---|---|---|---|---|---|
| $167 | 10% | +49.43 (+29.6%) | +66.41 (+39.8%) | +62 / +44 / +42 | +84 / +59 / +56 | behind at 4 of 4 |
| $500 | 10% | +150.96 (+30.2%) | +201.78 (+40.4%) | +190 / +135 / +128 | +254 / +180 / +171 | behind at 4 of 4 |
| $1000 | 10% | +303.41 (+30.3%) | +405.04 (+40.5%) | +381 / +271 / +257 | +511 / +361 / +343 | behind at 4 of 4 |

Why: (1) the cash itself costs ten points on a rising quarter — the sleeve without any dip rule
lands at +29.6% against +39.8% — and no X earns them back. (2) On $167 a lot is $14, and a
round trip costs ~1.5% plus $0.70 of gas, about 6.5% of the lot; the lots lose money at every
X under 8% (dip 3%: 27 lots, −12.38 over six months; 5%: 18 lots, −3.11) and only 8–10% dips
come out ahead (+1.24 / +2.94), which is why the blind choice is 10% — and on the unseen 72
days a 10% dip under the 7-day mean never happened, so the chosen machine bought nothing and
is simply the thirds with a quarter parked. (3) At $1000 the lots do earn (+36 to +41 at
5–10% over six months) but not the ten points the cash gives up. (4) What the sleeve does buy
is a smaller drawdown: 9.8–9.9% on the unseen days against 12.8%, 19–22% over six months
against 24.5%. That is insurance, paid for in return; it is not what the brief asked for.
(5) Costs × 1.5 change the picture by a dollar or two, nowhere the verdict.

Not built. Deposits keep going to the thirds through the top-up pass. If cash is ever wanted it
should be for a stated reason (a drawdown ceiling), not for return, and this is its price.

## The dip reserve (2026-09-10, live)

The operator wants stables for dips and is sending $50 USDT for that. A carve-out of the
thirds was measured and refused (above); a reserve is different money: it stays USDT by the
operator's decision, so its benchmark is idle USDT, not the thirds. Rule (`planReserve` in
`shared/trader-core.js`, the tick and the measurement run the same function): one lot at a
time, the whole reserve, into the leg furthest under its trailing 7-day mean of daily closes
when that is 8% or more under; back to USDT at the first daily close at or above the mean.
Deposits fill the reserve up to $50 before they top up the thirds; a lot's gain or loss stays
in the reserve; the thirds never see it (it is not in their holdings). One order at most per
tick; a pending reserve order is booked from the balance like any other.

Measured on the same 180 daily closes (`scripts/trader-sleeve.mjs --reserve 50`):

| X | 6 months | lots / won | unseen 72 d | lots / won |
|---|---|---|---|---|
| 5% | +14.71 | 12 / 8 | −4.80 | 3 / 1 |
| 8% | +25.17 | 9 / 7 | +4.86 | 3 / 2 |
| 10% | +22.22 | 5 / 4 | +0.00 | 0 / 0 |
| the same $50 in the thirds | +18.64 | — | +18.85 | — |

Chosen blind on the first 108 days the pick is 10%, and a 10% dip never came in the last 72,
so the blind result is exactly zero at every split. 8% is the operator's rule by judgment:
more lots, seven of nine won over six months, it fires in the unseen part and nets there.
Read honestly: the reserve is a bet on falling or choppy prices and the thirds a bet on rising
ones; on this rising half-year the thirds would have earned four times as much with the same
$50. Costs: a round trip is ~1.5% plus $0.70 of gas, about 3% of a $50 lot, which is why
nothing under 8% is worth buying. Yield on the waiting USDT (Lista 5%, Venus 2.7% through
the wallet's DeFi commands) is $0.23 a month on $50 — under one deposit's gas, not built.

## The server (2026-09-10)

Hetzner CX22-class, 1 vCPU / 2 GB, load 0.03, the trader is the only service. It exists
because the Agentic Wallet's CLI needs a signed-in host that Cloudflare Workers cannot be;
everything that needs the wallet to act belongs here (the thirds, the reserve, a DeFi step
if one is ever measured worth it), and nothing that does not.

## Live since

Hourly agent 2026-09-08 13:41 UTC (bootstrap 0.14822 BNB → 110.32 USDT, tx 0xc8a402…); it
placed no order in its 15 hours. Operator deposit 2026-09-09 ~04:20 UTC: +29.05 USDT.
**Slow machine live 2026-09-09 04:25 UTC**, first monthly pass on $139.37: USDT→BNB 46.46
(0.06165 BNB; the order went through while the order list stayed empty — hence the pending
mechanism, booked 04:30), USDT→CAKE 46.41 (20.41 CAKE, 0% under quote), USDT→BOB 46.41
(2.384e9 BOB, 0.03% under quote, tx 0xeeae1797…). Sleeves after: BNB $46.32 · CAKE $46.34 ·
BOB $46.37 · cash $0.09; pot $139.12 against $139.37 in (the costs). High-water mark
$139.37; next monthly pass 2026-10-09; daily tick 00:20 UTC.
