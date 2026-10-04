// Where the agent side stands, read live — and what to do next.
//
// Operator, 2026-10-04: "submitted does not mean done — that is when the
// building starts. We have to know where we are and what to do to get
// better." So this reads every outside verdict and our own records in one go,
// prints them as PASS / OPEN lines, and ends with the next steps it can derive.
// Run at the start of every agent session: node scripts/agent-status.mjs
//
// Sources (all public, no keys): Marque phase-2 API, Mandate quest/qualify
// API, our /stats/detail (rolled up since 4.10.), /jobs/own, /jobs/watch,
// the kernel via our own job reader, the registry (ownerOf, getAgentWallet).
import { createPublicClient, http, parseAbi, formatUnits, formatEther } from 'viem';
import { bsc } from 'viem/chains';

const CAMPAIGN = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
const PROVIDER = '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963';
const DEFI = 363709;
const OURS = [363709, 302257, 302258, 304493, 304494, 310460];
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const U = '0xcE24439F2D9C6a2289F741120FE202248B666666';
const AG = 'https://agent.brainonbnb.com';
const pub = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed1.defibit.io') });
const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); return r.ok ? await r.json() : null; } catch { return null; } };
const todo = [];
let open = 0;
const line = (ok, label, detail = '') => { if (!ok) open++; console.log(`${ok ? 'PASS' : 'OPEN'}  ${label}${detail ? ' — ' + detail : ''}`); };
const head = (t) => console.log(`\n== ${t}`);

head('Set and Earn — campaign wallet ' + CAMPAIGN.slice(0, 6) + '…' + CAMPAIGN.slice(-4) + ' (ends 2026-11-05 12:00 UTC)');
const ABI = parseAbi(['function ownerOf(uint256) view returns (address)', 'function getAgentWallet(uint256) view returns (address)', 'function balanceOf(address) view returns (uint256)']);
const [owner, aw] = await Promise.all([
  pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [BigInt(DEFI)] }),
  pub.readContract({ address: REGISTRY, abi: ABI, functionName: 'getAgentWallet', args: [BigInt(DEFI)] }),
]);
line(owner.toLowerCase() === CAMPAIGN.toLowerCase(), `#${DEFI} owned by the campaign wallet`, owner);
line(aw.toLowerCase() === PROVIDER.toLowerCase(), `#${DEFI} agentWallet = provider (signs quotes and deliveries)`, aw);
const mq = (await get(`https://marque.trade/api/v1/phase2/wallet/${CAMPAIGN}`)) || {};
const mdq = (await get(`https://www.mandatemarkets.com/api/v1/quest/${CAMPAIGN}`))?.data || {};
const hires = mq.hires || [];
const viaMarque = hires.filter((h) => h.marque).length;
const agentsHired = new Set([...hires.map((h) => h.agent?.agentId), ...(mdq.agentsHired || []).map((a) => a.agentId)].filter(Boolean));
line(agentsHired.size >= 3, 'hire: 3 different agents', `${agentsHired.size} (${[...agentsHired].join(', ')})`);
line(viaMarque >= 1 && (mdq.here?.hires || 0) >= 1, 'hire: on 2 marketplaces', `Marque ${viaMarque} own-flow, Mandate ${mdq.here?.hires || 0}`);
const qual = (await get(`https://www.mandatemarkets.com/api/v1/qualify/${DEFI}`))?.data;
for (const c of qual?.checks || []) line(c.state === 'pass', `build (Mandate's mirror of BNB's six): ${c.id}`, c.detail.slice(0, 150));
if (qual && !(qual.wallets || []).map((w) => w.toLowerCase()).includes(CAMPAIGN.toLowerCase())) todo.push(`Mandate still reads #${DEFI}'s wallets as ${qual.wallets.join(', ')} — refresh: curl -X POST ${'https://www.mandatemarkets.com/api/v1/list'} -d '{"tokenId":"${DEFI}"}'`);
const hiredCheck = qual?.checks?.find((c) => c.id === 'hired');
if (hiredCheck && hiredCheck.state !== 'pass') todo.push('3 completed hires of #363709 from outside wallets (not funded by us) — the operator decides how to ask; no TG post (4.10.)');
line(false, 'registration form submitted', 'not machine-checkable — confirm with the operator once: https://forms.gle/jzTajVNZEgukeoYT9');

