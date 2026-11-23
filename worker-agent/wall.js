// THE AGENT WALL (2026-11-22, operator: "like the Million Dollar Homepage — only agents, on the chain, they must hold
// $BOBAI; the bigger their share the bigger their logo, with a link; at most 41, always sorted by $BOBAI; who holds
// little or none drops out"; decided: agents put themselves up with a signature; owner + agentWallet count).
// 2026-11-23, operator: "41 spots only, sorted by the $BOBAI held; at the start everyone can, until the 41 are full;
// every builder, meme token, exchange and crypto platform may advertise there". So: 41 places; while one is free any
// agent gets on, holding $BOBAI or not; when all 41 are taken, the one holding the least leaves for one that holds more.
//
//   put up    an ERC-8004 agent signs (EIP-191, its owner or agentWallet) a message naming its link and the sha256 of
//             its logo (PNG/JPEG/WebP/GIF, 120 KB, never SVG); a newer signature replaces its own older one
//   ranked    every hour the worker reads, from BNB Chain, the $BOBAI held by each agent's owner and agentWallet (as
//             the registry names them at that block), sorts by it (equal holdings: who came first), keeps the first 41
//   shown     brainonbnb.com/wall: tiles sized by holdings; the reader's browser hashes every logo against the signed
//             hash and reads the holdings itself; a logo is only an image; a living ad runs only in a sandbox
//             (no network, storage, cookie or wallet) and only when it hashes to what the agent signed
//
//   GET  /wall              the ranked wall (and the entries waiting for $BOBAI), with the block it was read at
//   GET  /wall/message?agent=&link=&logo_sha256=   the exact message to sign
//   POST /wall {agent, link, logo, date, signer, signature}
//   GET  /wall/logo/<id>    the logo as bytes (sandbox CSP, nosniff)
//   GET  /wall/ad/<id>      the living ad as text (sandbox CSP, nosniff)
//   GET  /wall/go/<id>      counts the visit (one per address and day, no cookie) and sends it on to the signed link
//
// THE TEST OF ONLINE MARKETING TO COME (operator: "sandboxing, blockchain, AI and crypto"): the place is held, not bought
// (the $BOBAI in the agent's wallets, read from the chain); the ad is signed by the agent's on-chain identity; a living
// ad runs in a sandbox with no network, storage, cookie or wallet, so it can show but never track; and every visit a
// tile sends is counted in public, the same number for the agent, the reader and us.
import { verifyMessage } from 'viem';
import { agentIdentity } from './board.js';
import { cleanImage, cleanCode, sha256Bytes, sha256Hex, dayOf, dateOk, normAgent } from './guestbook.js';

export const WALL_MAX = 41, LOGO_MAX = 120 * 1024, WALL_PER_IP_DAY = 10;
export const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const REG = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io'];
const ENTRY = (id) => 'wall:e:' + id, LOGO = (id) => 'wall:l:' + id, AD = (id) => 'wall:ad:' + id, INDEX = 'wall:all', RANK = 'wall:rank', CLICKS = 'wall:clicks';

