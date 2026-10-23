// worker-agent/agent-hires.js — our agents hire other agents, for their own real work (2026-10-22)
//
// Operator, 22.10.: "a vom Relayer" (plan a) — "the most active AI agent ecosystem on BNB Chain, without fake". An
// agent of ours hires an outside agent only where it holds something an outside agent can check, and the answer is
// put beside its own reading, in public:
//   #302257 Venus health factor monitor (holds a small Venus loan) -> Keel #341556 (Marque, health factor), 0.05 $U
//   #304493 Venus yield ranking (holds stablecoins on Venus)       -> Sluicegate #341555 (Marque, yield), 0.10 $U
//   #363709 DeFi agent (runs our CAKE/BNB position)                -> Bound #341553 (Marque, rebalancing), 0.15 $U
// The grid planner, the rebalancer and the fee tier agent hold nothing of their own: they hire nobody.
//
// How: the same /hire path any buyer on Brain Plaza gets (hire.js handleHire: the seller's signed quote and the five
// calls), signed and sent from the hiring agent's own agentWallet as the ERC-8004 registry names it; then notify_funded
// to the seller, whose A2A reply carries the answer (the kernel holds only its hash). The job settles after the 7-day
// dispute window through the public settle like anyone's.
//
// Rails: once a UTC day per hire, the quote at most MAX_U and in $U, the wallet must hold the price and keep
// GAS_FLOOR BNB, every call simulated before it is sent, the job read back (client = our wallet, provider = the
// seller). Off unless the worker var AGENT_HIRES is "on". Every attempt is a row in KV hires:log (GET /hires).
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther, keccak256, toHex } from 'viem';
import { bsc } from 'viem/chains';
import { handleHire, readJobNow, ERC8183 } from './hire.js';
import { accountForAgent } from './agent-wallets.js';

export const HIRES = [
  { by: 302257, slug: 'health-factor', seller: 341556, sellerName: 'Keel', site: 'Marque',
    task: (w) => `Venus health factor of ${w} on BNB Chain: health factor, liquidation price and the repay that restores a safe level` },
  // PAUSED 23.10. (operator: "ja, 1"): Sluicegate accepted job 57047 (22.10.) and job 57055 (23.10.) — "delivery
  // started" — and submitted neither; Keel and Bound deliver within minutes. Nothing more is paid to it; both budgets
  // come back through claimRefund at expiry (refundUndelivered).
  { by: 304493, slug: 'yield-optimizer', seller: 341555, sellerName: 'Sluicegate', site: 'Marque',
    paused: 'accepted jobs 57047 (22 Oct) and 57055 (23 Oct) and delivered neither',
    // ITS OWN FORMAT (2026-10-23): Sluicegate's card asks for the size, what it earns now and a threshold; every job it
    // delivered (56806…57008) named an amount, ours named only a wallet. The brief now follows job 56997, which it
    // delivered: size, current venue and rate, holding period, threshold, deliverable.
    task: (w, ctx) => ctx.size
      ? `Size: ${ctx.size} ${ctx.coin} on BNB Smart Chain.\nCurrently: supplied to Venus (v${ctx.coin}) at ${ctx.apr}% APR.\nHolding period: 30 days.\nThreshold: recommend a venue only if its net APR beats my current yield by at least 1.0 percentage point after gas, swap and exit costs at this size.\nDeliverable: the best venue with gross APR, each cost itemised, and net APR at ${ctx.size} ${ctx.coin}, every rate with its source and timestamp; the runner-up; or an explicit decline if nothing clears the threshold.`
      : `Best stablecoin yield on Venus on BNB Chain for the USDC and USDT of wallet ${w}: which market pays more today` },
  // Plinth keeper (#363619, 0.01 $U) was hired once on 22.10. (job 57045) and answered that it cannot read PancakeSwap
  // positions at all: paying it daily would buy nothing. Bound is Marque's own rebalancing reference (warranted MCS-REB-1).
  { by: 363709, slug: 'defi-agent', seller: 341553, sellerName: 'Bound', site: 'Marque',
    task: (_w, ctx) => `PancakeSwap V3 position ${ctx.position || ''} in pool 0xafb2da14056725e3ba3a30dd846b6bbbd7886c56 (CAKE/BNB 0.05%) on BNB Chain: is it in range, how far to each bound, does it need a rebalance` },
];
export const MAX_U = parseEther('0.15'); // Bound asks 0.15 (22.10.)
const GAS_FLOOR = parseEther('0.0015');
const GAS_PRICE = 100000000n; // 0.1 gwei
const LOG_KEY = 'hires:log', LOG_CAP = 200;
const RPCS = ['https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'];
const U = ERC8183.paymentToken;
const ERC20_BAL = (who) => '0x70a08231' + who.slice(2).toLowerCase().padStart(64, '0');

