// Creates the wallet that holds this project's own liquidity position.
//
// Its own wallet, and not one of the five that already exist, for a reason that
// has already been paid for once: the x402 wallet is used for nothing but
// receiving agent payments, which is exactly why its transaction history IS the
// earnings record, and why /agents can point at it and say "check for
// yourself". Mint a liquidity position from that address and the claim stops
// being checkable — the fees, the position, the swaps and the earnings all
// arrive as one indistinguishable stream.
//
// So: a separate address, whose whole history is the position. Opened it, held
// it, collected from it, sent the proceeds to the buyback. Anyone can read that
// off the chain without being told which transactions to ignore.
//
// The private key is generated, written to .env and never printed. Anything
// echoed to a terminal is in shell history, scrollback and any transcript of
// the session, and a key that has been through those has to be rotated.
//
// This key is used from a laptop, never uploaded as a Cloudflare secret. A
// wallet holding a real position should not be reachable from a worker that
// answers requests from the public internet.
//
// Refuses to overwrite an existing entry: re-running it after the position is
// open would strand it at an address nobody has the key for any more.
//
// Usage: node scripts/create-lp-wallet.mjs
import fs from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV = path.join(ROOT, '.env');
const KEY_NAME = 'LP_PRIVATE_KEY';
const ADDR_NAME = 'LP_WALLET';

const existing = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
if (new RegExp(`^${KEY_NAME}=`, 'm').test(existing)) {
  const addr = existing.match(new RegExp(`^${ADDR_NAME}=(.*)$`, 'm'));
  console.log(`${KEY_NAME} already exists in .env — refusing to overwrite.`);
  if (addr) console.log(`Existing liquidity wallet: ${addr[1].trim()}`);
  console.log('Delete both lines by hand first if you really want a new wallet.');
  process.exit(0);
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

const block = [
  '',
  '# Liquidity position wallet — created by scripts/create-lp-wallet.mjs',
  '# Holds the project\'s own PancakeSwap V3 position, and nothing else, so that',
  '# its transaction history is the position\'s whole record. Funded by hand to',
  '# start with and topped up from what the agents earn. The fees it collects',
  '# are swapped to BNB, spent on $BOBAI and burned, in the same public log.',
  '# Used from a laptop only. Do NOT upload it as a Cloudflare secret: a wallet',
  '# holding a position should not be reachable from a worker on the open web.',
  `${ADDR_NAME}=${account.address}`,
  `${KEY_NAME}=${pk}`,
  '',
].join('\n');

fs.appendFileSync(ENV, block);

console.log('Created the liquidity position wallet.');
console.log(`Address: ${account.address}`);
console.log(`Private key written to .env as ${KEY_NAME} (not shown, not logged).`);
console.log('.env is gitignored — confirm with: git check-ignore -v .env');
console.log('');
console.log('Nothing is funded and nothing is open. Next:');
console.log('  1. send BNB to the address above (the position, plus gas)');
console.log('  2. node scripts/lp-plan.mjs --usd <amount>     what our own tools choose');
console.log('  3. node scripts/lp-open.mjs                    prints the plan, moves nothing');
console.log('  4. node scripts/lp-open.mjs --confirm          opens it');
