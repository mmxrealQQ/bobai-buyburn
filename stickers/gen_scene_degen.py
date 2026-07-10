#!/usr/bin/env python3
"""
Degen-life scenes for the BOBAI GIF pack (original content, no movie IP) —
same recipe as gen_scene_pulp.py: gpt-image-2 + 4 char refs, cinematic
film-still look (the approved "pulp" render style), opaque background.
Chart candles / paper hands as characters carry the joke — no text anywhere.

Usage: python stickers/gen_scene_degen.py [slug ...] [--force]
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
    "a cult 90s movie. Figure centered and LARGE in frame, shallow depth of "
    "field (background softly blurred). NO text anywhere in the image, no "
    "letters, no numbers, no logos, no watermarks. Full-frame image with the "
    "background filling the whole square — NOT transparent."
)

SCENES = {
    'degen-3am':        "SCENE: he lies in bed under a rumpled blanket in a dark "
                        "bedroom at night, holding a smartphone above his face "
                        "with both hands — his face is lit only by the cold "
                        "glow of the screen, huge tired bloodshot round eyes "
                        "staring at the phone. Waist-up shot from a slight "
                        "side angle. SETTING: dark bedroom, faint moonlight "
                        "through blinds, blurred nightstand.",

    'degen-upsidedown': "SCENE: he hangs UPSIDE DOWN from the ceiling like a "
                        "bat, knees hooked over an exposed ceiling pipe, arms "
                        "crossed, relaxed smug grin — in front of a huge wall "
                        "screen showing a red crashing candlestick chart with "
                        "red candles going down. His whole body visible, "
                        "upside down, centered. SETTING: dim trading room at "
                        "night, red chart glow.",

    'degen-ironing':    "SCENE: he stands at an ironing board wearing a small "
                        "apron, carefully ironing a GIANT crumpled cut-out "
                        "paper hand (a wrinkled white paper shaped like an "
                        "open hand, bigger than a pillow) — steam puffs from "
                        "the iron, his expression focused and content. "
                        "Knee-up shot. SETTING: cozy retro living room, warm "
                        "evening lamp light, laundry basket nearby.",

    'degen-snail':      "SCENE: he wears a bright red vintage racing helmet "
                        "with goggles pushed up, riding a GIANT garden snail "
                        "like a jockey — leaning far forward in a full racing "
                        "crouch, intensely determined face, the snail calmly "
                        "sliding along leaving a subtle glittery slime trail. "
                        "Full figure centered. SETTING: quiet suburban road "
                        "at golden-hour dusk, soft warm light.",

    'degen-furnace':    "SCENE: he wears thick work gloves and a leather "
                        "apron, shoveling a heap of shiny golden coins from a "
                        "wheelbarrow into the roaring orange mouth of a big "
                        "industrial furnace — sparks and embers flying, warm "
                        "fire glow on his determined face. Knee-up shot from "
                        "a slight side angle. SETTING: dark boiler room lit "
                        "only by furnace fire.",

    'degen-wen':        "SCENE: he sits alone on a bench at a lonely bus stop "
                        "at night, slumped and bored, dramatically checking a "
                        "wrist watch on his raised arm — the small lit bus-stop "
                        "sign above him shows only a big crescent MOON symbol "
                        "(no letters). Full figure centered. SETTING: empty "
                        "night road, single street lamp cone of light, a few "
                        "moths around the lamp.",

    'degen-defib':      "SCENE: he wears a paramedic uniform, dramatically "
                        "pressing two defibrillator paddles onto a big paper "
                        "stock chart lying flat on an ambulance stretcher — "
                        "the chart shows a single flat red line, small "
                        "electric sparks between the paddles, his expression "
                        "desperate and heroic. Waist-up shot. SETTING: "
                        "dramatic emergency-room lighting, blurred heart "
                        "monitor with a flat line in the background.",

    'degen-fishing':    "SCENE: he sits in a tiny wooden rowboat wearing a "
                        "bucket fisherman hat, leaning back pulling hard on a "
                        "bent fishing rod — hooked on the line, just pulled "
                        "out of the water, hangs a big GLOWING GREEN "
                        "candlestick (a rectangular green chart candle with "
                        "thin wicks on both ends, glowing like neon), water "
                        "drops sparkling. His face awestruck and thrilled. "
                        "SETTING: dark red ocean at dusk, moody sky.",

    'degen-trustmebro': "SCENE: he wears a brown tweed professor jacket, "
                        "standing at a huge chalkboard completely covered in "
                        "chaotic abstract chalk diagrams — circles, spirals, "
                        "crossed-out sketches and many small arrows (NO "
                        "readable letters or numbers) — all converging toward "
                        "one BIG bold chalk arrow pointing steeply up in the "
                        "top corner, which he taps with a wooden pointer "
                        "stick, turning to the viewer with an absolutely "
                        "confident smile. Waist-up shot. SETTING: dim retro "
                        "lecture hall, warm desk lamp light.",

    'degen-bouncer':    "SCENE: he wears a black suit, black turtleneck and "
                        "dark sunglasses, standing as a bouncer with arms "
                        "crossed next to a red velvet rope at a club entrance "
                        "at night — he lifts the rope open for a happy "
                        "GLOWING GREEN cartoon candlestick figure (rectangular "
                        "green chart candle with stubby arms and legs) "
                        "strutting in, while a sad droopy RED candlestick "
                        "figure stands rejected to the side hanging its head. "
                        "Knee-up shot. SETTING: neon-lit club entrance, "
                        "purple-pink glow, velvet rope posts (no signs, no "
                        "text).",
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
