// RETIRED 2026-11-16 (operator's choice "b"). From 13.10. this wrote the measured agent charts, brainonbnb.com/agent/<id>,
// into dashboard/sitemap.xml, and the site worker did the same live. But the agent page has said noindex since it was
// built (12.10.), so 873 sitemap entries asked a search engine to read pages it was told not to keep. They are out now:
// the static block is empty and the worker adds none.
//
// What is left is the guard, so the block does not come back by habit:
//   node scripts/sitemap-agents.mjs --self-test    no /agent/<id> in the sitemap file, none added by the worker
//   node scripts/sitemap-agents.mjs                says it is retired, writes nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xml = fs.readFileSync(path.join(ROOT, 'dashboard', 'sitemap.xml'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'dashboard', '_worker.js'), 'utf8');
const agentHtml = fs.readFileSync(path.join(ROOT, 'dashboard', 'agent.html'), 'utf8');

if (process.argv.includes('--self-test')) {
  const fails = [];
  if (/<loc>https:\/\/brainonbnb\.com\/agent\//.test(xml)) fails.push('sitemap.xml lists /agent/<id>');
  if (/<loc>https:\/\/brainonbnb\.com\/agent\/\$\{/.test(worker)) fails.push('the worker writes /agent/<id> into the sitemap');
  // the reason holds only while the page is noindex: if it is ever indexed again, this guard has to be rethought
  if (!/<meta name="robots" content="noindex">/.test(agentHtml)) fails.push('agent.html is no longer noindex — decide again whether its charts belong in the sitemap');
  console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'no agent chart in the sitemap, and the agent page is noindex — the two agree');
  process.exit(fails.length ? 1 : 0);
}
console.log('retired 2026-11-16: /agent/<id> is noindex and stays out of the sitemap — nothing written');
