# Build the Era — submission draft

Prepared 2026-09-02, refreshed 2026-09-07 (evening). **SUBMITTED 2026-09-07 18:43 UTC through the form (Google: "Ihre Antwort wurde gesendet"), a copy of the answers sent to brainonbnb@gmail.com.** Judging 2026-09-09 to 09-23: the live pages are what the judges see, keep them up. The
form is titled "Build the Era Hackathon Registration" and is the only
submission channel the hackathon page names ("Submit Project" →
`forms.gle/9g9XPNFwnYaHAz9L8`). **Build period ends 2026-09-09 12:00 UTC —
noon, not midnight** (from the form's own header: "Build period 12:00pm UTC+0,
Aug 5 2026 – 12:00pm UTC+0, Sep 9 2026"). Judging 2026-09-09 to 09-23.
Support group named on the page: https://t.me/BNBchaincommunity.

Every figure below carries the date it was measured. On submission day, run
the refresh list at the bottom and replace any figure that moved; nothing in
this file is a claim that should outlive its date.

## Form fields — every field the form has, in its order (read 2026-09-07)

Required fields are marked *. Personal fields are filled in by the operator on
the day and never stored in this repo.

| Field | Answer |
|---|---|
| Full Name * | operator |
| Email Address * | operator |
| Telegram Handle * | operator |
| X (Twitter) Handle * | @BrainOnBNB |
| Discord Handle | leave empty |
| How did you hear about this hackathon? * | BNB Chain Website |
| Country and Timezone * | operator (Switzerland, UTC+2 in September) |
| Solo builder or team? * | Solo |
| Number of Teammates * | 1 (Solo) |
| Teammate Names, Emails, Roles | leave empty |
| Project Name * | Brain Plaza — the measured agent marketplace for BNB Chain |
| One-Line Pitch * | Every agent on BNB Chain, read from the registry, contacted, measured, and hireable in four clicks — with every number checkable on-chain. |
| Project Description * | the text under "Project description" below |
| Sub-prize tracks * (options: PancakeSwap, AltLayer, TermiX, Not sure) | PancakeSwap, TermiX. **Altana is not an option in this field** — its evidence goes into Additional Notes (below). AltLayer: not selected, nothing built for it. |
| Project GitHub Repo Link * | **OPEN — see "The repo link" below** |
| Prototype Stage * (Fresh idea / Early prototype / Working MVP) | Working MVP |
| BSC/EVM Experience Level | Advanced |
| Areas you are comfortable with | Solidity, AI agent frameworks, Onchain data/APIs, Frontend development |
| Mentorship during the build period? * | No, I am confident building solo/as a team |
| Availability 09-09 to 09-23 * | Yes, I confirm availability |
| Wallet address in case you win * (ERC-20/BEP-20) | operator's choice on the day — a wallet the operator controls, not a worker wallet |
| Additional Notes | the text under "Additional Notes" below (live URL, Altana evidence, the repo situation) |
| Co-marketing / Prizes / Third-party risk / Terms * | I have read and agree to the Terms of Participation |

There is no field for a live URL, a demo video or a deck. The live URL
therefore goes into the first line of the description and into the notes.

## Additional Notes (for the form field, ~900 characters)

Live: https://brainonbnb.com/registry (marketplace), https://brainonbnb.com/advantage
(TermiX Agent Advantage Report), https://brainonbnb.com/session (Altana).
Everything is public and on BSC mainnet; nothing needs a login.

Altana (not selectable above): the agent runs on its own Altana wallet 0xC5A17B5295Fc50BAdB1F9f9C09b412fE5e84F7d3 on BNB Smart Chain (chain 56), KeyStore 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a. The admin (root) key 0xc11b9dc3a76225954ff040294daae83c7b902af060da656d9c72c9eb9939a6e8 grants and revokes; the current session key 0x86fabbfa5b59af42a0d025bd77a6c826cad52389447f012422c918f58f017e99 (granted 2026-09-07 18:28 UTC, tx 0x627a0368a2ae03eb70efe515ccf7f3aa13306211aa48abe8116a8b964d314be7) carries a call allowlist (the ERC-8183 kernel and approve() on $U), a spend cap of 1 $U and 0.002 BNB per day, and expires 2026-09-14. Proven both ways on mainnet: an allowed call through the session key succeeded (0x55128a7f373a9dc4fd0787d97489d5601a3663666e0ee5f155fd88b2589df588), a call outside the allowlist reverted with UnauthorizedCall, and revocation works from the operator's machine (0x363aaffdc70faa1cae5ffc65c2411dc9c0492ad1f6c7903345e0e6fbd58e9e38) and from inside the product: /session shows what the agent may do, live from the KeyStore, and has a Revoke button. The admin key is a Cloudflare secret on the worker, never in the page or the source; the route signs only with the operator's token (401 without it, so a stranger cannot switch the agent off). The session granted at 18:12 UTC was revoked with that button at 18:13 UTC, tx 0x054ea9a00dee6f2126f266e859242d23dbca6d276455800c7957e094725c5939, and every revocation fired from the page is recorded there. Raw JSON: https://agent.brainonbnb.com/session.

Repository: the GitHub account is suspended since 2026-07-24 (under appeal, no
second account opened). The full source is public at
`git clone https://brainonbnb.com/source.git` (MIT, secret-audited) and as
bundles at https://brainonbnb.com/#library.

## Project description — what goes into the form (800-character limit)

Found 2026-09-07 evening while filling the form in: the field validates with
"In 800 characters or less, describe how your marketplace vision is unique and
what features you have optimized for." This is the text in the field (797
characters); the long version below stays as the source for judges' questions,
the notes and any follow-up.

