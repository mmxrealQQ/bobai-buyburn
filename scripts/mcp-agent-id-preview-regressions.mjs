// bnb_agent_id projects/preview for a contract NOT listed (2026-11-28): a builder's agent gets the count since 18 Nov
// (the preview) instead of "not listed". Offline: fetch is answered here. node scripts/mcp-agent-id-preview-regressions.mjs
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({ load(url, ctx, next) { return /\/(dashboard|shared)\/(?:i18n\/)?[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); } });
const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const LISTED = '0x' + '11'.repeat(20), NEW = '0x' + '22'.repeat(20);
const asked = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url); asked.push(u);
  if (u === `https://agent.brainonbnb.com/agent-id/projects/${LISTED}`) return J({ contract: LISTED, agent_id_addresses: 7, read_to_block: 1 });
  if (u.startsWith('https://agent.brainonbnb.com/agent-id/projects/preview?contract=')) return J({ contract: u.split('=')[1], agent_id_addresses: 3, senders: 9, complete: true });
  if (u.startsWith('https://agent.brainonbnb.com/agent-id/projects/0x')) return J({ error: 'not listed' }, 404);
  if (u === 'https://agent.brainonbnb.com/agent-id/projects') return J({ projects: [] });
  return J({});
};
const site = (await import(pathToFileURL(path.join(ROOT, 'dashboard/_worker.js')).href)).default;
const senv = { HIT_SECRET: 'hs', ASSETS: { fetch: async () => new Response('asset') } }, sctx = { waitUntil: () => {} };
const quiet = console.log;
const call = async (args) => {
  console.log = () => {};
  try { const r = await site.fetch(new Request('https://brainonbnb.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bnb_agent_id', arguments: args } }) }), senv, sctx); const j = await r.json(); return { j, out: (() => { try { return JSON.parse(j.result?.content?.[0]?.text || 'null'); } catch { return null; } })() }; }
  finally { console.log = quiet; }
};
{ const { j, out } = await call({ action: 'projects', address: NEW });
  check(!j.result?.isError && out?.listed === false && out.agent_id_addresses === 3 && /one-off count since 18 Nov/.test(out.note), 'projects + a contract not listed: the count since 18 Nov, marked listed: false', JSON.stringify(out).slice(0, 120)); }
{ asked.length = 0; const { out } = await call({ action: 'projects', address: LISTED });
  check(out?.agent_id_addresses === 7 && out.listed === undefined && !asked.some((u) => u.includes('/preview')), 'projects + a listed contract: its live count, no preview asked'); }
{ const { j, out } = await call({ action: 'preview', address: LISTED });
  check(!j.result?.isError && out?.listed === false && out.agent_id_addresses === 3, 'preview: the one-off count for any contract'); }
{ const { j } = await call({ action: 'preview' });
  check(j.result?.isError === true && /the contract to count/.test(j.result.content[0].text), 'preview without an address is refused in words'); }
{ const { out } = await call({ action: 'projects' });
  check(Array.isArray(out?.projects), 'projects without an address: the list, as before'); }
{ const tl = (await (await site.fetch(new Request('https://brainonbnb.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), senv, sctx)).json()).result.tools;
  const t = tl.find((x) => x.name === 'bnb_agent_id');
  check(t.inputSchema.properties.action.enum.includes('preview') && /one-off count since 18 Nov/.test(t.description), 'the tool names preview and the not-listed count'); }
globalThis.fetch = realFetch;
console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
