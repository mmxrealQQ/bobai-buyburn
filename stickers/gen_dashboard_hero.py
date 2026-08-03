#!/usr/bin/env python3
"""
Hero banner candidates for brainonbnb.com. Same recipe as gen_scene_movies.py
(gpt-image-2 + character refs, character lock, no text in image) but LANDSCAPE
and composed so the right third stays calm — the HTML overlays headline, live
stats and CTA there.

Yesterday's liq-boost-complete-v2 post graphic rides along as a 5th ref so the
palette matches what already went out on X.

Usage: python stickers/gen_dashboard_hero.py [slug ...] [--force]
"""
import os, sys, base64, requests

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REFS_DIR = r'd:/ai/fourmeme/dashboard/worldcup/_refs'
REFS = [f'{REFS_DIR}/1.jpg', f'{REFS_DIR}/2.jpg', f'{REFS_DIR}/3.jpg', f'{REFS_DIR}/4.jpg',
        r'd:/ai/fourmeme/x-posts/liq-boost-complete-2026-08-02-v2.jpg']
OUT = r'd:/ai/fourmeme/assets-src/hero'
os.makedirs(OUT, exist_ok=True)

LOCK = (
    "CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from "
    "different angles. The BOBAI figure must look EXACTLY like the input "
    "reference: same friendly cartoon face, same big round eyes, same body "
    "proportions, same head shape, same glossy detailed brain on top of the head "
    "with CLEARLY VISIBLE colorful holographic paint speckles on the brain and "
    "cheeks (small cyan/magenta/yellow glitch strokes, exactly like in the "
    "reference images). Identical character — only outfit, pose and scenery "
    "change. Do NOT change the face. "
)

# Composition rule: the figure sits LEFT of centre, the right side stays dark and
# uncluttered so white headline type over it keeps contrast.
STYLE = (
    " VISUAL STYLE: cinematic, premium polished cartoon illustration, rich "
    "saturated colors, dramatic volumetric lighting, sharp focus, high detail — "
    "like a key art frame from a blockbuster movie. Deep near-black background "
    "(#050510) with warm gold (#F0B90B) as the dominant accent light. "
    "COMPOSITION — CRITICAL: the BOBAI figure is placed in the LEFT HALF of the "
    "wide frame, large and fully visible with clear headroom above the brain "
    "(never crop the head or the brain). The RIGHT THIRD of the image must stay "
    "visually CALM and DARK — atmospheric haze, soft bokeh or empty shadow only, "
    "no busy detail there. The bottom edge fades smoothly into near-black. "
    "NO text anywhere in the image, no letters, no numbers, no logos, no "
    "watermarks, no user interface elements. Full-frame image, NOT transparent."
)

SCENES = {
    # The core story: an autonomous machine that never stops burning supply.
    'command': "SCENE: he sits calm and focused in a big command chair at the "
               "centre of a dark futuristic control room, one hand resting on "
               "the armrest, faint confident smile, softly lit from below by "
               "warm golden light. Around him float large abstract holographic "
               "panels made of glowing gold line-art — rising bar shapes, arcs "
               "and orbit rings (pure abstract geometry, absolutely no readable "
               "text or numbers). Thin gold particles drift through the air. "
               "Wide three-quarter shot, figure large in the left half. "
               "SETTING: night, deep black room, gold rim light on the "
               "character, cool blue shadow fill.",

    'forge':   "SCENE: he stands in profile facing a huge open furnace mouth "
               "glowing white-hot gold, wearing a dark heavy apron, calmly "
               "feeding a stream of glowing golden coin-discs into the fire "
               "with one gloved hand — the coins dissolve into bright embers "
               "and sparks that spiral upward. Confident unbothered "
               "expression, strong warm rim light along his silhouette. "
               "Knee-up shot, figure large in the left half. SETTING: dark "
               "industrial forge at night, intense orange-gold firelight from "
               "the right, deep black shadows, floating embers and light "
               "smoke.",

    'summit':  "SCENE: he stands on a high rocky summit at dawn above a sea of "
               "clouds, arms relaxed at his sides, cape-like dark coat blown "
               "sideways by the wind, looking out over the horizon with a calm "
               "determined expression. Below and behind him a vast golden "
               "sunrise breaks through the cloud layer. Full figure, low "
               "heroic camera angle, figure large in the left half. SETTING: "
               "cold high altitude dawn, warm golden backlight, cool blue "
               "shadows, drifting mist.",
}

def gen(slug, force=False):
    if slug not in SCENES:
        print(f"unknown scene '{slug}', known: {list(SCENES)}"); return
    dst = f'{OUT}/hero-{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return
    files = [('image[]', (os.path.basename(p), open(p, 'rb'), 'image/jpeg'))
             for p in REFS]
    prompt = LOCK + SCENES[slug] + STYLE
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': prompt,
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
    for n in (args or list(SCENES)):
        gen(n, force)
