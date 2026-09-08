# The trading agent — runbook (private)

Not published: this file, `scripts/trader*.mjs`, `shared/trader-core.js` and
`data/trader/` are kept out of the source mirror (`scripts/build-mirror.mjs`,
`PRIVATE_TREES`). The agent trades the operator's own money through his
Binance Agentic Wallet; it is not part of what brainonbnb.com offers.

## What it is

Four traded assets on BNB Chain — BNB, CAKE, BOB, USDT — plus $BOBAI as where the
profit goes (bought on its dips, never sold), and one rule chosen by
evidence, plus the operator's profit rule:

- **USDT is the base position.** The pot sits in USDT when nothing earns an entry.
- **One pot, rotation.** Every hour the rule looks at BNB (against USDT), CAKE and
  BOB (in USD). If the pot is in a position and that leg says sell (back at its
  mean, a 6% stop, or 72 h held), it is sold to USDT; if the pot is free and a
  leg says buy, the deepest signal is bought with the whole pot. Both can
  happen in the same hour: out of a top, into a dip.
- **Two rule families, per leg, chosen by unseen hours.** `reversion` buys a
  dip (z-score of the log price against its rolling mean ≤ −entryZ) and sells at
  the mean; `trend` buys a breakout (z ≥ entryZ) and sells once the price is
  back under the mean. Parameters (family, window, entry, exit) are chosen on
  the first 60% of six months of hourly closes and judged on the last 40%;
  `--robust` repeats that at four split points and with costs × 1.5.
- **Profit rule.** Every closed trade's net goes to a profit pool. When BOBAI
  dips (its own z ≤ −1 over 168 h), half of the pool buys BOBAI — never sold —
  and half is added to the pot, so the capital compounds. Losses eat the pool
  first, then the pot.
- **Costs** per side per leg (pool fee + impact at size + wallet allowance) live
  in `DEFAULT_COSTS_PCT`; the wallet's own fee turned out to be inside its
  quote (bootstrap 2026-09-08: received 0.01% above quote), and gas is
  0.00047 BNB (~$0.35) per swap on top — hence the $10 minimum order.

## Where it lives

| Piece | Path |
|---|---|
| arithmetic (pure, self-tested) | `shared/trader-core.js` |
| analysis: self-test, backtest, robust, plan, status | `scripts/trader.mjs` |
| prices (Binance spot + GeckoTerminal pools, hourly, USD) | `scripts/trader-fetch.mjs` → `data/trader/prices.json` (6 months), `prices-live.json` (400 h, the tick) |
| chosen parameters | `data/trader/picks.json` (written by `--backtest`) |
| the live agent: bootstrap, tick, loop, refit, reports | `scripts/trader-live.mjs` |
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
systemctl status bobai-trader            # the loop: a tick every hour at :05, a refit every Monday 00:20 UTC
journalctl -u bobai-trader -n 50         # what the ticks said
sudo -u trader node /home/trader/bobai/scripts/trader-live.mjs --state
touch /home/trader/bobai/data/trader/STOP   # halt: the loop keeps running but does nothing; rm to resume
```

After a change to any file in the table above: `scp -i ~/.ssh/bobai-trader <file> root@2.29.45.27:/home/trader/bobai/<path>`,
`chown -R trader:trader /home/trader/bobai`, `systemctl restart bobai-trader`.

## Guards

- never more than the pot in one order and never more than $1,000 (BOB's pool moves 0.3% at $500); the rest waits in USDT
- nothing under $10; the BNB gas reserve (0.006) is never traded and refills itself from the pot under 0.003 BNB
- deposits are taken in by the next tick: BNB above the reserve becomes USDT, USDT beyond the capital on record raises the capital; nothing is added to an open position, the money waits for the next entry
- daily loss cap: realised losses over 5% of the capital in a UTC day block new entries until the next day (exits still run)
- a failed or refused order ends the tick and is reported; nothing is retried blind
- the wallet's own rules, set in the Binance App: 365-day sign-in, high-risk transactions need app confirmation, developer mode off

## Evidence (2026-09-08, six months 12.3.–8.9., $25 a leg, unseen last 40% = 72 days)

Per leg: BNB reversion +2.25, CAKE reversion +3.72, BOB trend +4.62 (holding: +30.63 on 100).
Rotation on a $75 pot: +62.20 realised in 21 trades (14 won), three BOBAI dips bought
$22.97 of BOBAI, total $173.61, drawdown 8.5%. At four split points: +48 / +66 / +99 / +37;
with costs × 1.5: +31 / +47 / +79 / +29. BOB carries most of it with a 37.5% hit rate — few large
winners — and the first half of the period had a 33% drawdown. An expectation, not a promise.

## Live since

2026-09-08 13:41 UTC. Bootstrap: 0.14822 BNB → 110.32 USDT (tx 0xc8a402…). First ticks: all
legs hold.
