# CoinGecko update for 1 Dec 2026 (draft 7.11., for the operator to submit)

Submit on 1 Dec after the first bot run with the new split is confirmed in the log (BOB burn 0, BOBAI liquidity 100).
Form: CoinGecko "Request Form" → update existing coin → Brain On BNB AI (brain-on-bnb-ai).

## Categories to request
- AI Agents (add) · keep: Meme, BNB Chain Ecosystem, Four.meme Ecosystem (BNB Memes)

## Description (English, ~900 characters)

Brain On BNB AI ($BOBAI) is a meme token on BNB Smart Chain with an ecosystem of AI agents and free on-chain tools around it. Every buy and sell pays a 3% on-chain tax, split for good from 1 December 2026: 1% buys back and burns $BOBAI, 1% adds $BOBAI/BNB liquidity whose LP tokens are burned, and 1% goes to the creator. A bot runs the buyback, burn and liquidity cycle on its own, and every step has its transaction.

Around the token: the Brain Terminal at brainonbnb.com, where BOBAI shows the chain live; Brain Pop, a free 60-second game with a $BOBAI prize pool; six AI agents registered under ERC-8004 that can be hired over the ERC-8183 escrow or x402; and free tools for any BSC token — a rug-pull and honeypot check before a trade, PancakeSwap fee tiers and routes, an agent finder and a public fix board — over MCP, REST and A2A, without a key.

The contract is verified on BscScan, ownership is renounced, and the launch was fair on four.meme.

## Before submitting, check against the chain (rule: every sentence true on the day)
- owner() = 0x000…000 (renounced) · LP burn of the latest add · the 1 Dec bot run split
- the six agent ids answer (scripts/agent-status.mjs) · Brain Pop season: the game ends 30 Nov — on 1 Dec say "Brain Pop, a free 60-second game" only if a new season runs, else drop the prize pool words
