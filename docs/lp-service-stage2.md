# The DeFi agent for other people's positions — stage 2 (designed, not built)

Stage 1 is live (2026-09-03): `lp_position_plan`, sold per answer over x402 and
through the escrow, reads any PancakeSwap V3 position and returns what the agent
that runs our own position would decide about it — from the same code
(`shared/lp-agent.js`). It signs nothing. That is the honest ceiling of what a
service can do on a stranger's liquidity without holding a key to it.

Stage 2 is the agent *acting* on that position. This page is the design, written
before a line of it, because a key to somebody's liquidity is not something to
ship in an afternoon.

## The trust boundary, stated once

The agent must never hold a key that can move the client's capital out. So:

1. **The client's account is an Altana smart account.** Our provider key is
   granted a *session* on it — the same mechanism this project already runs on
   mainnet for its own escrow spending (`scripts/altana-session.mjs`, five
   requirements met with real transactions). The session is written into the
   on-chain KeyStore and the account refuses anything outside it at validation
   time. That is a fact a stranger can check with three view calls, not a
   promise in our documentation.
2. **The allowlist is the PancakeSwap V3 position manager, and only these
   functions:** `collect`, `decreaseLiquidity`, `increaseLiquidity`, `mint`,
   `burn` — plus `approve` on the two pool tokens and on WBNB. **No `transfer`.**
   A session that can transfer is a wallet; a session that can only re-shape a
   position is a manager. The proceeds of every call stay in the client's
   account because every call names the client's account as recipient.
3. **Caps:** a native cap for gas (the session pays the fee; measured on our own
   sessions: without a native cap the first call fails with
   `NoSpendPermissions`), and no token cap needed — the calls cannot send
   tokens away. **Expiry:** thirty days, renewable by the client, revocable by
   the client in one transaction at any time.
4. **What the agent decides is exactly what stage 1 already prints.** The plan a
   client can buy today for 0.10 $U is the plan the session would execute. No
   hidden second policy.

## What it costs and where the money goes

- Fee: **in $BOBAI**, per action the agent takes (a re-set, a collect, an
  increase), not per day watched. A quiet day costs nothing, which is the only
  pricing that does not reward an agent for acting when it should not.
- The fee is paid into the income wallet like every other AI income here and
  follows the same loop: sold for BNB, put into the project's own position,
  half of the fees stays there as capital, half buys $BOBAI the agent holds
  (until 2026-09-09: to the buyback bot, burn). Paying in $BOBAI means the buyer bought $BOBAI
  first; that is the push.

## What has to exist before it is switched on

- [ ] A worker that submits UserOperations through the Altana session (the
  worker-agent has no SDK by design; `scripts/altana-session.mjs` has it — the
  execute path moves into a small worker of its own with only that key).
- [ ] A dry-run mode that prints the UserOp it *would* send, checked against the
  plan, for every client position, every day, before any live run.
- [ ] The client-side flow on /defi: grant the session (their wallet),
  see the exact allowlist and caps read back from the KeyStore, revoke.
- [ ] A record per client like `/lp/agent`: what was decided, why, and every
  transaction hash — readable by the client and by nobody else without the
  position id.
- [ ] The operator's explicit go, after a full month of stage 1 answers
  matching what our own position did.

Nothing above is scheduled. It is written so that the day it is built, it is
built to this and not to whatever seemed convenient that afternoon.
