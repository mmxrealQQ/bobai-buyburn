# Phase H — Bot Wiring + Payout Plan

This is the **technical roadmap** for activating the prize-pool money flow.
Nothing here ships yet — these are the changes we make **at specific dates**
during the run-up to the World Cup.

---

## Prize-Pool Wallet

- **Address (public):** `0x5E4102520A71B2AA18a1208330d4848dea4BD105`
- **Private key:** stored in CF Worker secret `PRIZE_PRIVATE_KEY` on worker `bobai-worldcup-sync` (encrypted at rest, never in code).
- **Backed up offline** by the project owner.

---

## Step 1 — Tax routing (activate **2026-06-11 at kickoff**)

**File to edit:** `dev-buyback.js` (the bot that processes the 1 % creator tax).

Today the bot splits the creator tax across:
- 4 × 4 % to project builders (16 %)
- 50 % to BOB liquidity boost (until 2026-06-04)
- 84 % to creator personal wallet

**Change at kickoff (2026-06-11 19:00 UTC):**

- New split: **26 %** → `PRIZE_WALLET` (BNB transfer, no swap), **58 %** → creator personal, **16 %** → builders.
- The BOB liquidity-boost stops on 2026-06-04 (already planned).
- After 2026-07-20 (1 day post-final): revert to 100 % creator personal (or whatever the next initiative is).

**Implementation pattern:**

```js
const KICKOFF_UTC  = new Date('2026-06-11T19:00:00Z').getTime();
const POOL_END_UTC = new Date('2026-07-20T00:00:00Z').getTime();

const POOL_ACTIVE = Date.now() >= KICKOFF_UTC && Date.now() < POOL_END_UTC;

if (POOL_ACTIVE) {
  await sendBnb(PRIZE_WALLET, taxBnbAmount * 0.26);
  await sendBnb(BUILDERS,     taxBnbAmount * 0.16);
  // remainder stays in creator wallet
}
```

Hard-coded dates = no manual flag flip needed. Worker just starts/stops doing the routing on the right day.

---

## Step 2 — Donation watcher + auto-swap (deploy any time before kickoff)

**New file:** `worker-wc/donation-watch.js` (or extend `worker-wc/index.js`).

Logic for the existing 5-min cron in `worker-wc`:

1. Read `PRIZE_WALLET` BNB + USDT balance from BSC RPC.
2. If BNB balance > `MIN_SWAP_BNB` (e.g. 0.003 BNB ≈ $1): swap all BNB → BOBAI via PancakeRouter V2. Keep ~0.001 BNB reserved for gas.
3. If USDT balance > `MIN_SWAP_USDT` (e.g. 5 USDT): approve USDT to router, then swap USDT → BOBAI.
4. Log each swap to `wc_donations` (`from_address`, `token`, `amount_in`, `amount_bobai`, `tx_hash`, `swap_tx_hash`).
5. Update `wc_pool.total_bobai` with the new BOBAI balance read from chain.
6. Allocate the **incoming delta** across `group_pot / endpool / crypto_pot` based on tournament phase:
   - Before kickoff or after final → 0/0/0 (no allocation — held in reserve, manual decision)
   - During group stage (kickoff → end-of-group-stage): **45 / 40 / 15**
   - From R32 onward: **0 / 85 / 15** (group_pot is already locked from earlier)

---

## Step 3 — Pool reader (deploy any time)

Even before swaps run, the leaderboard pool card should reflect the on-chain BOBAI balance of `PRIZE_WALLET`. Read it via BSC RPC `eth_call balanceOf(PRIZE_WALLET)` on the BOBAI token contract every 5 min from the same cron.

This way the moment any BOBAI lands in the wallet (donation, tax, or direct send), the leaderboard updates.

Also fetch the live BOBAI USD price from GeckoTerminal (already in use by TG bot) and stash in `wc_pool.bobai_price_usd` for the USD display.

---

## Step 4 — Payout calculator (deploy ~1 week before group stage ends)