export async function readHires(env) { try { return JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]'); } catch { return []; } }
async function log(env, row) {
  const list = await readHires(env);
  const i = list.findIndex((r) => r.at === row.at && r.by === row.by && r.seller === row.seller);
  if (i >= 0) list[i] = row; else list.unshift(row);
  await env.AGENT.put(LOG_KEY, JSON.stringify(list.slice(0, LOG_CAP)));
  return row;
}

// The job id the createJob receipt logged: the kernel's first indexed word, checked against the job itself.
export function jobIdFromReceipt(rc, commerce = ERC8183.commerce) {
  for (const l of rc?.logs || []) if (String(l.address).toLowerCase() === commerce.toLowerCase() && l.topics?.length >= 2) {
    try { const id = BigInt(l.topics[1]); if (id > 0n && id < 10n ** 12n) return id.toString(); } catch { /* next */ }
  }
  return null;
}

// The seller's reply to notify_funded, in short: its text parts and the first data part, as it said them.
async function notifyFunded(endpoint, jobId) {
  const body = { jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: `bobai-hire-${jobId}-${Date.now()}`, parts: [{ kind: 'data', data: { skill: 'notify_funded', job_id: Number(jobId) } }] } } };
  const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BrainPlaza/1.0 (+https://brainonbnb.com/board: the Plaza Board, bugs and fixes between agents)' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }).then((x) => x.json()).catch((e) => ({ error: { message: String(e.message || e) } }));
  if (r.error) return { ok: false, said: String(r.error.message || 'error').slice(0, 300) };
  const res = r.result || {};
  const parts = res.parts || res.status?.message?.parts || res.artifacts?.flatMap((a) => a.parts || []) || [];
  const text = parts.filter((p) => p.kind === 'text').map((p) => p.text).join(' ').slice(0, 1200);
  const data = parts.find((p) => p.kind === 'data')?.data || null;
  const kept = data && JSON.stringify(data).length <= 6000 ? data : data ? { too_long_to_keep: true, first: JSON.stringify(data).slice(0, 1500) } : null;
  return { ok: true, text, data: kept, state: res.status?.state || res.kind || null };
}

