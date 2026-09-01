// Packs skills/<name>/ into the tarball that brainonbnb.com serves, so any
// agent can install it with `npx skills add <url>`.
//
// The chain layer is PULLED from dashboard/scanner-chain.js at build time
// rather than kept as a second copy in the skill folder. That is the whole
// point of this script: the impact formulas, the verified fee table and the
// tax measurement exist once. A skill shipping its own drifted copy would put
// a wrong cost column in somebody else's agent, which is worse than shipping
// nothing.
//
// Usage:
//   node scripts/build-skill.mjs            build
//   node scripts/build-skill.mjs --verify   build, then check the live URL
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'dashboard', 'skills');
const BASE = 'https://brainonbnb.com';

// Files the skill folder does not own. Source path -> name inside the tarball.
// Both layers are pulled: scanner-scan.js decides what to measure, and
// scanner-chain.js does the arithmetic. The skill folder holds neither — only
// the thin CLI that calls them.
const PULLED = {
  'dashboard/scanner-chain.js': 'scripts/scanner-chain.mjs',
  'dashboard/scanner-scan.js': 'scripts/scanner-scan.mjs',
  'dashboard/tier-scan.js': 'scripts/tier-scan.mjs',
  'dashboard/range-scan.js': 'scripts/range-scan.mjs',
};

const SKILLS = ['bsc-pool-depth'];

const readFrontmatter = (md) => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('SKILL.md has no YAML frontmatter — the installer will refuse it');
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (kv && kv[2] !== '') out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  for (const req of ['name', 'description', 'version', 'license'])
    if (!out[req]) throw new Error(`SKILL.md frontmatter is missing required field: ${req}`);
  return out;
};

const index = [];
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const name of SKILLS) {
  const src = path.join(ROOT, 'skills', name);
  const skillMd = fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8');
  const fm = readFrontmatter(skillMd);
  if (fm.name !== name)
    throw new Error(`frontmatter name "${fm.name}" does not match folder "${name}"`);

  // Staged in a temp dir so the pulled files land under their tarball names
  // without ever being written back into skills/ — nothing there is a copy.
  const stage = path.join(OUT_DIR, '.stage', name);
  fs.rmSync(path.join(OUT_DIR, '.stage'), { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'scripts'), { recursive: true });

  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    if (f.isDirectory()) {
      for (const g of fs.readdirSync(path.join(src, f.name)))
        fs.copyFileSync(path.join(src, f.name, g), path.join(stage, f.name, g));
    } else fs.copyFileSync(path.join(src, f.name), path.join(stage, f.name));
  }
  for (const [from, to] of Object.entries(PULLED)) {
    // Renamed on the way in, and the imports renamed with them. The site serves
    // these as .js; a bare .js inside a folder with no package.json is CommonJS
    // to Node, so the skill needs .mjs or `import` throws on the installer's
    // machine and not on ours. Rewriting the specifier is the other half of
    // that rename — without it the file lands correctly and fails to resolve.
    let src = fs.readFileSync(path.join(ROOT, from), 'utf8');
    for (const other of Object.values(PULLED)) {
      const base = path.basename(other, '.mjs');
      src = src.split("'./" + base + ".js'").join("'./" + base + ".mjs'");
    }
    fs.writeFileSync(path.join(stage, to), src);
  }

  // Three things the packing has to get right, all of which fail quietly:
  //
  // Relative arguments only. GNU tar reads a leading "D:" as host:path and
  // tries to open an rsh connection, so an absolute Windows path fails outright.
  //
  // No wrapping folder. The installer does files.get("SKILL.md") against the
  // archive root; with the skill in a "<name>/" subdirectory that lookup
  // returns nothing and the whole entry is skipped with "no skills found" and
  // no indication that the archive was reached, downloaded and discarded.
  const tar = path.join(OUT_DIR, `${name}.tar.gz`);
  // Byte-identical output for identical input, which is not cosmetic here: the
  // manifest carries the tarball's digest, so a build that changes the bytes
  // without changing the content invalidates every deployed copy and makes
  // --verify report a failure that is really just a second build. tar's own -z
  // writes the current time into the gzip header, so the tar is made plain and
  // deflated separately — node's zlib writes MTIME 0.
  const members = fs.readdirSync(path.join(OUT_DIR, '.stage', name)).sort();
  const plain = `${name}.tar`;
  execFileSync('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-cf', plain, '-C', path.join('.stage', name), ...members,
  ], { cwd: OUT_DIR, stdio: 'inherit' });
  fs.writeFileSync(tar, zlib.gzipSync(fs.readFileSync(path.join(OUT_DIR, plain)), { level: 9 }));
  fs.rmSync(path.join(OUT_DIR, plain));
  fs.rmSync(path.join(OUT_DIR, '.stage'), { recursive: true, force: true });

  const bytes = fs.statSync(tar).size;
  const sha = createHash('sha256').update(fs.readFileSync(tar)).digest('hex');
  // Field names are the discovery spec's, not ours: an entry missing `type` or
  // carrying a bare hex `sha256` instead of `digest: "sha256:…"` is skipped
  // silently by the installer, which then reports "no skills found" and gives
  // no hint as to why. version/license are extras the validator ignores; they
  // are here for anyone reading the manifest by hand.
  index.push({
    name: fm.name,
    description: fm.description,
    type: 'archive',
    url: `${BASE}/skills/${name}.tar.gz`,
    digest: `sha256:${sha}`,
    version: fm.version,
    license: fm.license,
    bytes,
  });
  if (fm.description.length > 1024) throw new Error('description exceeds the 1024-char discovery limit');
  if (!/^[a-z0-9-]+$/.test(fm.name) || fm.name.includes('--'))
    throw new Error(`"${fm.name}" is not a valid skill name (lowercase, digits and single hyphens only)`);
  console.log(`built ${name}  ${(bytes / 1024).toFixed(1)} KB  sha256:${sha.slice(0, 16)}…`);
}

