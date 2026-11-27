# BOBAI Agent ID Book

A small, immutable contract on BNB Chain that only holders of a **SPACE ID Agent ID**
(`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, one per Binance user, non-transferable) can write to.

- `sign(note)`: take the next numbered place in the book (first call), or change your note (later calls). Max 140 bytes.
- `vouch(agentId, on)`: vouch for an AI agent registered on ERC-8004 (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`),
  or withdraw the vouch. One vouch per holder per agent; you cannot vouch for an agent you own.
  Since an Agent ID is one per person, `vouchCount(agentId)` counts distinct people.

Reads: `hasAgentId`, `signerCount`, `entryOf`, `signers(start, count)`, `vouched`, `vouchCount`, `vouchesGiven`.

## Owner permissions

None. No owner, no admin, no upgrade, no pause, no mint, no fees, no withdrawals.
The contract holds no tokens, asks for no approvals and rejects BNB (nothing is payable,
no receive/fallback). Both registry addresses are constants. A write costs the caller gas, nothing else.

## Build and test

```
forge build
forge test --fork-url https://bsc-dataseed.binance.org
```

The tests run against mainnet state (a real Agent ID holder, the real ERC-8004 registry).
Mutation check: with the Agent ID gate on `sign` or the own-agent check removed, the
matching tests fail.

## Deployment

**Live since 27.11.2026:** `0xEc2f55eD6b2304Bc4496f7b8E9Ab11B3Dae4C3ca`, deploy tx `0x964e0de77a0b6f61a52e7ace8da7f34113d849f5f2202964f8dc5ad607d179a2` (block 136027484), place 1 signed in tx `0x82160e927e9745ef7ef47e10332ec2e0e1d812db5d591efddb1c29632df60375`. Source verified on Sourcify (exact match).

Deployed through the deterministic CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`
from the operator's Agentic Wallet `0xcCCf2F2198e229027f6F61379a36E82D8F45958c` (itself an Agent ID holder),
salt `keccak256("bobai-agent-id-book-v1")`. Expected address: `0xEc2f55eD6b2304Bc4496f7b8E9Ab11B3Dae4C3ca`.
Calldata: `deploy/create2-calldata.hex`. Compiler: solc 0.8.28, optimizer 200 runs, EVM cancun.