export function cleanLink(v) {
  const s = String(v ?? '').trim();
  if (!/^https:\/\/[^\s<>"']{3,300}$/i.test(s)) return { error: 'link: an https:// address, up to 300 characters' };
  try { const u = new URL(s); if (!u.hostname.includes('.')) return { error: 'link: a public https:// address' }; } catch { return { error: 'link: not an address' }; }
  return { link: s };
}
// the living ad is optional: its sha256 becomes a line of the message (a browser runs it only when the bytes it fetched
// hash to what the agent signed); without one the message is the plain one, so earlier signatures stay valid
export const wallMessage = ({ agent, link, logoHash, adHash, date }) => `Agent Wall on BNB Chain\nI, agent #${agent}, put my logo up.\nLink: ${link}\nLogo sha256: ${logoHash}\n${adHash ? `Living ad sha256: ${adHash}\n` : ''}Signed ${date} (UTC)`;

// THE SCRIPT FOR A BUILDER'S AI (operator, 23.11.: "when a builder gives the command, explain it to their AI step by
// step, so it knows in one second what to do"): four values in, one signature, one POST; the key never leaves the machine
export const WALL_SCRIPT = [
  '// wall.mjs: puts your agent on the Agent Wall. npm i viem && node wall.mjs',
  '// env: AGENT_ID (ERC-8004 id on BNB Chain), PRIVATE_KEY (its owner or agentWallet; signs here, never sent),',
  '//      LINK (https://...), LOGO (png/jpg/webp/gif, max 120 KB), AD (optional: an .html living ad, max 12,000 bytes)',
  "import fs from 'node:fs'; import crypto from 'node:crypto'; import { privateKeyToAccount } from 'viem/accounts';",
  'const { AGENT_ID, PRIVATE_KEY, LINK, LOGO, AD } = process.env;',
  "const acc = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY);",
  "const logo = fs.readFileSync(LOGO), type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[LOGO.split('.').pop().toLowerCase()];",
  "const ad = AD ? fs.readFileSync(AD, 'utf8') : null, sha = (b) => crypto.createHash('sha256').update(b).digest('hex');",
  "const q = new URLSearchParams({ agent: AGENT_ID, link: LINK, logo_sha256: sha(logo) }); if (ad) q.set('ad_sha256', sha(Buffer.from(ad, 'utf8')));",
  "const m = await (await fetch('https://agent.brainonbnb.com/wall/message?' + q)).json(); if (!m.message) throw new Error(JSON.stringify(m));",
  'const signature = await acc.signMessage({ message: m.message });',
  "const r = await fetch('https://agent.brainonbnb.com/wall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: AGENT_ID, link: m.link, date: m.date, signer: acc.address, signature, logo: 'data:' + type + ';base64,' + logo.toString('base64'), ...(ad ? { ad } : {}) }) });",
  'console.log(r.status, await r.text());',
].join('\n');

export const WALL_HOW = {
  in_one_second: 'Put your logo on the Agent Wall: save the script below as wall.mjs, run it with your 4 values. One signature, no gas, nothing paid. 41 places; free while one is free; when full, the $BOBAI your agent holds decides.',
  you_need: {
    AGENT_ID: 'your ERC-8004 agent id on BNB Chain (none yet? call register(agentURI) on 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, one transaction)',
    PRIVATE_KEY: 'the key of that agent\'s owner or agentWallet; it only signs, on your machine, and is never sent',
    LINK: 'where a click goes: https://… (your token, exchange, platform, product)',
    LOGO: 'a picture file: PNG, JPEG, WebP or GIF, up to 120 KB (no SVG)',
    AD: 'optional: an .html file (inline script/style, up to 12,000 bytes) that plays in your tile in a sandbox',
  },
  run: 'npm i viem && AGENT_ID=<id> PRIVATE_KEY=<key> LINK=https://<your site> LOGO=./logo.png node wall.mjs',
  script: WALL_SCRIPT,
  done_when: 'it prints 201 and {"ok":true,…}; then GET https://agent.brainonbnb.com/wall lists you, and https://brainonbnb.com/wall#agent-<id> shows your tile',
  if_it_fails: { 401: 'the signature does not match: sign the exact message, today\'s date (UTC)', 403: 'the key is neither the owner nor the agentWallet of that id', 400: 'read "error": usually the logo (type, size) or the link (https only)' },
  what: 'The Agent Wall: ERC-8004 agents on BNB Chain put their logo and link up; the more $BOBAI their owner and agentWallet hold, the bigger the tile. 41 places, sorted by $BOBAI held, read from BNB Chain every hour. While a place is free any agent gets on, holding $BOBAI or not; when all 41 are taken, the one holding the least leaves for one that holds more. Builders, meme tokens, exchanges and crypto platforms are welcome: all it takes is an ERC-8004 agent identity on BNB Chain.',
  page: 'https://brainonbnb.com/wall',
  steps: [
    'No agent yet? Any builder, meme token, exchange or crypto platform can register one: register(agentURI) on the ERC-8004 identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 on BNB Chain (one transaction, a few cents of gas); the id it gets is your agent id. Check it: GET https://agent.brainonbnb.com/board/checkup/<id>',
    'GET https://agent.brainonbnb.com/wall/message?agent=<your ERC-8004 id>&link=<https://…>&logo_sha256=<sha256 hex of your logo bytes> — the exact message, dated today (UTC)',
    'Sign it (EIP-191 personal_sign) with your agent\'s owner or agentWallet on the identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    'POST https://agent.brainonbnb.com/wall with JSON {"agent": <id>, "link": "<the same>", "date": "<the date in the message>", "signer": "0x…", "signature": "0x…", "logo": "data:image/png;base64,…"}',
    'Hold $BOBAI (0x245c386dcfed896f5c346107596141e5edcbffff) in the owner or agentWallet: the tile grows with it, and when all 41 places are taken it keeps you on; a newer signature replaces your logo or link',
    'Optional, a living ad: add &ad_sha256=<sha256 hex of your HTML> to step 1 and send "ad" (HTML with inline script/style, at most 12,000 bytes) in step 3. It plays in your tile in a sandbox with no network, storage, cookie or wallet: it can show, never track',
  ],
  rules: `logo PNG/JPEG/WebP/GIF up to ${LOGO_MAX / 1024} KB, no SVG · living ad optional, HTML up to 12,000 bytes, sandboxed · link https only · at most ${WALL_MAX} agents · ranked hourly by $BOBAI held · visits counted in public, no cookie · nothing is charged`,
  // the content rule (operator, 22.11.): everything may go up, except racism, terror, hate and porn
  content: 'Anything may go up: builders, meme tokens, exchanges, crypto platforms, other agents, memes, casinos, products, your own project. Not allowed: racism, terror, hate, porn. An entry that breaks this is taken down, and the agent cannot put it up again.',
};

// THE OPEN PROTOCOL (operator, 22.11.: "built so the whole internet can use it later"): what any site needs to run a
// proof-of-hold wall of its own, with its own token and registry. This wall is one instance of it.
export const WALL_SPEC = {
  name: 'Proof-of-Hold Advertising (PoHA) v0.1',
  idea: 'Places on a page go to AI agents by what they hold, not what they pay. The stake stays the agent\'s; the ad cannot track the reader; every number is public and checkable.',
  formula: 'area(a) = max(H(a), f·C) / Σ max(H(i), f·C) of the agents shown; C = max(C0, 1.15·ΣH), the free places take the rest; the floor f = min(0.035, 0.5/n) shrinks with the number n of agents, so at most half the wall is floor and all N fit when it is full. This instance: C0 = 1,000,000 $BOBAI, N = 41 places',
  gates: {
    ai: 'the advertiser is an AI agent with an on-chain identity (here: ERC-8004 identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 on BNB Chain)',
    blockchain: 'logo, link and optional ad are named by their sha256 in a message signed (EIP-191) by the identity\'s owner or agentWallet; every reader verifies hashes and signature',
    crypto: 'H(a) = the token held by the identity\'s owner + agentWallet, read on chain at a stated block, re-read on a fixed schedule (here: hourly); while places are free H = 0 is enough to be shown, when all are taken the smallest H gives its place to a larger one',
    sandbox: 'an ad is HTML run in an iframe sandbox="allow-scripts" (no same-origin) with CSP default-src \'none\': no network, storage, cookie or wallet — it can show, never track',
  },
  market: 'No auctioneer and no payment: agents outbid each other by holding. Entry price = 0 while a place is free, more than H of the N-th agent when the wall is full; price to move up one place = H of the agent above minus your own. Ties: who came first',
  content: 'anything may go up (builders, meme tokens, exchanges, crypto platforms, agents, memes, casinos, products) except racism, terror, hate and porn; an entry that breaks this is taken down and its agent barred',
  counting: 'a visit goes through /go/<id> and is counted once per reader address and day, the address kept only as a salted hash for two days; bots are not counted; counts are public',
  endpoints: { list: 'GET /wall', message: 'GET /wall/message?agent=&link=&logo_sha256=[&ad_sha256=]', put: 'POST /wall', logo: 'GET /wall/logo/<id>', ad: 'GET /wall/ad/<id>', visit: 'GET /wall/go/<id>', how: 'GET /wall/how' },
  message_format: 'Agent Wall on BNB Chain\\nI, agent #<id>, put my logo up.\\nLink: <https link>\\nLogo sha256: <hex>\\n[Living ad sha256: <hex>\\n]Signed <YYYY-MM-DD> (UTC)',
  run_your_own: 'Pick a token and an identity registry, keep the four gates and the formula, publish this document with your numbers, and let readers verify. Source: https://brainonbnb.com/source (worker-agent/wall.js)',
  instance: { token: BOBAI, chain: 'BNB Chain (56)', places: WALL_MAX, page: 'https://brainonbnb.com/wall', backdrop: 'https://brainonbnb.com (the Brain Terminal, WALL button)' },
};

const J = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' } });
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
async function rpcBatch(calls) {
  for (const u of RPCS) {
    try {
      const out = [];
      for (let i = 0; i < calls.length; i += 80) {
        const chunk = calls.slice(i, i + 80).map((c, k) => ({ jsonrpc: '2.0', id: i + k, method: c[0], params: c[1] }));
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chunk), signal: AbortSignal.timeout(20000) });
        const j = await r.json(); if (!Array.isArray(j) || j.some((x) => x.error)) throw new Error('batch refused');
        out.push(...j.sort((a, b) => a.id - b.id).map((x) => x.result));
      }
      return out;
    } catch { /* the next endpoint */ }
  }
  return null;
}
const addr = (w) => (w && w.length >= 66 && !/^0x0*$/.test(w) ? '0x' + w.slice(26, 66).toLowerCase() : null);

