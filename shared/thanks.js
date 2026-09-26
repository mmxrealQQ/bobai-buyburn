// A thank-you on every answer we give away (2026-09-26, the operator's idea).
//
// Everything BOBAI measures for other agents is free: no key, no account, no fee. Whoever calls it gets the
// same answer as anyone else, and with it one short note: thank you, and if it helped, a tip is welcome —
// voluntary, never required, and the answer does not change either way. The note is data, not an instruction:
// it tells the operator behind the caller where a tip would go and what it does there, nothing more.
//
// Where a tip goes is where our money already goes (see the money flow in shared/lp-agent.js): an x402 tip lands
// in the x402 wallet the paid services use and the DeFi agent's daily sweep takes it; BNB sent straight to the
// DeFi agent's wallet is picked up by its deposit watch. Either way it works in its PancakeSwap pool, and half
// of what that pool earns buys $BOBAI the agent keeps. ONE SOURCE: the worker at brainonbnb.com (REST + MCP) and
// the agent server at agent.brainonbnb.com both import this object; neither re-words it.

export const DEFI_WALLET = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
export const BOBAI_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';

export const THANKS = Object.freeze({
  note: 'Thank you for using BOBAI. This answer is free: no key, no account, no fee. If it helped you, a tip is welcome, entirely voluntary and never required. The answer is the same either way.',
  tip: {
    x402: 'https://agent.brainonbnb.com/tip?usd=1',
    x402_how: 'An x402 client tips in one step: that URL answers 402, the amount is yours to set with ?usd= (0.10 to 1000), paid in USDC or USD1 on BNB Smart Chain.',
    or_bnb_to: DEFI_WALLET,
    what_it_does: "Either way it ends up with BOBAI's DeFi agent, which puts it to work in its PancakeSwap pool; half of what the pool earns buys $BOBAI that the agent keeps.",
  },
  bobai: {
    token: BOBAI_TOKEN,
    what_it_is: 'The token of the project that runs these tools. Every trade pays 3% tax, split on-chain: BOBAI bought back and burned, liquidity added and burned, the DeFi agent and more.',
    pancakeswap: `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${BOBAI_TOKEN}`,
  },
  by: 'BOBAI · https://brainonbnb.com',
});

// The same in one line, for an HTTP header and for places where a JSON field does not fit.
export const THANKS_LINE = `Free to use. A voluntary tip is welcome, never required: x402 at https://agent.brainonbnb.com/tip or BNB to ${DEFI_WALLET}. brainonbnb.com`;

// Adds the note to an answer that is a plain JSON object; anything else (a bare number, a list, a string) is
// returned untouched, because callers parse those exactly as they are.
export function withThanks(out) {
  return out && typeof out === 'object' && !Array.isArray(out) ? { ...out, _thanks: THANKS } : out;
}
