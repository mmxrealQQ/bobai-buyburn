#!/usr/bin/env python3
"""
Real motion for the saga stickers: Sora image-to-video from the approved scene
stills. Static camera, the character itself moves. Output mp4 saved to
stickers/assets/video/<slug>.mp4 (cropped/encoded to webm by build step).

Usage: python stickers/gen_sora.py <slug ...> [--force]
"""
import os, sys, time, requests
from io import BytesIO
from PIL import Image, ImageFilter

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

SCN = r'd:/ai/fourmeme/stickers/assets/scenes'
OUT = r'd:/ai/fourmeme/stickers/assets/video'
os.makedirs(OUT, exist_ok=True)

BASE = ("Static locked-off camera, no camera movement, no zoom. Cinematic "
        "scene exactly as shown in the reference image — same setting, same "
        "lighting, same characters. The small cute brain-headed figure(s) "
        "keep their exact face, outfit and proportions from the reference. ")
TAIL = (" Background ambience moves gently (light, mist or bokeh flicker), "
        "clothing sways very subtly. Subtle, natural, slow movements — "
        "nothing exaggerated. No text anywhere.")

MOTION = {
    'saga-pump':     "He points his index finger straight at the camera and "
                     "jabs the pointing hand emphatically toward the viewer "
                     "two times, keeping his confident smile, other hand "
                     "resting on his wooden cane.",
    'saga-patience': "He speaks calmly toward the viewer, mouth moving "
                     "gently as if giving wise advice, raised open palm "
                     "making a small calming patting motion.",
    'saga-nosell':   "He pushes his raised open palm firmly toward the "
                     "camera in a STOP gesture two times, stern expression, "
                     "slight head shake no.",
    'saga-hodl':     "He pounds his two fists together in front of his chest "
                     "with a visible impact, then raises both clenched fists "
                     "and shakes them with determination while leaning toward "
                     "the camera, intense determined stare, clearly visible "
                     "energetic arm movement.",
    'saga-snap':     "He raises the golden gauntlet and SNAPS his fingers once "
                     "with a bright flash of light from the gems, then smirks "
                     "confidently at the camera, embers drifting.",
    'saga-smash':    "He flexes his huge green muscular arms, roars excitedly "
                     "and smashes one fist down with visible impact, dust "
                     "puffs rising, then grins at the camera.",
    'saga-thunder':  "He raises the war hammer higher as bright GREEN "
                     "lightning bolts strike it two times with vivid flashes, "
                     "green electric arcs crackle visibly across his armor "
                     "and the hammer, his red cape flows strongly in the "
                     "storm wind, rain streaks past, heroic stare — clearly "
                     "visible continuous movement.",
    'saga-captain':  "He tightens the strap of his dented shield, straightens "
                     "up from exhaustion into a determined stance and nods "
                     "slowly at the camera, smoke drifting behind him.",
    'saga-spidey':   "Both suited figures point at each other emphatically, "
                     "jabbing their pointing fingers two times in disbelief, "
                     "tilting their heads, city lights flickering behind.",
    'saga-sayagain': "He leans even further toward the camera, jabbing his "
                     "pointed finger emphatically two times while ranting, "
                     "furious intense glare, shoulders tense.",
    'saga-confused': "He turns his head left and right searching the room, "
                     "spreads his open palms wider in confusion, shrugs, "
                     "utterly baffled expression.",
    'saga-dance':    "Both figures do the classic twist dance — swinging hips "
                     "and knees, dragging two fingers in a V across their "
                     "eyes in sync, playful serious faces, neon lights "
                     "pulsing gently.",
    'saga-wallet':   "He slowly opens the briefcase lid further — the golden "
                     "glow intensifies and flickers on his awestruck face, "
                     "his eyes widen, he leans in mesmerized.",
    'saga-shake':    "The figure takes a sip from the big milkshake through "
                     "the straw, then nods contentedly at the camera with a "
                     "relaxed friendly smile, neon lights flickering softly.",
    'saga-fear':     "He meditates peacefully with closed eyes, breathing "
                     "slowly and deeply, hands folded on his cane rising and "
                     "falling gently with each breath, mist swirling around.",
    'degen-3am':        "He holds the smartphone with both hands and scrolls "
                        "with his thumb two times, the cool screen light "
                        "flickers softly on his face, he blinks slowly with "
                        "tired eyes.",
    'degen-upsidedown': "Hanging upside down he sways very gently from the "
                        "pipe, nods approvingly at the crashing chart, the "
                        "red chart glow pulses softly on his face.",
    'degen-ironing':    "He glides the steaming iron slowly across the giant "
                        "crumpled paper hand two times, steam puffs rise, he "
                        "nods contently at his work.",
    'degen-snail':      "The giant snail slides forward slightly, its eye "
                        "stalks wiggle, he leans even lower into his racing "
                        "crouch urging it on, determined stare ahead.",
    'degen-furnace':    "He clearly lifts and tips the shovel so golden coins "
                        "visibly slide and tumble into the furnace mouth, the "
                        "flames FLARE UP brightly with dancing fire, sparks "
                        "and embers fly upward, the warm glow flickers "
                        "strongly on his face — clearly visible continuous "
                        "movement through the whole clip.",
    'degen-wen':        "He raises his arm and looks at his wrist watch, then "
                        "looks down the empty road and slumps back bored, "
                        "moths fluttering around the street lamp.",
    'degen-defib':      "He presses the defibrillator paddles down firmly — a "
                        "bright spark flash, the paper chart jolts up once "
                        "like a chest compression, then he looks at it "
                        "desperately hopeful.",
    'degen-fishing':    "He pulls the bent fishing rod harder, the glowing "
                        "green candlestick swings on the line dripping "
                        "sparkling water drops, the little boat rocks gently.",
    'degen-trustmebro': "He taps the big rising chalk arrow with his wooden "
                        "pointer two times, then turns to the camera nodding "
                        "with absolute confidence.",
    'degen-bouncer':    "He lifts the velvet rope open, the happy green "
                        "candlestick figure struts inside wiggling with joy, "
                        "the sad red candlestick slumps its head even deeper.",
    'saga-moonwalk':  "He performs the moonwalk backslide: his legs make "
                      "smooth walking-forward stepping motions, but his "
                      "whole body continuously SLIDES BACKWARD across the "
                      "glossy floor — one foot stays flat gliding backward "
                      "while the other heel pops up, alternating rhythmically, "
                      "moving clearly from screen center toward screen edge "
                      "backwards, body tilted slightly forward, he pinches "
                      "his fedora brim with the gloved hand.",
    'degen-lean':     "He holds the impossible forward lean steadily, then "
                      "leans a touch further and calmly adjusts his fedora "
                      "with one hand, loose papers drifting through the air, "
                      "red chart glow pulsing softly, totally unbothered "
                      "cool expression.",
    'saga-thriller':  "He does a playful goofy dance — hunched shoulders "
                      "shrugging rhythmically up and down two times, stiff "
                      "raised hands bobbing to the beat, head tilting side "
                      "to side, cheerful mischievous grin, fog drifting "
                      "slowly around his legs.",
    'degen-popcorn':  "He grabs a handful of popcorn and stuffs it into his "
                      "mouth, chewing with puffed cheeks, wide gleeful eyes "
                      "fixed on the screen, flickering screen light dancing "
                      "on his face, he leans forward slightly, totally "
                      "entertained.",
    'saga-toespin':   "Stage smoke machines SHOOT bursts of glowing GREEN "
                      "fog from both sides of the stage floor, the green "
                      "smoke billows and swirls around his legs "
                      "continuously — while he bounces rhythmically on his "
                      "toe tips to a beat, tipping his fedora with the hand "
                      "at the brim, his sequin jacket sparkling glinting, "
                      "the floor tiles pulsing green and cyan light. "
                      "Clearly visible continuous movement through the "
                      "whole clip. He does not spin, exactly two arms, "
                      "correct anatomy.",
    'saga-march':     "He marches forward ON THE SPOT to a strong beat, "
                      "stomping rhythmically, pumping his raised fist two "
                      "times with power — the crowd of green candlestick "
                      "figures behind him bounces and marches in sync, "
                      "their little fists pumping to the same beat, dust "
                      "drifting in the warm light. Clearly visible rhythmic "
                      "movement through the whole clip, exactly two arms, "
                      "correct anatomy.",
    'saga-futures':   "He clearly floats UP and DOWN in a visible levitation "
                      "cycle while both hands actively weave circles in the "
                      "air — the golden magic mandala rings VISIBLY ROTATE "
                      "around his hands throwing glowing rune sparks, the "
                      "green time-glow pulses brightly, his cloak sways, "
                      "floating books and pages drift and flutter around "
                      "him, clearly visible continuous movement.",
    'saga-rocky':     "He bounces on the spot in triumph, pumping both "
                      "boxing gloves up into the air two times, breath "
                      "visible in the cold morning air, the sunrise glow "
                      "flaring softly behind him.",
    'saga-matrix':    "He leans even further back in slow-motion, the "
                      "glowing red candlesticks streak past above him "
                      "leaving motion trails, his long coat flutters, he "
                      "keeps perfect balance, cool unbothered face.",
    'saga-wolf':      "He pounds his fist on his chest rhythmically two "
                      "times with visible impact, then raises the "
                      "microphone with a wild confident grin, the blurred "
                      "crowd behind him pumping fists in sync.",
    'saga-delorean':  "The twin FIRE TRAILS on the asphalt BLAZE tall and "
                      "lively: bright orange flames burn HIGH, dance and "
                      "lick upward vigorously along both trails through the "
                      "whole clip, many embers swirl up into the air, smoke "
                      "billows, the strong fire glow pulses and flickers on "
                      "the wet street and the car body — the fire is the "
                      "star of the shot, big clearly visible flame movement "
                      "at all times. He stays at the open gullwing door "
                      "with a confident smirk and gives one small cool nod, "
                      "his sunglasses stay perfectly in place, he never "
                      "touches them. Framing stays exactly as the "
                      "reference, no zoom.",
}