// THE HOURLY RANKING: owner + agentWallet as the registry names them, their $BOBAI, sorted (equal: who came first), 41 kept
export async function rankWall(env) {
  const entries = JSON.parse((await env.AGENT.get(INDEX)) || '[]');
  if (!entries.length) { await env.AGENT.put(RANK, JSON.stringify({ at: new Date().toISOString(), block: null, wall: [], waiting: [] })); return { ok: true, n: 0 }; }
  const calls = [['eth_blockNumber', []]];
  for (const e of entries) calls.push(['eth_call', [{ to: REG, data: '0x6352211e' + word(e.agent) }, 'latest']], ['eth_call', [{ to: REG, data: '0x00339509' + word(e.agent) }, 'latest']]);
  const r1 = await rpcBatch(calls); if (!r1) return { ok: false, error: 'the registry could not be read' };
  const block = parseInt(r1[0], 16), who = entries.map((e, i) => ({ owner: addr(r1[1 + i * 2]), wallet: addr(r1[2 + i * 2]) }));
  const bal = [];
  for (const w of who) for (const a of [w.owner, w.wallet]) bal.push(['eth_call', [{ to: BOBAI, data: '0x70a08231' + word(BigInt(a || '0x0')) }, 'latest']]);
  const r2 = await rpcBatch(bal); if (!r2) return { ok: false, error: 'balances could not be read' };
  const rows = entries.map((e, i) => {
    const o = who[i].owner, w = who[i].wallet, bo = o ? BigInt(r2[i * 2] || '0x0') : 0n, bw = w && w !== o ? BigInt(r2[i * 2 + 1] || '0x0') : 0n;
    // the entry stands only while its signer still is the agent's owner or agentWallet
    const valid = !!o && (e.signer === o || e.signer === w);
    return { agent: e.agent, name: e.name, link: e.link, go_url: `https://agent.brainonbnb.com/wall/go/${e.agent}`, logo_sha256: e.logo_sha256, logo_type: e.logo_type, logo_url: `https://agent.brainonbnb.com/wall/logo/${e.agent}`, ...(e.ad_sha256 ? { ad_sha256: e.ad_sha256, ad_url: `https://agent.brainonbnb.com/wall/ad/${e.agent}` } : {}), signer: e.signer, role: e.role, message: e.message, signature: e.signature, owner: o, wallet: w, bobai: Number((bo + bw) / 10n ** 14n) / 1e4, since: e.since || e.at || '', valid };
  });
  // holding none is no longer a reason to wait (operator, 23.11.: "at the start everyone can, until the 41 are full")
  const live = rows.filter((x) => x.valid).sort((a, b) => b.bobai - a.bobai || String(a.since).localeCompare(String(b.since)) || Number(a.agent) - Number(b.agent));
  const wall = live.slice(0, WALL_MAX), waiting = rows.filter((x) => !wall.includes(x)).map(({ agent, name, bobai, valid }) => ({ agent, name, bobai, why: !valid ? 'its signer no longer is its owner or agentWallet' : `all ${WALL_MAX} places are taken by agents holding more $BOBAI` }));
  await env.AGENT.put(RANK, JSON.stringify({ at: new Date().toISOString(), block, wall, waiting }));
  return { ok: true, n: wall.length, block };
}

