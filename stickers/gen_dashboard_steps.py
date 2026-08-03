#!/usr/bin/env python3
"""
Four small step illustrations for the "How It Works" cards on brainonbnb.com
(Trade / Collect / Split / Burn). Same character lock + refs as the sticker
scripts, but transparent background so they sit cleanly on the dark cards.

Usage: python stickers/gen_dashboard_steps.py [slug ...] [--force]
"""
import os, sys, base64, requests

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

HERO_DIR = r'd:/ai/fourmeme/assets-src/hero'
SCENES   = r'd:/ai/fourmeme/stickers/assets/scenes'
# Deliberately NOT the worldcup/_refs avatars — those wear a football kit and
# it bled straight into the output. These are the GIPHY movie/degen scenes
# (coat, suit, apron) plus the hero render and yesterday's v2 post graphic.
REFS = [f'{SCENES}/saga-matrix.png', f'{SCENES}/saga-wolf.png',
        f'{SCENES}/degen-furnace.png', f'{SCENES}/saga-rocky.png',
        f'{HERO_DIR}/hero-summit.png',
        r'd:/ai/fourmeme/x-posts/liq-boost-complete-2026-08-02-v2.jpg']

MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}
OUT = r'd:/ai/fourmeme/assets-src/hero/steps'
os.makedirs(OUT, exist_ok=True)

LOCK = (
    "CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from "
    "different angles. The BOBAI figure must look EXACTLY like the input "
    "reference: same friendly cartoon face, same big round eyes, same body "
    "proportions, same head shape, same glossy detailed brain on top of the head "
    "with CLEARLY VISIBLE colorful holographic paint speckles on the brain and "
    "cheeks (small cyan/magenta/yellow glitch strokes, exactly like in the "
    "reference images). Identical character — only outfit, pose and props "
    "change. Do NOT change the face. "
)

STYLE = (
    " VISUAL STYLE: match the cinematic look of the reference renders exactly — "
    "premium polished 3D character render, dramatic warm rim lighting, rich "
    "saturated gold (#F0B90B) accents, glossy materials, shallow depth, high "
    "detail, the same dark gold-trimmed outfit family as the references. "
    "OUTFIT LOCK — CRITICAL: he wears the SAME outfit as the hero renders — a "
    "dark near-black hoodie or jacket with thin gold trim and dark long "
    "trousers with dark sneakers. Absolutely NO sports jersey, NO football "
    "kit, NO shorts, NO team strip, NO numbers or stripes on the clothing. "
    "Cheerful and inviting mood. FULL BODY visible, head to feet, centered, "
    "with clear empty margin above the brain and below the feet — never crop "
    "the figure. BACKGROUND — CRITICAL: completely FLAT, UNIFORM, very dark "
    "near-black (#0a0814) empty background. No floor, no horizon, no scenery, "
    "no furniture, no gradient, no vignette, no shadow plate, no background "
    "panel — just the character floating on flat darkness. NO text anywhere, "
    "no letters, no numbers, no logos, no watermarks."
)

STEPS = {
    'trade':   "POSE: he stands cheerfully with both thumbs up, winking one eye, "
               "wearing a casual gold-trimmed hoodie — a single glowing golden "
               "coin floats just above one raised hand. Friendly welcoming "
               "energy.",

    'collect': "POSE: he holds a small open treasure pouch with both hands in "
               "front of his chest, looking down into it with a delighted "
               "surprised smile, while three glowing golden coins drop down "
               "into the pouch from above, leaving soft light trails.",

    'split':   "POSE: he stands with both arms spread wide and open palms up, "
               "grinning confidently — one glowing golden coin hovers above "
               "each palm and a third hovers above his brain, the three coins "
               "arranged in a wide triangle around him.",

    'burn':    "POSE: he tosses a glowing golden coin downward out of one hand "
               "with a mischievous happy grin, the coin dissolving into warm "
               "orange embers and sparks below it. Other hand on his hip, "
               "confident playful stance.",
}

def gen(slug, force=False):
    if slug not in STEPS:
        print(f"unknown step '{slug}', known: {list(STEPS)}"); return
    dst = f'{OUT}/{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return
    files = [('image[]', (os.path.basename(p), open(p, 'rb'),
                          MIME[os.path.splitext(p)[1].lower()]))
             for p in REFS]
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': LOCK + STEPS[slug] + STYLE,
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
    for n in (args or list(STEPS)):
        gen(n, force)
