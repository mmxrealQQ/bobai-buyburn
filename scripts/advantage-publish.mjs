#!/usr/bin/env node
// Renders data/advantage/report.json into dashboard/advantage.html.
//
// Generated rather than written by hand for the same reason /registry is: the
// page states measurements, and a measurement that gets retyped into HTML is a
// measurement that will eventually disagree with the file it came from. Re-run
// scripts/advantage-report.mjs, re-run this, deploy — the page cannot drift
// from the run that produced it.
//
//   node scripts/advantage-report.mjs && node scripts/advantage-publish.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'advantage', 'report.json'), 'utf8'));

if (!report.tasks?.length) {
  console.error('report.json holds no tasks — run scripts/advantage-report.mjs first');
  process.exit(1);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const ms = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-US')} ms`);

// How many of the three the hand-done path actually answered. This is the
// headline, and it is counted from the data rather than asserted in prose.
const answeredManually = report.tasks.filter((t) => t.manual?.answer?.answered).length;
const answeredByAgent = report.tasks.filter((t) => t.agent?.answer?.answered).length;

// The window's length in words. Minutes come from block timestamps when the
// tool could date the window, and from the block count otherwise — the source
// travels with the number so the page never prints an estimate as a reading.
const windowText = (w) => {
  if (!w) return 'a live window';
  const min = w.minutes != null ? `${w.minutes} minutes` : `${(w.blocks || 0).toLocaleString('en-US')} blocks`;
  return w.minutes_source ? `about ${min} (${w.minutes_source})` : min;
};

const taskCard = (t) => {
  const a = t.agent?.answer || {};
  const mn = t.manual?.answer || {};
  const agentOk = a.answered;
  const manualOk = mn.answered;

  // Task 1 carries the evidence table: the tier a public interface points at,
  // against the one that actually paid.
  const tierRows = (a.tiers || []).map((x) => `
        <tr${x.tier === a.best_paying_tier ? ' class="win"' : ''}>
          <td>${esc(x.tier)}</td>
          <td class="n">${usd(x.capital_usd)}</td>
          <td class="n">${x.swaps == null ? '<span class="unm">not measurable</span>' : x.swaps}</td>
          <td class="n">${x.fees_paid_usd == null ? '—' : usd(x.fees_paid_usd)}</td>
          <td class="n">${x.fees_per_1000_usd_parked == null ? '—' : '$' + x.fees_per_1000_usd_parked.toFixed(5)}</td>
        </tr>`).join('');

  const evidence = t.task === 1 && (a.tiers || []).length ? `
      <div class="ev">
        <div class="ev-h">What the five pools actually paid, over ${esc(a.window?.minutes ?? '')} minutes of chain</div>
        <div class="tw"><table>
          <thead><tr><th>Tier</th><th class="n">Capital parked</th><th class="n">Swaps</th><th class="n">Fees paid</th><th class="n">Fees per $1,000 parked</th></tr></thead>
          <tbody>${tierRows}</tbody>
        </table></div>
        <p class="ev-n">The tier holding the most capital is <strong>${esc(a.most_capital_tier)}</strong>. The tier that paid best is <strong>${esc(a.best_paying_tier)}</strong>. Every public interface ranks this pair by the first column; an LP is paid on the last one. Measured over a single window of ${esc(windowText(a.window))} and deliberately not annualised — forty minutes of flow says what happened in forty minutes.</p>
      </div>` : '';

  // Tasks 2 and 3 carry their outputs too. TermiX asks for "the actual outputs
  // attached", and a verdict without the answer beside it is a claim.
  const kv = (rows) => `
        <div class="tw"><table class="kv">
          <thead><tr><th>What was asked</th><th>Asking the agent</th><th>Doing it by hand</th></tr></thead>
          <tbody>${rows.map(([k, x, y]) => `
          <tr><td>${esc(k)}</td><td>${x}</td><td>${y}</td></tr>`).join('')}</tbody>
        </table></div>`;
  const miss = (why) => `<span class="unm">${esc(why || 'not produced')}</span>`;
  const pctOf = (v) => (v == null ? miss() : `${Number(v).toFixed(2)}%`);
  const task2 = t.task === 2 && (a.price_usd != null || mn.price_usd != null) ? `
      <div class="ev">
        <div class="ev-h">The answers, side by side</div>
        ${kv([
          ['Price', a.price_usd != null ? usd(a.price_usd, 4) : miss(), mn.price_usd != null ? usd(mn.price_usd, 4) : miss()],
          ['Pool measured', esc(a.pool || '—'), esc(mn.pool || '—')],
          ['Hard backing in that pool (the BNB side, the half that holds)', a.hard_backing_usd != null ? usd(Math.round(a.hard_backing_usd)) : miss(), mn.hard_backing_usd != null ? usd(Math.round(mn.hard_backing_usd)) : miss()],
          ['Share of the token\'s liquidity this pool is', a.share_of_liquidity_readable != null ? `${(a.share_of_liquidity_readable * 100).toFixed(1)}%` : miss(), mn.share_of_liquidity_readable != null ? `${(mn.share_of_liquidity_readable * 100).toFixed(1)}%` : miss('needs every other pool on every venue found first')],
          [`Cost of a $${(a.sell_cost_pct_at_size?.sizeUsd ?? mn.sell_cost_pct_at_size?.sizeUsd ?? 2500).toLocaleString('en-US')} sell`, pctOf(a.sell_cost_pct_at_size?.sellCostPct), pctOf(mn.sell_cost_pct_at_size?.sellCostPct)],
          ['Transfer tax', a.transfer_tax && a.transfer_tax.buyPct != null ? `buy ${Number(a.transfer_tax.buyPct).toFixed(2)}% · sell ${Number(a.transfer_tax.sellPct ?? a.transfer_tax.buyPct).toFixed(2)}% (${esc(a.transfer_tax.measured ? 'measured from executed trades' : (a.transfer_tax.source || 'reported'))})` : miss(a.transfer_tax?.warning ? 'not established this run — the log endpoint refused, and the tool says so instead of printing 0%' : undefined), mn.transfer_tax ? esc(JSON.stringify(mn.transfer_tax)) : miss('not a field on the contract')],
          ['LP burned', pctOf(a.lp_burned_pct), pctOf(mn.lp_burned_pct)],
        ])}
        <p class="ev-n">Both columns come from the same run. The hand-done column is what a person gets from the pair contract and the price feed alone; the two rows it cannot fill are the two the question was about.</p>
      </div>` : '';
  const task3 = t.task === 3 && (a.candidates != null || mn.sampled_ids != null) ? `
      <div class="ev">
        <div class="ev-h">The answers, side by side</div>
        ${kv([
          ['Candidates found', a.candidates != null ? `${a.candidates} that match, of ${(mn.registry_ids_at_measurement || 0).toLocaleString('en-US')} ids in the registry` : miss(), mn.sampled_ids != null ? `none — ${mn.sampled_ids} ids read to measure the rate` : miss()],
          ['Top three', (a.top || []).length ? (a.top || []).map((c) => `#${esc(String(c.id))} ${esc(c.name || '')}`).join('<br>') : miss(), miss('no index to rank by')],
          ['What it charges', a.charges ? `${esc(a.charges.price)} — #${esc(String(a.charges.id))} ${esc(a.charges.name || '')}, quoted over A2A through the hire path` : miss(a.could_not_answer), miss('there is nobody to ask until somebody is found')],
          ['Time to read the whole registry at the measured rate', '—', mn.extrapolated_hours_to_read_the_registry != null ? `${mn.extrapolated_hours_to_read_the_registry} h at ${mn.ms_per_id_measured} ms an id — an extrapolation from ${mn.sampled_ids} ids, labelled as one` : miss()],
        ])}
        ${(a.asked_for_a_price || []).length ? `<p class="ev-n">Asked for a price, in the broker's order: ${(a.asked_for_a_price || []).map((x) => `#${esc(String(x.id))} ${x.quoted ? `quoted ${esc(x.price)}` : `did not quote (${esc(x.reason || '')})`}`).join(' · ')}.</p>` : ''}
      </div>` : '';

  // The marketplace half: the agent on Brain Plaza that sells this answer,
  // what it quoted through the marketplace's own hire path during this run,
  // and the completed job where one exists.
  const mk = t.marketplace;
  const market = mk && !mk.error ? `
      <div class="ev mk">
        <div class="ev-h">Hired through the marketplace</div>
        <p class="ev-n"><strong><a href="${esc(mk.hire)}">#${esc(String(mk.agent_id))} ${esc(mk.name)}</a></strong> — ${esc(mk.what_it_delivers)}.
        ${mk.quote?.quoted
          ? `Asked through the hire path during this run, it quoted <strong>${esc(mk.quote.price)}</strong>${mk.quote.escrow ? ` (escrow ${esc(mk.quote.escrow)}` + (mk.quote.provider ? `, provider ${esc(mk.quote.provider.slice(0, 6))}…${esc(mk.quote.provider.slice(-4))}` : '') + ')' : mk.quote.status === 402 ? ' (a 402 with the price, paid per x402)' : ''}.`
          : `It did not quote during this run${mk.quote?.reason ? ` (${esc(mk.quote.reason)})` : ''}; the page says so rather than printing an older price.`}
        ${mk.completed_job ? ` A job hired this way is on the chain: <a href="${esc(mk.completed_job.page)}">job ${esc(String(mk.completed_job.id))}</a>, ${esc(mk.completed_job.status)}, the delivered answer readable at <a href="${esc(mk.completed_job.result)}">${esc(mk.completed_job.result.replace('https://', ''))}</a>.` : ''}</p>
      </div>` : '';

  return `
    <article class="task">
      <div class="t-h"><span class="t-n">Task ${t.task}</span><span class="t-c">${esc(t.category)}</span></div>
      <h3>${esc(t.question)}</h3>
      <p class="t-w">${esc(t.why_it_is_hard)}</p>

      <div class="cmp">
        <div class="col ${agentOk ? 'good' : 'bad'}">
          <div class="col-h">Asking the agent</div>
          <div class="big">${ms(t.agent?.ms)}</div>
          <div class="sub">${t.agent?.requests ?? '—'} request${t.agent?.requests === 1 ? '' : 's'}</div>
          <div class="verdict">${agentOk ? 'Answered the question' : 'Did not answer'}</div>
          ${a.could_not_answer ? `<p class="miss">${esc(a.could_not_answer)}</p>` : ''}
        </div>
        <div class="col ${manualOk ? 'good' : 'bad'}">
          <div class="col-h">Doing it by hand</div>
          <div class="big">${ms(t.manual?.ms)}</div>
          <div class="sub">${t.manual?.requests ?? '—'} request${t.manual?.requests === 1 ? '' : 's'}</div>
          <div class="verdict">${manualOk ? 'Answered the question' : 'Did not answer'}</div>
          ${mn.could_not_answer ? `<p class="miss">${esc(mn.could_not_answer)}</p>` : ''}
        </div>
      </div>

      <p class="ratio">${t.ratio_lower_bound
        ? `${t.ratio_lower_bound}&times; longer by hand — and that is a floor, not an estimate: the hand-done path here is a script, with no page loads, no reading and no typing.`
        : 'No time ratio is published for this task. One of the two paths never produced the answer, and dividing a time by a non-answer would turn a failure into a benchmark.'}</p>
      ${evidence}${task2}${task3}${market}
    </article>`;
};

const html = `<!DOCTYPE html>
<!-- Generated by scripts/advantage-publish.mjs from data/advantage/report.json.
     Do not edit by hand: the numbers here are a measurement, and a measurement
     retyped into HTML is one that will eventually disagree with its source. -->
<html lang="en" style="background:#0c0b0c">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/spacegrotesk-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css?v=1">
<title>Agent Advantage Report — three tasks, done twice</title>
<meta name="description" content="Three real BNB Smart Chain tasks, each done twice: once by asking an agent, once by hand. Wall-clock, request counts, and what the hand-done path could not answer at all.">
<link rel="canonical" href="https://brainonbnb.com/advantage">
<link rel="icon" type="image/png" href="/favicon.png?v=4">
<meta property="og:title" content="Agent Advantage Report — three tasks, done twice">
<meta property="og:description" content="We set out to measure how much faster an agent is. What we measured is that the hand-done route did not answer ${3 - answeredManually} of the 3 questions at all.">
<meta property="og:image" content="https://brainonbnb.com/og-banner.png">
<meta property="og:url" content="https://brainonbnb.com/advantage">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/styles.css?v=37">
<style>
  .adv{max-width:960px;margin:0 auto}
  .hero h1{font-family:'Space Grotesk',system-ui,sans-serif;font-size:clamp(28px,5vw,44px);line-height:1.08;margin:0 0 14px}
  .hero .lead{color:var(--muted);font-size:17px;line-height:1.6;max-width:70ch}
  .headline{border:1px solid var(--border);border-radius:var(--radius);background:var(--card);padding:18px 20px;margin:24px 0}
  .headline strong{color:var(--gold)}
  .method{border-left:2px solid var(--border);padding:2px 0 2px 16px;margin:22px 0;color:var(--muted);font-size:14.5px;line-height:1.65}
  .method b{color:#e9e6e3;font-weight:600}
  .task{border:1px solid var(--border);border-radius:var(--radius);background:var(--card);padding:20px;margin:18px 0}
  .t-h{display:flex;gap:10px;align-items:center;margin-bottom:10px}
  .t-n{font-family:'Space Grotesk',system-ui,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
  .t-c{font-size:12px;color:var(--muted)}
  .task h3{font-family:'Space Grotesk',system-ui,sans-serif;font-size:19px;line-height:1.35;margin:0 0 8px}
  .t-w{color:var(--muted);font-size:14.5px;line-height:1.6;margin:0 0 16px}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:640px){.cmp{grid-template-columns:1fr}}
  .col{border:1px solid var(--border);border-radius:12px;padding:14px}
  .col-h{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .big{font-family:'Space Grotesk',system-ui,sans-serif;font-size:26px}
  .sub{color:var(--muted);font-size:13px;margin-top:2px}
  .verdict{margin-top:10px;font-size:13.5px;font-weight:600}
  .col.good .verdict{color:#7fd1a3}
  .col.bad .verdict{color:#e2a03f}
  .miss{color:var(--muted);font-size:13px;line-height:1.55;margin:8px 0 0}
  .ratio{margin:14px 0 0;font-size:14px;color:var(--muted);line-height:1.6}
  .ev{margin-top:18px;border-top:1px solid var(--border);padding-top:16px}
  .ev-h{font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
  .tw{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border)}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
  tr.win td{color:var(--gold)}
  .unm{color:#e2a03f}
  .ev-n{color:var(--muted);font-size:13.5px;line-height:1.6;margin:10px 0 0}
  /* the marketplace block carries a result URL with no break point in it; at 360px it ran 17px past the card until this. */
  .ev-n a{overflow-wrap:anywhere}
  .caveats li{color:var(--muted);font-size:14px;line-height:1.65;margin-bottom:6px}
  .foot{color:var(--muted);font-size:13.5px;line-height:1.7;margin-top:26px;border-top:1px solid var(--border);padding-top:16px}
  .foot code{background:rgba(255,255,255,.05);padding:2px 6px;border-radius:5px;font-size:12.5px}
</style>
</head>
<body>
<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>
<div class="page">
  <nav><div class="nav">
    <a class="back-btn" href="/" title="Back to Dashboard"><span>&larr;</span> Dashboard</a>
    <a class="brand-link" href="/advantage">Agent Advantage Report</a>
    <a class="nb" href="/registry">Brain Plaza</a>
  </div></nav>

  <section class="sec b-blue adv" style="margin-top:86px">
    <div class="blk-head"><span class="blk-tag">Report &middot; measured ${esc(report.measured_at.slice(0, 10))}</span><span class="blk-line"></span></div>

    <div class="hero">
      <h1>Three tasks, each done twice</h1>
      <p class="lead">Once by asking an agent. Once by hand — every call a person would have to make, in the same minute, over the same node. The plan was to measure how much time an agent saves.</p>
    </div>

    <div class="headline">
      That is not what came back. The hand-done route answered <strong>${answeredManually} of ${report.tasks.length}</strong> questions; the agent answered <strong>${answeredByAgent} of ${report.tasks.length}</strong>. On one task the hand-done path was <em>quicker</em> — because the public node refused its log queries, so it skipped the only expensive step and returned a number it already had. The fastest path in any comparison is always the broken one, which is why no ratio is published where a side failed to answer.
    </div>

    <div class="method">
      <b>How the hand-done path was measured.</b> It is a script issuing the same calls a person would have to issue — no page loads, no reading, no typing an address into a block explorer, no deciding which explorer to open. It is therefore a <b>floor</b> on what a person costs, never an estimate of it. Inflating that side would have been easy and would have made this document worthless.<br><br>
      <b>What is recorded as a failure.</b> A query the node refused is recorded as unmeasured, never as zero. &ldquo;Nobody traded in this pool&rdquo; and &ldquo;we could not look&rdquo; are different answers, and a report that renders them the same is worse than no report.<br><br>
      <b>What can be re-run.</b> Everything. <code>node scripts/advantage-report.mjs</code> writes the JSON this page is generated from; the endpoints it calls are public, need no key, and are the same ones any caller gets.
    </div>

${report.tasks.map(taskCard).join('\n')}

    <h2 style="font-family:'Space Grotesk',system-ui,sans-serif;font-size:20px;margin:30px 0 12px">What this does and does not show</h2>
    <ul class="caveats">
      ${report.caveats.map((c) => `<li>${esc(c)}</li>`).join('\n      ')}
      <li>Every endpoint used on the agent side is free and unauthenticated. The cost difference in this report is not a subscription — it is a person.</li>
    </ul>

    <div class="foot">
      Raw measurement: <a href="/api-advantage.json">/api-advantage.json</a> &middot; measured ${esc(report.measured_at)} against <code>${esc(report.rpc)}</code> on ${esc(report.chain)}.<br>
      The agent side is <code>/api/fee-tiers</code>, <code>/api/pool-scan</code> and <code>agent.brainonbnb.com/find</code> — the same public endpoints documented on <a href="/registry">Brain Plaza</a>. The hand-done side is <code>scripts/advantage-report.mjs</code>, published with the rest of the source at <a href="/source">/source</a>.
    </div>
  </section>

<footer><div class="fi2">
  <div class="fb"><img src="/logo-sm.webp" width="96" height="96" alt=""><span>BOBAI</span></div>
  <div class="fm">
    <p>Both paths measured from one machine in one run &middot; the raw measurement is <a href="/api-advantage.json">/api-advantage.json</a> &middot; the script that produced it is published at <a href="/source">/source</a></p>
    <p style="margin-top:6px;opacity:.75">Made by <a href="/">Brain On BNB AI</a> &middot; <a href="/registry">Brain Plaza</a> &middot; <a href="/whitepaper">Whitepaper</a></p>
  </div>
</div></footer>
</div>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'dashboard', 'advantage.html'), html);
// The raw file next to the page, so the claim and its evidence ship together.
fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-advantage.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`wrote dashboard/advantage.html (${(html.length / 1024).toFixed(1)} KB) and dashboard/api-advantage.json`);
console.log(`  hand-done path answered ${answeredManually} of ${report.tasks.length}; agent answered ${answeredByAgent} of ${report.tasks.length}`);
