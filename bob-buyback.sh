#!/bin/bash
# BOB Auto Buy & Burn Bot
# 1. Collects BNB from BOBAI tax fees (automatic on-chain)
# 2. Buys $BOB on PancakeSwap
# 3. Burns $BOB by sending to dead address (permanent supply reduction)
#
# Every BOBAI trade = less $BOB in circulation = $BOB gains value
#
# Created autonomously by Claude Opus 4.6

BOB_TOKEN="0x51363f073b1e4920fda7aa9e9d84ba97ede1560e"
DEAD_ADDRESS="0x000000000000000000000000000000000000dEaD"
MIN_BNB_WEI="1000000000000000"   # 0.001 BNB minimum to trigger buyback
KEEP_GAS_WEI="3000000000000000"  # 0.003 BNB reserve for gas (buy + burn = 2 txs)
WALLET="0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce"

cd D:/ai/fourmeme

echo "============================================"
echo "[$(date)] BOB Buy & Burn Bot"
echo "============================================"

# Step 1: Check BNB balance
BALANCE=$(node -e "
const {createPublicClient,http}=require('viem');
const {bsc}=require('viem/chains');
const client=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.binance.org/')});
client.getBalance({address:'$WALLET'}).then(b=>console.log(b.toString()));
" 2>/dev/null)

echo "[$(date)] Wallet BNB balance: $BALANCE wei"

AVAILABLE=$(node -e "
const b=BigInt('${BALANCE:-0}');
const reserve=BigInt('$KEEP_GAS_WEI');
const min=BigInt('$MIN_BNB_WEI');
const avail=b-reserve;
if(avail>=min){console.log(avail.toString())}else{console.log('0')}
")

if [ "$AVAILABLE" = "0" ]; then
  echo "[$(date)] Balance too low for buyback, skipping."
  exit 0
fi

# Step 2: Buy $BOB with available BNB
echo "[$(date)] BUYING \$BOB with $AVAILABLE wei..."
npx fourmeme buy "$BOB_TOKEN" funds "$AVAILABLE" 0
BUY_EXIT=$?

if [ $BUY_EXIT -ne 0 ]; then
  echo "[$(date)] Buy failed, will retry next cycle."
  exit 1
fi

# Step 3: Get BOB balance and BURN all of it
echo "[$(date)] Checking BOB balance to burn..."
BOB_BALANCE=$(node -e "
const {createPublicClient,http,parseAbi}=require('viem');
const {bsc}=require('viem/chains');
const client=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.binance.org/')});
client.readContract({
  address:'$BOB_TOKEN',
  abi:parseAbi(['function balanceOf(address) view returns (uint256)']),
  functionName:'balanceOf',
  args:['$WALLET']
}).then(b=>console.log(b.toString()));
" 2>/dev/null)

echo "[$(date)] BOB balance to burn: $BOB_BALANCE"

if [ -z "$BOB_BALANCE" ] || [ "$BOB_BALANCE" = "0" ]; then
  echo "[$(date)] No BOB to burn."
  exit 0
fi

# Step 4: Send ALL $BOB to dead address = PERMANENT BURN
echo "[$(date)] BURNING $BOB_BALANCE BOB -> $DEAD_ADDRESS"
npx fourmeme send "$DEAD_ADDRESS" "$BOB_BALANCE" "$BOB_TOKEN"

echo "============================================"
echo "[$(date)] BUY & BURN COMPLETE"
echo "[$(date)] $BOB_BALANCE BOB permanently removed from supply"
echo "============================================"