def prep_input(slug):
    """Pad the 1024² scene to 720x1280 portrait (blurred fill top/bottom)."""
    im = Image.open(f'{SCN}/{slug}.png').convert('RGB').resize((720, 720), Image.LANCZOS)
    bg = im.resize((720, 1280)).filter(ImageFilter.GaussianBlur(60))
    bg.paste(im, (0, 280))
    buf = BytesIO(); bg.save(buf, 'JPEG', quality=92); buf.seek(0)
    return buf

JOBS = f'{OUT}/jobs.txt'

def _jobs():
    j = {}
    if os.path.exists(JOBS):
        for ln in open(JOBS):
            if '=' in ln:
                k, v = ln.strip().split('=', 1); j[k] = v
    return j

def _save_job(slug, vid_id):
    j = _jobs(); j[slug] = vid_id
    open(JOBS, 'w').write(''.join(f'{k}={v}\n' for k, v in j.items()))

def gen(slug, force=False):
    dst = f'{OUT}/{slug}.mp4'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return

    vid_id = None if force == 'new' else _jobs().get(slug)
    if not vid_id or force is True and os.path.exists(dst):
        vid_id = None
    if vid_id:
        print(f"[{slug}] resuming job {vid_id}")
    else:
        r = requests.post(
            'https://api.openai.com/v1/videos',
            headers={'Authorization': f'Bearer {KEY}'},
            files={'input_reference': (f'{slug}.jpg', prep_input(slug), 'image/jpeg')},
            data={'model': 'sora-2', 'prompt': BASE + MOTION[slug] + TAIL,
                  'size': '720x1280', 'seconds': '4'},
            timeout=120,
        )
        if r.status_code not in (200, 201):
            print(f"ERR {slug}: {r.status_code} {r.text[:1500]}"); sys.exit(1)
        vid_id = r.json()['id']
        _save_job(slug, vid_id)
        print(f"[{slug}] job {vid_id} started…")

    while True:
        time.sleep(10)
        try:
            s = requests.get(f'https://api.openai.com/v1/videos/{vid_id}',
                             headers={'Authorization': f'Bearer {KEY}'}, timeout=60).json()
        except Exception as e:
            print(f"  [{slug}] poll retry ({type(e).__name__})"); continue
        st = s.get('status')
        print(f"  [{slug}] {st} {s.get('progress', '')}")
        if st == 'completed': break
        if st in ('failed', 'cancelled'):
            j = _jobs(); j.pop(slug, None)   # clear so next run starts fresh
            open(JOBS, 'w').write(''.join(f'{k}={v}\n' for k, v in j.items()))
            print(f"ERR {slug}: {s.get('error', s)}"); return False

    for attempt in range(5):
        try:
            c = requests.get(f'https://api.openai.com/v1/videos/{vid_id}/content',
                             headers={'Authorization': f'Bearer {KEY}'}, timeout=300)
            break
        except Exception as e:
            print(f"  [{slug}] download retry ({type(e).__name__})"); time.sleep(8)
    open(dst, 'wb').write(c.content)
    print(f"OK {slug} ({len(c.content)//1024} KB) -> {dst}")

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    for n in (args or list(MOTION)):
        gen(n, force)
