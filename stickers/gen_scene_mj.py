#!/usr/bin/env python3
"""
MJ-tribute scenes for the BOBAI GIF pack — iconic dance-move parody, no real
person, no name in prompts (fedora / sequin glove / red leather jacket codes
only). Same recipe as gen_scene_degen.py: gpt-image-2 + 4 char refs,
cinematic film-still look, opaque background, no text anywhere.

Usage: python stickers/gen_scene_mj.py [slug ...] [--force]
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
    "saturated colors, dramatic concert-stage lighting with strong spotlights "
    "and glowing rim light, sharp focus, high detail — like a still frame "
    "from a blockbuster music movie. Figure centered and VERY LARGE in frame "
    "filling most of the height, shallow depth of field (background softly "
    "blurred). NO text anywhere in the image, no letters, no numbers, no "
    "logos, no watermarks. Full-frame image with the background filling the "
    "whole square — NOT transparent."
)

SCENES = {
    'saga-moonwalk':  "SCENE: he performs the iconic moonwalk dance move — "
                      "gliding backwards across a glossy dark stage floor, "
                      "body tilted slightly forward, one heel raised mid-"
                      "glide, wearing a black fedora tilted over his eyes, a "
                      "black sequined jacket, ONE sparkling white sequin "
                      "glove on his raised hand, short black trousers with "
                      "bright white socks and black loafers. Behind him a "
                      "night-sky stage backdrop with a big glowing full moon "
                      "and a rising chart of glowing green candlesticks "
                      "(green rectangles with thin wicks) climbing toward "
                      "the moon. Full figure filling the frame top to "
                      "bottom, slight low camera angle. SETTING: dark "
                      "concert stage, single dramatic white spotlight cone "
                      "from above, subtle stage haze.",

    'degen-lean':     "SCENE: he performs an impossible anti-gravity lean — "
                      "whole body ramrod straight, tilted 45 degrees forward "
                      "toward the camera, heels planted on the floor, "
                      "defying gravity, arms relaxed at his sides, cool "
                      "unbothered expression. He wears a white 1930s gangster "
                      "suit with a blue shirt, white tie and white fedora. "
                      "Around him big wall screens show crashing red "
                      "candlestick charts (red rectangles falling) and loose "
                      "papers fly through the air — he stays perfectly calm. "
                      "Full figure filling the frame, dramatic low camera "
                      "angle. SETTING: dim trading floor at night, red chart "
                      "glow, strong dramatic side spotlight.",

    'saga-thriller':  "SCENE: he strikes a playful spooky zombie dance pose — "
                      "shoulders hunched up high, both hands raised like "
                      "stiff claws, head tilted sideways, mischievous grin. "
                      "He wears an iconic bright red leather jacket with "
                      "black V-shaped stripes and many silver zippers, and "
                      "matching red leather trousers. Behind him a foggy "
                      "graveyard with bare twisted trees and a huge full "
                      "moon. Knee-up shot, figure LARGE. SETTING: misty "
                      "graveyard at night, dramatic cold blue moonlight "
                      "spotlight with a warm amber rim light, fog rolling "
                      "over the ground.",

    'degen-popcorn':  "SCENE: he sits alone in a red velvet cinema seat in a "
                      "dark movie theater, holding a red-and-white striped "
                      "popcorn bag, mid-munch with one hand stuffing popcorn "
                      "into his mouth, cheeks full, wide gleeful entertained "
                      "eyes fixed on the screen in front of him, flickering "
                      "screen light reflecting on his face. He wears a red "
                      "leather jacket with silver zippers. Waist-up shot "
                      "from a slight front-low angle. SETTING: dark cinema "
                      "auditorium, glowing blurred screen light from the "
                      "front, dust floating in the projector beam, empty "
                      "seats blurred behind him.",

    'saga-march':     "SCENE: he leads a street march at dusk — striding "
                      "forward at the front with one fist raised high in "
                      "the air, determined proud expression, wearing a "
                      "simple white tank top and dark pants. Behind him "
                      "marches a crowd of GLOWING GREEN candlestick figures "
                      "(rectangular green chart candles with stubby arms "
                      "and legs and small fists raised), stretching down "
                      "the street. Full figure filling the frame, slight "
                      "low camera angle. SETTING: urban street at warm "
                      "dusk, golden rim light, light dust in the air, no "
                      "banners, no signs, no text anywhere.",

    'saga-toespin':   "SCENE: he is frozen at the spectacular climax of a "
                      "dance spin — standing on the very tips of his toes, "
                      "legs pressed together, one hand pinching the brim of "
                      "his black fedora pulled low over his eyes, the other "
                      "arm extended straight out to the side, black sequined "
                      "jacket sparkling, bright white socks flashing above "
                      "black loafers. Beneath him the stage floor is made of "
                      "large square tiles that light up in glowing green and "
                      "cyan under his feet. Full figure filling the frame "
                      "top to bottom, slight low camera angle. SETTING: dark "
                      "stage, glowing floor tiles as strong light source "
                      "from below, white spotlight from above, subtle haze.",
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