head('Marketplace listings of our agents');
const mdRungs = {};
for (const q of ['hireable=1&limit=100', 'all=1&limit=200', 'all=1&limit=200&offset=200']) {
  for (const x of ((await get(`https://www.mandatemarkets.com/api/v1/agents?${q}`))?.data?.agents) || []) mdRungs[String(x.tokenId)] = `${x.rung} ${x.rungName}`;
}
const mo = (await get(`https://marque.trade/api/v1/phase2/owner/${PROVIDER}`))?.agents || [];
const mo2 = (await get(`https://marque.trade/api/v1/phase2/owner/${CAMPAIGN}`))?.agents || [];
for (const id of OURS) {
  const a = [...mo2, ...mo].find((x) => String(x.agentId) === String(id) && x.quality?.checks?.[0]?.pass !== false) || [...mo2, ...mo].find((x) => String(x.agentId) === String(id));
  const md = (await get(`https://www.mandatemarkets.com/api/v1/qualify/${id}`))?.data;
  const live = md?.checks?.find((c) => c.id === 'live')?.state;
  line(!!a?.listedOnMarque && live === 'pass', `#${id} ${a?.name || md?.name || ''}`, `Marque ${a ? (a.listedOnMarque ? 'listed ' + a.quality?.passed + '/5' : 'NOT listed: ' + (a.quality?.checks || []).filter((c) => !c.pass).map((c) => c.id + ' ' + (c.reason || '').slice(0, 70)).join('; ')) : 'unknown'} · Mandate live ${live || '?'}, rung ${mdRungs[String(id)] || '?'}`);
  if (a && !a.listedOnMarque) todo.push(`#${id}: Marque listing — ${(a.quality?.checks || []).filter((c) => !c.pass).map((c) => c.reason).join('; ').slice(0, 160)}`);
}

head('Dolphin (lists ERC-8004 agents that answer its check, by itself)');
{
  const dl = [...(((await get(`https://www.dolphinamp.xyz/api/v1/agents?owner=${PROVIDER}`))?.agents) || []), ...(((await get(`https://www.dolphinamp.xyz/api/v1/agents?owner=${CAMPAIGN}`))?.agents) || [])];
  for (const id of OURS) {
    const a = dl.find((x) => String(x.tokenId) === String(id));
    line(!!a?.listed, `#${id} on Dolphin`, a ? `${a.status}, listed since ${String(a.listedSince || '').slice(0, 10)}, ${a.category}` : 'not indexed yet');
  }
}

head('8004scan (the explorer most people check)');
for (const id of OURS) {
  const a = (await get(`https://8004scan.io/api/v1/public/agents/56/${id}`))?.data;
  const sv = a?.scores?.breakdown?.dimensions?.service;
  line(!!sv && sv.score >= 60, `#${id} service score`, sv ? `${Math.round(sv.score)} · ${sv.details?.health_status} / ${sv.details?.integrity_tier} · checked ${String(a.updated_at || '').slice(0, 16)}` : 'not indexed yet');
}

head('Real use today (rolled-up /stats/detail)');
const day = new Date().toISOString().slice(0, 10);
const det = (await get(`${AG}/stats/detail?day=${day}&r=${Date.now()}`)) || { names: {} };
let use = 0, menu = 0; const uses = [];
for (const [k, v] of Object.entries(det.names)) {
  if (/^(mcp|paidmcp):(tools_)?call:|^rest:ext:|^sell:answer:[a-z_]+:paid|^sell:watch:paid/.test(k)) { use += v; uses.push(`${k.replace(/^rest:ext:|^mcp:call:/, '')} ${v}`); }
  else if (/^mcp:(initialize|tools_list|prompts_list|resources_list)$|^paidmcp:tools_list$/.test(k)) menu += v;
}
line(!det.truncated, 'the day is counted whole', `${det.isolates} isolates, ${det.rolled_up} rolled up${det.truncated ? ', TRUNCATED' : ''}`);
console.log(`      tool calls by others: ${use}  (${uses.join(', ') || 'none'})`);
console.log(`      menu checks by registries: ${menu} · crawler hits on unknown paths: ${det.names['rest:unknown'] || 0}`);
console.log(`      paid path: ${Object.entries(det.names).filter(([k]) => k.startsWith('sell:') || k.startsWith('paidmcp:')).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'}`);

head('Earnings and jobs');
const [uProv, uCamp, bnbProv, bnbCamp] = await Promise.all([
  pub.readContract({ address: U, abi: ABI, functionName: 'balanceOf', args: [PROVIDER] }),
  pub.readContract({ address: U, abi: ABI, functionName: 'balanceOf', args: [CAMPAIGN] }),
  pub.getBalance({ address: PROVIDER }), pub.getBalance({ address: CAMPAIGN }),
]);
console.log(`      provider ${formatUnits(uProv, 18)} $U, ${Number(formatEther(bnbProv)).toFixed(5)} BNB · campaign ${formatUnits(uCamp, 18)} $U, ${Number(formatEther(bnbCamp)).toFixed(5)} BNB`);
line(Number(formatEther(bnbProv)) > 0.0015, 'provider has gas for deliveries', `${Number(formatEther(bnbProv)).toFixed(5)} BNB`);
if (Number(formatEther(bnbProv)) <= 0.0015) todo.push('top up the provider gas: node scripts/fund-provider-wallet.mjs (operator starts it)');
const own = (await get(`${AG}/jobs/own`))?.summary || {};
console.log(`      jobs: ${own.completed?.length || 0} completed · ${own.waiting?.length || 0} waiting the 7-day window · settleable ${own.settleable?.length || 0}`);
if (own.settleable?.length) todo.push(`settle ${own.settleable.join(', ')} (escrow pays the provider; completes the hire)`);
const watch = (await get(`${AG}/jobs/watch`)) || {};
line(watch.cursor_job_id != null, 'funded-job watcher runs', `cursor ${watch.cursor_job_id}, retrying ${Object.keys(watch.retrying || {}).length}`);

console.log(`\n== Next (${todo.length})`);
todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log(`\n${open} open of the checks above.`);
