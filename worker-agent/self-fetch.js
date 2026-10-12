// A CALL TO OUR OWN HOST GOES IN, NOT OUT (2026-10-12): a Worker cannot fetch its own custom domain — every call this
// worker made to agent.brainonbnb.com (our own agents' A2A endpoints) came back 522. The listing check refused our
// DeFi agent as "did not answer" while it answered everyone else, and the daily pulse would have drawn our agents as
// down. A URL on this worker's own host is handed to its SELF service binding (wrangler.toml); everything else is a
// plain fetch. The binding is set once per invocation by index.js (bindSelf).
const OWN_HOST = 'agent.brainonbnb.com';
let SELF = null;
export const bindSelf = (env) => { if (env?.SELF) SELF = env.SELF; };
export function netFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  try { if (SELF && new URL(url).host === OWN_HOST) return SELF.fetch(new Request(url, init)); } catch {}
  return fetch(input, init);
}
