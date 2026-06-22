// Deploy BobaiBuyDrops to BNB Chain mainnet via viem.
// Reads NFT_RELAYER_PRIVATE_KEY from .env, deploys, appends NFT_CONTRACT_ADDRESS.
//
// Run: npm run deploy
const path = require('path');
const fs = require('fs');
const { createPublicClient, createWalletClient, http, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bsc } = require('viem/chains');

const RPC = process.env.BSC_RPC || 'https://bsc-dataseed.binance.org';
const PK  = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!PK) { console.error('FATAL: NFT_RELAYER_PRIVATE_KEY missing in .env'); process.exit(1); }

const account = privateKeyToAccount(PK);
const BASE_URI = process.env.NFT_BASE_URI || ''; // empty placeholder; setBaseURI later

const artifact = require(path.join(__dirname, '..', 'build', 'BobaiBuyDrops.json'));

(async () => {
  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });

  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer/Relayer: ${account.address}`);
  console.log(`Balance:          ${formatEther(bal)} BNB`);
  if (bal < 5_000_000_000_000_000n) { // < 0.005 BNB
    console.error('FATAL: balance too low for deploy (need >= 0.005 BNB).');
    process.exit(1);
  }

  console.log(`\nDeploying BobaiBuyDrops...`);
  console.log(`  constructor baseURI = "${BASE_URI}"`);

  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [BASE_URI],
  });
  console.log(`tx hash: ${hash}`);
  console.log(`Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  if (receipt.status !== 'success') {
    console.error('FATAL: deploy tx reverted');
    process.exit(1);
  }
  const addr = receipt.contractAddress;
  console.log(`\n✅ Deployed`);
  console.log(`  contract:   ${addr}`);
  console.log(`  block:      ${receipt.blockNumber}`);
  console.log(`  gas used:   ${receipt.gasUsed.toString()}`);
  console.log(`  bscscan:    https://bscscan.com/address/${addr}`);

  const envPath = path.resolve(__dirname, '..', '..', '..', '.env');
  fs.appendFileSync(envPath, `\n# Deployed ${new Date().toISOString()}\nNFT_CONTRACT_ADDRESS=${addr}\n`);
  console.log(`\nNFT_CONTRACT_ADDRESS appended to .env`);
})();