> Brain Plaza is the marketplace built on what the chain actually says. We read every ERC-8004 id on BNB Chain (338,000+), contacted every endpoint, and list only the 814 that answer, sorted into the four categories. Each row: what the agent does in one sentence, live status probed every 15 minutes, and a Hire button that negotiates the price over A2A and pays through the ERC-8183 escrow with unsigned calls for your own wallet. Or type the task in plain words and the broker finds, calls and names the agent. Optimised for: no dead end for a stranger, every number dated and checkable on-chain (all 56,719 escrow jobs read; 99% sit at one address, shown rather than hidden), and equal depth in all four categories, our own five agents hireable like everyone else's. Live: brainonbnb.com/registry

## Project description (long version, ~2,900 characters — NOT for the form field)

Brain Plaza is a marketplace built on what the chain actually says. We read
every id in the ERC-8004 identity registry on BNB Smart Chain (332,331 in the
full scan of 2026-09-03; the live counter stood at 338,507 on 2026-09-07 evening),
contacted every endpoint they name, and published who answers,
what they do, and what they have been paid — from the ERC-8183 escrow, all
56,719 jobs, not a sample (read on 2026-09-07; every job still open at the
last reading is read again on each run, so a settled escrow reaches the page). The result is a marketplace where a stranger lands,
picks one of the four categories (rebalancing, grid trading, yield, health
factor), reads what each agent does in one sentence, sees its live status,
and hires it through the ERC-8183 escrow with a wallet — sixteen hire
buttons, eleven of which returned a price when actually asked, five escrow
steps, every one verified end to end. Or types the task in plain words:
"measure the CAKE pool", "the health factor of the Venus position at 0x…" —
the broker finds an agent that can answer, calls it read-only, and names it.

The numbers are the point. Of 332,331 registered agents, 814 answer; those are
103 hosts run by 74 operators. Of the escrow's 56,719 jobs, 99.0% go to one
provider address, which holds 91.7% of the 602 $U ever escrowed; the
Studio's reference agents have 17 funded jobs and 8 completed between them
(2026-09-07). We show this on the page, with the method, because a
marketplace that hides it is selling the inflation.

Data quality is live: each agent's status is probed every fifteen minutes by
our worker, timestamped, and a probe that fails says whether the fault is the
agent's, the chain's, or ours. Our own five agents are hireable the same way
as everyone else's and answer in every category. The same measurement is
offered to agents free of charge as MCP, REST and an installable skill
(`npx skills add https://brainonbnb.com`) — 119,305 requests answered for
other agents as of 2026-09-07 evening — and six answers are sold per x402 or through
the escrow. What they pay runs, unattended, into the project's own PancakeSwap
V3 position: an agent that re-sets the range in the width that earned the most
over the recorded prices, checks it every hour, and splits the fees: half
grows the position, half goes to the buyback that burns $BOBAI. Three re-sets
have run on their own so far (2026-09-04, 09-06, 09-07; 3 to 8 transactions
each, under 0.0001 BNB of gas apiece). Every step is a transaction on BNB
Chain, the record is public, and it keeps the failures: a re-set that reverted
halfway is on the record with its cause, and the run that finished it from the
wallet the next morning is on it too. The profit so far is on the page in one
sentence, price move, fees and gas apart, because on $55 of capital it is
nearly all the pair's price and saying otherwise would be spin.

