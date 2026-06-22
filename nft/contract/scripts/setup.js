// Post-deploy setup: sets the 6 per-tier caps via setCapBatch + sets minter.
// Run AFTER deploy.js. Reads NFT_CONTRACT_ADDRESS + NFT_RELAYER_PRIVATE_KEY from .env.
//
// Run: npm run setup
const path = require('path');
const { createPublicClient, createWalletClient, http, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bsc } = require('viem/chains');

const RPC  = process.env.BSC_RPC || 'https://bsc-dataseed.binance.org';
const PK   = process.env.NFT_RELAYER_PRIVATE_KEY;
const ADDR = process.env.NFT_CONTRACT_ADDRESS;
const MINTER = process.env.NFT_MINTER_ADDRESS || process.env.NFT_RELAYER_ADDRESS;
if (!PK)   { console.error('FATAL: NFT_RELAYER_PRIVATE_KEY missing'); process.exit(1); }
if (!ADDR) { console.error('FATAL: NFT_CONTRACT_ADDRESS missing — run deploy first'); process.exit(1); }
if (!MINTER) { console.error('FATAL: minter address missing'); process.exit(1); }

const artifact = require(path.join(__dirname, '..', 'build', 'BobaiBuyDrops.json'));
const account = privateKeyToAccount(PK);

// Per-tier caps. Sum = 1925.
//        NICE  BIG  HUGE WHALE THUNDER KRAKEN
const CAPS = [1000, 500, 250,  100,    50,     25];

(async () => {
  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });

  console.log(`Owner/Sender:  ${account.address}`);
  console.log(`Contract:      ${ADDR}`);
  console.log(`Minter target: ${MINTER}`);
  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:       ${formatEther(bal)} BNB`);

  const tiers = [0, 1, 2, 3, 4, 5];
  const total = CAPS.reduce((a, b) => a + b, 0);
  console.log(`Total NFTs:    ${total} (expected 1925)`);
  if (total !== 1925) { console.error('Cap sum mismatch — aborting'); process.exit(1); }

  // ----- 1) setCapBatch
  console.log('\n[1/2] setCapBatch(6 tiers)...');
  const txCap = await wallet.writeContract({
    address: ADDR,
    abi: artifact.abi,
    functionName: 'setCapBatch',
    args: [tiers, CAPS.map(n => BigInt(n))],
  });
  console.log(`     tx: ${txCap}`);
  const rcap = await publicClient.waitForTransactionReceipt({ hash: txCap, confirmations: 1 });
  if (rcap.status !== 'success') { console.error('setCapBatch reverted'); process.exit(1); }
  console.log(`     ✅ confirmed, gas: ${rcap.gasUsed.toString()}`);

  // ----- 2) setMinter
  console.log('\n[2/2] setMinter()...');
  const txMin = await wallet.writeContract({
    address: ADDR,
    abi: artifact.abi,
    functionName: 'setMinter',
    args: [MINTER],
  });
  console.log(`     tx: ${txMin}`);
  const rmin = await publicClient.waitForTransactionReceipt({ hash: txMin, confirmations: 1 });
  if (rmin.status !== 'success') { console.error('setMinter reverted'); process.exit(1); }
  console.log(`     ✅ confirmed, gas: ${rmin.gasUsed.toString()}`);

  // ----- verify
  const [mintedArr, capArr] = await publicClient.readContract({
    address: ADDR, abi: artifact.abi, functionName: 'getTiers',
  });
  const minter = await publicClient.readContract({
    address: ADDR, abi: artifact.abi, functionName: 'minter',
  });
  const sumCap = capArr.reduce((a, b) => a + b, 0n);
  const sumMinted = mintedArr.reduce((a, b) => a + b, 0n);
  const LABEL = ['NICE','BIG','HUGE','WHALE','THUNDER','KRAKEN'];

  console.log('\n=== Verification ===');
  console.log(`minter:     ${minter}`);
  console.log(`per-tier caps: ${capArr.map((c, i) => `${LABEL[i]}=${c}`).join(', ')}`);
  console.log(`total cap:  ${sumCap} (expect 1925)`);
  console.log(`minted:     ${sumMinted}`);
  console.log(`\nBscScan: https://bscscan.com/address/${ADDR}`);
})();
