// Reads agent #49467's on-chain metadata URI back from the ERC-8004 identity
// registry and prints what it resolves to — the check to run after
// update-8004-metadata.mjs, so a republish is verified rather than assumed.
//
//   node scripts/verify-8004-metadata.mjs
import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID = 49467n;
const rpc = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const pub = createPublicClient({ chain: bsc, transport: http(rpc) });

const getters = ['getAgentURI', 'agentURI', 'tokenURI'];
let uri = null;
for (const fn of getters) {
  try {
    uri = await pub.readContract({
      address: REGISTRY,
      abi: [{ type: 'function', name: fn, stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'string' }] }],
      functionName: fn, args: [AGENT_ID],
    });
    console.log('Read via', fn + '()');
    break;
  } catch { /* try next */ }
}
if (!uri) { console.log('No getter matched — check on BscScan/8004scan directly.'); process.exit(0); }

const b64 = uri.split('base64,')[1];
const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
console.log('name       :', json.name);
console.log('image      :', json.image);
console.log('token attr :', json.attributes.find(a => a.trait_type === 'Token Contract')?.value);
console.log('services   :', json.services.map(s => s.name).join(', '));
console.log('has BOB?   :', /\bBOB\b(?!AI)/.test(JSON.stringify(json)) ? 'YES (check!)' : 'no — clean BOBAI');
