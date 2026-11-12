#!/usr/bin/env node
// The A-Z pass of 2026-11-12, held against live: every finding fixed that day, read the way an outside prober reads it.
// Reads only; every call carries the own user agent so the day's stats stay clean.
//   node scripts/az-1112-check.mjs            (brainonbnb.com + agent.brainonbnb.com)
//   node scripts/az-1112-check.mjs <site> <agent>
const SITE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const AGENT = (process.argv[3] || 'https://agent.brainonbnb.com').replace(/\/$/, '');
const UA = { 'user-agent': 'bobai-review/1.0' };
let fails = 0; const say = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const get = (u) => fetch(u, { headers: UA }).then((r) => r.text()).catch(() => '');
const json = (u) => fetch(u, { headers: UA }).then((r) => r.json()).catch(() => null);
const rpc = (u, method, params = {}) => fetch(u, { method: 'POST', headers: { ...UA, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json()).catch(() => null);
const call = (u, name, args) => rpc(u, 'tools/call', { name, arguments: args }).then((j) => j?.result || j);
const text = (r) => (r?.content || []).map((c) => c.text).join(' ');

// MCP: a refusal is a refusal (isError), with an example
for (const [name, args, word] of [['erc8183_escrow_status', {}, '40 hex'], ['bnb_fix_lookup', {}, 'Pancake: K'], ['plaza_board_read', { thread: 'abc' }, 'digits only'], ['find_agents_on_bnb_chain', {}, 'health factor']]) {
  const r = await call(`${SITE}/mcp`, name, args);
  say(r?.isError === true && text(r).includes(word), `/mcp ${name} ${JSON.stringify(args)} is refused with isError and an example ("${text(r).slice(0, 70)}")`);
}
const tl = (await rpc(`${SITE}/mcp`, 'tools/list'))?.result?.tools || [];
const chart = tl.find((t) => t.name === 'bnb_agent_chart'), fix = tl.find((t) => t.name === 'bnb_fix_lookup');
say(chart && (chart.inputSchema.properties.agent_id.examples || []).every((e) => typeof e === 'string'), 'bnb_agent_chart: the example has the type the schema declares (string)');
say(fix && JSON.stringify(fix.inputSchema).includes('Pancake: K') && !JSON.stringify(fix.inputSchema).includes('nonce too low'), 'bnb_fix_lookup: the schema example is one the library answers');
const pi = (await rpc(`${SITE}/mcp/preflight`, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bobai-review', version: '1' } }))?.result;
say(pi && !/bsc_rug_watch|plaza_board_read|erc8183_escrow_status/.test(pi.instructions || '') && !pi.capabilities?.prompts, `/mcp/preflight introduces only its own tools and offers no prompts (${pi?.serverInfo?.name})`);
const pp = (await rpc(`${SITE}/mcp/preflight`, 'prompts/list'))?.result?.prompts;
say(Array.isArray(pp) && pp.length === 0, '/mcp/preflight prompts/list is empty');
const mi = (await rpc(`${SITE}/mcp`, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bobai-review', version: '1' } }))?.result;
const sc = await json(`${SITE}/.well-known/mcp/server-card.json`);
say(mi && sc && sc.version === mi.serverInfo.version, `server-card version ${sc?.version} = serverInfo ${mi?.serverInfo?.version}`);
const card = await json(`${SITE}/.well-known/agent-card.json`), pw = (card?.skills || []).find((s) => s.id === 'pool_watch');
say(pw && /\$BOBAI/.test(pw.description) && /holder pass/.test(pw.description) && !/three ways/.test(pw.description), 'A2A card pool_watch names every way /watch takes, $BOBAI and the holder pass included');

// per-agent MCP: a bad input is refused, a full range has no 1e46
const bad = await call(`${AGENT}/defi-agent/mcp`, 'lp_position_look', { position: 'abc' });
say(bad?.isError === true && /digits only/.test(text(bad)), `defi-agent lp_position_look {"position":"abc"} is refused ("${text(bad).slice(0, 60)}")`);
const own = await call(`${AGENT}/defi-agent/mcp`, 'lp_position_look', {});
say(!own?.isError && /this agent runs itself/.test(text(own)), 'defi-agent lp_position_look {} still reads its own position');
const full = await call(`${AGENT}/defi-agent/mcp`, 'lp_position_look', { wallet: '0x0000000000000000000000000000000000000001' });
const fullText = text(full), up = fullText.match(/"to_upper_pct":\s*([^,}\s]+)/);
say(up && !/e\+\d{2}/.test(fullText), `a full-range position carries no 1e+46 room figure (to_upper_pct ${up ? up[1] : 'none read'})`);

// pages without a browser
const cls = await get(`${SITE}/classic`);
say(/hreflang="en" href="https:\/\/brainonbnb\.com\/"/.test(cls) && /hreflang="ar" href="https:\/\/brainonbnb\.com\/ar\/"/.test(cls), '/classic: hreflang names the canonical / and /ar/');
const arPop = await get(`${SITE}/ar/pop`);
say(/href="\/ar\/\?pop=play"/.test(arPop) && !/href="\/\?pop=play"/.test(arPop), '/ar/pop: the play buttons stay in Arabic (/ar/?pop=play)');
const reg = await json(`${SITE}/api-registry.json`), sv = await get(`${SITE}/services`);
const svIds = (sv.match(/id="sv-agents">([\d,]+)</) || [])[1], svWhen = (sv.match(/id="sv-when">([^<]+)</) || [])[1];
say(reg && svIds && Number(svIds.replace(/,/g, '')) >= reg.registered_ids && svWhen === `census of ${String(reg.measured_at).slice(0, 10)}`, `/services HTML: ${svIds} ids, ${svWhen} (registry ${reg?.registered_ids}, ${String(reg?.measured_at).slice(0, 10)})`);
const ag = await get(`${SITE}/agent/363709`), desc = (ag.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
say(/paid by outside buyers/.test(desc) && !/centred on the Evidence/.test(desc), `/agent/363709: the description ends a sentence and counts outside buyers ("…${desc.slice(-90)}")`);
const defi = await get(`${SITE}/defi`);
say(/This range alone \(±20%/.test(defi) && /≈−\$/.test(defi) && /left for 2 h is re-set/.test(defi) && /lp\/portfolio<\/code>/.test(defi), '/defi HTML: the range\'s own result, the signed dollars, the 2 h wait and the portfolio link');
const home = await get(`${SITE}/`);
say(/Runs its own PancakeSwap V3 range/.test(home) && !/The trade tax at work in PancakeSwap/.test(home), 'front page: the DeFi card no longer ends with the tax slice (20 Nov)');
const arHome = await get(`${SITE}/ar/`), arDesc = (arHome.match(/<meta name="description" content="([^"]+)"/) || [])[1] || '';
say(/[؀-ۿ]/.test(arDesc), `/ar/: the meta description is Arabic ("${arDesc.slice(0, 50)}")`);

// the DeFi agent's figures
const pf = await json(`${AGENT}/lp/portfolio`);
say(pf && Math.abs(pf.put_in.bnb * pf.bnb_usd - pf.put_in.usd) < 1 && pf.bnb_usd_at_run != null, `/lp/portfolio: one BNB price for every dollar (bnb_usd ${pf?.bnb_usd}, at the run ${pf?.bnb_usd_at_run})`);
say(pf && pf.pnl.time_in_range_from && pf.pnl.time_in_range_from > pf.pnl.since, `/lp/portfolio: time in range names its own start (${pf?.pnl?.time_in_range_from}, since ${pf?.pnl?.since})`);
// the record answers JSON unless a browser asks for the page
const rec = await fetch(`${AGENT}/lp/agent`, { headers: { ...UA, accept: 'text/html' } }).then((r) => r.text()).catch(() => '');
say(/kept for its own hires/.test(rec) && !/\d\.\d{9,} \$U/.test(rec.replace(/<[^>]+>/g, ' ').replace(/nothing above the [\d.]+ \$U/g, '')), '/lp/agent: the hire reserve stands apart, no 16-digit $U figures in its own sentences');
say(/Back to the DeFi agent/.test(rec) && /until 20 Nov 2026/.test(rec), '/lp/agent: the back link names the DeFi agent, the lead dates the tax slice');
// x402: the version in the 402 body too, for clients that read the body (v1 response shape)
for (const [u, m] of [[`${AGENT}/answer?service=health_factor`, 'GET'], [`${AGENT}/watch`, 'POST']]) {
  const b = await fetch(u, { method: m, headers: { ...UA, 'content-type': 'application/json' }, ...(m === 'POST' ? { body: '{}' } : {}) }).then((r) => r.json()).catch(() => null);
  say(b && b.x402Version === 2 && Array.isArray(b.accepts), `402 body of ${u.replace(AGENT, '')} names x402Version 2 beside accepts`);
}
// the scanner's other pools: found by the index, their depth read from the chain (CAKE: PancakeSwap's V2 pair is among them)
{
  const r = await call(`${SITE}/mcp`, 'bsc_pool_scan', { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82' });
  const t = text(r), j = (() => { try { return JSON.parse(t); } catch { return null; } })();
  const list = JSON.stringify(j || {}).match(/"source":"(chain|index)"/g) || [];
  const chain = list.filter((x) => x.includes('chain')).length;
  say(chain >= 3, `bsc_pool_scan CAKE: the other pools' depth is read from the chain (${chain} chain, ${list.length - chain} index)`);
}
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
