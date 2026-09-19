// The agent ids we own, and the domain proof built from them — one copy.
//
// An ERC-8004 registration is only half a claim. The other half is this file:
// the origin an agent names has to answer /.well-known/agent-registration.json
// listing that id, or the agent is anonymous whatever its on-chain document
// says. Two origins serve that proof — brainonbnb.com and agent.brainonbnb.com,
// because a verifier fetches whichever host the agent named — and until now
// each one carried its own literal copy of the list, with a comment in both
// asking the next person to remember the other. A list kept in step by a
// comment is a list that drifts, and the failure is silent: the id verifies on
// one host and reads as unattributable on the other.
//
// data/own-agents.json remains the receipt — written by the registration
// script, one entry per on-chain tx. This file is what the workers serve, and
// scripts/dispatch-safety.mjs checks the two against each other on both
// origins, so a divergence fails a test instead of going unnoticed.

// The registry the ids live in. CAIP-10 style, as ERC-8004 wants it.
export const AGENT_REGISTRY = 'eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// The agents we run ourselves. These ids appear in the domain proof on two
// origins, in the telemetry document, in the registry page's live-line mapping
// and in two check scripts.
export const OWN_AGENT_IDS = [302257, 302258, 304493, 304494, 310460];

// The parent identity — the operator itself, registered long before the
// hireable four. It belongs in the domain proof but not in the per-agent
// telemetry, which is why the two lists are not the same length.
export const PARENT_AGENT_ID = 49467;

// Everything this operator claims on-chain, in the shape the proof document
// wants. Parent first: it is the id a reader recognises.
export const PROOF_IDS = [PARENT_AGENT_ID, ...OWN_AGENT_IDS];

// The registries a reader can check us against, one copy for every card that
// declares them (2026-09-19: the agent origin's card carried them as literals,
// the apex card — the one #49467 names on chain — carried none).
export const TRUST_REGISTRIES = {
  identity: AGENT_REGISTRY,
  reputation: 'eip155:56:0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
};

export const registrations = () =>
  PROOF_IDS.map((agentId) => ({ agentId, agentRegistry: AGENT_REGISTRY }));
