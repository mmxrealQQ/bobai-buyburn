// What this agent is allowed to spend — read from the chain, not from us.
//
// Every other page in this project that says "the agent may only do X" is us
// saying it. This one is different: an Altana session writes its public key
// into the on-chain KeyStore, and the account contract refuses anything outside
// the granted scope at validation time. So the authority is a fact a stranger
// can check with three view calls, and this endpoint makes the same three calls
// rather than reporting what our own config file believes.
//
// The distinction matters more than it sounds. A marketplace where agents spend
// money on your behalf has to answer "what can this thing do to my funds?", and
// "trust our documentation" is not an answer. isValidKey() is.
//
//   GET /session            both chains
//   GET /session?chain=97   one of them
//
// Reads only. Revocation needs the wallet's admin key and is deliberately not
// reachable from a public endpoint — see the note at the bottom.

// KeyStore, from the Altana deployment manifests the SDK ships
// (@altananetwork/sdk/dist/config.js). Kept here as literals because this
// worker has no dependencies by design; if Altana redeploys, these move.
export const ALTANA_NETWORKS = {
  56: {
    name: 'BNB Smart Chain',
    keyStore: '0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a',
    explorer: 'https://bscscan.com',
    rpcs: ['https://bsc.publicnode.com', 'https://bsc-dataseed1.defibit.io'],
    kernel: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6',
    paymentToken: '0xcE24439F2D9C6a2289F741120FE202248B666666',
  },
  97: {
    name: 'BNB Smart Chain Testnet',
    keyStore: '0x6b8361C29d05D498b1a12B54A37310f94171E94A',
    explorer: 'https://testnet.bscscan.com',
    rpcs: ['https://bsc-testnet-rpc.publicnode.com', 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'],
    kernel: '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE',
    paymentToken: '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565',
  },
};

// Selectors computed from the signatures rather than copied from anywhere:
//   getKeys(address)                 0x34e80c34
//   isValidKey(address,bytes32)      0x8fd4f06b
//   getPublicKey(address,bytes32)    0x7cefdd5d
// Verified against the KeyStore ABI the SDK ships in dist/internal/keystore.js.
// A wrong selector here does not throw — it calls a different function or none,
// and an empty return decodes cleanly as "no keys registered", which is the
// answer that would let an unlimited session pass for a revoked one.
const SEL_GET_KEYS = '0x34e80c34';
const SEL_IS_VALID = '0x8fd4f06b';
const SEL_GET_PUBKEY = '0x7cefdd5d';

const pad = (hexOrAddr) => String(hexOrAddr).replace(/^0x/, '').toLowerCase().padStart(64, '0');

async function call(rpcs, to, data) {
  let last;
  for (const endpoint of rpcs) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message); continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('no endpoint answered');
}

// A bytes32[] returned by eth_call: offset, length, then the words.
function decodeBytes32Array(hex) {
  const h = String(hex || '').replace(/^0x/, '');
  if (h.length < 128) return [];
  const len = parseInt(h.slice(64, 128), 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push('0x' + h.slice(128 + i * 64, 128 + (i + 1) * 64));
  return out;
}

/**
 * Reads one chain's KeyStore for a wallet.
 *
 * An unreadable chain is reported as unreadable. It is never reported as "no
 * session": those two look identical in a UI that renders both as an empty
 * list, and the difference is exactly the one a person checking their agent's
 * spending authority needs.
 */
export async function readSessionState(chainId, wallet) {
  const net = ALTANA_NETWORKS[chainId];
  if (!net) return { chainId, error: 'unknown chain' };
  if (!wallet) return { chainId, chain: net.name, wallet: null, state: 'no agent wallet configured on this chain' };

  try {
    const raw = await call(net.rpcs, net.keyStore, SEL_GET_KEYS + pad(wallet));
    const keyIds = decodeBytes32Array(raw);
    const keys = [];
    for (const keyId of keyIds) {
      let valid = null;
      try {
        const v = await call(net.rpcs, net.keyStore, SEL_IS_VALID + pad(wallet) + keyId.replace(/^0x/, ''));
        valid = BigInt(v || '0x0') === 1n;
      } catch { valid = null; }
      keys.push({
        keyId,
        // null is its own answer: the key exists in the registry and we could
        // not determine its validity. Rendering that as "revoked" would be a
        // lie in the safe-looking direction, which is still a lie.
        valid,
        keystore_entry: `${net.explorer}/address/${net.keyStore}`,
      });
    }
    return {
      chainId, chain: net.name, wallet,
      keystore: net.keyStore,
      registered_keys: keys.length,
      keys,
      state: keys.length === 0
        ? 'no session key registered for this wallet'
        : `${keys.filter((k) => k.valid === true).length} of ${keys.length} registered keys are currently valid`,
      verify_it_yourself: {
        contract: net.keyStore,
        call: `getKeys(${wallet}) then isValidKey(${wallet}, keyId)`,
        note: 'Both are view calls against the KeyStore. Nothing here comes from our own state.',
      },
    };
  } catch (e) {
    return { chainId, chain: net.name, wallet, error: `KeyStore unreadable: ${e.message || e}` };
  }
}

export async function handleSession(url, env) {
  // The agent's Altana wallet address is public — it is an address. It lives in
  // an env var rather than a literal so a re-created wallet does not need a
  // code change.
  const wallet = env.ALTANA_AGENT_WALLET || null;
  const want = url.searchParams.get('chain');
  const chains = want ? [Number(want)] : [56, 97];

  const states = [];
  for (const c of chains) states.push(await readSessionState(c, wallet));

  return {
    what_this_is: 'The spending authority delegated to this agent, read live from the Altana KeyStore on-chain. Not a description of our configuration — the same view calls a stranger would make.',
    why_it_exists: 'An agent that can spend needs limits somebody else can verify. An Altana session carries an allowlist of contracts, a rolling spend cap per token and an expiry; the account contract enforces them at validation, so a call outside the scope reverts rather than being caught by our code.',
    agent_wallet: wallet,
    chains: states,
    revocation: {
      how: 'The wallet\'s admin key revokes; the effect is immediate and the KeyStore entry stops validating.',
      why_not_here: 'The admin key is not on this worker and no public endpoint can trigger a revoke. An endpoint that could would be a way for a stranger to disable the agent, which is a denial-of-service dressed as a safety feature.',
      command: 'node scripts/altana-session.mjs --revoke --confirm',
    },
    measured_at: new Date().toISOString(),
  };
}
