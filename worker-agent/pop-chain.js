// worker-agent/pop-chain.js — Brain Pop's daily result written on BNB Chain (2026-11-10)
//
// Operator, 10.11.: "the ecosystem on the blockchain" — option 1: the game provable on chain. Every night, once the
// day is closed, one transaction from our agent wallet 0x7380 to the prize wallet 0x5E41…D105, 0 BNB, its input data
// plain text: the day, the champion, the score, the run, the players, and the sha256 of the day's whole board in a
// canonical form (GET /pop/chain gives that form back, so anyone can hash it again and compare). The prize wallet's
// page on BscScan then lists every daily champion of the season, and on 30 Nov the prize goes to a #1 everyone could
// follow day by day.
//
//   when      the quarter hour from 00:15 UTC (the day closed at 00:00, a run lasts a minute); missed days of the
//             season are written in the next run, oldest first, at most MAX_PER_RUN at a time
//   the money 0 BNB; gas ~25,000 at 0.1 gwei (about 0.0000025 BNB); simulated before it is sent; never below
//             RESERVE_BNB in the wallet; one nonce, counted here (as public-settle.js and agent-hires.js)
//   a day nobody played is recorded as such in KV, nothing is sent

import { createWalletClient, createPublicClient, http, fallback, toHex, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { providerAccount } from './submit.js';
import { RESERVE_BNB } from './public-settle.js';

export const PRIZE_WALLET = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
export const SEASON_FIRST = '2026-11-06', SEASON_LAST = '2026-11-30';
const POP = 'https://brainonbnb.com/api/pop/';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
const GAS_PRICE = 100000000n, GAS = 60000n, MAX_PER_RUN = 6;
const DAY_KEY = (day) => `pop:chain:${day}`, LOG_KEY = 'pop:chain:log';

export const popChainDue = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() >= 15;

const nextDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10);
export const sc7 = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 7, maximumFractionDigits: 7 });

