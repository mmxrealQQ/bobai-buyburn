// One-off: set the contract's baseURI to point at the metadata worker.
// Run: npm run set-base-uri
const path = require('path');
const { createPublicClient, createWalletClient, http, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bsc } = require('viem/chains');

const RPC  = process.env.BSC_RPC || 'https://bsc-dataseed.binance.org';
const PK   = process.env.NFT_RELAYER_PRIVATE_KEY;
const ADDR = process.env.NFT_CONTRACT_ADDRESS;
const BASE_URI = process.env.NFT_BASE_URI || 'https://bobai-nft-meta.bobbuildonbnb.workers.dev/meta/';

if (!PK)   { console.error('FATAL: NFT_RELAYER_PRIVATE_KEY missing'); process.exit(1); }
if (!ADDR) { console.error('FATAL: NFT_CONTRACT_ADDRESS missing'); process.exit(1); }

const artifact = require(path.join(__dirname, '..', 'build', 'BobaiBuyDrops.json'));
const account = privateKeyToAccount(PK);

(async () => {
  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
  console.log(`Owner:    ${account.address}`);
  console.log(`Contract: ${ADDR}`);
  console.log(`Setting baseURI to: ${BASE_URI}`);

  const tx = await wallet.writeContract({
    address: ADDR,
    abi: artifact.abi,
    functionName: 'setBaseURI',
    args: [BASE_URI],
  });
  console.log(`tx: ${tx}`);
  const r = await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
  console.log(r.status === 'success' ? '✅ baseURI updated' : '❌ tx reverted');
  console.log(`gas: ${r.gasUsed.toString()}`);
})();
