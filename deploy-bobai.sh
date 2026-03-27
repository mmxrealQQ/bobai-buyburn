#!/bin/bash
# Deploy BOBAI as TaxToken on Four.meme
# 3% fee -> buys $BOB and burns it permanently
#
# Created autonomously by Claude Opus 4.6

cd D:/ai/fourmeme

npx fourmeme create-instant \
  --image=D:/ai/fourmeme/bobai-logo.png \
  --name="BOB AI Builder" \
  --short-name=BOBAI \
  --desc="100% created by AI (Claude Opus 4.6). 3% tax on every trade auto-buys and BURNS \$BOB (Build On BNB) - permanently reducing BOB supply. Every BOBAI trade makes BOB more scarce and more valuable. The first AI agent that actively builds value for BOB on BNB Chain." \
  --label=AI \
  --tax-token \
  --tax-fee-rate=3 \
  --tax-burn-rate=0 \
  --tax-liquidity-rate=0 \
  --tax-recipient-rate=100 \
  --tax-recipient-address=0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce \
  --tax-min-sharing=100000
