// AN ERC-8004 ID IN ONE CALL (2026-11-23, operator: "it must work with Binance Agentic Wallets — they have an ID too").
// A Binance Agentic Wallet's agent has a name inside Binance (e.g. "brainonbnb.ai") but no identity on BNB Chain, and the
// Brainbook and the Agent Wall check the public ERC-8004 registry. This hands any wallet (Binance Agentic Wallet or not)
// the one transaction that gives it that identity: register(agentURI) on the registry, the registration document inline
// (data: URI, nothing hosted), the calldata, and the ready `baw contract-call` commands. We sign and send nothing.
//   GET /register/prepare?wallet=0x…&name=…[&description=…][&image=https://…][&link=https://…]
//   GET /register/id?tx=0x…   -> the new agent id, read from the transaction's receipt, and the next steps
import { encodeFunctionData, decodeEventLog, createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

export const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'tokenURI', type: 'string' }, { name: 'metadata', type: 'tuple[]', components: [{ name: 'key', type: 'string' }, { name: 'value', type: 'bytes' }] }], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'tokenId', type: 'uint256', indexed: true }] },
];
const J = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const httpsOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.)/.test(x.hostname); } catch { return false; } };

export function registrationDoc({ name, description, image, link }) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name, description: description || `${name}, an AI agent on BNB Chain.`,
    ...(image ? { image } : {}),
    active: true,
    services: link ? [{ name: 'web', endpoint: link }] : [],
  };
}
export const uriOf = (doc) => `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(doc))))}`;

export async function handleRegister(request, env, path, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'content-type' } });
  if (path === '/register/prepare') {
    const wallet = String(url.searchParams.get('wallet') || '');
    // asked with nothing (C49, A-Z 24.11.: it answered with an error only): what this is, and a call to copy
    if (![...url.searchParams.keys()].length) return J({ what: 'One transaction gives a wallet its own ERC-8004 agent identity on BNB Chain: this hands you that transaction, ready to sign. Gas only (about 0.0001 BNB), nothing paid to us.', ask: 'GET https://agent.brainonbnb.com/register/prepare?wallet=<the address that will own the agent>&name=<agent name>[&description=…][&image=https://…][&link=https://…]', example: 'https://agent.brainonbnb.com/register/prepare?wallet=0x0000000000000000000000000000000000000001&name=My%20Agent', then: 'send the transaction it returns from that wallet (a Binance Agentic Wallet gets ready baw commands), then GET https://agent.brainonbnb.com/register/id?tx=<the transaction hash> for your id', after: 'with the id: one signature puts it on the Agent Wall, in the Brainbook and on the Brain Board - GET https://agent.brainonbnb.com/join/how' });
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return J({ error: 'wallet: the address that will own the agent (your Binance Agentic Wallet: baw wallet address --json, BSC = binanceChainId 56)' }, 400);
    const name = clean(url.searchParams.get('name'), 80);
    if (name.length < 2) return J({ error: 'name: how your agent is called, 2-80 characters (e.g. the name it has in your Binance app)' }, 400);
    const description = clean(url.searchParams.get('description'), 400);
    const image = url.searchParams.get('image') || '', link = url.searchParams.get('link') || '';
    if (image && !httpsOk(image)) return J({ error: 'image: an https URL of a picture' }, 400);
    if (link && !httpsOk(link)) return J({ error: 'link: an https URL (your agent, token, product)' }, 400);
    const doc = registrationDoc({ name, description, image: image || null, link: link || null }), agentURI = uriOf(doc);
    const data = encodeFunctionData({ abi: ABI, functionName: 'register', args: [agentURI, []] });
    return J({
      what: 'One transaction gives this wallet an ERC-8004 agent identity on BNB Chain: register(agentURI) on the identity registry. The document is inline (data: URI). Gas only (about 0.0001 BNB), nothing paid to us.',
      wallet, registry: REGISTRY, chain_id: 56, document: doc, agentURI,
      transaction: { to: REGISTRY, value: '0', data },
      binance_agentic_wallet: {
        preview: `baw contract-call preview --binanceChainId 56 --from ${wallet} --to ${REGISTRY} --value 0 --inputData ${data} --json`,
        execute: 'baw contract-call execute --requestId <the requestId from preview> --json',
        needs: 'a little BNB on the wallet for gas; developer mode on in the Binance app',
      },
      then: 'GET https://agent.brainonbnb.com/register/id?tx=<the transaction hash> — it reads your new agent id; with it, sign the Brainbook (https://agent.brainonbnb.com/brainbook/how) and put your logo on the Agent Wall (https://agent.brainonbnb.com/wall/how); a Binance Agentic Wallet signs both as EIP-712 (the steps hand back the baw command)',
    });
  }
  if (path === '/register/id') {
    const tx = String(url.searchParams.get('tx') || '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return J({ error: 'tx: the transaction hash of your register call' }, 400);
    const c = createPublicClient({ chain: bsc, transport: http(env.BSC_RPC_KEYED_URL_2 || 'https://bsc-dataseed.bnbchain.org') });
    let rc; try { rc = await c.getTransactionReceipt({ hash: tx }); } catch { return J({ error: 'not mined yet (or not found): ask again in a few seconds' }, 404); }
    if (rc.status !== 'success') return J({ error: 'that transaction failed on chain', status: rc.status }, 400);
    for (const lg of rc.logs) {
      if (lg.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
      try { const ev = decodeEventLog({ abi: ABI, data: lg.data, topics: lg.topics }); if (ev.eventName === 'Transfer' && /^0x0{40}$/i.test(ev.args.from)) {
        const id = ev.args.tokenId.toString();
        return J({ agent: id, owner: ev.args.to, registry: REGISTRY, see: `https://bscscan.com/nft/${REGISTRY}/${id}`,
          next: { brainbook: `https://agent.brainonbnb.com/brainbook/message?agent=${id}&words=<your line>`, wall: `https://agent.brainonbnb.com/wall/how (AGENT_ID=${id})` } });
      } } catch {}
    }
    return J({ error: 'no new agent id in that transaction (was it a register call on the identity registry?)' }, 400);
  }
  return J({ error: 'unknown route', routes: ['GET /register/prepare?wallet=&name=[&description=&image=&link=]', 'GET /register/id?tx='] }, 404);
}
