# scripts/

Every script here is plan-by-default: run bare, it reads and prints; it moves
money or writes on-chain only with `--confirm`. Every checker has `--self-test`
where a wrong checker would be indistinguishable from a passing one. Nothing in
this folder is a cron; the crons are the `worker-*` folders.

## Is everything running?
| script | answers |
|---|---|
| `health.mjs` | are all systems alive (bots, agents, site, gas, the two daily Telegram posts) — one command; the checks live in `lib/health-checks.mjs` because `worker-health/` runs the same body every day at 09:10 UTC and reports to the operator on Telegram |
| `smoke-health-worker.mjs` | the morning health worker's two decisions: red is asked twice before it is reported, and the message (one line green, failing checks by name red), 9 pins both ways |
| `smoke-whale.mjs` | the whale tracker's quiet floor ($5), retire rule (empty 7 daily snapshots) and one-screen recap, and the cron run dry at 06:05 (no gate may log an out-of-scope name), 29 pins both ways; `--render` shows the recap and the small-wallet line from the live KV |
| `smoke-agent-surface.mjs` | does everything offered to a machine work end to end |
| `site-audit.mjs` · `site-fix.mjs` | every page against one checklist; the fixer applies what the audit found |
| `layout-audit.mjs` | does every page render at every width (real browser) |
| `asset-audit.mjs` · `link-audit.mjs` | does every image/script load; does every promise the site makes resolve |
| `secret-audit.mjs` | can the repository be published (worktree and history) |
| `gas-check.mjs` · `gas-refill.mjs` | can every bot still pay; top up the ones that cannot |
| `dispatch-safety.mjs` | does the router only call read-only tools, on both origins |
| `phase-parity.mjs` | do the two copies of the tax split agree |
| `dashboard-check/` | browser-driven checks of single pages and panels (see its README) |
| `dashboard-check/style-arrival.mjs` | does every visible class on every page meet a rule in a loaded stylesheet (the /advantage lesson) |

## The measurements the tools are built on
| script | checks |
|---|---|
| `band-depth-check.mjs` | working capital against the pool's own quoter |
| `range-replay-check.mjs` | the range replay's identities |
| `route-check.mjs` | best route, round trip, transfer tax (a quiet hour is skipped, not red) |
| `sell-sim-check.mjs` | the sell simulation: sellable tokens sell, a withheld allowance is refused, keccak vector |
| `curve-check.mjs` | the four.meme launch curve: read only for a curve, graduated tokens fall through, a size the curve cannot fill is flagged |
| `binance-route-crosscheck.mjs` · `binance-web3-check.mjs` | a second opinion from Binance's API; the signing, proven |
| `goplus-check.mjs` | the GoPlus key and signature |

## The DeFi agent
| script | does |
|---|---|
| `lp-plan.mjs` | where the tools would put the project's money |
| `lp-windows.mjs` | the width record, several windows, never one; since 2026-09-16 every width is replayed with one-sided re-sets (beside the price, no trade, gas alone) and the pick is the width that ended the most ahead against holding over the last week, fees included, kept unless another leads it by a tenth; the ten-minute price tape is walked beside the hourly heads, and 1.5/3/4/7% are derived between the replayed widths; `--self-test` pins all of it |
| `lp-pools.mjs` | RETIRED 2026-09-11 — the agent stays in CAKE/BNB 0.05% (HOME_POOL); the pool record's functions and pins stay as the record of how twelve pools were compared |
| `lp-portfolio.mjs` | the portfolio model as the page, the bot and the 05:00 card see it; `--self-test` pins its rules both ways |
| `lp-open.mjs` | open the position the tools chose |
| `lp-agent.mjs` | the daily worker's steps by hand: sweep, collect, rebalance (one-sided since 2026-09-16), increase; the ladder (a reserve range below the price from waiting BNB, gated by LP_LADDER) lives in the worker and is only planned here (`--step ladder`); since 2026-09-17 the script reads the worker's ladder record from `/lp/agent` (field `ladder`), so a wallet with a reserve range reads as one position, as the worker sees it; `--self-test` pins the guards, the ladder rule, the tick math and the trade sizing |
| `create-lp-wallet.mjs` | one-time: the wallet that holds the position |

## The census and the marketplace (ERC-8004 / ERC-8183)
Run in the order the header of `erc8004-publish.mjs` gives.
| script | does |
|---|---|
| `erc8004-scan.mjs` · `erc8004-probe.mjs` · `erc8004-a2a-confirm.mjs` · `erc8004-enrich.mjs` | read every id, contact every endpoint, settle the cards, fill in what the scan lacks |
| `erc8183-job-scan.mjs` | every escrow job, who was paid |
| `erc8004-hire-confirm.mjs` | ask every hireable agent for a price |
| `erc8004-publish.mjs` | write `/registry` and the JSON from all of the above |
| `census-sync.mjs` | hand the scan to the live worker |
| `erc8004-reputation-scan.mjs` · `erc8004-give-feedback.mjs` · `erc8004-append-response.mjs` | read the reputation registry; write measured feedback; answer ratings on our agents |
| `erc8183-job-watch.mjs` | our own jobs until each completes; `--settle` when the window has passed, `--refund` for a funded job nobody delivered |
| `register-own-agents.mjs` · `update-own-agents.mjs` · `hire-own-agent.mjs` | our five agents: register, republish, hire one for real |
| `update-8004-metadata.mjs` · `verify-8004-metadata.mjs` | agent #49467's document: write it, read it back |
| `a2a-card-audit.mjs` · `erc8183-encoding-check.mjs` | how many A2A cards really speak A2A; the hand-rolled calldata |
| `create-provider-wallet.mjs` · `fund-provider-wallet.mjs` | one-time: the wallet our agents sign as, and its gas |

## The paid service (x402) and the catalogues
| script | does |
|---|---|
| `x402-catalog-proof.mjs` | the ownership proofs in the catalogue, signed offline |
| `x402-buy-usd1.mjs` · `fund-service-wallet.mjs` · `create-x402-wallet.mjs` | one-time: the service wallet, its gas, a real paid request |
| `x402-buy-answer.mjs` | buy one of the six answers over x402 the way a stranger would: read the 402, pay 0.10 USD1 (or `--in bobai`: the same in $BOBAI, bought first), get the document; plan by default, `--confirm` spends |
| `x402-bazaar-scan.mjs` | what is inside the Coinbase Bazaar (measured, then declined) |
| `b402-register.mjs` | the Binance Bazaar listing — waits on the permission |
| `mcp-registry-publish.mjs` | the server entry in the official MCP registry |

## Publishing
| script | does |
|---|---|
| `build-library.mjs` | the code bundles on the homepage — after every change to a bundled file |
| `build-services.mjs` | `/services` from the catalogue |
| `build-skill.mjs` | the installable agent skill |
| `build-mirror.mjs` · `publish-source.mjs` | the public source mirror; then `--verify` |
| `advantage-report.mjs` · `advantage-publish.mjs` | the Agent Advantage Report, measured then rendered |
| `altana-session.mjs` | the agent's spending session in the Altana KeyStore |
| `dashboard-check/submission-screens.mjs` | screenshots for the hackathon submission, to files only |

## Left over
`lp-origin-scan.js` (whose LP is which, for the manual liquidity adds),
`generate-brainscreener-images.mjs` (one-time artwork), `tg/` (Telegram
updates), `worldcup/` (the 2026 tip game, archived), `lib/` (shared pieces).
