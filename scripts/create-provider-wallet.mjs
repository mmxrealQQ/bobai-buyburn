// Creates the wallet our own agents sign as, and appends it to .env.
//
// This is a different animal from the x402 receiving wallet, and the difference
// is the reason it gets its own key rather than borrowing that one.
//
// The x402 wallet only ever RECEIVES. Verification runs against the facilitator,
// so the worker never needs its key, and that key has therefore never been
// uploaded anywhere — a deliberate decision worth keeping.
//
// This wallet has to SIGN, automatically, with no human present: ERC-8183 says
// the provider writes the deliverable on-chain itself via
// submit(uint256,bytes32,bytes), and an agent that cannot do that is an agent
// that gets hired and never delivers. That is precisely the failure we measured
// across the whole kernel — 27,195 jobs holding a deliverable whose escrow never
// released, and all four BNB Agent Studio reference agents at zero completions.
// We are not shipping another one.
//
// So this key does go into the worker as a Cloudflare secret, and the way to
// keep that honest is to make sure it is worth as little as possible:
//
//   It holds gas and nothing else. Earnings in $U are swept out, not parked.
//   It is not the buyback bot, not the treasury, not the x402 wallet.
//   Its entire authority is "write a deliverable for a job somebody funded".
//
// The private key is generated, written to disk and never printed, for the same
// reason as every other wallet here: anything echoed to a terminal survives in
// shell history, scrollback and the session transcript.
//
// Usage: node scripts/create-provider-wallet.mjs
import fs from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV = path.join(ROOT, '.env');
const KEY_NAME = 'AGENT_PROVIDER_PRIVATE_KEY';
const ADDR_NAME = 'AGENT_PROVIDER_WALLET';

const existing = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
if (new RegExp(`^${KEY_NAME}=`, 'm').test(existing)) {
  const addr = existing.match(new RegExp(`^${ADDR_NAME}=(.*)$`, 'm'));
  console.log(`${KEY_NAME} already exists in .env — refusing to overwrite.`);
  if (addr) console.log(`Existing provider address: ${addr[1].trim()}`);
  console.log('Two ERC-8004 identities are owned by that address. Replacing the key');
  console.log('orphans them, and there is no way to move an agent id afterwards.');
  process.exit(0);
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

const block = [
  '',
  '# Provider wallet for our own hireable agents — scripts/create-provider-wallet.mjs',
  '# Owns the ERC-8004 identities of the grid-trading and health-factor agents,',
  '# and signs submit(jobId, hash, payload) when a funded job is delivered.',
  '# Holds gas only. This one IS uploaded as a Cloudflare secret, because the',
  '# delivery has to happen without a human present — see the file header.',
  `${ADDR_NAME}=${account.address}`,
  `${KEY_NAME}=${pk}`,
  '',
].join('\n');

fs.appendFileSync(ENV, block);

console.log('Created the agent provider wallet.');
console.log(`Address: ${account.address}`);
console.log(`Private key written to .env as ${KEY_NAME} (not shown, not logged).`);
console.log('');
console.log('Next: fund it with gas, then register the two identities.');
console.log('  node scripts/fund-provider-wallet.mjs');
console.log('  node scripts/register-own-agents.mjs');
