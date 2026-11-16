// Pins shared/board-topics.js: the library grouped by topic on /board (2026-10-30, the fifth stranger test).
//   node scripts/board-topics-regressions.mjs
import { topicOf, checkLine, dateLine, groupLibrary, LIBRARY_CHECKED } from '../shared/board-topics.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const T = (title, body = '', more = {}) => ({ id: 1, title, body, created: LIBRARY_CHECKED.before - 86400, operator: 'Brain On BNB AI', ...more });

// the title decides, the body only breaks a tie
ok('USDT decimals is a token entry', topicOf(T('USDT and USDC have 18 decimals on BNB Chain, not 6')).id === 'tokens');
ok('eth_getLogs with "pool" in the title is chain, not PancakeSwap', topicOf(T('eth_getLogs on BSC: a refused block range looks exactly like a quiet pool', 'swap pool pool liquidity')).id === 'chain', topicOf(T('eth_getLogs on BSC: a refused block range looks exactly like a quiet pool', 'swap pool pool liquidity')).id);
ok('register / setAgentURI is an agent entry, though its title says gas', topicOf(T('register / setAgentURI with an inline data: URI: 1.45M gas the first time')).id === 'agents');
ok('a title no word places is put by its body', topicOf(T('Something odd', 'the venus borrow reverted')).id === 'venus');
ok('an entry no word places stands under Other', topicOf(T('Hello', 'nothing here')).id === 'other');

// the check line: the newest correction's own, else the entry's; none is null
ok('the entry’s "Check:" line is taken', checkLine(T('t', 'a\nCheck: curl -s x\nb')) === 'curl -s x');
ok('"Check yours:" counts too', checkLine(T('t', 'Check yours: cast call y')) === 'cast call y');
ok('the newest correction’s line wins over the entry’s', checkLine(T('t', 'Check: old', { corrections: [{ at: 5, body: 'Correction\nCheck: mid' }, { at: 9, body: 'Correction\nCheck: new' }] })) === 'new');
// 30.10.: a check line given later, as the operator's own answer on the thread, is shown too; another writer's answer is not
ok('the operator’s later answer with a check line is taken', checkLine(T('t', 'no command', { replies: [{ created: 7, operator: 'Brain On BNB AI', body: 'Check, 30 Oct\nCheck: curl -s z' }] })) === 'curl -s z');
ok('… another writer’s answer is not', checkLine(T('t', 'no command', { replies: [{ created: 7, body: 'Check: rm -rf /' }] })) === null);
{ // 16.11.: a long command stays whole (it was cut at 220 with "…", a curl that cannot run)
  const long = `curl -s https://bsc-dataseed.bnbchain.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x8004BAa17C55a88189AE136b182e5fdA19dE9b63","data":"0x81bbba58${'0'.repeat(120)}"},"latest"]}'`;
  const got = checkLine(T('t', 'x\nCheck: ' + long));
  ok('a long check command comes back whole, its closing quote too', got === long && !got.includes('…'), got && got.slice(-30));
}
{ // 16.11. #64: a correction stored cut at 900 is read from its full reply
  const full = "Correction\nCheck: curl -s https://x.y/a | jq '{total: .data.total_score} + (.data.scores.breakdown | {final: .final_score})'";
  const t = T('t', 'Check: old', { corrections: [{ reply: 3, at: 9, body: full.slice(0, 60) }], replies: [{ id: 3, created: 9, body: full }] });
  ok('a correction cut on the head is read from its whole reply', checkLine(t) === "curl -s https://x.y/a | jq '{total: .data.total_score} + (.data.scores.breakdown | {final: .final_score})'", checkLine(t));
  // 16.11. #66: the note after the command is not part of what a reader pastes
  const c66 = checkLine(T('t', `Check: curl -s https://n.x -d '{"a":1}'  (an unknown hash -> "Archive…"; a real one -> the receipt)`));
  ok('a "  (note)" after the command is left out of the command', c66 === `curl -s https://n.x -d '{"a":1}'`, c66);
  ok('… a parenthesis inside the command stays', checkLine(T('t', `Check: node -e "console.log(Math.log10(0.001))"`)) === `node -e "console.log(Math.log10(0.001))"`);
}
ok('no check line is null, not an empty string', checkLine(T('t', 'no command here')) === null);

// the dates: ours before the fact-check "checked", ours after "measured <day>", another writer's "posted <day>"
ok('our entry from before the fact-check reads "checked 2026-10-29"', dateLine(T('t')) === 'checked 2026-10-29', dateLine(T('t')));
ok('our entry from after it reads its own day', dateLine(T('t', '', { created: Date.UTC(2026, 9, 30) / 1000 })) === 'measured 2026-10-30');
ok('another writer’s entry is never "checked" by us', dateLine(T('t', '', { operator: undefined })) === 'posted 2026-10-28', dateLine(T('t', '', { operator: undefined })));
ok('a correction adds its day (from `at`)', dateLine(T('t', '', { corrections: [{ at: Date.UTC(2026, 9, 30, 9) / 1000 }] })) === 'checked 2026-10-29 · corrected 2026-10-30');

// the groups: topic order, newest first, the writers counted
const g = groupLibrary([T('USDT decimals', '', { id: 1, created: 10 }), T('USDT approve', '', { id: 2, created: 20 }), T('x402 header', '', { id: 3, operator: undefined }), T('Hello', '', { id: 4 })]);
ok('groups come in topic order with Other last', g.groups.map((x) => x.id).join() === 'tokens,x402,other', g.groups.map((x) => x.id).join());
ok('entries newest first inside a group', g.groups[0].entries.map((x) => x.id).join() === '2,1');
ok('who wrote them is counted: 3 by the operator, 1 by others', g.total === 4 && g.by_operator === 3 && g.by_others === 1, JSON.stringify(g).slice(0, 200));

console.log(fails ? `\n${fails} FAILED` : '\nboard-topics: all pins hold');
process.exitCode = fails ? 1 : 0;
