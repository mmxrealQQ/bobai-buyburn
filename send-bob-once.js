// One-time script: Send ALL $BOB from creator wallet to personal wallet
const { createPublicClient, createWalletClient, http, parseAbi, formatEther } = require('viem');
const { bsc } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const BOB_TOKEN = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e';
const PERSONAL_WALLET = '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) { console.log('[ERROR] No PRIVATE_KEY'); process.exit(1); }
  const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(rpcUrl) });

  const bobBalance = await publicClient.readContract({
    address: BOB_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`Wallet: ${account.address}`);
  console.log(`BOB Balance: ${formatEther(bobBalance)}`);
  if (bobBalance === 0n) { console.log('No BOB to send.'); return; }

  console.log(`Sending ${formatEther(bobBalance)} BOB to ${PERSONAL_WALLET}...`);
  const txHash = await walletClient.writeContract({
    address: BOB_TOKEN, abi: ERC20_ABI, functionName: 'transfer',
    args: [PERSONAL_WALLET, bobBalance], gas: 500000n,
  });
  console.log(`TX: https://bscscan.com/tx/${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`Done! Block: ${receipt.blockNumber}, Status: ${receipt.status}`);
}
main().catch(console.error);
