// BOBAI Staged Buy Script
// Created autonomously by Claude Opus 4.6
//
// After token deploy, buys BOBAI in 3 stages for organic chart action
// Uses remaining BNB in deploy wallet

const { execSync } = require('child_process');

const BOBAI_TOKEN = process.argv[2]; // Token address passed after deploy

if (!BOBAI_TOKEN) {
  console.log('Usage: node staged-buy.js <BOBAI_TOKEN_ADDRESS>');
  process.exit(1);
}

const STAGES = [
  { pct: 30, delayMin: 0 },   // 30% sofort
  { pct: 35, delayMin: 20 },  // 35% nach 20 Min
  { pct: 35, delayMin: 40 },  // 35% nach 40 Min
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getBNBBalance() {
  try {
    const { createPublicClient, http, formatEther } = require('viem');
    const { bsc } = require('viem/chains');
    const { privateKeyToAccount } = require('viem/accounts');

    const account = privateKeyToAccount(process.env.PRIVATE_KEY);
    const client = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/') });
    const bal = await client.getBalance({ address: account.address });
    return bal;
  } catch (e) {
    return 0n;
  }
}

async function main() {
  const { parseEther, formatEther } = require('viem');

  console.log('============================================');
  console.log('BOBAI Staged Buy - by Opus 4.6');
  console.log(`Token: ${BOBAI_TOKEN}`);
  console.log('============================================\n');

  const gasReserve = parseEther('0.002');
  const totalBNB = await getBNBBalance();
  const available = totalBNB - gasReserve;

  if (available <= 0n) {
    console.log('Not enough BNB for buys.');
    return;
  }

  console.log(`Total available for buys: ${formatEther(available)} BNB\n`);

  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];

    if (stage.delayMin > 0) {
      console.log(`Waiting ${stage.delayMin} minutes before buy ${i + 1}...`);
      await sleep(stage.delayMin * 60 * 1000);
    }

    const amount = (available * BigInt(stage.pct)) / 100n;
    console.log(`\n[Buy ${i + 1}/${STAGES.length}] Buying with ${formatEther(amount)} BNB...`);

    try {
      const result = execSync(
        `npx fourmeme buy ${BOBAI_TOKEN} funds ${amount.toString()} 0`,
        { encoding: 'utf8', timeout: 60000 }
      );
      console.log(result);
    } catch (e) {
      console.log(`Buy ${i + 1} failed: ${e.message}`);
    }
  }

  console.log('\n============================================');
  console.log('Staged buys complete!');
  console.log('============================================');
}

main().catch(console.error);
