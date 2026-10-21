// scripts/lib/agent-wallet-sig.mjs — the signature setAgentWallet wants from the NEW wallet (2026-10-21)
//
// IdentityRegistry.setAgentWallet(agentId, newWallet, deadline, signature) is sent by the agent's owner and carries an
// EIP-712 signature by newWallet, so nobody can point an agent at a wallet that did not agree. Both read from the chain
// on 21.10., not from documentation: the domain from eip712Domain() on 0x8004A169… (name ERC8004IdentityRegistry,
// version 1, chain 56, the proxy as verifying contract), the type by finding its hash in the implementation's bytecode
// (0x7274e874…): AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline).
// Used by scripts/set-venus-agent-wallets.mjs and proved on a fork by scripts/venus-work-fork-test.mjs.

export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const SET_AGENT_WALLET_ABI = [
  { name: 'setAgentWallet', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }, { name: 'signature', type: 'bytes' }], outputs: [] },
  { name: 'getAgentWallet', type: 'function', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
];

export function agentWalletSig(newWalletAccount, { agentId, owner, deadline }) {
  return newWalletAccount.signTypedData({
    domain: { name: 'ERC8004IdentityRegistry', version: '1', chainId: 56, verifyingContract: IDENTITY_REGISTRY },
    types: { AgentWalletSet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'AgentWalletSet',
    message: { agentId: BigInt(agentId), newWallet: newWalletAccount.address, owner, deadline: BigInt(deadline) },
  });
}
