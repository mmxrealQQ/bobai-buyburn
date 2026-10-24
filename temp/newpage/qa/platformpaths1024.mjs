// (platformpaths1024, 2026-10-24, operator: "Punkt 1 und 2 bauen") a verified platform writes on every path, not only
// POST /board: the MCP tool plaza_board_post takes platform_key (its schema says so — clients send only what it lists)
// and the A2A skill plaza-board; with --write it answers on thread #33 over both and reads the entries back as
// "brainonbnb (verified brainonbnb.com)". The key comes from .env (BOARD_PLATFORM_KEY), never printed.
import 'dotenv/config';
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const mcp = (method, params) => fetch('https://brainonbnb.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(async (r) => { const t = await r.text(); const line = t.trim().startsWith('{') ? t : (t.match(/^data: (.+)$/m) || [])[1]; return JSON.parse(line || '{}'); });
const tools = (await mcp('tools/list', {})).result?.tools || [];
const post = tools.find((t) => t.name === 'plaza_board_post');
say(!!post?.inputSchema?.properties?.platform_key && /platform_key/.test(post.description), 'MCP plaza_board_post lists platform_key and says what it is for');
const card = await fetch('https://agent.brainonbnb.com/.well-known/agent-card.json').then((r) => r.json()).catch(() => null);
say(/platform_key/.test((card?.skills || []).find((s) => s.id === 'plaza-board')?.description || ''), 'the A2A skill plaza-board says a platform writes with platform_key');
if (process.argv.includes('--write')) {
  const key = process.env.BOARD_PLATFORM_KEY;
  const viaMcp = await mcp('tools/call', { name: 'plaza_board_post', arguments: { action: 'reply', thread: '33', body: 'Checked: this works over MCP too — plaza_board_post with "platform_key" posts as the verified platform, no wallet.', platform_key: key } });
  const mj = JSON.parse(viaMcp.result?.content?.[0]?.text || '{}');
  const a2a = await fetch('https://agent.brainonbnb.com/a2a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: 'pf-' + Date.now(), parts: [{ kind: 'data', data: { skill: 'plaza-board', action: 'reply', thread: 33, body: 'Checked: and over A2A — skill "plaza-board", action "reply", with "platform_key".', platform_key: key } }] } } }) }).then((r) => r.json());
  const aj = a2a.result?.parts?.find((p) => p.kind === 'data')?.data || {};
  const t = await fetch('https://agent.brainonbnb.com/board/thread/33').then((r) => r.json());
  const by = (id) => t.replies.find((r) => r.id === id);
  say(mj.ok && by(mj.reply)?.platform === 'brainonbnb.com' && by(mj.reply)?.from === 'brainonbnb', `MCP reply #${mj.reply} stands as brainonbnb (verified brainonbnb.com)${mj.ok ? '' : ': ' + JSON.stringify(mj).slice(0, 160)}`);
  say(aj.ok && by(aj.reply)?.platform === 'brainonbnb.com', `A2A reply #${aj.reply} stands as brainonbnb (verified brainonbnb.com)${aj.ok ? '' : ': ' + JSON.stringify(aj).slice(0, 160)}`);
}
console.log(bad ? `\n${bad} FAIL` : '\nall PASS'); process.exit(bad ? 1 : 0);
