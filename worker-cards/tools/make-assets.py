# One-off asset build for worker-cards (run from the repo root: python worker-cards/tools/make-assets.py).
# resvg cannot read woff2 variable fonts or webp, so the site's own files are turned into what it can read:
#  - the two dashboard fonts -> static TTF instances at the weights the cards use, subset to Latin + the few
#    symbols the cards print (keeps the Worker bundle small; a glyph outside the subset would render as tofu,
#    so extend TEXT if a card ever prints something new)
#  - the BOBAI figure stills of the terminal -> PNG, scaled down (a 1600x900 card draws him ~830 px tall)
# The logo is copied byte-for-byte, never re-encoded: it is the original and stays that way.
import os, shutil
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'worker-cards')
TEXT = ''.join(chr(c) for c in range(0x20, 0x7F)) + '·–—…≈→←↗✓×•’‘“”°%€'

def add_approx(f):
    # The site's woff2 files are subset and have no U+2248; the browser borrows it from a system font, a
    # Worker has none. The cards print "≈ $…" in every sub-line, so the sign is built from the face's own
    # tilde: a composite glyph of two tildes, one above the other — same weight, same colour of stroke.
    from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent
    cmap = f.getBestCmap()
    if 0x2248 in cmap or 0x7E not in cmap: return
    tilde = cmap[0x7E]; upm = f['head'].unitsPerEm; d = round(upm * 0.095)
    g = Glyph(); g.numberOfContours = -1; g.components = []
    for dy in (d, -d):
        c = GlyphComponent(); c.glyphName = tilde; c.x = 0; c.y = dy; c.flags = 0x4; g.components.append(c)
    name = 'approxequal'
    order = list(f.getGlyphOrder()) + [name]
    f.setGlyphOrder(order); f['glyf'].glyphOrder = order; f['glyf'].glyphs[name] = g
    f['hmtx'][name] = f['hmtx'][tilde]
    for t in f['cmap'].tables:
        if t.isUnicode(): t.cmap[0x2248] = name
    f['glyf'][name].recalcBounds(f['glyf'])
    f['maxp'].numGlyphs = len(f.getGlyphOrder())

def font(src, name, weights):
    for w in weights:
        f = TTFont(os.path.join(ROOT, 'dashboard', 'fonts', src))
        axes = {a.axisTag: a for a in f['fvar'].axes}
        loc = {'wght': w}
        for tag, a in axes.items():
            if tag != 'wght': loc[tag] = a.defaultValue
        inst = instancer.instantiateVariableFont(f, loc)
        opts = subset.Options(); opts.layout_features = ['kern', 'liga', 'tnum', 'lnum']; opts.name_IDs = ['*']
        sub = subset.Subsetter(opts); sub.populate(text=TEXT); sub.subset(inst)
        inst.flavor = None
        add_approx(inst)
        # the variable font's default names ('Space Grotesk Light') would become the family resvg matches on;
        # one clean family per face, the weight carried by OS/2 usWeightClass (set by the instancer)
        fam = {'inter': 'Inter', 'spacegrotesk': 'Space Grotesk'}[name]
        nt = inst['name']; nt.removeNames(nameID=16); nt.removeNames(nameID=17)
        for nid, val in ((1, fam), (2, 'Regular'), (4, f'{fam} {w}'), (6, f'{fam.replace(" ", "")}-{w}')):
            nt.setName(val, nid, 3, 1, 0x409); nt.setName(val, nid, 1, 0, 0)
        path = os.path.join(OUT, 'fonts', f'{name}-{w}.ttf'); inst.save(path)
        print(path, os.path.getsize(path))
        # advance widths per character, in em: a Worker has no canvas.measureText, and the card must shrink a
        # long number to its box the way the browser's fit() does (kerning ignored — a few px on a 700 px line)
        t = TTFont(path); upm = t['head'].unitsPerEm; cmap = t.getBestCmap(); hm = t['hmtx']
        METRICS[f'{name}-{w}'] = {ch: round(hm[cmap[ord(ch)]][0] / upm, 4) for ch in TEXT if ord(ch) in cmap}

METRICS = {}
font('inter-var.woff2', 'inter', [500, 700])
font('spacegrotesk-var.woff2', 'spacegrotesk', [600, 700])
import json
with open(os.path.join(OUT, 'src', 'metrics.json'), 'w', encoding='utf-8') as fh: json.dump(METRICS, fh, ensure_ascii=False)

POSES = ['idle', 'giggle', 'liq', 'burn', 'burn-small', 'burn-nice', 'burn-big', 'burn-mega', 'burn-apocalypse', 'burn-supernova']
for p in POSES:
    im = Image.open(os.path.join(ROOT, 'temp', 'terminal-site', 'terminal', 'fig', p + '.webp')).convert('RGBA')
    im = im.resize((540, round(540 * im.height / im.width)), Image.LANCZOS)
    path = os.path.join(OUT, 'img', p + '.png'); im.save(path, optimize=True)
    print(path, im.size, os.path.getsize(path))

shutil.copyfile(os.path.join(ROOT, 'dashboard', 'logo.png'), os.path.join(OUT, 'img', 'logo.png'))
