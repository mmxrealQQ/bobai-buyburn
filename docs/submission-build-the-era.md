# Build the Era — submission draft

Prepared 2026-09-02, refreshed 2026-09-05. **Not submitted.** Deadline 2026-09-09, form
`forms.gle/9g9XPNFwnYaHAz9L8`, judging 2026-09-09 to 09-23.

Every figure below carries the date it was measured. On submission day, run
the refresh list at the bottom and replace any figure that moved; nothing in
this file is a claim that should outlive its date.

## Form fields

| Field | Answer |
|---|---|
| Project name | Brain Plaza — the measured agent marketplace for BNB Chain |
| One-line pitch | Every agent on BNB Chain, read from the registry, contacted, measured, and hireable in four clicks — with every number checkable on-chain. |
| Project GitHub Repo Link (required) | **OPEN — see "The repo link" below** |
| Sub-prize tracks | PancakeSwap (fee-tier measurement, hireable agent #310460) · TermiX (Agent Advantage Report, live at /advantage) · Altana (session keys on mainnet, live at /session) |
| Prototype stage | Live on BSC mainnet, public, in daily use by our own automation |
| Live URL | https://brainonbnb.com/registry |
| Name, e-mail, Telegram, X, country, wallet | filled in by the operator on the day — never stored in this repo |
| Availability 09-09 to 09-23 | yes |

## Project description (for the form, ~1,500 characters)

Brain Plaza is a marketplace built on what the chain actually says. We read
every id in the ERC-8004 identity registry on BNB Smart Chain (332,331 as of
2026-09-03), contacted every endpoint they name, and published who answers,
what they do, and what they have been paid — from the ERC-8183 escrow, all
56,665 jobs, not a sample. The result is a marketplace where a stranger lands,
picks one of the four categories (rebalancing, grid trading, yield, health
factor), reads what each agent does in one sentence, sees its live status,
and hires it through the ERC-8183 escrow with a wallet — sixteen hire
buttons, eleven of which returned a price when actually asked, five escrow
steps, every one verified end to end. Or types the task in plain words:
"measure the CAKE pool", "the health factor of the Venus position at 0x…" —
the broker finds an agent that can answer, calls it read-only, and names it.

The numbers are the point. Of 332,331 registered agents, 814 answer; those are
103 hosts run by 74 operators. 123 ids share one identical tool list. Of the
escrow's 56,665 jobs, 99.1% of the money comes from one address, and the
Studio's four reference agents have 16 funded jobs and 0 completed. We show
this on the page, with the method, because a marketplace that hides it is
selling the inflation.

Data quality is live: each agent's status is probed every fifteen minutes by
our worker, timestamped, and a probe that fails says whether the fault is the
agent's, the chain's, or ours. Our own five agents are hireable the same way
as everyone else's and answer in every category. The same measurement is
offered to agents free of charge as MCP, REST and an installable skill
(`npx skills add https://brainonbnb.com`) — 87,830 requests answered for other
agents as of 2026-09-04 — and six answers are sold per x402 or through the
escrow. What they pay runs, unattended, into the project's own PancakeSwap V3
position: an agent that re-sets the range in the width that earned the most
over the recorded prices, checks it every hour, and splits the fees: half
grows the position, half goes to the buyback that burns $BOBAI. Every step is
a transaction on BNB Chain and the record is public.

## How the three criteria are met — with evidence

### Functionality: land, find by category, understand, activate
- https://brainonbnb.com/registry — categories first, hire panel with 16
  buttons across all four categories, 11 quoting when asked (2026-09-03).
- Dispatch in plain words (2026-09-04): known symbols read as addresses, an
  account in the question is passed to the tool even when optional, and an
  answer about a different address than the one asked is refused and the
  next agent tried — pinned both ways in `scripts/dispatch-safety.mjs`.
- Wallet flow through the five escrow steps; job 56657 hired and COMPLETED
  (first seen 2026-09-02 07:21 UTC).
- Every row carries a one-sentence "what it does" (2026-08-25; the smoke
  checks it, `every hireable row says what the agent does`).
- Cold-start check `scripts/dashboard-check/registry-coldstart.mjs` measures
  the four categories against each other and presses the first button.

### Data quality: real-time, accurate, beyond counts
- Live telemetry every 15 minutes, `agent.brainonbnb.com/status` and
  `/telemetry.json`, with `checked_at` and a cause on every failure
  (`not_ready_because`: chain_unreachable | agent_error), since 2026-09-01.
- Job census: 56,665 jobs read, one address at 99.1% of the money
  (2026-09-03); our own jobs 56657 (completed), 56670–72 and 56694 open in
  their dispute windows. `/api-jobs.json`, MCP
  `bnb_agent_employment`.
- Reputation: 20,734 ratings read, 38 checkable; we write `responseTime`
  attestations with hashed evidence and answer ratings on our own agents
  (2026-09-01).
- Fleet unmasking: 814 responders = 103 hosts = 74 operators (2026-09-03).
- Every figure on the page is dated, and the growth section names the daily
  check's number beside the live headline rather than printing two "nows".

### Agent diversity: all four categories, equal depth
- Category depth measured 2026-09-03: rebalancing 5 entries (18 ids once
  fleets collapse) · grid trading 3 · yield 5 (247 ids) · health factor 6
  (11 ids). **Refresh on submission day.**
- Our own agents cover every category: #302257 Venus Health Factor Monitor,
  #302258 BSC Grid Planner, plus yield, rebalancing and the PancakeSwap
  fee-tier agent #310460.
- The chain itself lacks the depth the brief asks for; the page says so and
  shows what is there rather than padding it.

## Sub-prize evidence
- **PancakeSwap**: `pancakeswap_fee_tiers` (MCP, `/api/fee-tiers`, skill) —
  which of the five fee tiers actually pays an LP, by working capital in
  ±2% of price; agent #310460 delivers it for hire. Range replay and best
  route tools proven against the pool's own quoter (0.0000% deviation,
  2026-09-01). The project runs its own money through it: position #7324788,
  CAKE/BNB 0.05%, managed by the liquidity agent (https://brainonbnb.com/liquidity):
  the width is the one that netted the most per day when every width was
  replayed over the recorded hourly prices with the agent's own re-set delay
  and its measured re-set cost (the width record, readable, at
  agent.brainonbnb.com/lp/windows); the range is checked every hour and was
  re-set by the cron on its own on 2026-09-04 07:50 UTC (#7309536 to
  #7324788, 8 transactions, 0.000075 BNB of gas, measured); the fees are
  split 50/50 between the position and the buyback that burns $BOBAI, the
  share a public variable (LP_FEE_KEEP_PCT, since 2026-09-04); the record
  with every transaction and the money flow (came in, went out, waiting) is
  at agent.brainonbnb.com/lp/agent. The same reading is free for anyone's
  position at agent.brainonbnb.com/lp/look?position=<id> (since 2026-09-04),
  the plan with decisions is sold per x402.
  **TO FILL after the 2026-09-05 05:23 UTC run:** the first automatic
  increase (BNB above the reserve into the position, 3-4 transactions,
  the field `bnb_spent` in the record).
- **TermiX**: Agent Advantage Report at https://brainonbnb.com/advantage —
  three real tasks, each done with and without an agent; the hand-done path
  answered 0 of 3.
- **Altana**: session keys with allowlist, spend cap and expiry, registered in
  the KeyStore on mainnet, revocable — https://brainonbnb.com/session.

## The repo link

The form requires `Project GitHub Repo Link`. The GitHub account has been
flagged and 404 since 2026-07-24. Options, decision with the operator:

1. Ask the organisers whether `git clone https://brainonbnb.com/source.git`
   (500 files, secret-audited, verified) or the Library
   (https://brainonbnb.com/#library) satisfies the field. Honest, costs time.
   Draft, to send from the operator's own account (English, short):

   > Subject: Build the Era — repository link for a project whose GitHub account is suspended
   >
   > Hello — we are submitting Brain Plaza (https://brainonbnb.com/registry).
   > The form requires a GitHub repository link. Our GitHub account has been
   > flagged since 24 July and is under appeal; we have deliberately not opened
   > a second account, as that could be read as circumventing the flag.
   >
   > The full source is public and clonable from our own domain:
   > `git clone https://brainonbnb.com/source.git` (MIT, ~500 files, every
   > measurement on the site is produced by a script in it), and the same code
   > is packaged bundle by bundle at https://brainonbnb.com/#library.
   >
   > May we put that clone URL in the repository field? If you need GitHub
   > specifically, we will follow whatever you advise. Thank you.
2. Wait for the GitHub appeal.
3. ~~A second GitHub account~~ — advised against; circumventing a flag can
   sink the submission itself.

## Screens to attach
Captured to `temp/submission-screens/` by `node scripts/dashboard-check/submission-screens.mjs` (the folder is gitignored):
home, registry (categories + hire panel), scanner, advantage, session,
services, status, liquidity, lp-agent (the record), lp-windows (the width
record). Re-capture on submission day.

## Refresh on submission day
```
node scripts/health.mjs
node scripts/smoke-agent-surface.mjs
node scripts/dashboard-check/registry-coldstart.mjs
node scripts/dispatch-safety.mjs
curl -s https://agent.brainonbnb.com/stats | head -40
curl -s https://agent.brainonbnb.com/lp/agent | head -60   # the re-sets, with gas per transaction
```
Then replace every dated figure above with the fresh one, and re-capture the
screens.

Refresh run 2026-09-04 ~07:10 UTC: health 49/49 · smoke 177/177 · cold-start
"no problems" · dispatch-safety live "every tool not named after an action
can be reached" · screens captured (7 pages at 1440). Figures above are
current as of that run.
