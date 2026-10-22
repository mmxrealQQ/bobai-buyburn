#!/usr/bin/env node
// Our agents hire outside agents for their own work (worker-agent/agent-hires.js, 2026-10-22, plan a). Held against:
//   offline  the seller's answer is unpacked however deep its JSON is nested (Keel: response.content is JSON again) and
//            the health factor / in-range figure is found; a reply without the figure yields none; the job id is read
//            from the createJob receipt's kernel log and nothing else
//   live     GET /hires is switched on and names three hires, each from an agent that holds something (#302257, #304493,
//            #363709); every hire it logged has its five transactions; every answered hire names where its answer was
//            read and its figure; no hire is counted "answered" without its figure
// usage: node scripts/agent-hires-check.mjs [origin]
import { healthFactorIn, inRangeIn, jobIdFromReceipt } from '../worker-agent/agent-hires.js';
const origin = (process.argv[2] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const keel = JSON.stringify({ chain_id: 56, response: { content: JSON.stringify({ healthFactor: 2.174, primaryCollateralSymbol: 'BNB' }) } });
say(healthFactorIn({ text: keel }) === 2.174, 'Keel\'s nested answer: health factor 2.174 (a pattern over the raw text read 2)');
say(healthFactorIn({ data: { health_factor: '3.1' } }) === 3.1 && healthFactorIn({ text: 'the health factor is 1.85 today' }) === 1.85, 'a health factor in a data part or in words is found');
say(healthFactorIn({ text: 'I cannot read Venus positions with my tools.' }) === null, 'a reply without the figure yields none');
say(inRangeIn(JSON.stringify({ response: { content: JSON.stringify({ positions: [{ inRange: false }] }) } })) === false && inRangeIn('nothing here') === null, 'in range is found nested, and only when it is there');
const K = '0xEa4DAa3100A767e86FDed867729ae7446476EBA6';
say(jobIdFromReceipt({ logs: [{ address: '0x1', topics: ['0xa', '0x' + '9'.repeat(64)] }, { address: K, topics: ['0xb', '0x' + (57046).toString(16).padStart(64, '0')] }] }) === '57046' && jobIdFromReceipt({ logs: [] }) === null, 'the job id comes from the kernel\'s own log in the receipt');
const j = await fetch(`${origin}/hires?r=${Date.now()}`).then((r) => r.json()).catch(() => null);
say(j?.switched_on === true && (j.hires || []).length === 3 && j.hires.every((h) => [302257, 304493, 363709].includes(h.by)), `GET /hires: switched on, ${(j?.hires || []).length} hires (${(j?.hires || []).map((h) => `#${h.by} -> ${h.seller_name}`).join(', ')})`);
const rows = (j?.log || []).filter((r) => r.job);
say(rows.length > 0 && rows.every((r) => (r.txs || []).length === 5 && r.txs.every((t) => t.ok && /^0x[0-9a-f]{64}$/i.test(t.tx))), `every hire logged has its five transactions on chain (${rows.length} hires)`);
const answered = rows.filter((r) => r.status === 'answered');
say(answered.every((r) => r.answer?.url && (r.by !== 302257 || r.answer.health_factor != null) && (r.by !== 363709 || r.answer.in_range != null)), `every "answered" names where its answer was read and its figure (${answered.map((r) => `${r.seller_name}${r.answer?.health_factor != null ? ' HF ' + r.answer.health_factor : ''}${r.agrees != null ? (r.agrees ? ' agrees' : ' DISAGREES') : ''}`).join('; ') || 'none yet'})`);
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