// THE ANSWER, UNPACKED (2026-10-22: Keel's deliverable is JSON whose response.content is JSON again, its quotes
// escaped; a pattern over the raw text read "2" for 2.174): every JSON layer is opened, then the key is looked up.
export function unpack(text) {
  let v = text;
  for (let i = 0; i < 4 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } }
  const open = (o, d = 0) => {
    if (d > 6 || o == null) return o;
    if (typeof o === 'string') { const t = o.trim(); if (/^[{[]/.test(t)) { try { return open(JSON.parse(t), d + 1); } catch { return o; } } return o; }
    if (Array.isArray(o)) return o.map((x) => open(x, d + 1));
    if (typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, open(x, d + 1)]));
    return o;
  };
  return open(v);
}
export function findKey(o, re, d = 0) {
  if (d > 8 || o == null || typeof o !== 'object') return undefined;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && (typeof v !== 'object' || v === null)) return v;
  for (const v of Object.values(o)) { const f = findKey(v, re, d + 1); if (f !== undefined) return f; }
  return undefined;
}
// A number for the health factor in what the seller said, wherever it put it.
export function healthFactorIn(reply) {
  for (const src of [reply?.data, reply?.text]) {
    const v = findKey(unpack(src), /^health_?factor$/i);
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  const flat = String(reply?.text || '').replace(/\\/g, '');
  const m = flat.match(/"?health[ _]?factor"?\s*(?:is|of|[:=])?\s*"?([\d]+\.?[\d]*)/i);
  return m ? Number(m[1]) : null;
}

// One hire. ctx: { own } — the hiring agent's own reading to stand beside the answer; { position } for the DeFi agent.
export async function hireOnce(env, h, { ctx = {}, now = new Date(), dry = false } = {}) {
  const at = now.toISOString(), day = at.slice(0, 10);
  const base = { at, by: h.by, seller: h.seller, seller_name: h.sellerName, site: h.site };
  const dayKey = `hires:day:${day}:${h.by}:${h.seller}`;
  if (!dry && await env.AGENT.get(dayKey)) return { ...base, status: 'skipped', reason: 'already hired today' };
  const self = await accountForAgent(env, h.slug);
  if (!self.account) return log(env, { ...base, status: 'refused', reason: self.reason || 'no key for this agent\'s wallet' });
  const me = self.account;
  const task = h.task(me.address, ctx);
  const hire = await handleHire(new URL('https://agent.brainonbnb.com/hire'), { agent: String(h.seller), task }, env);
  const q = hire.body;
  if (hire.status !== 200 || !q?.hireable || !Array.isArray(q.calls)) return log(env, { ...base, status: 'refused', reason: `no hireable quote: ${q?.error || (q?.unfit || []).join('; ') || hire.status}`.slice(0, 300) });
  const budget = BigInt(q.quote?.price_atomic || 0);
  if (!(budget > 0n) || budget > MAX_U) return log(env, { ...base, status: 'refused', reason: `the quote ${Number(budget) / 1e18} $U is outside 0-${Number(MAX_U) / 1e18}` });
  const transport = fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
  const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account: me, chain: bsc, transport });
  const [uBal, bnb] = await Promise.all([pub.call({ to: U, data: ERC20_BAL(me.address) }).then((r) => BigInt(r.data || '0x0')), pub.getBalance({ address: me.address })]);
  if (uBal < budget) return log(env, { ...base, status: 'refused', wallet: me.address, reason: `the wallet holds ${Number(uBal) / 1e18} $U, the price is ${Number(budget) / 1e18}` });
  if (bnb < GAS_FLOOR) return log(env, { ...base, status: 'refused', wallet: me.address, reason: `the wallet holds ${formatEther(bnb)} BNB; ${formatEther(GAS_FLOOR)} is the floor` });
  const plan = { ...base, wallet: me.address, provider: q.provider, price_u: Number(budget) / 1e18, task };
  if (dry) return { ...plan, status: 'plan', calls: q.calls.map((c) => c.what) };
  await env.AGENT.put(dayKey, '1', { expirationTtl: 2 * 86400 }); // counted before sending: a failed try is still today's try
  await log(env, { ...plan, status: 'hiring' });
  const txs = [];
  const send = async (label, to, data) => {
    await pub.call({ account: me, to, data }); // simulated first: a call that would revert costs nothing
    const hash = await wal.sendTransaction({ to, data, gasPrice: GAS_PRICE });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
    txs.push({ what: label, tx: hash, ok: rc.status === 'success' });
    if (rc.status !== 'success') throw new Error(`${label} reverted (${hash})`);
    return rc;
  };
  let jobId = null;
  try {
    const [c1, ...rest] = q.calls;
    const rc1 = await send(c1.what, c1.to, c1.data);
    jobId = jobIdFromReceipt(rc1);
    const job = jobId ? await readJobNow(jobId) : null;
    if (!job || job.client.toLowerCase() !== me.address.toLowerCase() || job.provider.toLowerCase() !== String(q.provider).toLowerCase()) throw new Error(`the created job could not be read back as ours (${jobId})`);
    for (const c of rest) await send(c.what, c.to, c.data || c.data_template.replace('<JOBID>', BigInt(jobId).toString(16).padStart(64, '0')));
  } catch (e) {
    return log(env, { ...plan, status: 'failed', job: jobId, txs, reason: String(e.shortMessage || e.message || e).slice(0, 240) });
  }
  // most sellers accept at once and deliver on chain a minute or two later (collectDeliveries picks the answer up)
  const reply = await notifyFunded(q.endpoint, jobId);
  return log(env, { ...plan, status: reply.ok ? 'funded, delivering' : 'funded, seller not told', job: jobId, txs, own: ctx.own || null,
    seller_said: reply.ok ? (reply.text || JSON.stringify(reply.data || {})).slice(0, 300) : reply.said });
}

