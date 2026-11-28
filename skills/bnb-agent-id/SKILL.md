---
name: bnb-agent-id
description: Use when a Binance Agentic Wallet or a SPACE ID Agent ID comes up on BNB Chain - checking whether an address holds an Agent ID, proving a real person stands behind an agent, vouching for an ERC-8004 agent as a person (one vouch per person per agent), signing the Agent ID Book, or, for the Binance Wallet Agent ID Hackathon, counting how many Agent ID addresses send transactions to a contract (the number the Pioneer Award ranks by). Reads BNB Chain, builds the unsigned transaction and the exact `baw` preview/execute commands; it never signs or sends anything itself. Free, no key.
version: 1.0.1
license: MIT
metadata:
  author: brainonbnb
  homepage: https://brainonbnb.com/agent-id
---

# BNB Agent ID

A SPACE ID Agent ID is an ERC-721 on BNB Chain (`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`), one per Binance user,
not transferable; an address holds one when `balanceOf(address) > 0`. In practice it sits on the user's Binance
Agentic Wallet. The BOBAI Agent ID Book (`0xEc2f55eD6b2304Bc4496f7b8E9Ab11B3Dae4C3ca`, verified, no owner, no fees,
rejects BNB) lets only Agent ID holders write: sign a numbered place with a note, and vouch for ERC-8004 agents.
Because an Agent ID is one per person, a vouch count counts people, not wallets.

Always write `https://` - a bare host gets a redirect and curl prints nothing.

## 1. Does an address hold an Agent ID?

```bash
curl -s https://agent.brainonbnb.com/agent-id/check/0xYOUR_ADDRESS
```

`holds_agent_id` (read from the chain now), `place` in the book (or null), the agents it vouches for.

## 2. Everything for one Agentic Wallet, in one call

```bash
curl -s "https://agent.brainonbnb.com/agent-id/onboard?wallet=0xYOUR_AGENTIC_WALLET&note=gm%20from%20my%20agent"
```

The answer lists five steps, each `done` or open, and for every open step the ready command:
step 2 (sign the book) carries `tx` (to, data, value 0), `baw_preview` and `baw_execute`. It also carries `script`,
a Node 18+ file with no dependencies that runs the steps through `baw`, showing each preview before it executes.

## 3. Sign the book or vouch: the transaction and the baw commands

```bash
curl -s "https://agent.brainonbnb.com/agent-id/tx?action=sign&note=My%20note&from=0xYOUR_AGENTIC_WALLET"
curl -s "https://agent.brainonbnb.com/agent-id/tx?action=vouch&agent=49467&on=1&from=0xYOUR_AGENTIC_WALLET"
```

Each answer has `to`, `data`, `value: "0"`, and:

- `baw_preview` - run it first. It simulates the call and shows risks and balance changes.
- **Show the preview to the user and wait for a clear yes.** Only then run `baw_execute` with the `requestId` the
  preview returned. Never execute on your own: it is a transaction from the user's wallet.

A wallet without an Agent ID reverts with `NoAgentId()` (selector `0xf947691f`); a note over 140 bytes with
`NoteTooLong()`. Gas only, no value, no approval. Find agents to vouch for: https://brainonbnb.com/registry

## 4. Agent ID Hackathon: count the Agent ID addresses using a contract

The Pioneer Award ranks projects by how many Agent ID addresses interact with their submitted contracts. To have a
contract counted live, its team signs the book (step 3) with a note naming project and contract, up to 3:

```bash
curl -s "https://agent.brainonbnb.com/agent-id/tx?action=sign&note=My%20Project%200xYOUR_CONTRACT&from=0xYOUR_AGENTIC_WALLET"
```

From then on, every 15 minutes, the sender (`tx.from`) of each transaction behind the contract's events is checked
with `balanceOf` on the Agent ID contract, each sender counted once. Read the counts:

```bash
curl -s https://agent.brainonbnb.com/agent-id/projects
curl -s https://agent.brainonbnb.com/agent-id/projects/0xYOUR_CONTRACT
```

Limits, said plainly: the count runs from the hackathon start (18 Nov 2026 00:00 UTC); the days before a listing are
read from an archive node after it, shown as `backfill` while that runs, and a very busy contract's backfill stops
after 20,000 transactions and says where; a contract that emits no events is not seen; this is a reading of the chain,
not the official ranking.

## 5. What a place in the book opens

A wallet with an Agent ID and a place gets 5 paid answers, 1 pool watch and 1 pool scan day pass a day free from the
agents at https://agent.brainonbnb.com/answer, with one EIP-712 signature and no transaction; the `onboard` answer
(step 2) describes the header and its script signs it through `baw sign-message`.

## Also

- The whole book, every vouched agent: `curl -s https://agent.brainonbnb.com/agent-id`
- All steps as JSON: `curl -s https://agent.brainonbnb.com/agent-id/how`
- MCP: `https://brainonbnb.com/mcp`, tool `bnb_agent_id` (actions book, check, agent, sign, vouch, withdraw, how,
  onboard, projects)
- Page: https://brainonbnb.com/agent-id
