// Generiert alle brainScreener-Bilder im BOBAI-Look via OpenAI gpt-image-2.
// Gleiche Motive wie adhsiq.ch, aber BOBAI-Palette (deep navy + gold).
// Hero + OG nutzen den BOBAI-Mascot mit Character-Refs (edits-Endpoint).
// Ausfuehren: node scripts/generate-brainscreener-images.mjs [--force] [--only=a,b]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "dashboard", "brainscreener", "assets", "images");
const REFS = [
  path.join(ROOT, "dashboard", "hero.png"),
  path.join(ROOT, "dashboard", "worldcup", "_refs", "1.jpg"),
  path.join(ROOT, "dashboard", "worldcup", "_refs", "4.jpg"),
];

async function loadEnv() {
  const raw = await fs.readFile(path.join(ROOT, ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const STYLE_BASE = `
Style: editorial, premium, calm, modern. Dark high-end tech-finance aesthetic:
deep space navy background (#050510), luminous golden accents (#F0B90B and softer #ffd54f),
subtle warm glow, very fine grain, soft diffuse light, lots of negative space,
quiet composition. NO text, NO watermarks, NO letters, NO clichéd symbols
(no lightbulb-brain, no puzzle pieces). Dignified and elegant — like a cover
illustration for a premium magazine. Dark mode.
`.trim();

const MASCOT_LOCK = `
The BOBAI mascot from the reference images: a friendly golden-suited character with a
pink brain head and confident smile. Reproduce the character EXACTLY as in the references
(same brain shape, same face, same golden suit). Render him LARGE with his face clearly visible.
IMPORTANT: composed, calm and dignified — NOT exaggerated, NOT meme-style, NOT cartoonish
action. He appears serious and thoughtful, matching a high-end editorial magazine
illustration. Subtle presence, quiet confidence.
`.trim();

const IMAGES = [
  {
    name: "hero",
    size: "1536x1024",
    refs: true,
    prompt: `${STYLE_BASE}
Motif: A delicate anatomical study, drawn in fine luminous golden ink on deep navy paper —
like an editorial cover illustration in a medical-philosophical magazine (New Yorker /
Nautilus style). It shows the HEAD OF THE BOBAI CHARACTER from the reference images in
SIDE PROFILE: his characteristic pink brain on top of the head, his friendly facial
features — but rendered as a refined, quiet LINE-ART ILLUSTRATION, merging into
organically flowing lines reminiscent of neural connections that drift off the profile
into the dark — very subtle, almost like ink on old paper. The brain is softly shaded
in muted rose, the flowing lines and accents in luminous gold.
NOT a 3D render, NOT glossy, NOT a mascot photo, NO golden suit, NO full body —
just the dignified profile study. Mood: thoughtful, dignified, inviting. Wide aspect ratio.`,
  },
  {
    name: "og-image",
    size: "1536x1024",
    refs: true,
    prompt: `${STYLE_BASE}
Motif: Social media preview image (Open Graph) for a library of anonymous psychological
self-tests. A delicate anatomical study in fine luminous golden ink on deep navy paper:
the HEAD OF THE BOBAI CHARACTER from the reference images in SIDE PROFILE on the RIGHT
third of the image — his characteristic pink brain on top, friendly features — as a
refined quiet LINE-ART ILLUSTRATION with organically flowing golden neural lines
drifting off the profile. Clearly more empty negative space in the LEFT half (that
space stays deliberately empty and calm). NOT a 3D render, NOT glossy, NO golden suit,
NO full body. NO text, NO letters, NO logo. Wide aspect.`,
  },
  {
    name: "adhs-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbolic, very calm depiction of the concept "attention and focus". A single sharp,
clear luminous golden point at the center, surrounded by blurred, semi-transparent
concentric waves or strokes fraying outward into the dark. Like a zen, minimalist still
life. Deep navy tones, muted. Square format.`,
  },
  {
    name: "iq-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Abstract geometric composition symbolising cognitive clarity. Three to five
precisely placed geometric shapes (circle, triangle, hexagon) in subtle overlap,
connected with fine lines — like from an architect's sketchbook. Deep navy background,
lines in soft warm grey-gold, one single element in luminous gold. Very minimalist,
Bauhaus-inspired, modern. Square format.`,
  },
  {
    name: "charakter-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for the many facets of a character. Four softly merging, semi-transparent
colour fields or broad brushstrokes — in luminous gold (#F0B90B), muted teal blue (#4FA3B8),
warm red (#ff5a4f) and silver grey (#9aa0b5) — overlapping and interpenetrating into a
single calm circular sphere. NO face, NO masks, NO clichés, no text. Lots of dark navy
negative space. Noble and multilayered, like an abstract personality emblem. Square format.`,
  },
  {
    name: "method",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: An open premium notebook on a dark wooden desk at night. On the page: fine
hand-drawn sketches of diagrams, distribution curves, lines in glowing golden ink —
but unreadable/abstract, NO text, NO readable numbers. Next to it a small warm lamp glow
from the upper left, a fountain pen. Symbolises scientific-methodical care. Dark,
warm, editorial. Square format.`,
  },
  {
    name: "phq9-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbolic, calm depiction of the concept "mood and severity". A single, half-veiled
golden sun behind soft, elongated horizontal bands of dark clouds, in muted deep navy
tones, with a very fine golden streak of light at the horizon. Like a meditative sunrise
in the stillness of a winter morning at night's edge. Very restrained, dignified. Square format.`,
  },
  {
    name: "gad7-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for tension and its release. A single, very finely drawn spiral that
unwinds from dense coils at the centre outward and ends in a straight, calm line.
Luminous gold line on deep navy, one softer grey-gold accent line. Very minimalist,
almost zen-buddhist in its clarity. Square format.`,
  },
  {
    name: "pcl5-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for trauma and healing. A single Japanese kintsugi element: a softly
fragmented oval form (like a stone or ceramic object) in muted dark blue-grey, whose
cracks are filled with fine luminous gold lines. Symbolises breakage and healing at once.
Deep navy background. Square format.`,
  },
  {
    name: "ocir-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for order, repetition and letting go. Seven or eight precise small squares
in a row, one of them slightly shifted out of the grid, the others exactly aligned.
Fine warm grey-gold outlines on deep navy, the shifted square in luminous gold.
Very calm, almost architecturally strict. Square format.`,
  },
  {
    name: "eat26-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Still life — a single, very simple dark ceramic bowl on a dark wooden table,
photographed slightly elevated from above. The bowl is half filled with water catching
a single golden glint of light; a single olive branch rests at its edge. Soft diffuse
low light, lots of dark negative space around it. Mood: calm mindfulness, neither
craving nor rejecting. Square format.`,
  },
  {
    name: "audit-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: A single empty cocktail glass of clear, very fine crystal, on a deep navy
background, soft play of shadows and a warm golden rim light. The glass stands upright,
empty, with a very thin golden edge. Symbolises mindfulness towards alcohol, no judgement.
Very minimalist, a studio still life in editorial quality. Square format.`,
  },
  {
    name: "mdq-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for mood swings. Two gently curved, intertwined wave lines (one in luminous
gold, one in soft blue-grey) flowing across the image in a calm movement like mountain
silhouettes or sine curves. A single luminous golden point at the centre where they cross.
Very meditative, abstract, on deep navy. Square format.`,
  },
  {
    name: "aq50-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for perception, patterns and depth of detail. A very finely drawn honeycomb
structure (hexagons), especially precise and detailed at the centre of the image and
becoming more diffuse and soft toward the edges. Fine warm grey-gold lines on deep navy,
individual hexagons accented in luminous gold. Homage to neurodivergent detail perception,
without clichéd puzzle motif. Square format.`,
  },
  {
    name: "bfi2-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Five abstract vertical lines of different heights and saturation, side by side,
like an abstract personality profile or a calm bar chart. Colours: luminous gold, soft
gold, blue-grey, silver grey, warm off-white — each line in a different tone, on deep
navy. Very Bauhaus-inspired, minimalist. Square format.`,
  },
  {
    name: "whodas36-card",
    size: "1024x1024",
    prompt: `${STYLE_BASE}
Motif: Symbol for functioning and participation. Six very finely drawn, interconnected
circles in a calm hexagonal arrangement — like an abstract relationship network or an
ICF diagram in editorial aesthetics. Fine warm grey-gold lines on deep navy, a single
circle elevated in luminous gold. Symbolises connection between health domains. Square format.`,
  },
];

let sharp;
try { sharp = (await import("sharp")).default; } catch { console.error("sharp fehlt"); process.exit(1); }

async function generateOne(item) {
  console.log(`-> ${item.name} (${item.size}${item.refs ? ", mit Character-Refs" : ""}) ...`);
  let res;
  if (item.refs) {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", item.prompt);
    form.append("size", item.size);
    form.append("quality", "high");
    for (const r of REFS) {
      const buf = await fs.readFile(r);
      const type = r.endsWith(".png") ? "image/png" : "image/jpeg";
      form.append("image[]", new Blob([buf], { type }), path.basename(r));
    }
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-image-2", prompt: item.prompt, size: item.size, quality: "high", n: 1 }),
    });
  }
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("keine b64_json");
  const buf = Buffer.from(b64, "base64");

  if (item.name === "og-image") {
    const outPath = path.join(OUT_DIR, "og-image.jpg");
    await sharp(buf).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 86, chromaSubsampling: "4:4:4" }).toFile(outPath);
    console.log(`   ok -> og-image.jpg (${((await fs.stat(outPath)).size / 1024).toFixed(0)} KB)`);
  } else {
    const outPath = path.join(OUT_DIR, `${item.name}.webp`);
    await sharp(buf).webp({ quality: 86, effort: 5 }).toFile(outPath);
    console.log(`   ok -> ${item.name}.webp (${((await fs.stat(outPath)).size / 1024).toFixed(0)} KB)`);
  }
}

await loadEnv();
if (!process.env.OPENAI_API_KEY) { console.error("OPENAI_API_KEY fehlt in .env"); process.exit(1); }

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith("--only="))?.slice(7)?.split(",") || null;

let ok = 0, failed = 0;
for (const item of IMAGES) {
  if (only && !only.includes(item.name)) continue;
  try { await generateOne(item); ok++; }
  catch (e) { console.error(`!! ${item.name}: ${e.message}`); failed++; }
}
console.log(`\nFertig. ok: ${ok} · fehlgeschlagen: ${failed}`);
