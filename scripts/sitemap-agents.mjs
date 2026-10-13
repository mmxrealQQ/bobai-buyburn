// The agent charts in the sitemap (2026-10-13). brainonbnb.com/agent/<id> is a measured page per agent — the thing an
// AI or a search engine should find when it looks for "which agent on BNB Chain works" — and none of them was in the
// sitemap. This writes the measured ones (evidence score above zero, at least one day of pulse, or ours) between two
// markers in dashboard/sitemap.xml, from the live screener; the rest of the file stays hand-kept.
//   node scripts/sitemap-agents.mjs            (then deploy)
//   node scripts/sitemap-agents.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'dashboard', 'sitemap.xml');
const START = '<!-- agent charts: scripts/sitemap-agents.mjs -->', END = '<!-- /agent charts -->';

export function block(rows, day) {
  const urls = rows.map((id) => `  <url>\n    <loc>https://brainonbnb.com/agent/${id}</loc>\n    <lastmod>${day}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`);
  return `${START}\n${urls.join('\n')}\n  ${END}`;
}
export function splice(xml, b) {
  const i = xml.indexOf(START), j = xml.indexOf(END);
  if (i >= 0 && j > i) return xml.slice(0, i) + b + xml.slice(j + END.length);
  return xml.replace('</urlset>', `  ${b}\n</urlset>`);
}

if (process.argv.includes('--self-test')) {
  const base = '<?xml version="1.0"?>\n<urlset>\n  <url><loc>https://brainonbnb.com/</loc></url>\n</urlset>\n';
  const once = splice(base, block([1, 2], '2026-10-13')), twice = splice(once, block([3], '2026-10-14'));
  const ok = once.includes('/agent/1') && once.includes('/agent/2') && twice.includes('/agent/3') && !twice.includes('/agent/1') && twice.split(START).length === 2 && twice.endsWith('</urlset>\n');
  console.log(ok ? 'the block is written once and replaced, never doubled' : 'FAIL: splice'); process.exit(ok ? 0 : 1);
}

const j = await (await fetch('https://agent.brainonbnb.com/screener')).json();
const F = j.fields, rows = j.rows.map((r) => Object.fromEntries(F.map((f, i) => [f, r[i]])));
const pick = rows.filter((a) => a.score > 0 || a.days > 0 || a.ours).sort((a, b) => b.score - a.score || a.id - b.id).map((a) => a.id);
const xml = splice(fs.readFileSync(FILE, 'utf8'), block(pick, new Date().toISOString().slice(0, 10)));
fs.writeFileSync(FILE, xml);
console.log(`sitemap: ${pick.length} agent charts written (of ${rows.length} in the screener)`);
