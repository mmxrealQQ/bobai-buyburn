// Leaderboard snapshot for Matchday 3 — 16-fan stadium tribune, NO floating text outside placards.
// Landscape 3:2 (1536x1024), gpt-image-2 high quality, fans (not players in kits).
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-leaderboard-snapshot-md3.js

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

const PROMPT = `Cinematic fan-tribune banner for BOBAI Worldcup '26 — a FIFA 2026 World Cup crypto prediction tipgame on BNB Chain. Visualizes the 16 tippers currently in the payout zone heading into Matchday 3 of the group stage. Vibe: ONE super-cool multi-national BOBAI fan community celebrating together — arms around shoulders, shared scarves stretched between two fans, ultras-section energy, "we already won" mood.

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. Images 1, 2 and 3 are the PRIMARY MASTER CHARACTER SHEET — every BOBAI fan in the banner must look EXACTLY like that character: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). All 16 fans are IDENTICAL BOBAI characters, only differing in country gear (jersey, scarf, flag) and the prize placard.

NO BANNER TEXT, NO TITLE, NO URL, NO CAPTION, NO LEADERBOARD UI, NO TABLES, NO LOGO STRIP, NO HANDHELD SIGNS, NO PLACARDS, NO PRICE TAGS, NO DOLLAR AMOUNTS ANYWHERE. The image must contain NO floating UI text and NO numbers — the ONLY text visible in the entire image is the NICKNAME printed in big bold caps across the FRONT CHEST of each fan's jersey. Nothing else, no exceptions.

EACH FAN IS DRESSED AS A REAL FAN, NOT A PLAYER ON THE PITCH:
- wears their country's home JERSEY (Trikot) with their NICKNAME printed huge across the chest in bold all-caps (this is how they identify themselves in the picture)
- their country's SCARF either worn around the neck OR stretched wide above the head between two friends
- holds a large country FLAG on a short pole, waved or draped over their shoulders cape-style
- two vertical stripes of country-color FACE PAINT on each cheek
- HANDS FREE for cheering, scarves, flags, or arms around friends — NO placards, NO signs, NO cards with text or numbers

COMMUNITY FRAMING — the 16 fans are NOT lined up in stiff rows. They form ONE warm, packed ultras crowd. Many have arms around each other's shoulders; some lean cheek-to-cheek; some hoist a friend up; scarves cross between fans of different countries. Mixed nationalities celebrating side by side. Eye contact toward camera, big grins, mouths open mid-chant. Three loose tiers of depth (front closest and largest, middle behind, back tallest at top), but the rows blur into one big celebrating group.

FRONT TIER (5 fans, largest in frame, closest to camera, left to right):
- Fan 1 — FRANCE home jersey (navy-blue with white+red trim, gold star above crest). Chest reads "MMX_QQ" in bold white caps. Wears a navy-white-red French tricolor scarf around the neck. Waves a large French flag. Pose: both arms raised, ecstatic cheer, leaning shoulder-to-shoulder with Fan 2.
- Fan 2 — SPAIN home jersey (bright red with yellow trim, navy shorts). Chest reads "BESO2025" in bold white caps. Spanish red+yellow scarf stretched wide overhead together with Fan 5. Mini Spain flag tucked behind ear. Mouth open mid-chant.
- Fan 3 — SPAIN home jersey (red, yellow trim). Chest reads "ELFE" in bold white caps. Red+yellow scarf around neck, large Spain flag draped cape-style over shoulders. Pose: fist pumped, leaning on Fan 4's shoulder.
- Fan 4 — SAUDI ARABIA home jersey (white with green trim and palm-tree crest, white shorts). Chest reads "MEZIN" in bold green caps. Green+white Saudi scarf around the neck, waves a green Saudi flag on a short pole. Clapping above head.
- Fan 5 — SPAIN home jersey (red). Chest reads "TASITALIA" in bold white caps. Holds the OTHER end of the long Spanish scarf stretched between Fan 2 and Fan 5. Jumping mid-air, free hand in the air.

MIDDLE TIER (5 fans, behind the front, left to right, arms over each other's shoulders):
- Fan 6 — NETHERLANDS home jersey (bright orange with black trim). Chest reads "MANSOUR" in bold black caps. Orange wig + orange face stripes, classic Dutch ultras look. Waves a large Netherlands flag.
- Fan 7 — TÜRKİYE home jersey (solid red with white crescent-moon-and-star crest, white shorts). Chest reads "MUVAZZAF" in bold white caps. Red Türkiye scarf, big Turkish flag draped cape-style, arm around Fan 6.
- Fan 8 — USA home jersey (white with red-and-blue stripe trim). Chest reads "WHALE123" in bold navy caps. Stars-and-stripes face paint, waves a large US flag.
- Fan 9 — GERMANY home jersey (white with black trim, three-stripe sleeves). Chest reads "PRINCE27" in bold black caps. Black-red-gold scarf, German flag draped cape-style, both arms thrown around Fan 8 and Fan 10.
- Fan 10 — TÜRKİYE home jersey (red, crescent-and-star). Chest reads "KOV4OY" in bold white caps. Red Türkiye scarf, waves Turkish flag.

BACK TIER (6 fans, tallest in frame, slightly blurred for depth, left to right, scarves raised overhead):
- Fan 11 — TÜRKİYE home jersey (red, crescent-and-star). Chest reads "DGN" in bold white caps. Holds a smoking-red flare like ultras, Turkish flag draped.
- Fan 12 — PORTUGAL home jersey (deep maroon-red with green collar trim). Chest reads "TOM" in bold gold caps. Maroon-green scarf stretched overhead.
- Fan 13 — SPAIN home jersey (red). Chest reads "BENJAMIN_FR" in bold white caps. Spanish scarf, Spain flag draped.
- Fan 14 — SWITZERLAND home jersey (solid red with a large white Swiss cross on chest as the kit motif). Chest reads "_PW" in bold white caps (placed just below the Swiss cross so both are clearly visible). Red+white scarf, Swiss flag draped.
- Fan 15 — EGYPT home jersey (red with white trim, golden eagle crest). Chest reads "ABDOABODEIF" in bold white caps. Red+white+black Egyptian scarf, Egyptian flag draped over shoulder.
- Fan 16 — EGYPT home jersey (red, white trim). Chest reads "MEDOABODEIF" in bold white caps. Egyptian scarf and flag, scarf stretched overhead together with Fan 15.

JERSEY-CHEST TEXT RULES (CRITICAL):
- Every nickname appears LARGE on the FRONT CHEST of the jersey (this is the main identifier — fans need to spot themselves at a glance), NOT on the back.
- Spelled EXACTLY as given, character-for-character. Underscores and digits rendered literally: "MMX_QQ", "BESO2025", "_PW", "WHALE123", "KOV4OY", "BENJAMIN_FR", "PRINCE27" appear exactly as written.
- Bold oversized sans-serif, high contrast against the jersey color (white text on red/navy/maroon, black text on white/orange, navy on white, gold on maroon).

BACKGROUND: Packed stadium stands behind the 16 fans, blurred crowd of generic silhouettes cheering, soft warm golden-hour sunlight pouring in from the right. Stadium light glow with subtle BNB-chain-style honeycomb hex patterns woven into the lens flare. Gentle golden confetti drifting through the air. National flag bunting strung along the upper edge of the frame: France, Spain, Saudi Arabia, Netherlands, Türkiye, USA, Germany, Portugal, Switzerland, Egypt. Atmosphere: euphoric, premium, ONE multi-national BOBAI family, "we already won" energy.

COLOR PALETTE: Black/dark-navy base, BOBAI signature gold (#F0B90B) accents in stadium light glow, deep BNB yellow highlights, vivid Spain red+yellow, France navy, Saudi green, Netherlands orange, Türkiye red, USA red+white+blue, Germany black+red+gold, Portugal maroon, Switzerland red, Egypt red+black. High contrast, vibrant.

COMPOSITION: Landscape 3:2 aspect. Cinematic crowd hero shot. All 16 fans clearly visible and individually recognizable — every jersey chest nickname legible, no overlapping faces. Strong central focal point on FRONT TIER fan 1 (MMX_QQ, France). Symmetrical, balanced framing. Highly detailed BOBAI faces. Premium feel.

DO NOT include: FIFA logo, FIFA wordmark, real sponsor logos, real player faces, realistic human faces, watermarks, dates, percentages, dollar amounts, numbers on signs or placards, handheld signs, cardboard cards, URLs, titles, captions, or any floating text. The ONLY text visible in the entire image is the 16 nicknames printed on the 16 jersey chests. Nothing else.`;

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

  console.log('Calling OpenAI gpt-image-2 (high quality, 1536x1024, 6 refs, 16-fan tribune)...');
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
  const outMain   = path.join(OUT_DIR, 'worldcup-x-leaderboard-md3.png');
  const outBackup = path.join(OUT_DIR, `worldcup-x-leaderboard-md3-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
