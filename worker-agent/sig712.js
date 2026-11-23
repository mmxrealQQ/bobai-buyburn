// TWO WAYS TO SIGN THE SAME MESSAGE (2026-11-23, operator: "make it work with the Binance Agentic Wallet too — Brainbook
// entries and the Wall"). The Binance Agentic Wallet (CLI `baw sign-message`) signs EIP-712 typed data only, no
// personal_sign. So the Brainbook and the Agent Wall take either:
//   eip191  personal_sign over the message text (as since 22.11.)
//   eip712  the SAME message text as the one field of a typed struct:
//           domain { name: "BOBAI Brainbook" | "BOBAI Agent Wall", version: "1", chainId: 56 }
//           Signed { string message }
// The text a reader sees and checks stays the same; only the envelope differs. Readers' browsers recompute either hash
// (brainbook.html / wall.html), so nothing is taken on trust.
import { verifyMessage, verifyTypedData } from 'viem';

export const DOMAIN_NAME = { brainbook: 'BOBAI Brainbook', wall: 'BOBAI Agent Wall' };

export function typedFor(kind, message) {
  return {
    domain: { name: DOMAIN_NAME[kind], version: '1', chainId: 56 },
    types: { Signed: [{ name: 'message', type: 'string' }] },
    primaryType: 'Signed',
    message: { message },
  };
}

// the JSON a wallet's eth_signTypedData_v4 takes (EIP712Domain spelled out, as wallets want it)
export function typedJson(kind, message) {
  const t = typedFor(kind, message);
  return { types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }], ...t.types }, domain: t.domain, primaryType: t.primaryType, message: t.message };
}

// what to run with a Binance Agentic Wallet (the wrapper the CLI asks for: an eth_signTypedData_v4 JSON-RPC request)
export function bawFor(kind, message, signer = '<your agentic wallet address>') {
  const wrapper = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(typedJson(kind, message))] });
  return {
    preview: `baw sign-message preview --binanceChainId 56 --signType EIP712 --message '${wrapper.replace(/'/g, "'\\''")}' --json`,
    execute: 'baw sign-message execute --requestId <the requestId from preview> --json',
    then: 'send the signature with "sig_type": "eip712"',
  };
}

export const SIG_TYPES = ['eip191', 'eip712'];
export const normSigType = (v) => (String(v || 'eip191').toLowerCase().replace(/[^a-z0-9]/g, '') === 'eip712' ? 'eip712' : 'eip191');

export async function verifySigned({ kind, signer, message, signature, sigType }) {
  try {
    if (normSigType(sigType) === 'eip712') return await verifyTypedData({ address: signer, signature, ...typedFor(kind, message) });
    return await verifyMessage({ address: signer, message, signature });
  } catch { return false; }
}
