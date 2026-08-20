#!/usr/bin/env python3
"""
Movie-parody scenes wave 2 for the BOBAI GIF pack (Rocky / Matrix / Wolf of
Wall Street / Back-to-the-Future vibes — generic descriptions, no brand names,
no real faces). Same recipe as gen_scene_marvel.py: gpt-image-2 + 4 char refs,
blockbuster film-still look, figure LARGE, opaque background, no text.

Usage: python stickers/gen_scene_movies.py [slug ...] [--force]
"""
import os, sys, base64, requests

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REFS_DIR = r'd:/ai/fourmeme/dashboard/worldcup/_refs'
REFS = [f'{REFS_DIR}/1.jpg', f'{REFS_DIR}/2.jpg', f'{REFS_DIR}/3.jpg', f'{REFS_DIR}/4.jpg']
OUT = r'd:/ai/fourmeme/stickers/assets/scenes'
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

STYLE = (
    " VISUAL STYLE: cinematic, premium polished cartoon illustration, rich "
    "saturated colors, dramatic lighting, sharp focus, high detail — like a "
    "still frame from a blockbuster movie. Figure centered and VERY LARGE in "
    "frame filling most of the height, shallow depth of field (background "
    "softly blurred). NO text anywhere in the image, no letters, no numbers, "
    "no logos, no watermarks. Full-frame image with the background filling "
    "the whole square — NOT transparent."
)

SCENES = {
    'saga-rocky':    "SCENE: he stands triumphant at the top of wide stone "
                     "museum stairs at dawn, wearing a plain gray sweatsuit "
                     "and red boxing gloves, both gloved fists pumped high "
                     "into the air in victory, joyful determined expression, "
                     "breath visible in the cold morning air. Behind and "
                     "below him a golden sunrise over a hazy city skyline. "
                     "Knee-up shot from a slight low angle, figure LARGE. "
                     "SETTING: cold winter morning, warm golden sunrise "
                     "backlight with cool blue shadows.",

    'saga-matrix':   "SCENE: he leans far backwards in an extreme slow-"
                     "motion limbo dodge, knees bent, arms flung out to the "
                     "sides, wearing a long flowing black coat and small "
                     "oval dark sunglasses — while three glowing RED "
                     "candlesticks (rectangular red chart candles with thin "
                     "wicks) streak past ABOVE his chest with bullet-time "
                     "motion trails. Full figure filling the frame, dramatic "
                     "side angle. SETTING: dark night rooftop, faint green-"
                     "tinted glow of abstract falling glyph streaks in the "
                     "background (abstract dashes only, no real letters).",

    'saga-wolf':     "SCENE: he stands like a hyped-up sales king, wearing a "
                     "sharp tailored navy suit, white shirt and silk tie, "
                     "pounding one fist against his chest, the other hand "
                     "holding a silver microphone, wild confident grin — "
                     "behind him a blurred crowd of office workers cheering "
                     "with raised fists. Waist-up shot, figure LARGE, but "
                     "IMPORTANT: his entire head and the full brain on top "
                     "must be COMPLETELY visible inside the frame with clear "
                     "headroom above — never crop the head or brain. "
                     "SETTING: luxurious 90s trading office, warm golden "
                     "lighting, confetti specks floating.",

    'saga-delorean': "SCENE: he steps out of a silver retro wedge-shaped "
                     "sports car with its gullwing door swung open upward, "
                     "wearing an orange puffer vest over a denim jacket and "
                     "dark sunglasses which he lowers with one hand, cool "
                     "confident smirk — behind the car two glowing FIRE "
                     "TRAILS burn across the wet asphalt, light smoke "
                     "drifting. Knee-up shot, figure LARGE. SETTING: quiet "
                     "suburban street at night, cool blue night light mixed "
                     "with warm orange fire glow.",
}

def gen(slug, force=False):
    if slug not in SCENES:
        print(f"unknown scene '{slug}', known: {list(SCENES)}"); return
    dst = f'{OUT}/{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return
    files = [('image[]', (f'ref{i+1}.jpg', open(p, 'rb'), 'image/jpeg'))
             for i, p in enumerate(REFS)]
    prompt = LOCK + SCENES[slug] + STYLE
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
        print(f"ERR {slug}: {r.status_code} {r.text[:800]}"); return False
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f"OK {slug} ({os.path.getsize(dst)//1024} KB) -> {dst}")
    return True

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    for n in (args or list(SCENES)):
        gen(n, force)
