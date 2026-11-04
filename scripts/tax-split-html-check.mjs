// THE TAX SPLIT A READER WITHOUT A BROWSER SEES (2026-11-04)
// /token, the front page (/) and /classic carried "~1% / ~1% / ~1%" plus three hidden boxes (0.5 / 0.3 / 0.3): app.js
// fixes them in a browser, but a crawler or an agent reading the HTML — most of our readers — got six parts adding to
// 4.1% of a 3% tax and "Splits ~1/1/1". The site worker writes in the split of the phase running now. This reads the
// raw HTML as such a reader does: the boxes left must add up to 3%, the step's line must name the same parts.
//   node scripts/tax-split-html-check.mjs [base=https://brainonbnb.com]
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const live = await fetch('https://brainonbnb.com/api/tokenomics', { headers: { 'user-agent': 'brainonbnb-tax-split-check' } }).then((r) => r.json()).catch(() => null);
const phase = live?.current_phase;
let bad = 0;
const pin = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
pin('the tool names the phase running now, adding up to 3%', phase && Math.abs(phase.total_pct - 3) < 1e-9, phase ? `${phase.id} ${phase.total_pct}%` : 'no phase');
for (const path of ['/token', '/', '/classic']) {
  const html = await fetch(BASE + path, { headers: { 'user-agent': 'brainonbnb-tax-split-check' } }).then((r) => r.text()).catch(() => '');
  const flow = html.slice(html.indexOf('class="tax-flow"'), html.indexOf('class="tax-schedule"'));
  if (!flow || flow.length < 50) { pin(`${path}: the tax flow is in the page`, false); continue; }
  const pcts = [...flow.matchAll(/<div class="p"[^>]*>([^<]*)<\/div>/g)].map((m) => m[1].trim());
  const sum = Math.round(pcts.reduce((a, x) => a + (parseFloat(x.replace('~', '')) || 0), 0) * 100) / 100;
  pin(`${path}: the boxes a reader sees add up to 3%`, sum === 3 && !pcts.some((x) => x.startsWith('~')), `${pcts.join(' + ')} = ${sum}%`);
  pin(`${path}: no box of a share that is not running stays hidden in the page`, !/display:none/.test(flow));
  const step = (html.match(/<span id="step-split">([^<]*)<\/span>/) || [])[1] || '';
  const stepSum = Math.round([...step.matchAll(/([\d.]+)%/g)].reduce((a, m) => a + Number(m[1]), 0) * 100) / 100;
  pin(`${path}: the step names every part and they add up to 3%`, stepSum === 3 && !/~1\/1\/1/.test(step), step || '(none)');
  if (phase) pin(`${path}: the BOBAI burn box is the phase's figure`, pcts.includes(`${+phase.split_pct.bobai_burn.toFixed(2)}%`), `${phase.split_pct.bobai_burn}%`);
}
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exitCode = bad ? 1 : 0;
