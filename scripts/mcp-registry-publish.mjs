// Publishes scripts/mcp-registry-server.json to the official MCP registry.
//
// WHY NOT THE CLI
// The documented route is the mcp-publisher binary from the registry's GitHub
// releases. That means downloading and running an executable, and the registry
// exposes the same two calls over HTTP — so this does them directly with the
// key that is already in .env. Nothing is fetched, nothing is installed.
//
// THE FLOW, both steps from the registry's own OpenAPI document
//   1. POST /v0.1/auth/http  { domain, timestamp, signed_timestamp }
//      timestamp is RFC3339; signed_timestamp is the ed25519 signature over
//      that exact string, hex-encoded. The registry checks it against the
//      public key served at https://<domain>/.well-known/mcp-registry-auth,
//      which is why that file must stay deployed forever — it is the proof
//      that whoever signs controls the domain.
//   2. POST /v0.1/publish    Authorization: <registry token>, body = server.json
//
// THE KEY
// MCP_REGISTRY_PRIVATE_KEY in .env is a raw 32-byte ed25519 SEED in hex, not a
// PKCS#8 document. Node will not import a bare seed, so it is wrapped in the
// twelve-byte PKCS#8 prefix that ed25519 private keys always carry. Those bytes
// are constant for the algorithm; there is nothing secret or variable in them.
//
// PUBLISHING IS PUBLIC. Nothing happens without --confirm.
//
// Usage:
//   node scripts/mcp-registry-publish.mjs            # show what would be sent
//   node scripts/mcp-registry-publish.mjs --confirm  # publish
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REGISTRY = 'https://registry.modelcontextprotocol.io';
const DOMAIN = 'brainonbnb.com';
const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(ROOT, 'scripts', 'mcp-registry-server.json');

const server = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// 100 characters, enforced by the registry with a 422 and no explanation.
if (server.description.length > 100) {
  console.error(`description is ${server.description.length} chars; the registry rejects anything over 100.`);
  process.exit(1);
}

const seedHex = (process.env.MCP_REGISTRY_PRIVATE_KEY || '').replace(/^0x/, '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
  console.error('MCP_REGISTRY_PRIVATE_KEY must be a 32-byte hex seed.');
  process.exit(1);
}

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const privateKey = crypto.createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
  format: 'der',
  type: 'pkcs8',
});

// Printed and checked against what the domain actually serves BEFORE anything
// is sent. A mismatch means this key cannot authenticate, and finding that out
// here is better than reading a 401 and guessing which half is wrong.
const publicKeyB64 = crypto.createPublicKey(privateKey)
  .export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

const served = await fetch(`https://${DOMAIN}/.well-known/mcp-registry-auth`)
  .then((r) => (r.ok ? r.text() : '')).catch(() => '');
const servedKey = (served.match(/p=([A-Za-z0-9+/=]+)/) || [])[1] || null;

console.log('');
console.log('  name        ', server.name);
console.log('  version     ', server.version);
console.log('  description ', server.description, `(${server.description.length} chars)`);
console.log('  endpoint    ', (server.remotes || []).map((r) => r.url).join(', '));
console.log('');
console.log('  key on domain', servedKey || '(not served)');
console.log('  key from .env', publicKeyB64);
console.log('  match        ', servedKey === publicKeyB64 ? 'yes' : 'NO — publishing would be rejected');
console.log('');

if (servedKey !== publicKeyB64) process.exit(1);

if (!process.argv.includes('--confirm')) {
  console.log('  nothing published. Re-run with --confirm.');
  console.log('');
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const signed = crypto.sign(null, Buffer.from(timestamp, 'utf8'), privateKey).toString('hex');

const auth = await fetch(`${REGISTRY}/v0.1/auth/http`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ domain: DOMAIN, timestamp, signed_timestamp: signed }),
});
const authBody = await auth.text();
if (!auth.ok) { console.error('auth failed', auth.status, authBody.slice(0, 300)); process.exit(1); }
const { registry_token } = JSON.parse(authBody);
console.log('  authenticated as', DOMAIN);

const pub = await fetch(`${REGISTRY}/v0.1/publish`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${registry_token}` },
  body: JSON.stringify(server),
});
const pubBody = await pub.text();
if (!pub.ok) { console.error('publish failed', pub.status, pubBody.slice(0, 500)); process.exit(1); }

console.log('  published', server.version);
console.log('');
console.log(pubBody.slice(0, 400));
console.log('');
