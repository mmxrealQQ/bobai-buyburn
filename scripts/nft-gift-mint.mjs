#!/usr/bin/env node
// A Buy Drops NFT minted by hand — for the buy the minter sized wrong, not for
// anything else. The contract is renounced and the relayer is its only
// minter; this script is that relayer run from a laptop, once, for one wallet.
//
// It mints the way the worker does (worker-nft-mint/index.js): the tier is
// named by the person, the rarity is rolled weighted by the slots the tier
// still has per rarity, counted on chain (tierOf / rarityOf of every token) —
// so a hand mint can neither overshoot a cell nor pick its own rarity. The
// worker's cell counter reads the chain and picks the mint up by itself.
//
// SAFETY — a bare run changes nothing. Nothing is sent without --confirm, and
// the mint is simulated first either way.
//
//   node scripts/nft-gift-mint.mjs --to 0x… --tier 2 --why "…"            plan
//   node scripts/nft-gift-mint.mjs --to 0x… --tier 2 --why "…" --confirm  send
//   optional: --buy-tx 0x…  --usd 366   (written into the ledger entry it prints)
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, fallback, parseAbi, isAddress, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const CONFIRM = process.argv.includes('--confirm');
const TO = argOf('--to'), TIER = Number(argOf('--tier')), WHY = argOf('--why'), BUY_TX = argOf('--buy-tx'), USD = argOf('--usd') != null ? Number(argOf('--usd')) : null;

// The drop matrix of the worker (tier × rarity), copied with its labels; the
// check below refuses to run if the worker's text no longer carries this row.
const CELL_CAP = [
  [425, 264, 154, 80, 41, 27, 9], [212, 126, 76, 42, 23, 14, 7], [104, 64, 38, 21, 12, 7, 4],
  [34, 26, 16, 10, 7, 4, 3], [17, 11, 9, 6, 4, 2, 1], [7, 5, 4, 3, 3, 2, 1],
];
const TIER_NAME = ['NICE', 'BIG', 'HUGE', 'WHALE', 'THUNDER', 'KRAKEN'];
const RARITY_NAME = ['Common', 'Uncommon', 'Rare', 'Mythical', 'Legendary', 'Ancient', 'Immortal'];
const ABI = parseAbi([
  'function mintTo(address to, uint8 tier, uint8 rarity) external returns (uint256)',
  'function getTiers() external view returns (uint256[6] mintedArr, uint256[6] capArr)',
  'function nextId() view returns (uint256)',
  'function rarityOf(uint256) view returns (uint8)',
  'function tierOf(uint256) view returns (uint8)',
]);

function rollRarity(remaining) {
  const tot = remaining.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (tot <= 0) return -1;
  let r = Math.random() * tot;
  for (let i = 0; i < remaining.length; i++) { r -= remaining[i] > 0 ? remaining[i] : 0; if (r < 0) return i; }
  return remaining.findIndex((x) => x > 0);
}

const die = (m) => { console.error(m); process.exit(2); };
if (!TO || !isAddress(TO)) die('--to must be the wallet that receives the NFT');
if (!(Number.isInteger(TIER) && TIER >= 0 && TIER <= 5)) die('--tier is 0 NICE, 1 BIG, 2 HUGE, 3 WHALE, 4 THUNDER or 5 KRAKEN');
if (!WHY) die('--why says, in a sentence, why this NFT is minted by hand — it goes into the ledger entry');
const contract = process.env.NFT_CONTRACT_ADDRESS, key = process.env.NFT_RELAYER_PRIVATE_KEY;
if (!contract || !key) die('NFT_CONTRACT_ADDRESS and NFT_RELAYER_PRIVATE_KEY must be in .env');
{
  const fs = await import('node:fs');
  const w = fs.readFileSync(new URL('../worker-nft-mint/index.js', import.meta.url), 'utf8');
  if (!w.replace(/\s+/g, '').includes(`[${CELL_CAP[TIER].join(',')}]`)) die(`the worker's drop matrix no longer carries this script's row for tier ${TIER} — bring the copy up to date first`);
}

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const transport = fallback(['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'].map((u) => http(u)));
const pub = createPublicClient({ chain: bsc, transport });
const read = (functionName, args = []) => pub.readContract({ address: contract, abi: ABI, functionName, args });

const [[mintedArr, capArr], nextId, gas] = await Promise.all([read('getTiers'), read('nextId'), pub.getBalance({ address: account.address })]);
console.log(`relayer ${account.address} holds ${formatEther(gas)} BNB`);
console.log(`tier ${TIER} ${TIER_NAME[TIER]}: ${mintedArr[TIER]} of ${capArr[TIER]} minted; ${Number(nextId) - 1} NFTs exist`);
if (mintedArr[TIER] >= capArr[TIER]) die('this tier is sold out — nothing to mint');

// Count the tier's cells on chain, every token, so the roll sees what is left.
const counts = [0, 0, 0, 0, 0, 0, 0];
const total = Number(nextId) - 1;
for (let id = 1; id <= total; id += 20) {
  const ids = Array.from({ length: Math.min(20, total - id + 1) }, (_, i) => BigInt(id + i));
  const rows = await Promise.all(ids.map((t) => Promise.all([read('tierOf', [t]), read('rarityOf', [t])])));
  for (const [tt, rr] of rows) if (Number(tt) === TIER && Number(rr) < 7) counts[Number(rr)]++;
}
const remaining = CELL_CAP[TIER].map((cap, i) => cap - counts[i]);
console.log(`minted per rarity in this tier: ${counts.join(' / ')}; slots left: ${remaining.join(' / ')}`);
const rarity = rollRarity(remaining);
if (rarity < 0) die('every rarity cell of this tier is full');
console.log(`rolled: ${RARITY_NAME[rarity]} (weighted by the slots left, as the worker rolls)`);

const sim = await pub.simulateContract({ address: contract, abi: ABI, functionName: 'mintTo', args: [TO, TIER, rarity], account });
console.log(`simulated: would mint #${sim.result} ${TIER_NAME[TIER]} × ${RARITY_NAME[rarity]} to ${TO}`);
if (!CONFIRM) { console.log('\nPLAN ONLY — nothing was sent. Add --confirm to send it (the rarity is rolled again).'); process.exit(0); }

const wallet = createWalletClient({ account, chain: bsc, transport });
const hash = await wallet.writeContract(sim.request);
console.log(`sent: https://bscscan.com/tx/${hash}`);
const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120000 });
if (rc.status !== 'success') die('the mint reverted');
// The id from the mint's own Transfer log: the worker mints every minute, and
// the id the simulation named may have gone to a buyer in between.
const tl = rc.logs.find((l) => l.address.toLowerCase() === contract.toLowerCase() && l.topics.length === 4 && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
const tokenId = tl ? Number(BigInt(tl.topics[3])) : Number(sim.result);
const entry = { to: TO.toLowerCase(), tokenId, tier: TIER, rarity, ...(USD != null ? { usd: Math.round(USD) } : {}), mintTx: hash, ...(BUY_TX ? { buyTx: BUY_TX } : {}), block: Number(rc.blockNumber), ts: Math.floor(Date.now() / 1000), by_hand: WHY };
console.log(`minted #${tokenId} in block ${rc.blockNumber}.\nledger entry (KV recent_drops of bobai-nft-mint, newest first):\n${JSON.stringify(entry)}`);