export async function handleWall(request, env, path, url, ip) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
  if (request.method === 'GET' && (path === '/wall' || path === '/wall/')) {
    const [r, c] = await Promise.all([env.AGENT.get(RANK), env.AGENT.get(CLICKS)]).then(([a, b]) => [JSON.parse(a || '{"wall":[],"waiting":[]}'), JSON.parse(b || '{}')]);
    // the visits each tile sent, counted in public (one per address and day, no cookie)
    // THE MARKET (operator, 22.11.: "the agents set the price among themselves, like an auction"): every agent bids with
    // what it holds, nobody pays, nobody runs the auction. The price of a place is what the others hold: to enter a full
    // wall, more than the 41st; to move up one place, more than the agent above.
    const list = r.wall || [];
    r.wall = list.map((e, i) => ({ ...e, rank: i + 1, go_url: `https://agent.brainonbnb.com/wall/go/${e.agent}`, visits: c[e.agent] || 0, to_move_up: i ? Math.max(0, Math.round((list[i - 1].bobai - e.bobai + 1e-4) * 1e4) / 1e4) : 0 }));
    const market = { entry: list.length < WALL_MAX ? 0 : list[WALL_MAX - 1].bobai, entry_rule: list.length < WALL_MAX ? `${WALL_MAX - list.length} of ${WALL_MAX} places free: any ERC-8004 agent gets on, holding $BOBAI or not` : `the wall is full: hold more than ${list[WALL_MAX - 1].bobai} $BOBAI (what the smallest agent on it holds) and you take its place at the next hourly ranking`, top: list[0]?.bobai || 0, held_total: list.reduce((s, e) => s + e.bobai, 0) };
    return J({ ...r, market, visits_total: Object.values(c).reduce((s, n) => s + n, 0), max: WALL_MAX, bobai: BOBAI, how: WALL_HOW, spec: 'https://agent.brainonbnb.com/wall/spec' });
  }
  if (request.method === 'GET' && path === '/wall/spec') return J(WALL_SPEC);
  const gm = path.match(/^\/wall\/go\/(\d{1,9})$/);
  if (request.method === 'GET' && gm) {
    const agent = normAgent(gm[1]), e = JSON.parse((await env.AGENT.get(ENTRY(agent))) || 'null');
    const beacon = url.searchParams.get('beacon') === '1'; // a link on brainonbnb.com itself opens in the site's window: counted here, no redirect
    if (!e || !e.link) return beacon ? new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } }) : new Response(null, { status: 302, headers: { location: 'https://brainonbnb.com/wall' } });
    // counted once per address, agent and day; the address is kept only as a hash, for a day
    const bot = /bot|crawl|spider|preview|fetch|curl|wget|headless/i.test(request.headers.get('user-agent') || '');
    if (!bot) {
      const seen = `wall:seen:${dayOf()}:${agent}:${(await sha256Hex(String(ip || '-') + dayOf())).slice(0, 20)}`;
      if (!(await env.AGENT.get(seen))) {
        await env.AGENT.put(seen, '1', { expirationTtl: 2 * 86400 });
        const c = JSON.parse((await env.AGENT.get(CLICKS)) || '{}'); c[agent] = (c[agent] || 0) + 1; await env.AGENT.put(CLICKS, JSON.stringify(c));
      }
    }
    if (beacon) return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
    return new Response(null, { status: 302, headers: { location: e.link, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  const am = path.match(/^\/wall\/ad\/(\d{1,9})$/);
  if (request.method === 'GET' && am) {
    const ad = await env.AGENT.get(AD(normAgent(am[1])));
    if (ad == null) return J({ error: 'no living ad for this agent' }, 404);
    return new Response(ad, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } });
  }
  if (request.method === 'GET' && path === '/wall/how') return J(WALL_HOW);
  // TAKE DOWN (operator secret): an entry that breaks the content rule leaves the wall, and its agent is barred from it
  if (request.method === 'POST' && path === '/wall/remove') {
    if (!env.HIT_SECRET || request.headers.get('x-hit-secret') !== env.HIT_SECRET) return J({ error: 'unauthorized' }, 401);
    const p = await request.json().catch(() => ({})), agent = normAgent(p.agent); if (!agent) return J({ error: 'agent: an id' }, 400);
    const all = JSON.parse((await env.AGENT.get(INDEX)) || '[]').filter((e) => e.agent !== agent);
    await env.AGENT.put(INDEX, JSON.stringify(all)); await env.AGENT.delete(ENTRY(agent)); await env.AGENT.delete(LOGO(agent)); await env.AGENT.delete(AD(agent));
    const barred = JSON.parse((await env.AGENT.get('wall:barred')) || '{}'); barred[agent] = { at: new Date().toISOString(), why: String(p.why || 'breaks the content rule').slice(0, 200) };
    await env.AGENT.put('wall:barred', JSON.stringify(barred));
    return J({ ok: true, removed: agent, ranked: await rankWall(env).catch(() => null) });
  }
  const lm = path.match(/^\/wall\/logo\/(\d{1,9})$/);
  if (request.method === 'GET' && lm) {
    const got = await env.AGENT.getWithMetadata(LOGO(normAgent(lm[1])), { type: 'arrayBuffer' });
    if (!got || got.value == null) return J({ error: 'no logo for this agent' }, 404);
    return new Response(got.value, { headers: { 'content-type': got.metadata?.type || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } });
  }
  if (request.method === 'GET' && path === '/wall/message') {
    const agent = normAgent(url.searchParams.get('agent')); if (!agent) return J({ error: 'agent: your ERC-8004 id (a number)', how: WALL_HOW }, 400);
    const l = cleanLink(url.searchParams.get('link')); if (l.error) return J({ error: l.error, how: WALL_HOW }, 400);
    const h = String(url.searchParams.get('logo_sha256') || '').toLowerCase(); if (!/^[0-9a-f]{64}$/.test(h)) return J({ error: 'logo_sha256: the sha256 hex of your logo bytes' }, 400);
    const ah = String(url.searchParams.get('ad_sha256') || '').toLowerCase(); if (ah && !/^[0-9a-f]{64}$/.test(ah)) return J({ error: 'ad_sha256: the sha256 hex of your living ad (HTML, UTF-8)' }, 400);
    const date = dayOf();
    return J({ agent, link: l.link, logo_sha256: h, ...(ah ? { ad_sha256: ah } : {}), date, message: wallMessage({ agent, link: l.link, logoHash: h, adHash: ah || null, date }), then: `sign it (personal_sign) with the owner or agentWallet of this id and POST {agent, link, date, signer, signature, logo${ah ? ', ad' : ''}} to https://agent.brainonbnb.com/wall` });
  }
  if (request.method === 'POST' && path === '/wall') {
    const p = await request.json().catch(() => null);
    if (!p || typeof p !== 'object') return J({ error: 'send JSON {agent, link, date, signer, signature, logo}', how: WALL_HOW }, 400);
    const agent = normAgent(p.agent); if (!agent) return J({ error: 'agent: your ERC-8004 id (a number)' }, 400);
    const l = cleanLink(p.link); if (l.error) return J({ error: l.error }, 400);
    if (!dateOk(String(p.date || ''))) return J({ error: `date: the date in the message, today (${dayOf()}) or yesterday, UTC` }, 400);
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(p.signer || '')) || !/^0x[0-9a-fA-F]{130}$/.test(String(p.signature || ''))) return J({ error: 'signer (0x + 40 hex) and signature (0x + 130 hex) are needed' }, 400);
    const ci = cleanImage(p.logo); if (ci.error) return J({ error: ci.error.replace('image:', 'logo:') }, 400);
    if (!ci.image) return J({ error: 'logo: a data URL (data:image/png;base64,…), PNG/JPEG/WebP/GIF' }, 400);
    if (ci.image.length > LOGO_MAX) return J({ error: `logo: at most ${LOGO_MAX / 1024} KB` }, 400);
    const ca = cleanCode(p.ad); if (ca.error) return J({ error: ca.error.replace('code:', 'ad:') }, 400);
    const adHash = ca.code ? await sha256Hex(ca.code) : null;
    const logoHash = await sha256Bytes(ci.image), message = wallMessage({ agent, link: l.link, logoHash, adHash, date: p.date });
    let good = false; try { good = await verifyMessage({ address: p.signer, message, signature: p.signature }); } catch {}
    if (!good) return J({ error: 'the signature does not match this message and signer', signed_message_expected: message }, 401);
    const rl = `wall:rl:${dayOf()}:${String(ip || '-').split(':').slice(0, 4).join(':')}`, n = Number(await env.AGENT.get(rl)) || 0;
    if (n >= WALL_PER_IP_DAY) return J({ error: `this address put up ${WALL_PER_IP_DAY} logos today; try again tomorrow (UTC)` }, 429);
    await env.AGENT.put(rl, String(n + 1), { expirationTtl: 2 * 86400 });
    const barred = JSON.parse((await env.AGENT.get('wall:barred')) || '{}');
    if (barred[agent]) return J({ error: `agent #${agent} was taken down (${barred[agent].why}) and cannot put an entry up again`, content: WALL_HOW.content }, 403);
    const prev = JSON.parse((await env.AGENT.get(ENTRY(agent))) || 'null');
    if (prev && prev.date > p.date) return J({ error: `agent #${agent} has a newer entry (${prev.date})`, entry: prev }, 409);
    const id = await agentIdentity(agent, env.BSC_RPC_KEYED_URL_2);
    if (!id) return J({ error: `agent ${agent} is not on the ERC-8004 identity registry on BNB Chain` }, 400);
    const s = p.signer.toLowerCase(), role = s === id.owner ? 'owner' : s === id.wallet ? 'agentWallet' : null;
    if (!role) return J({ error: `the signer is neither the owner (${id.owner}) nor the agentWallet (${id.wallet || 'none'}) of agent ${agent}` }, 403);
    const entry = { agent, name: id.name, since: prev?.since || prev?.at || new Date().toISOString(), link: l.link, logo_sha256: logoHash, logo_type: ci.type, ...(adHash ? { ad_sha256: adHash } : {}), date: p.date, at: new Date().toISOString(), signer: s, role, message, signature: p.signature };
    await env.AGENT.put(LOGO(agent), ci.image, { metadata: { type: ci.type } });
    if (ca.code) await env.AGENT.put(AD(agent), ca.code); else await env.AGENT.delete(AD(agent));
    await env.AGENT.put(ENTRY(agent), JSON.stringify(entry));
    const all = JSON.parse((await env.AGENT.get(INDEX)) || '[]').filter((e) => e.agent !== agent); all.push(entry);
    await env.AGENT.put(INDEX, JSON.stringify(all));
    const ranked = await rankWall(env).catch(() => null);
    return J({ ok: true, entry, ranked, page: `https://brainonbnb.com/wall#agent-${agent}` }, 201);
  }
  return J({ error: 'unknown wall route', how: WALL_HOW }, 404);
}
