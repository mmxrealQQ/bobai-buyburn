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
        "scene in a misty dark-green swamp forest at dusk. The small cute "
        "brain-headed creature in a tattered sand-beige robe looks exactly "
        "like in the reference image and keeps its exact face and proportions. ")
TAIL = (" Gentle volumetric mist drifts slowly, tiny warm background lights "
        "flicker softly, robe fabric sways very subtly. Subtle, natural, "
        "slow movements — nothing exaggerated. No text anywhere.")

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
    'saga-hodl':     "He clenches both raised fists tighter and shakes them "
                     "slightly with determination, leaning a little toward "
                     "the camera, intense determined stare.",
    'saga-fear':     "He meditates peacefully with closed eyes, breathing "
                     "slowly and deeply, hands folded on his cane rising and "
                     "falling gently with each breath, mist swirling around.",
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
            print(f"ERR {slug}: {s}"); sys.exit(1)

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
