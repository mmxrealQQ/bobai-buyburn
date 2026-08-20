#!/usr/bin/env python3
"""
Marvel-parody scenes for the BOBAI Saga pack — same recipe as gen_scene_saga.py
(gpt-image-2 + the 4 worldcup char refs, cinematic film-still, opaque bg), but
each motif has its own hero setting. Generic hero descriptions (no brand names)
to stay clear of the IP output filter.

Usage: python stickers/gen_scene_marvel.py [slug ...] [--force]
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
    "still frame from a blockbuster superhero movie. Waist-up close shot, "
    "figure centered and LARGE, shallow depth of field (background softly "
    "blurred). NO text anywhere in the image, no letters, no numbers, no "
    "logos, no watermarks. Full-frame image with the background filling the "
    "whole square — NOT transparent."
)

SCENES = {
    'saga-snap':    "OUTFIT & SCENE: he wears heavy dark battle armor and on his "
                    "raised left hand a massive golden metal gauntlet studded with "
                    "six glowing gems in different colors (blue, red, purple, "
                    "green, orange, yellow), thumb and middle finger poised ready "
                    "to SNAP, confident smirk. SETTING: ruined cosmic battlefield "
                    "at dusk, floating dust and embers, dramatic orange rim light.",

    'saga-smash':   "OUTFIT & SCENE: his body is hugely muscular with green skin, "
                    "bulging arms and chest (the pink brain head stays completely "
                    "unchanged), wearing ripped purple shorts, both fists raised "
                    "mid-roar, furious excited grin. SETTING: smashed city street "
                    "at night, cracked asphalt, dust clouds, car headlights "
                    "glowing through debris.",

    'saga-thunder': "OUTFIT & SCENE: he wears a flowing red cape and silver "
                    "battle armor, raising a huge ancient stone-and-steel war "
                    "hammer to the sky with one hand — massive bright NEON "
                    "GREEN lightning bolts strike the hammer, vivid green "
                    "electric arcs crackle around him and across his armor, "
                    "green storm glow in the clouds, heroic determined "
                    "expression. SETTING: dark storm clouds, rain, epic "
                    "god-of-thunder atmosphere with green lightning light.",

    'saga-captain': "OUTFIT & SCENE: he wears a torn dark-blue tactical suit "
                    "with a rough BNB-gold emblem on the chest. He holds a "
                    "round dented metal shield with a plain gold hexagon "
                    "emblem on his LEFT FOREARM via straps — the shield is "
                    "clearly IN FRONT of the forearm, both of his arms are "
                    "fully visible and anatomically correct and clearly "
                    "separate from the shield, no limbs merging into the "
                    "shield. Battle-worn and bruised but standing tall, "
                    "exhausted but unbreakable determined look. IMPORTANT: "
                    "keep the head and brain proportionally SMALL, exactly "
                    "the same modest head-to-body ratio as in the reference "
                    "images — do NOT enlarge the head or the brain. SETTING: "
                    "smoking battlefield rubble at golden dawn.",

    'saga-futures': "OUTFIT & SCENE: he levitates cross-legged wearing a red "
                    "high-collared cloak, hands weaving glowing golden circular "
                    "magic mandala rings with rune patterns in the air, serene "
                    "all-knowing gaze at the viewer, faint green time-magic "
                    "glow. SETTING: mystical ancient library at night, floating "
                    "books, candle bokeh.",

    'saga-spidey':  "SCENE WITH TWO IDENTICAL BOBAI FIGURES: both wear the same "
                    "skin-tight dark-red and navy hero suit with a subtle dark "
                    "hexagon honeycomb pattern and a small gold hexagon emblem "
                    "on the chest — NO masks, both pink brain heads with the "
                    "holographic speckles fully visible. They stand facing each "
                    "other in profile, each pointing an accusing index finger "
                    "at the other one, identical surprised wide-eyed "
                    "expressions, classic meme composition. SETTING: night city "
                    "rooftop, glowing skyline bokeh behind them.",
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
