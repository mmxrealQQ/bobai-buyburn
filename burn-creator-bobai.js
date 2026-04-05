// One-time BOBAI burn from Creator Wallet
// Burns ALL BOBAI tokens to 0xdEaD address
// Separate from running bots — execute once and delete

const { createPublicClient, createWalletClient, http, parseAbi, formatEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
require('dotenv').config();

const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const CREATOR_WALLET = '0x15Ba17075ef5E0736292b030e3715d9100fe3d38';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('[ERROR] PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);

  if (account.address.toLowerCase() !== CREATOR_WALLET.toLowerCase()) {
    console.error(`[ERROR] PRIVATE_KEY does not match Creator Wallet`);
    console.error(`  Expected: ${CREATOR_WALLET}`);
    console.error(`  Got:      ${account.address}`);
    process.exit(1);
  }

  const publicClient = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed1.binance.org') });
  const walletClient = createWalletClient({ chain: bsc, transport: http('https://bsc-dataseed1.binance.org'), account });

  // Check BNB for gas
  const bnbBalance = await publicClient.getBalance({ address: account.address });
  console.log(`[INFO] BNB balance: ${formatEther(bnbBalance)} BNB`);

  if (bnbBalance < 500000n * 3000000000n) { // ~0.0015 BNB min for gas
    console.error('[ERROR] Not enough BNB for gas');
    process.exit(1);
  }

  // Check BOBAI balance
  const bobaiBalance = await publicClient.readContract({
    address: BOBAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (bobaiBalance === 0n) {
    console.log('[INFO] No BOBAI to burn — balance is 0');
    process.exit(0);
  }

  console.log(`[INFO] BOBAI balance: ${formatEther(bobaiBalance)} BOBAI`);
  console.log(`[INFO] Burning ALL to ${DEAD}...`);

  // Send all BOBAI to dead address
  const hash = await walletClient.writeContract({
    address: BOBAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [DEAD, bobaiBalance],
    gas: 500000n,
  });

  console.log(`[TX] Burn TX: https://bscscan.com/tx/${hash}`);

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    console.log(`[SUCCESS] Burned ${formatEther(bobaiBalance)} BOBAI`);
    console.log(`[SUCCESS] Gas used: ${receipt.gasUsed}`);
  } else {
    console.error('[FAILED] Transaction reverted');
    process.exit(1);
  }

  // Verify final balance
  const finalBalance = await publicClient.readContract({
    address: BOBAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`[INFO] Remaining BOBAI: ${formatEther(finalBalance)}`);
}

main().catch(err => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
