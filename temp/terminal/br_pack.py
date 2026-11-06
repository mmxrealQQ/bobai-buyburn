# Brainrot props -> small web images (2026-11-05). For every creature the newest base picture and its newest frame
# (temp/terminal/props-br/<name>-<ts>.png, <name>@<frame>-<ts>.png) are cleared of the faint alpha haze, cropped to ONE
# box (the union of base and frame, so the two lie exactly on each other) and written LOUD (no muting: this look is
# meant to scream) to terminal-site/terminal/br/<name>.webp and <name>_<frame>.webp. The sky is only resized.
# usage: python temp/terminal/br_pack.py
import glob, os, re
from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'props-br')
OUT = os.path.join(HERE, '..', 'terminal-site', 'terminal', 'br')
os.makedirs(OUT, exist_ok=True)
# longest side in px, about 2x the size shown
SIZES = {'octo': 300, 'bulb': 260, 'astro': 280, 'snail': 300, 'fridge': 280, 'sock': 260, 'shrimp': 260, 'kaiju': 520,
         'eyeball': 260, 'duck': 260, 'banana': 280, 'pigeon': 280, 'cactus': 260, 'pizza': 260, 'washer': 280,
         'cloud': 300, 'dj': 280, 'mini': 140, 'podium': 640,
         'stburn': 230, 'stbob': 230, 'stbobs': 230, 'stliq': 230, 'stdefi': 230, 'stgiggle': 230, 'stcreator': 230}
newest = lambda pat: (sorted(glob.glob(os.path.join(SRC, pat))) or [None])[-1]

def clean(path):
    a = np.asarray(Image.open(path).convert('RGBA')).copy()
    a[a[..., 3] < 24] = 0
    e = 12; a[:e] = 0; a[-e:] = 0; a[:, :e] = 0; a[:, -e:] = 0
    return a

# THE BALL LEAVES THE STAGE (operator, 2026-11-06: "put the disco ball in the ring, it has a good place there"): the
# painted ball is covered by the brain folds 2.9 radii to its left, a soft round patch (no second ball on the stage)
def no_ball(a):
    H, W = a.shape[:2]; cx, cy, r = 0.5034 * W, 0.6442 * H, 0.0968 * W  # = DISCO_AT below
    yy, xx = np.mgrid[0:H, 0:W]; d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    m = np.clip((r * 1.3 - d) / (r * 0.3), 0, 1)[..., None]; f = a.astype(np.float32)
    donor = np.roll(f, int(round(2.9 * r)), axis=1)  # donor[y, x] = a[y, x - 2.9 r]
    return (f * (1 - m) + donor * m).clip(0, 255).astype(np.uint8)

total = 0
for name, side in SIZES.items():
    base = newest(name + '-1*.png')
    if not base: print('MISSING', name); continue
    frames = {}
    for f in [x for x in glob.glob(os.path.join(SRC, name + '@*-1*.png')) if not x.endswith('.orig.png')]:  # br_cutout.py keeps the uncut original beside it
        k = re.match(r'.*@([a-z]+)-\d+\.png$', f).group(1); frames[k] = max(frames.get(k, ''), f)
    pics = {'': clean(base), **{k: clean(f) for k, f in frames.items()}}
    if name == 'podium': pics[''] = no_ball(pics[''])
    solid = np.zeros(pics[''].shape[:2], bool)
    for a in pics.values():
        if a.shape[:2] == solid.shape: solid |= a[..., 3] > 128
    rows = np.where(solid.sum(axis=1) > 4)[0]; cols = np.where(solid.sum(axis=0) > 4)[0]
    pad = 8; H, W = solid.shape
    box = (max(0, cols.min() - pad), max(0, rows.min() - pad), min(W, cols.max() + pad), min(H, rows.max() + pad))
    for k, a in pics.items():
        im = Image.fromarray(a).crop(box); s = side / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        fn = name + ('_' + k if k else '') + '.webp'
        im.save(os.path.join(OUT, fn), 'WEBP', quality=84, method=4)
        total += os.path.getsize(os.path.join(OUT, fn))
        print(fn, im.size, os.path.getsize(os.path.join(OUT, fn)), 'bytes')
# THE DISCO BALL ON ITS OWN (operator, 2026-11-05 night: "the disco ball should be seen"): the stations' creatures stood on
# the stage's painted ball; cut out round from the podium picture, it is drawn ABOVE them (disco.webp)
DISCO_AT = (0.5034, 0.6442, 0.0968)  # the ball's centre and radius in the podium picture, shares of its width/height (in the packed podium.webp: 50 % / 70 % of the picture, radius 63 of 640 px)
pod = newest('podium-1*.png')
if pod:
    im = Image.open(pod).convert('RGBA'); a = np.asarray(im).copy(); H, W = a.shape[:2]
    cx, cy, r = DISCO_AT[0] * W, DISCO_AT[1] * H, DISCO_AT[2] * W
    yy, xx = np.mgrid[0:H, 0:W]; d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    a[..., 3] = (a[..., 3] * np.clip((r - d) / 3 + 0.5, 0, 1)).astype(np.uint8)
    b = Image.fromarray(a).crop((int(cx - r - 2), int(cy - r - 2), int(cx + r + 2), int(cy + r + 2))).resize((160, 160), Image.LANCZOS)
    b.save(os.path.join(OUT, 'disco.webp'), 'WEBP', quality=86, method=4); total += os.path.getsize(os.path.join(OUT, 'disco.webp')); print('disco.webp', os.path.getsize(os.path.join(OUT, 'disco.webp')), 'bytes')
sky = newest('sky3-1*.png') or newest('sky2-1*.png') or newest('sky-1*.png')  # sky2 (5.11. evening): teal and orange, the pink brain stands out
if sky:
    Image.open(sky).convert('RGB').resize((1280, 853), Image.LANCZOS).save(os.path.join(OUT, 'sky.webp'), 'WEBP', quality=70, method=4)
    total += os.path.getsize(os.path.join(OUT, 'sky.webp')); print('sky.webp', os.path.getsize(os.path.join(OUT, 'sky.webp')), 'bytes')
print('total', total // 1024, 'KB')