// the board in its canonical form: one line per place, "rank|name|score|run", the score with 7 decimals, then the
// players line — the text that is hashed, and that GET /pop/chain hands back for anyone to hash again
export function canonical(day, board) {
  const rows = (board.rows || []).map((r, i) => `${i + 1}|${r.name}|${Number(r.score).toFixed(7)}|${r.run}`);
  return [`BRAIN POP 6.9 daily board ${day}`, ...rows, `players|${board.players}`].join('\n');
}
async function sha256(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// what the transaction carries, readable as UTF-8 on BscScan ("Input Data", view as UTF-8)
export function recordText(day, no, board, hash) {
  const top = board.rows[0];
  return `BRAIN POP 6.9 · DAILY #${no} · ${day} · CHAMPION ${top.name} · ${sc7(top.score)} ROT · run ${top.run} · ${board.players} player${board.players === 1 ? '' : 's'} · board sha256 ${hash} · brainonbnb.com/m/pop/${top.run}`;
}

export async function runPopChain(env, { rpcUrl = null, now = new Date(), fetchBoard = null } = {}) {
  const today = now.toISOString().slice(0, 10);
  const last = today > SEASON_LAST ? SEASON_LAST : new Date(Date.parse(today + 'T00:00:00Z') - 86400e3).toISOString().slice(0, 10);
  // the days still to write: the season so far, without the ones done
  const todo = [];
  for (let d = SEASON_FIRST; d <= last && todo.length < MAX_PER_RUN; d = nextDay(d)) if (!(await env.AGENT.get(DAY_KEY(d)))) todo.push(d);
  if (!todo.length) return { ok: true, nothing: true };
  const account = providerAccount(env);
  if (!account) return { ok: false, error: 'no provider key' };
  const transport = rpcUrl ? http(rpcUrl, { timeout: 60000 }) : fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
  const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account, chain: bsc, transport });
  const getBoard = fetchBoard || ((d) => fetch(POP + 'top?scope=day&d=' + d, { signal: AbortSignal.timeout(15000), cf: { cacheTtl: 0 } }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const pendingNonce = async () => {
    const urls = rpcUrl ? [rpcUrl] : RPCS;
    const got = await Promise.all(urls.map((u) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [account.address, 'pending'] }), signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((j) => (j && j.result ? Number(j.result) : null)).catch(() => null)));
    const known = got.filter((c) => c != null);
    return known.length ? Math.max(...known) : null;
  };
  const log = JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]');
  const done = [];
  let nonce = null, stopped = null;
  for (const day of todo) {
    const board = await getBoard(day);
    if (!board || board.day !== day || !Array.isArray(board.rows)) { stopped = `the board of ${day} did not answer; the next run tries again`; break; }
    if (!board.rows.length) { const rec = { day, no: board.no, players: 0, note: 'nobody played; nothing written', at: now.toISOString() }; await env.AGENT.put(DAY_KEY(day), JSON.stringify(rec)); done.push(rec); continue; }
    const text = canonical(day, board), hash = await sha256(text), memo = recordText(day, board.no, board, hash), data = toHex(new TextEncoder().encode(memo));
    const bal = await pub.getBalance({ address: account.address });
    if (bal < RESERVE_BNB + GAS * GAS_PRICE) { stopped = `the agent wallet holds ${formatEther(bal)} BNB; ${formatEther(RESERVE_BNB)} stays for its deliveries`; break; }
    try { await pub.call({ account, to: PRIZE_WALLET, data, value: 0n }); }
    catch (e) { stopped = `the simulation refused: ${String(e.shortMessage || e.message).slice(0, 120)}`; break; }
    if (nonce == null) nonce = await pendingNonce();
    if (nonce == null) { stopped = 'no node answered the nonce; the next run tries again'; break; }
    let tx = null;
    try {
      tx = await wal.sendTransaction({ to: PRIZE_WALLET, value: 0n, data, gas: GAS, gasPrice: GAS_PRICE, nonce });
      nonce++;
      const rc = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60000 });
      if (rc.status !== 'success') { stopped = `${day}: the transaction ${tx} failed`; break; }
      const rec = { day, no: board.no, champion: board.rows[0].name, score: board.rows[0].score, run: board.rows[0].run, players: board.players, sha256: hash, board: text, memo, tx, block: Number(rc.blockNumber), at: new Date().toISOString() };
      await env.AGENT.put(DAY_KEY(day), JSON.stringify(rec));
      log.unshift({ day, no: rec.no, champion: rec.champion, score: rec.score, run: rec.run, players: rec.players, sha256: hash, tx });
      done.push({ day, tx });
    } catch (e) {
      // not known whether it reached a node: the day stays open and the count is asked again next run (a second
      // record of the same day is the worst case, and it says the same thing)
      stopped = `${day}: ${tx ? 'sent ' + tx + ', no receipt' : 'not sent'}: ${String(e.shortMessage || e.message).slice(0, 120)}`;
      break;
    }
  }
  await env.AGENT.put(LOG_KEY, JSON.stringify(log.slice(0, 60)));
  const run = { at: now.toISOString(), written: done.filter((d) => d.tx).length, skipped: done.filter((d) => !d.tx).length, stopped };
  await env.AGENT.put('pop:chain:last', JSON.stringify(run));
  return { ok: !stopped, ...run, done };
}

// GET /pop/chain[?day=YYYY-MM-DD]: every day written, or one day with its canonical board to hash again
export async function readPopChain(env, day = null) {
  if (day) { const r = JSON.parse((await env.AGENT.get(DAY_KEY(day))) || 'null'); return r ? { ...r, check: 'sha256 of "board" (UTF-8, lines joined with \\n) equals "sha256"; the transaction input data is "memo" as UTF-8' } : null; }
  const [log, last] = await Promise.all([LOG_KEY, 'pop:chain:last'].map(async (k) => JSON.parse((await env.AGENT.get(k)) || 'null')));
  return { days: (log || []).map((x) => ({ ...x, bscscan: 'https://bscscan.com/tx/' + x.tx })), last_run: last };
}
