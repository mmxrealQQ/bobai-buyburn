// Updates the ERC-8004 agent #49467 on-chain metadata to the BOBAI card.
// Reads scripts/bobai-agent-card.json, encodes it as a base64 data: URI,
// and calls setAgentURI(agentId, uri) on the registry. Signs with the
// BOBAI creator wallet (0x15Ba…3d38). Run: node scripts/update-8004-metadata.mjs
import 'dotenv/config';
import { readFileSync } from 'fs';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID = 49467n;
const ABI = [{
  type: 'function', name: 'setAgentURI', stateMutability: 'nonpayable',
  inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newURI', type: 'string' }],
  outputs: [],
}];

const metadata = JSON.parse(readFileSync(new URL('./bobai-agent-card.json', import.meta.url), 'utf-8'));
const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;

let key = (process.env.BOBAI_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
if (!key) { console.error('Missing BOBAI_PRIVATE_KEY / PRIVATE_KEY'); process.exit(1); }
if (!key.startsWith('0x')) key = '0x' + key;
const account = privateKeyToAccount(key);
const rpc = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

const wallet = createWalletClient({ account, chain: bsc, transport: http(rpc) });
const pub = createPublicClient({ chain: bsc, transport: http(rpc) });

console.log('Agent      :', AGENT_ID.toString(), '(', metadata.name, ')');
console.log('Signer     :', account.address);
console.log('URI bytes  :', uri.length);
console.log('Services   :', metadata.services.map(s => s.name + ' -> ' + (s.endpoint || '')).join('\n             '));

const hash = await wallet.writeContract({
  address: REGISTRY, abi: ABI, functionName: 'setAgentURI', args: [AGENT_ID, uri],
});
console.log('\nTX sent    :', hash);
const rc = await pub.waitForTransactionReceipt({ hash });
console.log('Status     :', rc.status, '| block', rc.blockNumber.toString());
console.log('BscScan    : https://bscscan.com/tx/' + hash);
console.log('Verify     : https://8004scan.io/agents/bsc/49467');