// The manifest the installer looks for when handed the bare domain. $schema is
// not decoration — without this exact string the index is parsed as the legacy
// v1 format, which expects inline `files` and rejects archive entries outright.
const manifest = { $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills: index };
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote dashboard/skills/index.json (${index.length} skill${index.length === 1 ? '' : 's'})`);

if (process.argv.includes('--verify')) {
  // Checked against the manifest just written, which is only meaningful because
  // the tarball is byte-reproducible. Before it was, every --verify rebuilt a
  // differently-stamped archive and then reported the live copy as wrong —
  // a failure invented by the check itself.
  console.log('\nverifying against live site…');
  let bad = 0;
  const check = async (url, want) => {
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    const body = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') || '';
    // A catch-all SPA route answers 200 with HTML for absolutely any path, so a
    // status check alone proves nothing. The body has to be what we shipped.
    const isHtml = body.slice(0, 200).toString('utf8').toLowerCase().includes('<!doctype html');
    const ok = r.ok && !isHtml && (want ? createHash('sha256').update(body).digest('hex') === want : true);
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${url}  [${r.status} ${ct}${isHtml ? ' — HTML fallback!' : ''}]`);
    if (!ok) bad++;
  };
  for (const s of index) await check(s.url, s.digest.slice(7));
  // The installer tries agent-skills first, then skills. Both are served, so
  // both are checked — a fallthrough on either is a routing bug.
  await check(`${BASE}/.well-known/agent-skills/index.json`, null);
  await check(`${BASE}/.well-known/skills/index.json`, null);
  if (bad) {
    console.error(`\n${bad} check(s) failed — not live yet, or routing is falling through to the SPA.`);
    process.exit(1);
  }
  console.log('\nall live. install with:');
  console.log(`  npx skills add ${BASE}`);
}
