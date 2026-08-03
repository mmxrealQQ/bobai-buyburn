#!/usr/bin/env python3
"""
"Brain on the blockchain" key art — the literal concept: BOBAI's brain wired
into a receding chain of glowing blocks. Built for the full-bleed page bands,
so the figure sits left and the right third stays calm for the headline.

Refs are the GIPHY movie/degen sticker scenes + the summit hero + yesterday's
v2 post graphic. Deliberately NOT worldcup/_refs — those wear a football kit.

Usage: python stickers/gen_brainchain.py [slug ...] [--force]
"""
import os, sys, base64, requests

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

HERO   = r'd:/ai/fourmeme/assets-src/hero'
SCENES = r'd:/ai/fourmeme/stickers/assets/scenes'
REFS = [f'{SCENES}/saga-matrix.png', f'{SCENES}/saga-wolf.png',
        f'{SCENES}/degen-furnace.png', f'{HERO}/hero-summit.png',
        r'd:/ai/fourmeme/x-posts/liq-boost-complete-2026-08-02-v2.jpg']
MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}
OUT = HERO
os.makedirs(OUT, exist_ok=True)

LOCK = (
    "CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot. The "
    "figure must look EXACTLY like the reference: same friendly cartoon face, same "
    "big round eyes, same body proportions, same head shape, same glossy detailed "
    "brain on top of the head with CLEARLY VISIBLE colorful holographic paint "
    "speckles on the brain and cheeks (small cyan/magenta/yellow glitch strokes). "
    "OUTFIT: dark near-black jacket or coat with thin gold trim and dark trousers. "
    "NO sports jersey, NO football kit, NO shorts. Do NOT change the face. "
)

STYLE = (
    " VISUAL STYLE: cinematic premium 3D key art, deep near-black background "
    "(#0d0a1b), dominant warm gold (#F0B90B) light with violet and blue "
    "secondary glows, volumetric haze, sharp focus on the figure, high detail. "
    "COMPOSITION — CRITICAL: the BOBAI figure stands in the LEFT THIRD, large, "
    "full body visible with clear headroom above the brain — never crop the head "
    "or the brain. The RIGHT THIRD must stay CALM and DARK, only soft haze and "
    "distant glow, no busy detail. NO text anywhere, no letters, no numbers, no "
    "logos, no watermarks. Full-frame, NOT transparent."
)

SCENES_P = {
    'brainchain':
        "SCENE: he stands calm and confident, looking slightly upward with a "
        "faint proud smile, one hand open at his side. From the glossy brain on "
        "his head, bright golden light filaments arc outward and turn into a "
        "CHAIN OF FLOATING GEOMETRIC BLOCKS — translucent cubes with glowing "
        "gold edges, each linked to the next by a thin luminous strand, the "
        "chain curving away from him and receding into the dark distance "
        "towards the right, getting smaller and dimmer. The nearest cubes glow "
        "brightly from within; faint gold particles drift along the strands. "
        "SETTING: dark empty space, deep violet-blue haze, gold rim light on "
        "the character.",
}

def gen(slug, force=False):
    if slug not in SCENES_P:
        print(f"unknown scene '{slug}', known: {list(SCENES_P)}"); return
    dst = f'{OUT}/hero-{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return
    files = [('image[]', (os.path.basename(p), open(p, 'rb'),
                          MIME[os.path.splitext(p)[1].lower()])) for p in REFS]
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': LOCK + SCENES_P[slug] + STYLE,
              'size': '1536x1024', 'quality': 'high', 'moderation': 'low',
              'background': 'opaque', 'output_format': 'png', 'n': '1'},
        timeout=300,
    )
    if r.status_code != 200:
        print(f"ERR {slug}: {r.status_code} {r.text[:800]}"); return False
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f"OK {slug} ({os.path.getsize(dst)//1024} KB) -> {dst}")
    return True

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    for n in (args or list(SCENES_P)):
        gen(n, force)
