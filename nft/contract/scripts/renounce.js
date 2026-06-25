// One-off: renounce ownership of the BobaiBuyDrops contract.
// After this runs, owner = 0x0 — setMinter / setBaseURI / setCap are locked forever.
// minter address stays set → buy-alerts keep minting normally.
//
// Run: node scripts/renounce.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
const { createPublicClient, createWalletClient, http, parseAbi } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bsc } = require('viem/chains');

const RPC  = process.env.BSC_RPC || 'https://bsc-dataseed.binance.org';
const PK   = process.env.NFT_RELAYER_PRIVATE_KEY;
const ADDR = process.env.NFT_CONTRACT_ADDRESS;
if (!PK)   { console.error('FATAL: NFT_RELAYER_PRIVATE_KEY missing'); process.exit(1); }
if (!ADDR) { console.error('FATAL: NFT_CONTRACT_ADDRESS missing'); process.exit(1); }

const ABI = parseAbi([
  'function owner() view returns (address)',
  'function minter() view returns (address)',
  'function renounceOwnership()',
]);

const account = privateKeyToAccount(PK);

(async () => {
  const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });

  console.log(`Contract:  ${ADDR}`);
  console.log(`Sender:    ${account.address}`);

  const ownerBefore = await pub.readContract({ address: ADDR, abi: ABI, functionName: 'owner' });
  const minterBefore = await pub.readContract({ address: ADDR, abi: ABI, functionName: 'minter' });
  console.log(`\nBefore:`);
  console.log(`  owner:  ${ownerBefore}`);
  console.log(`  minter: ${minterBefore}`);

  if (ownerBefore.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    console.log('\nAlready renounced. Nothing to do.');
    process.exit(0);
  }
  if (ownerBefore.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`\nFATAL: sender ${account.address} is not owner ${ownerBefore}`);
    process.exit(1);
  }

  console.log(`\nSending renounceOwnership()...`);
  const hash = await wallet.writeContract({
    address: ADDR, abi: ABI, functionName: 'renounceOwnership', args: [],
  });
  console.log(`  tx: ${hash}`);
  console.log(`  https://bscscan.com/tx/${hash}`);

  const r = await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (r.status !== 'success') { console.error('Tx reverted'); process.exit(1); }
  console.log(`  ✅ confirmed, gas: ${r.gasUsed.toString()}`);

  const ownerAfter = await pub.readContract({ address: ADDR, abi: ABI, functionName: 'owner' });
  const minterAfter = await pub.readContract({ address: ADDR, abi: ABI, functionName: 'minter' });
  console.log(`\nAfter:`);
  console.log(`  owner:  ${ownerAfter}`);
  console.log(`  minter: ${minterAfter}`);
  console.log(`\n${ownerAfter === '0x0000000000000000000000000000000000000000' ? '🔒 RENOUNCED' : '❌ owner did not change'}`);
})().catch(e => { console.error(e); process.exit(1); });
