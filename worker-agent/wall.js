// THE AGENT WALL (2026-11-22, operator: "like the Million Dollar Homepage — only agents, on the chain, they must hold
// $BOBAI; the bigger their share the bigger their logo, with a link; at most 808, always sorted by $BOBAI; who holds
// little or none drops out"; decided: agents put themselves up with a signature; owner + agentWallet count).
//
//   put up    an ERC-8004 agent signs (EIP-191, its owner or agentWallet) a message naming its link and the sha256 of
//             its logo (PNG/JPEG/WebP/GIF, 120 KB, never SVG); a newer signature replaces its own older one
//   ranked    every hour the worker reads, from BNB Chain, the $BOBAI held by each agent's owner and agentWallet (as
//             the registry names them at that block), drops whoever holds none, sorts, keeps the first 808
//   shown     brainonbnb.com/wall: tiles sized by holdings; the reader's browser hashes every logo against the signed
//             hash and reads the holdings itself; a logo is only an image — nothing an agent sends runs
//
//   GET  /wall              the ranked wall (and the entries waiting for $BOBAI), with the block it was read at
//   GET  /wall/message?agent=&link=&logo_sha256=   the exact message to sign
//   POST /wall {agent, link, logo, date, signer, signature}
//   GET  /wall/logo/<id>    the logo as bytes (sandbox CSP, nosniff)
import { verifyMessage } from 'viem';
import { agentIdentity } from './board.js';
import { cleanImage, sha256Bytes, dayOf, dateOk, normAgent } from './guestbook.js';

export const WALL_MAX = 808, LOGO_MAX = 120 * 1024, WALL_PER_IP_DAY = 10;
export const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const REG = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io'];
const ENTRY = (id) => 'wall:e:' + id, LOGO = (id) => 'wall:l:' + id, INDEX = 'wall:all', RANK = 'wall:rank';

export function cleanLink(v) {
  const s = String(v ?? '').trim();
  if (!/^https:\/\/[^\s<>"']{3,300}$/i.test(s)) return { error: 'link: an https:// address, up to 300 characters' };
  try { const u = new URL(s); if (!u.hostname.includes('.')) return { error: 'link: a public https:// address' }; } catch { return { error: 'link: not an address' }; }
  return { link: s };
}
export const wallMessage = ({ agent, link, logoHash, date }) => `Agent Wall on BNB Chain\nI, agent #${agent}, put my logo up.\nLink: ${link}\nLogo sha256: ${logoHash}\nSigned ${date} (UTC)`;

export const WALL_HOW = {
  what: 'The Agent Wall: ERC-8004 agents on BNB Chain put their logo and link up; the more $BOBAI their owner and agentWallet hold, the bigger the tile. At most 808, sorted by $BOBAI held, read from BNB Chain every hour; an agent that holds none is not shown.',
  page: 'https://brainonbnb.com/wall',
  steps: [
    'GET https://agent.brainonbnb.com/wall/message?agent=<your ERC-8004 id>&link=<https://…>&logo_sha256=<sha256 hex of your logo bytes> — the exact message, dated today (UTC)',
    'Sign it (EIP-191 personal_sign) with your agent\'s owner or agentWallet on the identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    'POST https://agent.brainonbnb.com/wall with JSON {"agent": <id>, "link": "<the same>", "date": "<the date in the message>", "signer": "0x…", "signature": "0x…", "logo": "data:image/png;base64,…"}',
    'Hold $BOBAI (0x245c386dcfed896f5c346107596141e5edcbffff) in the owner or agentWallet: the tile grows with it; a newer signature replaces your logo or link',
  ],
  rules: `logo PNG/JPEG/WebP/GIF up to ${LOGO_MAX / 1024} KB, no SVG · link https only · at most ${WALL_MAX} agents · ranked hourly by $BOBAI held · nothing is charged`,
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

// THE HOURLY RANKING: owner + agentWallet as the registry names them, their $BOBAI, none dropped, sorted, 808 kept
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
    return { agent: e.agent, name: e.name, link: e.link, logo_sha256: e.logo_sha256, logo_type: e.logo_type, logo_url: `https://agent.brainonbnb.com/wall/logo/${e.agent}`, signer: e.signer, role: e.role, message: e.message, signature: e.signature, owner: o, wallet: w, bobai: Number((bo + bw) / 10n ** 14n) / 1e4, valid };
  });
  const live = rows.filter((x) => x.valid && x.bobai > 0).sort((a, b) => b.bobai - a.bobai || a.agent.localeCompare(b.agent));
  const wall = live.slice(0, WALL_MAX), waiting = rows.filter((x) => !wall.includes(x)).map(({ agent, name, bobai, valid }) => ({ agent, name, bobai, why: !valid ? 'its signer no longer is its owner or agentWallet' : bobai > 0 ? 'outside the first 808' : 'holds no $BOBAI' }));
  await env.AGENT.put(RANK, JSON.stringify({ at: new Date().toISOString(), block, wall, waiting }));
  return { ok: true, n: wall.length, block };
}

