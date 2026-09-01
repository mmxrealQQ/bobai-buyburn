// The ERC-8004 ReputationRegistry on BNB Smart Chain: addresses, interface, and
// the one rule this project applies to what is in it.
//
// PROVENANCE OF THE INTERFACE — this changed on 1 September 2026.
// Until now the shape below was *recovered*: the published README names these
// functions without their types, every getSummary/readAllFeedback call we tried
// reverted, and the working signatures were found by calling the contract until
// something answered. That was honest but it was guesswork, and it was wrong in
// one place. The implementation behind the proxy is verified source, and it can
// be fetched:
//
//   https://sourcify.dev/server/v2/contract/56/<IMPLEMENTATION>?fields=abi,sources
//
// Reading it corrected two things we had published:
//   * `value` is int128, not uint128. Nothing on this chain is negative today,
//     so no number we ever printed was wrong — but the first negative rating
//     would have rendered as 3.4e38 instead of a minus sign.
//   * getSummary and readAllFeedback do not revert because we had the wrong
//     selector. They revert with "clientAddresses required" when handed an
//     empty client list. They work; we were calling them wrongly.
//
// Note the implementation address is often quoted with a broken checksum. The
// one below is the checksummed form; the lower-case comparison is what matters.
export const REPUTATION = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
export const IMPLEMENTATION = '0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34';
export const IDENTITY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

export const ABI_SOURCE = {
  what: 'verified implementation source behind the ERC-1967 proxy',
  contract: 'ReputationRegistryUpgradeable',
  compiler: '0.8.24+commit.e11b9ed9',
  at: `https://sourcify.dev/server/v2/contract/56/${IMPLEMENTATION}?fields=abi`,
  read_on: '2026-09-01',
};

export const REPUTATION_ABI = [
  { name: 'getClients', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'address[]' }] },
  { name: 'getLastIndex', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'clientAddress', type: 'address' }],
    outputs: [{ type: 'uint64' }] },
  { name: 'readFeedback', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'clientAddress', type: 'address' }, { name: 'feedbackIndex', type: 'uint64' }],
    outputs: [
      { name: 'value', type: 'int128' }, { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }, { name: 'isRevoked', type: 'bool' }] },
  { name: 'getSummary', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }],
    outputs: [
      { name: 'count', type: 'uint64' }, { name: 'summaryValue', type: 'int128' }, { name: 'summaryValueDecimals', type: 'uint8' }] },
  { name: 'giveFeedback', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'value', type: 'int128' }, { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' }, { name: 'feedbackHash', type: 'bytes32' }],
    outputs: [] },
  { name: 'revokeFeedback', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'feedbackIndex', type: 'uint64' }],
    outputs: [] },
  { name: 'getResponseCount', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'clientAddress', type: 'address' },
      { name: 'feedbackIndex', type: 'uint64' }, { name: 'responders', type: 'address[]' }],
    outputs: [{ name: 'count', type: 'uint64' }] },
  { name: 'appendResponse', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'clientAddress', type: 'address' }, { name: 'feedbackIndex', type: 'uint64' },
      { name: 'responseURI', type: 'string' }, { name: 'responseHash', type: 'bytes32' }],
    outputs: [] },
  { name: 'getIdentityRegistry', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

// The identity registry's guard, which giveFeedback consults. An agent's owner
// or an address it has approved cannot rate it — the contract's only rule about
// who may write.
export const IDENTITY_ABI = [
  { name: 'isAuthorizedOrOwner', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
];

// TWO KINDS OF CLAIM, AND THEY ARE NOT COMPARABLE.
//
// An uptime or a response time is a measurement: a third party can go and take
// it again, and disagree. A "personality" of 70 is a taste claim about somebody
// else's agent — unfalsifiable, and on this chain written in bulk with the same
// constant. Both live in the same registry, and a marketplace that adds them up
// publishes a reputation layer that does not exist.
//
// This set is why the reader separates them, and it is also the whitelist the
// writer enforces: we do not put a taste score on a public registry.
export const OPERATIONAL = new Set(['uptime', 'responsetime', 'latency', 'liveness']);
export const isOperational = (tag) => OPERATIONAL.has(String(tag || '').toLowerCase());

// A value only means something next to its unit, so the unit travels with it.
export const UNITS = { uptime: '%', liveness: '%', responsetime: 'ms', latency: 'ms' };
export const unitFor = (tag) => UNITS[String(tag || '').toLowerCase()] || '';
