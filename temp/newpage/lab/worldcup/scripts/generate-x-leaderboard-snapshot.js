// One-off: leaderboard snapshot banner for X-post — 14-mascot team photo, NO text overlay.
// Landscape 3:2 (1536x1024), gpt-image-2 (opaque hero), names printed on jerseys.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-leaderboard-snapshot.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/worldcup';

const REF_MAIN = path.join(REFS_DIR, '1.jpg');
const REF_2    = path.join(REFS_DIR, '2.jpg');
const REF_3    = path.join(REFS_DIR, 'avatar-DZ.jpg');
const REF_4    = path.join(REFS_DIR, 'argentinia.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Cinematic team-photo banner for BOBAI Worldcup '26 — a FIFA 2026 World Cup crypto prediction tipgame on BNB Chain. Visualizes the 14 tippers currently in the payout zone after Matchday 1.

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. Images 1, 2 and 3 are the PRIMARY MASTER CHARACTER SHEET — every mascot in the banner must look EXACTLY like that character: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). All 14 mascots are IDENTICAL characters, only differing in jersey + jersey print.

NO BANNER TEXT, NO TITLE, NO URL, NO CAPTION. The image must contain NO floating UI text whatsoever — the ONLY text in the image is what is PRINTED ON THE FRONT OF EACH JERSEY (each mascot's nickname across the chest in bold all-caps, plus their rank number on a shoulder badge).

SCENE — winning team photo composition, like a championship squad lineup, three rows on a stadium pitch at golden hour. 14 BOBAI mascots arranged as follows:

FRONT ROW (3 mascots, on a low 3-tier winner's podium centered in frame, gold step in middle, silver to the left, bronze to the right):
- GOLD step center, slightly taller: BOBAI in SPAIN home kit (bright red jersey, navy-blue shorts, gold trim). Jersey chest reads "BENJAMIN_FR" in large bold white capital letters. Shoulder badge: "1". Pose: holding a glowing golden football trophy aloft with both hands, triumphant smile.
- SILVER step left: BOBAI in BRAZIL home kit (canary yellow jersey with green collar trim, blue shorts). Jersey chest reads "MANSOUR" in large bold green capital letters. Shoulder badge: "2". Pose: fist pumped in the air.
- BRONZE step right: BOBAI in SPAIN home kit (red jersey, navy shorts). Jersey chest reads "BESO2025" in large bold white capital letters. Shoulder badge: "3". Pose: arms wide open cheering.

MIDDLE ROW (6 mascots kneeling on one knee behind the podium, left to right):
- BOBAI in SAUDI ARABIA home kit (white jersey with green trim and palm-tree crest, white shorts). Chest reads "MEZIN" in bold green caps. Shoulder badge: "4".
- BOBAI in FRANCE home kit (navy-blue jersey, white shorts, red socks). Chest reads "MMX_QQ" in bold white caps. Shoulder badge: "5".
- BOBAI in TÜRKİYE home kit (solid red jersey with white crescent-moon-and-star, white shorts). Chest reads "MUVAZZAF" in bold white caps. Shoulder badge: "6".
- BOBAI in EGYPT home kit (red jersey with white trim, white shorts). Chest reads "MEDOABODEIF" in bold white caps. Shoulder badge: "7".
- BOBAI in TÜRKİYE home kit (red jersey with crescent-and-star). Chest reads "DGN" in bold white caps. Shoulder badge: "8".
- BOBAI in PORTUGAL home kit (deep maroon-red jersey with green trim). Chest reads "TOM" in bold gold caps. Shoulder badge: "9".

BACK ROW (5 mascots standing tallest behind the kneelers, left to right):
- BOBAI in SWITZERLAND home kit (solid red jersey with a large white Swiss cross on the chest). Chest reads "_PW" in bold white caps. Shoulder badge: "10".
- BOBAI in SPAIN home kit (red jersey, navy shorts). Chest reads "ELFE" in bold white caps. Shoulder badge: "11".
- BOBAI in USA home kit (white jersey with red-and-blue trim and US-stripe motif). Chest reads "WHALE123" in bold navy caps. Shoulder badge: "12".
- BOBAI in SPAIN home kit (red jersey). Chest reads "TASITALIA" in bold white caps. Shoulder badge: "13".
- BOBAI in USA home kit (white jersey with red-and-blue trim). Chest reads "HAVY" in bold navy caps. Shoulder badge: "14".

JERSEY TEXT RULES (CRITICAL):
- Every nickname appears on the FRONT-CHEST of its jersey, NOT the back, NOT floating.
- Every nickname is spelled EXACTLY as given. Each name is unique. Underscores and digits must be rendered literally (so "MMX_QQ", "_PW", "BESO2025", "WHALE123" appear character-for-character).
- Large legible bold sans-serif (think: oversized squad-name printing). High contrast against jersey color.
- Shoulder badge with rank number is a small circular gold patch with the number in black.

BACKGROUND: Wide football stadium pitch at golden-hour, soft warm sun, blurred stands packed with cheering crowd, glowing geometric BNB-chain-style honeycomb patterns subtly woven into the stadium-light glow. Gentle golden confetti drifting. National flag bunting strung above the back row showing Spain, Brazil, Saudi Arabia, France, Türkiye, Egypt, Portugal, Switzerland, USA flags. Atmosphere: epic, premium, celebratory.

COLOR PALETTE: Black/dark-navy base, BOBAI signature gold (#F0B90B) accents, deep BNB yellow highlights, vivid Spain red, Brazil yellow, Saudi green, France navy, Türkiye red, Switzerland red, USA white-red-blue, Portugal maroon. High contrast, vibrant.

COMPOSITION: Landscape 3:2 aspect. Cinematic hero squad shot. All 14 mascots clearly visible and individually recognizable — no overlapping faces, no obscured jersey text. Strong central focal point on the gold-step BENJAMIN_FR. Symmetrical, balanced. Highly detailed faces. Premium feel.

DO NOT include: FIFA logo, FIFA wordmark, real sponsor logos, real player faces, realistic human faces, watermarks, dates, percentages, dollar values, URLs, titles, captions, or ANY floating text. The ONLY text visible is on the jerseys themselves (names + shoulder rank badges).`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate() {
  const refs = [REF_MAIN, REF_MAIN, REF_MAIN, REF_2, REF_3, REF_4];
  const bufs = await Promise.all(refs.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  bufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-2 (high quality, 1536x1024, 6 refs, 14-mascot team photo)...');
  const t0 = Date.now();
  const res = await fetch(API_EDIT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI edits HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in response: ${text.slice(0, 300)}`);
  const raw = Buffer.from(b64, 'base64');
  console.log(`Got image in ${((Date.now() - t0)/1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T.]/g,'-').slice(0,19);
  const outMain   = path.join(OUT_DIR, 'worldcup-x-leaderboard-md1.png');
  const outBackup = path.join(OUT_DIR, `worldcup-x-leaderboard-md1-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
