// Creates the wallet that receives x402 payments and appends it to .env.
//
// The private key is generated, written to disk and never printed. That is the
// whole design of this script: anything echoed to a terminal ends up in shell
// history, scrollback and any transcript of the session that produced it, and a
// key that has been through those is a key that has to be rotated. Only the
// public address is shown, which is the part that is meant to be public anyway
// — it goes out in every PAYMENT-REQUIRED header we ever send.
//
// The receiving wallet does NOT need to be reachable by the worker. x402
// verification asks the facilitator whether a payment happened; the server
// never touches the funds and never needs the key. So this key stays local, is
// used only when moving earnings into the buyback, and is never uploaded as a
// Cloudflare secret.
//
// Refuses to overwrite an existing entry: re-running this after funds have
// arrived would strand them at an address nobody has the key for any more.
//
// Usage: node scripts/create-x402-wallet.mjs
import fs from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV = path.join(ROOT, '.env');
const KEY_NAME = 'X402_PRIVATE_KEY';
const ADDR_NAME = 'X402_WALLET';

const existing = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
if (new RegExp(`^${KEY_NAME}=`, 'm').test(existing)) {
  const addr = existing.match(new RegExp(`^${ADDR_NAME}=(.*)$`, 'm'));
  console.log(`${KEY_NAME} already exists in .env — refusing to overwrite.`);
  if (addr) console.log(`Existing receiving address: ${addr[1].trim()}`);
  console.log('Delete both lines by hand first if you really want a new wallet.');
  process.exit(0);
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

const block = [
  '',
  '# x402 payment receiving wallet — created by scripts/create-x402-wallet.mjs',
  '# Receives USDT/USD1 from agents paying for the watch service. The worker',
  '# never needs this key: x402 verification runs against the facilitator, so',
  '# the server only confirms that payment happened. Use it manually to move',
  '# earnings into the buyback. Do NOT upload it as a Cloudflare secret.',
  `${ADDR_NAME}=${account.address}`,
  `${KEY_NAME}=${pk}`,
  '',
].join('\n');

fs.appendFileSync(ENV, block);

// Deliberately the only thing this ever prints.
console.log('Created x402 receiving wallet.');
console.log(`Address: ${account.address}`);
console.log(`Private key written to .env as ${KEY_NAME} (not shown, not logged).`);
console.log('.env is gitignored — confirm with: git check-ignore -v .env');
