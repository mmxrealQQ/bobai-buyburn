#!/usr/bin/env python3
"""
"Sage BOBAI" meme-GIF-style scenes — full-frame cinematic movie stills (opaque
background, like the classic Yoda caption-GIF reference), BOBAI brain sage in a
misty swamp forest. Caption text is added later by build_sticker.py.

Usage: python stickers/gen_scene_saga.py [slug ...] [--force]
"""
import os, sys, base64, requests
from io import BytesIO
from PIL import Image

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REFS_DIR = r'd:/ai/fourmeme/dashboard/worldcup/_refs'
REFS = [f'{REFS_DIR}/1.jpg', f'{REFS_DIR}/2.jpg', f'{REFS_DIR}/3.jpg', f'{REFS_DIR}/4.jpg']
OUT = r'd:/ai/fourmeme/stickers/assets/scenes'
os.makedirs(OUT, exist_ok=True)

STYLE = (
    "CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from "
    "different angles. The BOBAI figure must look EXACTLY like the input "
    "reference: same friendly cartoon face, same big round eyes, same body "
    "proportions, same head shape, same glossy detailed brain on top of the head "
    "with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on "
    "the brain edges, tasteful — not glitchy). Identical character — only outfit, "
    "pose and scenery change. Do NOT age him, NO wrinkles, NO beard, NO changes "
    "to the face. "
    "OUTFIT: a tattered sand-beige hooded robe worn open over his usual clothes, "
    "hood down on the shoulders, and a small gnarled wooden walking cane — the "
    "wise-master weekend look. "
    "SETTING: a misty dark-green swamp forest at dusk — gnarled roots, hanging "
    "moss, soft volumetric fog, small glints of warm light in the background "
    "bokeh. "
    "VISUAL STYLE: cinematic, premium polished cartoon illustration, rich "
    "saturated colors, dramatic moody lighting with a cool green rim light, "
    "sharp focus, high detail — like a still frame from a blockbuster animated "
    "movie. Waist-up close shot, figure centered and LARGE, shallow depth of "
    "field (background softly blurred). "
    "NO text anywhere in the image, no letters, no numbers, no watermarks. "
    "Full-frame image with the swamp background filling the whole square — "
    "NOT transparent."
)

SCENES = {
    'saga-patience': "The sage looks straight at the viewer with a calm knowing "
                     "half-smile, one small hand raised in a gentle calming "
                     "gesture, the other resting on a small gnarled wooden cane.",

    'saga-pump':     "The sage points with one outstretched arm and extended "
                     "index finger STRAIGHT AT THE VIEWER (hand slightly "
                     "foreshortened toward the camera), confident wise smile, "
                     "the other hand resting on a small gnarled wooden cane.",

    'saga-nosell':   "The sage holds up one open palm toward the viewer in a "
                     "firm STOP gesture, stern serious expression, eyebrows "
                     "furrowed, the other hand gripping a small gnarled wooden "
                     "cane. IMPORTANT: his entire head and the full brain on "
                     "top must be COMPLETELY visible inside the frame with "
                     "clear headroom above — never crop the head or brain.",

    'saga-hodl':     "The sage clenches both small fists in front of his chest, "
                     "determined intense expression, leaning slightly forward "
                     "toward the viewer.",

    'saga-fear':     "The sage has his eyes gently closed in deep meditation, "
                     "perfectly serene face, both hands folded over the top of "
                     "his small gnarled wooden cane, mist swirling a little "
                     "thicker around him.",
}

def gen(slug, force=False):
    if slug not in SCENES:
        print(f"unknown scene '{slug}', known: {list(SCENES)}"); return
    dst = f'{OUT}/{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return

    files = [('image[]', (f'ref{i+1}.jpg', open(p, 'rb'), 'image/jpeg'))
             for i, p in enumerate(REFS)]

    prompt = STYLE + " SCENE: " + SCENES[slug]
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': prompt,
              'size': '1024x1024', 'quality': 'high', 'moderation': 'low',
              'background': 'opaque', 'output_format': 'png', 'n': '1'},
        timeout=300,
    )
    if r.status_code != 200:
        print(f"ERR {slug}: {r.status_code} {r.text[:2000]}"); sys.exit(1)
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f"OK {slug} ({os.path.getsize(dst)//1024} KB) -> {dst}")

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    for n in (args or list(SCENES)):
        gen(n, force)
