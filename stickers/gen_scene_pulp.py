#!/usr/bin/env python3
"""
Pulp-Fiction-parody scenes for the BOBAI Saga pack — same recipe as
gen_scene_marvel.py (gpt-image-2 + 4 char refs, cinematic film-still, opaque).
90s crime-movie look: warm tones, film grain, diner/apartment settings.
No weapons (IP/moderation) — the iconography carries the reference.

Usage: python stickers/gen_scene_pulp.py [slug ...] [--force]
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
    "saturated colors, moody 1990s crime-movie lighting with warm amber tones "
    "and subtle film grain, sharp focus, high detail — like a still frame from "
    "a cult 90s movie. Waist-up close shot, figure centered and LARGE, shallow "
    "depth of field (background softly blurred). NO text anywhere in the "
    "image, no letters, no numbers, no logos, no watermarks. Full-frame image "
    "with the background filling the whole square — NOT transparent."
)

SCENES = {
    'saga-sayagain': "OUTFIT & SCENE: he wears a slim black suit, white shirt "
                     "and skinny black tie, leaning far forward toward the "
                     "viewer with an intense deadly-serious glare, one index "
                     "finger pointed at the camera mid-rant, veins of "
                     "righteous fury. SETTING: shabby 70s apartment, morning "
                     "light through blinds, a burger wrapper on the table.",

    'saga-confused': "OUTFIT & SCENE: he wears a slim black suit with skinny "
                     "black tie, standing with arms slightly spread and palms "
                     "up, looking around utterly confused and lost, baffled "
                     "wide-eyed expression. SETTING: empty retro living room "
                     "with wood panel walls, warm lamp light.",

    'saga-dance':    "SCENE WITH TWO IDENTICAL BOBAI FIGURES dancing the twist "
                     "together — BOTH have the exact same pink glossy BRAIN "
                     "head with holographic speckles as the reference. One "
                     "wears a white shirt and loose black tie; the other wears "
                     "a small short black bob-cut wig perched ON TOP of the "
                     "pink brain head (brain lobes and brain texture clearly "
                     "visible on the forehead and around the wig) and a white "
                     "blouse. Both in black suit trousers, barefoot, doing the "
                     "classic twist dance move with two fingers making a V "
                     "over the eyes, playful serious faces. SETTING: retro "
                     "50s-style diner dance floor at night, neon glow, "
                     "checkered floor.",

    'saga-wallet':   "OUTFIT & SCENE: he wears a slim black suit and skinny "
                     "tie, opening a black leather briefcase toward himself — "
                     "brilliant golden light beams out of the open case onto "
                     "his awestruck face, eyes wide in wonder. SETTING: dim "
                     "smoky backroom bar, single overhead lamp.",

    'saga-shake':    "OUTFIT & SCENE: he wears a crisp white shirt with a loose "
                     "black tie, sitting relaxed in a red leather diner booth, "
                     "both hands around an oversized creamy milkshake with "
                     "whipped cream and a red straw, taking a satisfied sip, "
                     "relaxed happy eyes. SETTING: retro 50s diner at night, "
                     "neon signs, chrome details.",
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