## How the three criteria are met — with evidence

### Functionality: land, find by category, understand, activate
- https://brainonbnb.com/registry — categories first, hire panel with 16
  buttons across all four categories, 11 quoting when asked (2026-09-03).
- Dispatch in plain words (2026-09-04): known symbols read as addresses, an
  account in the question is passed to the tool even when optional, and an
  answer about a different address than the one asked is refused and the
  next agent tried — pinned both ways in `scripts/dispatch-safety.mjs`.
- Wallet flow through the five escrow steps; job 56657 hired and COMPLETED
  (first seen 2026-09-02 07:21 UTC); 56670–72 settled 2026-09-06, four
  distinct buyers have funded our provider since (2026-09-07).
- Every row carries a one-sentence "what it does" (2026-08-25; the smoke
  checks it, `every hireable row says what the agent does`).
- Cold-start check `scripts/dashboard-check/registry-coldstart.mjs` measures
  the four categories against each other and presses the first button.

### Data quality: real-time, accurate, beyond counts
- Live telemetry every 15 minutes, `agent.brainonbnb.com/status` and
  `/telemetry.json`, with `checked_at` and a cause on every failure
  (`not_ready_because`: chain_unreachable | agent_error), since 2026-09-01.
- Job census: 56,719 jobs read, one provider address at 99.0% of the jobs
  and 91.7% of the money (2026-09-07); our own jobs 56657 and 56670–72
  completed, 56694 in its dispute window, four newer ones funded or
  submitted by other buyers. `/api-jobs.json`, MCP `bnb_agent_employment`.
  Every job that was open at its last reading is read again on each scan
  (2026-09-07), so the card's "paid out" count follows the chain.
- Reputation: 20,800 ratings read, 361 agents rated by 64 raters, 61 checkable
  (re-read 2026-09-08 06:44 UTC; 20,735 / 39 on 08-31); we write `responseTime`
  attestations with hashed evidence and answer ratings on our own agents
  (2026-09-01).
- Fleet unmasking: 814 responders = 103 hosts = 74 operators (2026-09-03).
- Every figure on the page is dated, and the growth section names the daily
  check's number beside the live headline rather than printing two "nows".

### Agent diversity: all four categories, equal depth
- Category depth measured 2026-09-03, unchanged on 2026-09-07: rebalancing 5
  entries (18 ids once fleets collapse) · grid trading 3 · yield 5 (247 ids)
  · health factor 6 (11 ids); 16 hire buttons, 11 quote (cold-start check
  2026-09-07, "no problems", the first click in every category returns a
  price). **Refresh on submission day.**
- Our own agents cover every category: #302257 Venus Health Factor Monitor,
  #302258 BSC Grid Planner, plus yield, rebalancing and the PancakeSwap
  fee-tier agent #310460.
- The chain itself lacks the depth the brief asks for; the page says so and
  shows what is there rather than padding it.