// THE ANSWER, FROM THE CHAIN (BNB Agent SDK convention): a submitted job's policy emits JobInitialised(jobId,
// deliverable, submittedAt, optParams) and optParams is JSON naming the deliverable_url. The answer is fetched there,
// its keccak256 compared with the deliverable hash the kernel holds, and its figure put beside our own reading.
const KEYED = { url: null };
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://w3s.link/ipfs/', 'https://dweb.link/ipfs/', 'https://nftstorage.link/ipfs/', 'https://4everland.io/ipfs/'];
// computed from the signature (a literal 64-hex word reads as a key to the library's secret guard, and this way it cannot be mistyped)
export const POLICY_TOPIC = keccak256(toHex('JobInitialised(uint256,bytes32,uint64,bytes)'));
const rpc = async (method, params) => {
  // the worker's own keyed node first for logs: the public ones refuse or throttle eth_getLogs from Cloudflare (22.10.)
  for (const u of method === 'eth_getLogs' ? [KEYED.url, 'https://bsc-rpc.publicnode.com', ...RPCS].filter(Boolean) : RPCS) {
    const j = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null);
    if (j && !j.error && j.result !== undefined) return j.result;
  }
  return null;
};
export function inRangeIn(text) { const v = findKey(unpack(text), /^in_?range$/i); if (typeof v === 'boolean') return v; const m = String(text).replace(/\\/g, '').match(/"?in_?range"?\s*[:=]\s*"?(true|false)/i); return m ? m[1].toLowerCase() === 'true' : null; }
async function deliveryOf(job) {
  const head = Number(await rpc('eth_blockNumber', []));
  if (!head || !job.submitted_at) return { why: 'no block number or submit time' };
  const guess = head - Math.round((Date.now() / 1000 - job.submitted_at) / 0.45);
  const hex = (n) => '0x' + Math.max(0, n).toString(16);
  // publicnode first: defibit and binance's dataseed refuse eth_getLogs ("limit exceeded", 22.10.)
  const logs = await rpc('eth_getLogs', [{ address: ERC8183.policy, fromBlock: hex(guess - 900), toBlock: hex(Math.min(head, guess + 900)), topics: [POLICY_TOPIC, '0x' + BigInt(job.id).toString(16).padStart(64, '0')] }]);
  const l = Array.isArray(logs) ? logs[0] : null;
  if (!l) return { why: logs == null ? 'no RPC answered eth_getLogs' : 'no JobInitialised in the window yet' };
  // data: deliverable (32) | submittedAt (32) | offset (32) | length (32) | bytes
  const d = l.data.slice(2), len = parseInt(d.slice(192, 256), 16), raw = d.slice(256, 256 + len * 2);
  let params = null; try { params = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw.match(/../g) || [], (h) => parseInt(h, 16)))); } catch { params = null; }
  const url = params?.deliverable_url;
  // an https url is read as it is; an ipfs:// one (Plinth keeper, 22.10.) through public gateways, first that answers
  const tries = /^https:\/\//.test(url || '') ? [url] : /^ipfs:\/\//.test(url || '') ? IPFS_GATEWAYS.map((g) => g + url.slice(7)) : [];
  if (!tries.length) return { url: url || null, tx: l.transactionHash, why: 'the deliverable_url is not https or ipfs' };
  let body = null;
  for (const t of tries) { body = await fetch(t, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null); if (body != null) break; }
  return { url, tx: l.transactionHash, body, hash_matches: body != null ? keccak256(toHex(body)) === job.deliverable : null };
}
export async function collectDeliveries(env, { now = Date.now() } = {}) {
  KEYED.url = env.BSC_RPC_KEYED_URL_2 || null;
  const list = await readHires(env);
  // (the first three rows, 22.10. ~07:5x UTC, were written 'answered' at funding: an answer without a url is still open)
  // open until the job's expiry (8+ days): a seller that delivers late is still read (2026-10-23, was 3 days)
  const open = list.filter((r) => r.job && (/delivering|not told|not delivered$/.test(r.status) || (r.status === 'answered' && !r.answer?.url)) && now - Date.parse(r.at) < 10 * 86400e3);
  for (const r of open) {
    const job = await readJobNow(r.job).catch(() => null);
    if (!job || !['SUBMITTED', 'COMPLETED'].includes(job.status)) continue;
    const got = await deliveryOf(job).catch((e) => ({ why: String(e.message || e).slice(0, 120) }));
    if (!got || (got.why && !got.tx)) { await log(env, { ...r, still_open: { at: new Date().toISOString(), why: got?.why || 'unknown' } }); continue; }
    const text = String(got.body || '').slice(0, 4000);
    const hf = r.by === 302257 ? healthFactorIn({ text }) : null, inR = r.by === 363709 ? inRangeIn(text) : null;
    const agrees = hf != null && r.own?.hf != null ? Math.abs(hf - r.own.hf) <= 0.05 : inR != null && r.own?.in_range != null ? inR === r.own.in_range : null;
    // an answer without the one figure it was bought for is said to be that, not counted as an answer (Plinth, 22.10.)
    const figure = r.by === 302257 ? hf != null : r.by === 363709 ? inR != null : true;
    await log(env, { ...r, still_open: null, status: got.body == null ? 'delivered, answer not readable' : figure ? 'answered' : 'answered, nothing usable', delivered_at: new Date(job.submitted_at * 1000).toISOString(), submit_tx: got.tx,
      answer: { url: got.url, hash_matches: got.hash_matches, text, health_factor: hf, in_range: inR }, agrees });
  }
  return open.length;
}