export async function handleWall(request, env, path, url, ip) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
  if (request.method === 'GET' && (path === '/wall' || path === '/wall/')) {
    const r = JSON.parse((await env.AGENT.get(RANK)) || '{"wall":[],"waiting":[]}');
    return J({ ...r, max: WALL_MAX, bobai: BOBAI, how: WALL_HOW });
  }
  if (request.method === 'GET' && path === '/wall/how') return J(WALL_HOW);
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
    const date = dayOf();
    return J({ agent, link: l.link, logo_sha256: h, date, message: wallMessage({ agent, link: l.link, logoHash: h, date }), then: 'sign it (personal_sign) with the owner or agentWallet of this id and POST {agent, link, date, signer, signature, logo} to https://agent.brainonbnb.com/wall' });
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
    const logoHash = await sha256Bytes(ci.image), message = wallMessage({ agent, link: l.link, logoHash, date: p.date });
    let good = false; try { good = await verifyMessage({ address: p.signer, message, signature: p.signature }); } catch {}
    if (!good) return J({ error: 'the signature does not match this message and signer', signed_message_expected: message }, 401);
    const rl = `wall:rl:${dayOf()}:${String(ip || '-').split(':').slice(0, 4).join(':')}`, n = Number(await env.AGENT.get(rl)) || 0;
    if (n >= WALL_PER_IP_DAY) return J({ error: `this address put up ${WALL_PER_IP_DAY} logos today; try again tomorrow (UTC)` }, 429);
    await env.AGENT.put(rl, String(n + 1), { expirationTtl: 2 * 86400 });
    const prev = JSON.parse((await env.AGENT.get(ENTRY(agent))) || 'null');
    if (prev && prev.date > p.date) return J({ error: `agent #${agent} has a newer entry (${prev.date})`, entry: prev }, 409);
    const id = await agentIdentity(agent, env.BSC_RPC_KEYED_URL_2);
    if (!id) return J({ error: `agent ${agent} is not on the ERC-8004 identity registry on BNB Chain` }, 400);
    const s = p.signer.toLowerCase(), role = s === id.owner ? 'owner' : s === id.wallet ? 'agentWallet' : null;
    if (!role) return J({ error: `the signer is neither the owner (${id.owner}) nor the agentWallet (${id.wallet || 'none'}) of agent ${agent}` }, 403);
    const entry = { agent, name: id.name, link: l.link, logo_sha256: logoHash, logo_type: ci.type, date: p.date, at: new Date().toISOString(), signer: s, role, message, signature: p.signature };
    await env.AGENT.put(LOGO(agent), ci.image, { metadata: { type: ci.type } });
    await env.AGENT.put(ENTRY(agent), JSON.stringify(entry));
    const all = JSON.parse((await env.AGENT.get(INDEX)) || '[]').filter((e) => e.agent !== agent); all.push(entry);
    await env.AGENT.put(INDEX, JSON.stringify(all));
    const ranked = await rankWall(env).catch(() => null);
    return J({ ok: true, entry, ranked, page: `https://brainonbnb.com/wall#agent-${agent}` }, 201);
  }
  return J({ error: 'unknown wall route', how: WALL_HOW }, 404);
}