## Sub-prize evidence
- **PancakeSwap**: for traders, the Pool Scanner (https://brainonbnb.com/scanner,
  `/api/pool-scan`, MCP, skill): the real cost of a trade at six sizes, the
  transfer tax measured from executed trades — and since 2026-09-07, where
  the window holds no trade, from a sell and a buy simulated on the chain at
  that block from a fresh address (a contract placed by state override reads
  what arrived; BOBAI reads 3%, CAKE 0%, pinned in `scripts/sell-sim-check.mjs`)
  — who can pull the LP, and a token still on four.meme's curve read from
  four.meme's own contract. For LPs, `pancakeswap_fee_tiers` (MCP, `/api/fee-tiers`, skill) —
  which of the five fee tiers actually pays an LP, by working capital in
  ±2% of price; agent #310460 delivers it for hire. Range replay and best
  route tools proven against the pool's own quoter (0.0000% deviation,
  2026-09-01). The project runs its own money through it: position #7359173,
  CAKE/BNB 0.05%, managed by the liquidity agent (https://brainonbnb.com/liquidity):
  the width is the one that netted the most per day when every width was
  replayed over the recorded hourly prices with the agent's own re-set delay
  and its measured re-set cost (the width record, readable, at
  agent.brainonbnb.com/lp/windows); the range is checked every hour and has
  been re-set by the cron on its own three times: 2026-09-04 07:50 UTC
  (#7309536 to #7324788, 8 transactions, 0.000075 BNB of gas), 2026-09-06
  09:50 UTC (#7348261 to #7350813, 5 transactions, 0.000073 BNB) and
  2026-09-07 02:50 UTC (#7350813 to #7359173, 3 transactions, 0.000064 BNB),
  every figure measured on the chain, and the fees each re-set folded into
  the new capital are measured too and counted as fees (0.000998 BNB over
  the three, from the unwind transactions, 2026-09-07); the fees are
  split 50/50 between the position and the buyback that burns $BOBAI, the
  share a public variable (LP_FEE_KEEP_PCT, since 2026-09-04); the record
  with every transaction and the money flow (came in, went out, waiting) is
  at agent.brainonbnb.com/lp/agent. The same reading is free for anyone's
  position at agent.brainonbnb.com/lp/look?position=<id> (since 2026-09-04),
  the plan with decisions is sold per x402.
  The record keeps its failures, and there were two in two days. 2026-09-05
  05:23 UTC the first automatic increase bought the other side and the
  position manager reverted ("Price slippage check"): the minimums were a
  share of the wallet's balances instead of what the range takes. Fixed the
  same morning. 2026-09-05 12:50 UTC the hourly re-set unwound #7324788 in
  one multicall, bought the other side, and its mint of a ±1% range reverted
  on the same check: minimums at 97% of the amounts read seconds earlier, in
  a range 190 ticks wide where a few ticks of drift move the ratio by a
  percent each. The capital (13.42 CAKE + 0.042 WBNB, nothing lost) sat in
  the wallet for seventeen hours and every run said "no position". The fix
  (2026-09-06, commit b9e38bd): minimums that tolerate 20 ticks of drift,
  measured in ticks rather than percent because a percentage does not know
  the width; and a resume path — no position, the pool's two tokens in the
  wallet — that finishes the mint without waiting the two hours, sized by
  the same width and the same floor. The self-test replays the revert (6
  ticks at zero drift fails, 20 pass, 40 fail; 99/99). The resume ran from
  the hand script at 2026-09-06 06:06 UTC: 3 transactions, 0.000046 BNB of
  gas, position #7348261 at -58320 … -58140, in range, 0.0809 BNB — read on
  the chain, not from the record. The cron re-set that position twice since,
  with the fixed minimums, without a revert (above). Position #7359173 was in
  range and worth 0.0790 BNB on 2026-09-07 05:23 UTC; the day-by-day series
  (9 runs since 2026-09-03) and the profit line are on /liquidity.
  **Refresh on submission day:** the position id, and whether the hourly
  cron has re-set it since.
- **TermiX**: Agent Advantage Report at https://brainonbnb.com/advantage,
  re-measured 2026-09-07 evening against the track's wording. Three real
  tasks, each run both ways in one run: trading / liquidity provision (which
  fee tier pays), security / risk (the real cost of a $2,500 trade and
  whether the LP can be pulled), agent discovery / hiring (find a Venus
  health-factor agent and what it charges). For every task: wall-clock,
  request count, and the actual outputs side by side (task 1 the five-tier
  table, task 2 price / liquidity / share / sell cost / transfer tax / LP
  burned, task 3 the candidates and the price quoted over A2A through the
  hire path). The hand-done path answered 0 of 3; the agent 3 of 3. Each task
  names the agent on Brain Plaza that sells the same answer and what it
  quoted through the marketplace's own hire path during the run (#310460
  0.1 $U, the x402 watch 0.50 USD1, #302257 0.1 $U), and task 3 links the
  completed job 56657 hired that way with its delivered answer on-chain. No
  time ratio is published where one side did not answer. Raw JSON at
  /api-advantage.json, script `scripts/advantage-report.mjs` in the source.
- **Altana**: session keys with allowlist, spend cap and expiry, registered in
  the KeyStore on mainnet, revocable — https://brainonbnb.com/session. Since
  2026-09-07 evening revocable from inside the product: a Revoke button on
  /session, the admin key a Cloudflare secret on the worker, the route locked
  by the operator's token (401 without it); the session granted 18:12 UTC was
  revoked with it at 18:13 UTC (tx 0x054ea9a0…), recorded on the page; the
  admin (root) key 0xc11b… is named as such and cannot be revoked (KeyStore
  rule); current session 0x86fa… granted 18:28 UTC, expires 2026-09-14.

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
node scripts/advantage-report.mjs && node scripts/advantage-publish.mjs   # TermiX report, then deploy the dashboard
```
Then replace every dated figure above with the fresh one, and re-capture the
screens.

Refresh run 2026-09-08 ~06:50 UTC: reputation re-read in full (848 agents, 20,800
attestations, 361 rated, 64 raters, 61 checkable), published, smoke green.

Refresh run 2026-09-08 ~05:00 UTC (judging starts tomorrow; the live pages
are what is judged): full census re-run in the documented order — 340,473
ids read (was 332,331 on 09-03), 1,911 claim an endpoint, 848 answer (0.25%),
83 operators; hire-confirm asked 22 buttons, 12 quoted (was 16 / 11); the
live counter is level with the scan and the series carries it as its last
full point. Category order changed at the operator's decision: other
operators' agents first, ours last, evidence order within each — the
cold-start check now finds a stranger quoting on the first click in every
category (Portfolio Rebalancer 0.5 $U, BNB Grid Trader 0.1 $U, BNB Yield
Optimizer 1 $U, BNB Lending Guardian 5 $U) and no category led by an agent we
run. The new census surfaced an MCP range keeper as the best match for
"rebalance my lp range", and the dispatcher's reply lost the sellers behind
it; fixed the same morning (a tool short of an input is kept as a pointer, the
remaining candidates get their turn, the sellers are offered). Health 49/49 ·
smoke 182/182 · dispatch-safety self-test green · /liquidity and /services
now carry the same frame as /registry and /scanner (measured headless at 1280
and 390). The liquidity agent's daily run moved from 05:23 to 04:23 UTC; its
first 04:23 run (2026-09-08) held: position #7359173 in range, 0.0801 BNB,
every step under its floor. Figures above are current as of this run where
they name the census; the description in the form still says 814 answering
and 338,000+ ids — that field cannot be edited after submission.

Refresh run 2026-09-07 ~19:30 UTC: health 49/49 · smoke 182/182 (before the
scanner build; re-run after it below) · cold-start "no problems", depth
5/3/5/6, 16 hire buttons, 11 quote, first click quotes in every category ·
dispatch-safety "every tool not named after an action can be reached" ·
stats 119,305 asked · census live counter 338,507 · Agent Advantage Report
re-measured 2026-09-07 evening (outputs attached, the price the found agent
charges, the marketplace half per task) · Pool Scanner measures the tax by
simulation where the window holds no trade (sell-sim-check green both ways)
· the four tools read as a stranger at 1280 and 390 (scanner: BOBAI, CAKE,
a four.meme curve token, the feed, the fee-tier measurement; Plaza; Services)
· screens re-captured. Position #7359173 still in range, no re-set since
02:50 (the price left the range at 12:50 and came back before the two-hour
hysteresis ran out — no transactions spent). Figures above are current as of
this run.

Refresh run 2026-09-07 ~06:20 UTC: health 49/49 · smoke 182/182 · cold-start
"no problems", depth 5/3/5/6, 16 hire buttons, 11 quote, first click quotes
in every category · dispatch-safety "every tool not named after an action can
be reached" · stats 111,203 asked · census live counter 337,866 · job census
56,719 read the same morning (open jobs re-read) · screens re-captured. The
four tools had a read-only audit that morning (page read as a stranger at 1280
and 390, checkers, main paths pressed) and every finding was fixed before this
refresh. Figures above are current as of that run.

Refresh run 2026-09-06 ~06:15 UTC: health 49/49 · smoke 182/182 (the
`/lp/look` check now asks by the wallet's address, so it does not depend on
the daily record naming a position) · cold-start "no problems", depth
5/3/5/6, 16 hire buttons, 11 quote · dispatch-safety live "every tool not
named after an action can be reached" · stats 100,959 asked · census live
counter 336,537 · screens re-captured after the 06:50 cron wrote the new
position to the record. Figures above are current as of that run.

Refresh run 2026-09-04 ~07:10 UTC: health 49/49 · smoke 177/177 · cold-start
"no problems" · dispatch-safety live · screens captured (7 pages at 1440).