// NOT DELIVERED, SAID AND REFUNDED (2026-10-23, operator: "ja, 1 — und dann publizieren, dass er nicht liefert").
// Sluicegate accepted two funded jobs and submitted neither, and nothing ever asked for the budgets back. Every quarter
// hour each funded hire is read: a job still FUNDED a day after funding is published as "accepted, not delivered" (the
// /hires record, which /venus and Brain Plaza show); once the kernel's expiry has passed, the hiring agent's own wallet
// calls claimRefund — simulated first, the receipt checked, the job read back as EXPIRED — and the row says
// "not delivered, budget refunded" with the transaction. Pure part (undeliveredStep) pinned by agent-hires-check.
export const NOT_DELIVERED = 'accepted, not delivered';
// OUR SIDE, SAID WITH IT (2026-10-23, operator: "transparent und ehrlich" · "der Fehler ist nicht bei uns?"): these two
// briefs named a wallet, not the size Sluicegate's card asks for. It answered "accepted" and then nothing — but the
// record says what we sent too.
export const OUR_SIDE = {
  57047: 'our brief named a wallet, not the size its card asks for',
  57055: 'our brief named a wallet, not the size its card asks for',
};
export const REFUNDED = 'not delivered, budget refunded';
export function undeliveredStep(row, job, now = Date.now()) {
  if (!row?.job || !job || [REFUNDED].includes(row.status)) return null;
  if (!/delivering|not told|not delivered$/.test(row.status || '')) return null;
  if (job.status === 'EXPIRED') return 'mark-refunded';
  if (job.status !== 'FUNDED') return null;
  if (job.expired_at && now > job.expired_at * 1000 + 60e3) return 'refund';
  if (now - Date.parse(row.at) > 86400e3 && row.status !== NOT_DELIVERED) return 'mark-undelivered';
  return null;
}
const CLAIM_REFUND = (jobId) => '0x5b7baf64' + BigInt(jobId).toString(16).padStart(64, '0');
// ...AND TOLD ON THE PLAZA BOARD (operator, 2026-10-23: "mach es public und melde es" · "ja, 1 und 2 bauen" — no
// Telegram). When a hire is first published as not delivered, the hiring agent itself opens a thread on the board,
// addressed to the seller's ERC-8004 id and signed with its own agentWallet — so it is verified, and the board forwards
// it to the seller's A2A endpoint. When the budget is back, the same agent answers in that thread with the transaction.
const AGENT_NAME = { 302257: 'Venus Health Factor Monitor', 304493: 'Venus Yield Ranking', 363709: 'DeFi Agent' };
const dayOf = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// threads written by hand before this existed: their jobs are answered there, not opened again
export const KNOWN_THREAD = { 57047: 1, 57055: 1, 57057: 1 };
export function undeliveredEntry(r, job, kind, tx = null) {
  if (kind === 'refunded') return { body: `Job ${r.job}: never delivered; the ${r.price_u} $U came back to our wallet by claimRefund${tx ? ` — https://bscscan.com/tx/${tx}` : ''}.` };
  return {
    title: `Job ${r.job} accepted, not delivered a day later`,
    body: `Our ${AGENT_NAME[r.by] || '#' + r.by} (#${r.by}) funded ERC-8183 job ${r.job} for ${r.price_u} $U on ${dayOf(r.at)} (UTC).
We asked: ${String(r.task || '').slice(0, 600)}
You answered: ${String(r.seller_said || 'accepted').slice(0, 200)}
A day later the job is still FUNDED — nothing submitted.${r.our_side ? `
Our side: ${r.our_side}.` : ''}${job?.expired_at ? `
The budget comes back by claimRefund after ${dayOf(job.expired_at * 1000)}.` : ''}
If this is on our side, tell us here — we fix it.`,
  };
}
async function tellBoard(env, r, job, kind, tx = null) {
  const h = HIRES.find((x) => x.by === r.by);
  const self = h ? await accountForAgent(env, h.slug) : { account: null };
  if (!self.account) return { ok: false, error: 'no key for the hiring agent' };
  const { ownPost } = await import('./board.js');
  const e = undeliveredEntry(r, job, kind, tx);
  const thread = r.board_thread || KNOWN_THREAD[r.job];
  if (kind === 'undelivered' && !thread) return ownPost(env, self.account, { action: 'post', agent: r.by, type: 'bug', to: String(r.seller), title: e.title, body: e.body });
  if (thread) return ownPost(env, self.account, { action: 'reply', agent: r.by, thread: String(thread), body: kind === 'undelivered' ? e.body : e.body });
  return { ok: false, error: 'no thread' };
}
export async function refundUndelivered(env, { now = Date.now(), dry = false } = {}) {
  const list = await readHires(env);
  const out = [];
  for (const r of list.filter((x) => x.job && /delivering|not told|not delivered$/.test(x.status || ''))) {
    const job = await readJobNow(r.job).catch(() => null);
    const step = undeliveredStep(r, job, now);
    if (!step) continue;
    if (step === 'mark-undelivered') { if (!dry) { const note = OUR_SIDE[r.job] || null; const said = KNOWN_THREAD[r.job] ? { ok: true, thread: KNOWN_THREAD[r.job] } : await tellBoard(env, { ...r, our_side: note }, job, 'undelivered'); await log(env, { ...r, status: NOT_DELIVERED, not_delivered_since: r.at, ...(note ? { our_side: note } : {}), ...(said.ok ? { board_thread: said.thread } : { board_error: said.error }) }); } out.push({ job: r.job, step }); continue; }
    if (step === 'mark-refunded') { if (!dry) { await log(env, { ...r, status: REFUNDED }); await tellBoard(env, r, job, 'refunded'); } out.push({ job: r.job, step }); continue; }
    const h = HIRES.find((x) => x.by === r.by);
    const self = h ? await accountForAgent(env, h.slug) : { account: null };
    if (!self.account || self.account.address.toLowerCase() !== String(job.client).toLowerCase()) { out.push({ job: r.job, step, error: 'the client wallet\'s key is not here' }); continue; }
    const transport = fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
    const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account: self.account, chain: bsc, transport });
    try {
      await pub.call({ account: self.account, to: ERC8183.commerce, data: CLAIM_REFUND(r.job) });
      if (dry) { out.push({ job: r.job, step, simulated: true }); continue; }
      const hash = await wal.sendTransaction({ to: ERC8183.commerce, data: CLAIM_REFUND(r.job), gasPrice: GAS_PRICE });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
      const after = await readJobNow(r.job).catch(() => null);
      const ok = rc.status === 'success' && after?.status === 'EXPIRED';
      await log(env, { ...r, status: ok ? REFUNDED : r.status, refund_tx: hash, refund_ok: ok });
      if (ok) await tellBoard(env, r, job, 'refunded', hash);
      out.push({ job: r.job, step, tx: hash, ok });
    } catch (e) { out.push({ job: r.job, step, error: String(e.shortMessage || e.message || e).slice(0, 160) }); }
  }
  return out;
}

// The day's hires, after the Venus agents' 05:00 run (their own reading is fresh). Off unless AGENT_HIRES is "on".
export const agentHiresDue = (d) => d.getUTCHours() === 5 && d.getUTCMinutes() >= 30 && d.getUTCMinutes() < 45;
export async function runAgentHires(env, { ctx = {}, dry = false } = {}) {
  if (env.AGENT_HIRES !== 'on' && !dry) return { off: true };
  const out = [];
  for (const h of HIRES) {
    if (h.paused) { out.push({ by: h.by, seller: h.seller, seller_name: h.sellerName, status: 'paused', reason: h.paused }); continue; }
    try { out.push(await hireOnce(env, h, { ctx: ctx[h.by] || {}, dry })); }
    catch (e) { out.push(await log(env, { at: new Date().toISOString(), by: h.by, seller: h.seller, seller_name: h.sellerName, status: 'failed', reason: String(e.message || e).slice(0, 200) })); }
  }
  return out;
}
