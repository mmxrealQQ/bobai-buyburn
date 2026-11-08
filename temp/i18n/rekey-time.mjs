// one-off (8.11.): a time "10:41" became ONE token in core.js; entries that had "{a}:{b}" get "{a}" and their
// placeholders renumbered in key order, in the key and in the Arabic alike. Runs on dashboard/i18n/ar.json and temp/i18n/ar-*.json.
import fs from 'node:fs';
const fix = (k, v) => {
  if (!/\{\d+\}:\{\d+\}/.test(k)) return null;
  const join = (s) => s.replace(/\{(\d+)\}:\{(\d+)\}/g, '{$1}');
  const k1 = join(k), v1 = join(v);
  const order = [...k1.matchAll(/\{(\d+)\}/g)].map((m) => m[1]);
  const map = Object.fromEntries(order.map((o, i) => [o, String(i)]));
  const ren = (s) => s.replace(/\{(\d+)\}/g, (m, d) => '{' + (map[d] ?? 'X' + d) + '}');
  return [ren(k1), ren(v1)];
};
const files = ['D:/ai/fourmeme/dashboard/i18n/ar.json', ...fs.readdirSync('D:/ai/fourmeme/temp/i18n').filter((f) => /^ar-.*\.json$/.test(f)).map((f) => 'D:/ai/fourmeme/temp/i18n/' + f)];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8')), t = j.t || j, out = {};
  let n = 0;
  for (const [k, v] of Object.entries(t)) { const r = fix(k, v); if (r) { out[r[0]] = r[1]; n++; } else out[k] = v; }
  if (j.t) j.t = out;
  fs.writeFileSync(f, JSON.stringify(j.t ? j : out, null, j.t ? 0 : 1) + '\n');
  console.log(f.split('/').pop(), n, 'rekeyed');
}
