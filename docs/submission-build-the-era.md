# Build the Era — submission draft

Prepared 2026-09-02. **Not submitted.** Deadline 2026-09-09, form
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
every id in the ERC-8004 identity registry on BNB Smart Chain (285,447 as of
2026-08-25), contacted every endpoint they name, and published who answers,
what they do, and what they have been paid — from the ERC-8183 escrow, all
56,655 jobs, not a sample. The result is a marketplace where a stranger lands,
picks one of the four categories (rebalancing, grid trading, yield, health
factor), reads what each agent does in one sentence, sees its live status,
and hires it through the ERC-8183 escrow with a wallet — eleven hire buttons,
five escrow steps, every one verified end to end.

The numbers are the point. Of 285,447 registered agents, 796 answer; those are
100 hosts run by 72 operators. 123 ids share one identical tool list. Of the
escrow's 56,655 jobs, 99.1% of the money comes from one address, and the
Studio's four reference agents have 16 funded jobs and 0 completed. We show
this on the page, with the method, because a marketplace that hides it is
selling the inflation.

Data quality is live: each agent's status is probed every fifteen minutes by
our worker, timestamped, and a probe that fails says whether the fault is the
agent's, the chain's, or ours. Our own five agents are hireable the same way
as everyone else's and answer in every category. The same measurement is
offered to agents free of charge as MCP, REST and an installable skill
(`npx skills add https://brainonbnb.com`), and the paid pool watch is, as far
as we can measure, the first MCP tool ever listed for x402 payment.

## How the three criteria are met — with evidence

### Functionality: land, find by category, understand, activate
- https://brainonbnb.com/registry — categories first, hire panel with 11
  buttons across all four categories (built 2026-08-25, [project_hire_panel]).
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
- Job census: 56,655 jobs read, 591.56 $U ever escrowed, 28,191 released,
  one address at 99.1% (2026-08-25). `/api-jobs.json`, MCP
  `bnb_agent_employment`.
- Reputation: 20,734 ratings read, 38 checkable; we write `responseTime`
  attestations with hashed evidence and answer ratings on our own agents
  (2026-09-01).
- Fleet unmasking: 796 responders = 100 hosts = 72 operators; top-5 hosts
  hold 81% (2026-08-25).

### Agent diversity: all four categories, equal depth
- Category depth measured 2026-08-25: rebalancing 3 · grid trading 2 ·
  yield 3 · health factor 4 (independent operators; nip.io wildcard
  corrected). **Refresh on submission day.**
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
  2026-09-01). The project runs its own money through it: position #7306392.
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
2. Wait for the GitHub appeal.
3. ~~A second GitHub account~~ — advised against; circumventing a flag can
   sink the submission itself.

## Screens to attach
Captured to `temp/submission-screens/` by `node scripts/dashboard-check/submission-screens.mjs` (the folder is gitignored):
home, registry (categories + hire panel), scanner, advantage, session,
services, status. Re-capture on submission day.

## Refresh on submission day
```
node scripts/health.mjs
node scripts/smoke-agent-surface.mjs
node scripts/dashboard-check/registry-coldstart.mjs
node scripts/dispatch-safety.mjs
curl -s https://agent.brainonbnb.com/stats | head -40
```
Then replace every dated figure above with the fresh one, and re-capture the
screens.
