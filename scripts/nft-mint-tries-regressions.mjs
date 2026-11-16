// Pins Liste B "NFT-Minter" (2026-11-16, A-Z review 15.11.): only the buy's own fault (the contract refuses the mint)
// counts to MINT_TRIES; a failure of the road (gas, nonce, a node, a timeout, a mint still in the mempool) counts to
// OUTAGE_TRIES, a day. A buy given up is kept (mint_given_up) and shown on /drops. Three nodes, not one.
// The errors in part 2 are REAL viem errors, made against BNB Chain with read-only calls from an empty throwaway address.
//   node scripts/nft-mint-tries-regressions.mjs           (needs the network for part 2; --offline skips it)
import { readFileSync } from 'node:fs';
import { createPublicClient, http, encodeFunctionData, parseAbi, parseEther } from 'viem';
import { bsc } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mintFault, nextTries, MINT_TRIES, OUTAGE_TRIES } from '../worker-nft-mint/index.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

// 1. the counts
ok('the buy\'s own fault: 30 runs; the road: a day of runs', MINT_TRIES === 30 && OUTAGE_TRIES === 1440);
let t; let r;
t = undefined; for (let i = 0; i < 29; i++) { r = nextTries(t, 'buy'); t = r.tries; }
ok('29 refusals: not given up yet', r.giveUp === null && t.buy === 29);
r = nextTries(t, 'buy');
ok('the 30th refusal: given up, and it says why', /refused 30 runs/.test(r.giveUp || ''));
t = undefined; for (let i = 0; i < 600; i++) { r = nextTries(t, 'road'); t = r.tries; }
ok('600 runs (10 h) of a relayer out of gas: still waiting, not given up (was given up after 30)', r.giveUp === null && t.road === 600 && t.buy === 0);
t = { buy: 0, road: OUTAGE_TRIES - 1 }; r = nextTries(t, 'road');
ok('a whole day of road failures: given up, so one buy cannot hold up every buy after it', /a day/.test(r.giveUp || ''));
r = nextTries(12, 'buy');
ok('an old row (a bare number) reads as the buy\'s own count', r.tries.buy === 13 && r.tries.road === 0);
ok('the road does not add to the buy\'s count', nextTries({ buy: 5, road: 3 }, 'road').tries.buy === 5);

// 2. real errors from viem against the chain
if (!process.argv.includes('--offline')) {
  const pub = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed.binance.org') });
  const me = privateKeyToAccount(generatePrivateKey());
  const NFT = '0x' + readFileSync(new URL('../worker-nft-mint/wrangler.toml', import.meta.url), 'utf8').match(/NFT_CONTRACT_ADDRESS\s*=\s*"0x([0-9a-fA-F]{40})"/)?.[1];
  let revert = null, funds = null, down = null;
  // a stranger asking the contract to mint: refused by the contract (the shape of a recipient it refuses). Asked from an
  // address that holds BNB (a Binance hot wallet; read-only, no key): from an empty one the node answers "insufficient
  // funds" before the contract is even asked — as it would for our relayer out of gas, which is the road's fault
  const RICH = '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3';
  try { await pub.estimateGas({ account: RICH, to: NFT, data: encodeFunctionData({ abi: parseAbi(['function mintTo(address,uint8,uint8)']), functionName: 'mintTo', args: [me.address, 0, 0] }) }); } catch (e) { revert = e; }
  // an empty wallet sending value: the relayer out of gas
  try { await pub.estimateGas({ account: me, to: me.address, value: parseEther('1') }); } catch (e) { funds = e; }
  // a node that is not there
  try { await createPublicClient({ chain: bsc, transport: http('https://127.0.0.1:9', { timeout: 3000, retryCount: 0 }) }).getBlockNumber(); } catch (e) { down = e; }
  ok(`the contract refusing the mint is the buy's fault (${String(revert?.shortMessage || revert?.message).slice(0, 60)})`, !!revert && mintFault(revert) === 'buy');
  ok(`an empty relayer is the road's (${String(funds?.shortMessage || funds?.message).slice(0, 60)})`, !!funds && mintFault(funds) === 'road');
  ok(`a node that does not answer is the road's (${String(down?.shortMessage || down?.message).slice(0, 60)})`, !!down && mintFault(down) === 'road');
}
// our own words
ok('"the mint transaction … reverted" (mined and reverted) is the buy\'s', mintFault(new Error('the mint transaction 0xabc reverted')) === 'buy');
ok('"… is still not mined" is the road\'s', mintFault(new Error('the mint transaction 0xabc is still not mined')) === 'road');
ok('a revert whose data holds 0x…503… is still the buy\'s (no status-code false match)', mintFault(new Error('execution reverted: 0x08c379a0503429')) === 'buy');
ok('nonce too low is the road\'s', mintFault(new Error('nonce too low')) === 'road');

// 3. where the pieces sit
const src = readFileSync(new URL('../worker-nft-mint/index.js', import.meta.url), 'utf8');
ok('the mint goes over three nodes (fallback), not one', /const roads = fallback\(RPC_DATASEED\.map/.test(src) && /createWalletClient\(\{ account, chain: bsc, transport: roads \}\)/.test(src));
ok('a give-up is kept in mint_given_up and shown on /drops', /env\.KV\.put\('mint_given_up'/.test(src) && /JSON\.stringify\(\{ drops, given_up \}\)/.test(src));
ok('the fail path counts by fault (nextTries(… mintFault(e)))', /const fault = mintFault\(e\), \{ tries: t, giveUp \} = nextTries\(tries\[txHash\], fault\)/.test(src));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