**File:** `worker-wc/payouts.js`.

Endpoints:

### `POST /admin/compute-payout?bracket=group`
Returns the JSON plan for the group-pot distribution (32 winners). No transactions yet — pure preview.

Algorithm:
1. For each group A–L:
   - Pull `wc_leaderboard_group` rows for that letter, ordered by `group_points DESC`.
   - Top 2 = "group-winners" bracket.
   - Collect all 12 × 3rd-placed users into a separate pool, take top 8 by `group_points`.
2. Group-pot total = `wc_pool.group_pot`.
3. Each player's share = `their_points / sum_of_bracket_points × pot_share`.
4. Bracket pot share: 24 group-winners get ~70 %, 8 best-3rds get ~30 % (or 50/50 — TBD with owner).
5. Filter out players without `wallet_verified` — they appear on leaderboard but don't get paid.
6. Apply tie-breaker by on-chain BOBAI balance at payout time.

### `POST /admin/compute-payout?bracket=ko`
Returns the JSON plan for the end-pool + crypto-pot distribution.
- End-pool: top 4 by `total_points` (match + bonus).
  - 1st: 40 %, 2nd: 25 %, 3rd: 20 %, 4th: 15 % of `wc_pool.endpool`.
- Crypto-pot: 3 × 5 % to closest BTC/BNB/BOBAI guesses (from `wc_leaderboard_crypto`).

### `POST /admin/execute-payout?bracket=group|ko`
Takes the previously computed plan and **broadcasts the transactions**. Must include `X-Admin-Token`.

Implementation choice: **batch-send BOBAI** via a small `Multisend` contract OR sequential transfers. Sequential is simpler and fee is fine on BSC (~$0.10 per tx × 32 = $3 total). 

After execute: write the payout plan + tx hashes to a new table `wc_payouts` for the audit trail.

---

## Step 5 — Payout dashboard (admin-only UI)

A new page `dashboard/worldcup/app/admin.html` (gated by `ADMIN_TOKEN` URL param or session):

- "Compute group payout" button → calls `/admin/compute-payout?bracket=group` → shows table with username, wallet, points, share %, BOBAI amount.
- Approve checkbox per row (optional override).
- "Execute" button → posts to `/admin/execute-payout`.
- Live tx hash links to BscScan.

Same flow for KO + Crypto on `/admin/compute-payout?bracket=ko`.

---

## Hard dates

| Date | Action |
|---|---|
| **2026-06-04 12:00 UTC** | Public registration opens. Worldcup welcome page links to `/worldcup/app/`. |
| **2026-06-11 19:00 UTC** | Kickoff. Tax routing 26 % → PRIZE_WALLET starts. First match locks tipping +15 min before. |
| **2026-06-29** | Group stage ends. Bonus questions locked (already since 11.06). |
| **2026-06-30** | Group payout admin runs `/admin/compute-payout?bracket=group` → review → execute. |
| **2026-07-19 19:00 UTC** | Final kickoff. Crypto predictions lock. Live price snapshot stored. |
| **2026-07-20** | KO + Crypto payouts run. Owner manually triggers. |
| **2026-07-20 00:00 UTC** | Tax routing reverts: 0 % → PRIZE_WALLET. |

---

## Failure modes / mitigations

- **PancakeSwap slippage on big donations**: cap each swap at ~$500 worth of BNB/USDT per transaction. Loop if balance exceeds.
- **Worker hits API limit**: football-data.org free tier = 10 calls/min. We do 1/5min = 0.2/min — plenty of headroom.
- **Network outage during payout**: each tx is sent + confirmed sequentially; if a tx fails, the worker logs it and continues; admin manually retries failed wallets.
- **Player connects wallet AFTER group payout**: too bad — eligibility snapshot is taken at payout-trigger time. UI warns users to connect early.

---

## Out of scope for this build

- Slashing / penalties for late connects.
- Refunds. Pool is one-way.
- Currency conversion to fiat. BOBAI only.
- Cross-chain payouts. BSC only.
