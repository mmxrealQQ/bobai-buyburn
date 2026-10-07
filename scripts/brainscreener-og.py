# brainScreener share cards (2026-10-07): one 1200x630 picture per test, so a link shared on X says WHICH test it is.
# Until then all 28 pages carried the same wordless brain (og-image.jpg). The left half of that picture is empty dark:
# the test's name, what it screens for and its facts go there. Fonts: the share-card worker's TTFs.
# usage: python scripts/brainscreener-og.py      -> dashboard/brainscreener/assets/images/og-<id>.jpg
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'dashboard', 'brainscreener', 'assets', 'images')
FONTS = os.path.join(ROOT, 'worker-cards', 'fonts')
GOLD, INK, MUTED = (240, 185, 11), (240, 238, 248), (160, 160, 185)

# id (page name) -> (big name, what it screens for, facts)
TESTS = {
    'phq9': ('PHQ-9', 'Depression screening', '9 questions · 3–4 min'),
    'gad7': ('GAD-7', 'Anxiety screening', '7 questions · 2–3 min'),
    'adhd': ('ADHD', 'Adult self-test · ASRS v1.1', '43 questions · 10–12 min'),
    'aq50': ('AQ-50', 'Autism spectrum (adults)', '50 questions · 8–12 min'),
    'audit': ('AUDIT', 'Alcohol screening (WHO)', '10 questions · 3–4 min'),
    'bfi2': ('BFI-2', 'Big Five personality', '60 questions · 10–14 min'),
    'character': ('Dark Tetrad', 'Character profile', '28 questions · 6–8 min'),
    'eat26': ('EAT-26', 'Eating disorder screening', '26 questions · 5–7 min'),
    'iq': ('IQ test', '40 tasks · four cognitive domains', '25–30 min'),
    'mdq': ('MDQ', 'Bipolar screening', '15 questions · 3–4 min'),
    'ocir': ('OCI-R', 'OCD screening', '18 questions · 4–5 min'),
    'pcl5': ('PCL-5', 'Trauma / PTSD screening', '20 questions · 5–7 min'),
    'whodas36': ('WHODAS 2.0', 'Daily functioning (WHO)', '36 questions · 8–12 min'),
}

def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

def fit(draw, text, name, size, width):
    while size > 20 and draw.textlength(text, font=font(name, size)) > width:
        size -= 2
    return font(name, size)

def card(key, big, what, facts):
    im = Image.open(os.path.join(IMG, 'og-image.jpg')).convert('RGB')
    d = ImageDraw.Draw(im)
    x, w = 72, 560
    d.text((x, 92), 'brainScreener', font=font('spacegrotesk-700.ttf', 34), fill=GOLD)
    f = fit(d, big, 'spacegrotesk-700.ttf', 104, w)
    d.text((x, 168), big, font=f, fill=INK)
    d.text((x, 300), what, font=fit(d, what, 'inter-700.ttf', 40, w), fill=INK)
    d.text((x, 362), facts, font=font('inter-500.ttf', 32), fill=MUTED)
    d.rounded_rectangle((x, 450, x + 470, 508), radius=29, outline=GOLD, width=2)
    d.text((x + 26, 462), 'Free · anonymous · no sign-up', font=font('inter-500.ttf', 26), fill=GOLD)
    d.text((x, 548), 'A self-test, not a diagnosis', font=font('inter-500.ttf', 22), fill=MUTED)
    out = os.path.join(IMG, f'og-{key}.jpg')
    im.save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    return out

if __name__ == '__main__':
    for k, (big, what, facts) in TESTS.items():
        p = card(k, big, what, facts)
        print(k, os.path.getsize(p) // 1024, 'KB')
