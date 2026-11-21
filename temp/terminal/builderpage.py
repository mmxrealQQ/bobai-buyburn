#!/usr/bin/env python3
"""
THE BUILDER PAGE (2026-10-07, operator: "update the review page completely, add the Halloween theme, put it online but
not public — for me and the builder colleagues; like the old for-designer page, with the themes separated").
One private Artifact with a tab per theme:
  - BOBAI Terminal: every take of every move with its code (clippage.py: letter = move, number = take), LIVE /
    WITHHELD / NEW, when it plays; small keyed previews (his take cut out, on the terminal's dark ground)
  - Halloween: the scenes, BOBAI's films (copied server-side from the films artifact), the big clown's four clips, every
    picture of the look with its frames
  - WC26: the Worldcup '26 illustrations as they lie in dashboard/worldcup/app/illus (48 team avatars, heroes, accents,
    coins), each with where it is used
Writes temp/builder/ (index.html + v/ hw/ wc/). Previews are encoded only when missing or older than their source.
Usage: python builderpage.py      then publish temp/builder/index.html with its files (see the session notes)
"""
import os, re, sys, json, glob, shutil, subprocess, html
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ANIM = os.path.join(HERE, 'anim'); HW = os.path.join(HERE, '..', 'terminal-site', 'terminal', 'hw')
OUT = os.path.join(ROOT, 'temp', 'builder'); WC = os.path.join(ROOT, 'dashboard', 'worldcup', 'app')
for d in ('v', 'hw', 'wc'): os.makedirs(os.path.join(OUT, d), exist_ok=True)
subprocess.run(['python', os.path.join(HERE, 'clippage.py')], check=True)
moves = json.load(open(os.path.join(ANIM, 'review-data.json'), encoding='utf-8'))
# an empty file is never fresh (2026-10-07: a save cut off at 07:16 left wc/donation-usdt.webp at 0 bytes, newer
# than its source, so every later build kept the empty picture)
fresh = lambda dst, src: os.path.exists(dst) and os.path.getsize(dst) > 0 and os.path.getmtime(dst) >= os.path.getmtime(src)
BG = '0x15121b'  # the page's own ground behind a keyed take

def preview(src, dst, w=240):
    """a small H.264 preview: a packed take (colour above, alpha below) is keyed onto the page's ground, a raw take scaled"""
    if fresh(dst, src): return
    if src.endswith('.pack.mp4'):
        fc = (f"[0:v]split[x][y];[x]crop=iw:ih/2:0:0,split[c1][c2];[y]crop=iw:ih/2:0:ih/2,format=gray[a];"
              f"[c2]drawbox=0:0:iw:ih:{BG}:t=fill[bg];[c1][a]alphamerge[k];[bg][k]overlay,scale={w}:-2,format=yuv420p[o]")
        args = ['-filter_complex', fc, '-map', '[o]']
    else: args = ['-vf', f'scale={w}:-2,format=yuv420p']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, *args, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
                    '-movflags', '+faststart', dst], check=True)

def still(src, dst, w):
    if fresh(dst, src): return
    im = Image.open(src); im.thumbnail((w, w * 3)); im.save(dst, 'WEBP', quality=82, method=6)

# 1. the terminal's takes
import time
OPERATOR_OK = {'hub-board-bug', 'hub-board-plane', 'hub-board-detective'}  # 25.10. operator: "die sind super"
# decided by the operator on 25.10. 09:26-09:29 UTC (builder DECIDE, ✓ / ✗; carried out in anim/cut.txt the same morning)
DECIDED = {'hub-ouch', 'hub-ouch-v3', 'hub-paid-v3', 'hub-popcorn-v3', 'hub-zen', 'hub-zen-v2', 'hub-saber-v3', 'hub-bull-v3', 'hub-guitar',
           'hub-guitar-v2', 'hub-hire-v2', 'hub-paid-v2', 'hub-popcorn', 'hub-buy-thunder-v3', 'hub-buy-huge-v4', 'hub-buy-thunder-v4',
           'hub-buy-kraken', 'hub-buy-kraken-v2', 'hub-buy-kraken-v5', 'hub-burn-big-v2', 'hub-burn-apocalypse-v3', 'hub-burn-supernova-v2',
           'hub-liq', 'hub-liq-v2', 'hub-liq-v5', 'hub-defi-v4', 'hub-nft-v4', 'hub-paid',
           'hub-buy-whale-v2', 'hub-defi'}  # F2 + Q1: out on the operator's word (1.11.), off the top for good (21.11.: "F2 und Q1 will ich ja nicht")
MINE_HELD = {'hub-hire-v2'}  # its note names the operator (he approved the first take), but holding this one back was Claude's call
MINE_LIVE = {  # released by Claude, never confirmed by the operator (anim/cut.txt)
    'hub-ouch': '6.10. released by Claude: the Halloween moon hits his head (clipcheck: his face in every frame)',
    'hub-ouch-v3': '6.10. released by Claude: the moon hits his head, second take (clipcheck: his face in every frame)',
    'hub-zen': '10.10. released by Claude: palms together, floats cross-legged, lands',
    'hub-zen-v2': '10.10. released by Claude: deep breath, arms over head, tree pose, steps down',
    'hub-popcorn-v3': '10.10. released by Claude: watches like at the movies, eats, crumples the bucket and pockets it',
    'hub-paid-v3': '22.10. released by Claude: the paper bird stays low beside him (an agent paid a service)'}
for m in moves:
    for t in m['takes']:
        # named by the CLIP, never by the code (2026-10-25: when the codes moved back, v/ZZN1.mp4 — built as board-bug —
        # would have stood as ZZN1 guitar, since a file newer than its source is never built again)
        t['v'] = f"v/{t['clip']}.mp4"; preview(os.path.join(ANIM, t['file']), os.path.join(OUT, t['v']))
        # NEW AND ALREADY LIVE (2026-10-25, operator: "die neuen Videos ganz oben im /builder, damit ich sie sehe und
        # freigeben kann … dann sehe ich auch gleich, welche du gemacht hast"): a take shot in the last 36 hours (the ones of 22.10. he had already seen and released) that
        # plays live stands at the very top with its day, so the operator can still say no
        src = os.path.join(ANIM, t['file'])
        if os.path.exists(src) and time.time() - os.path.getmtime(src) < 36 * 3600:
            t['made'] = time.strftime('%d.%m.%Y', time.gmtime(os.path.getmtime(src)))
        WHEN = {'board-bug': 'plays when an agent posts a bug or a fix, or marks a thread resolved on the Brain Board',
                'board-plane': 'plays when an agent only answers on the Brain Board',
                'board-detective': 'plays when an agent opens a question, tip or note on the Brain Board'}
        if m['move'] in WHEN and not t.get('note'): t['note'] = WHEN[m['move']]
        # TO DECIDE, ALL AT THE TOP (2026-10-25, operator: "sortiere alle, bei welchen du unsicher bist, ganz oben; dann
        # sage ich, welches ok ist und welches nicht … sonst sind evtl. super Animationen drin, die nie abgespielt werden"):
        #   mine  live, released by Claude after 6.10., never confirmed by the operator
        #   me    withheld on Claude's judgement — a good take may wait here unplayed
        #   you   withheld on the operator's word, shown in case he thinks again
        # THE DAY IT WAS MADE, on every take (2026-10-25, operator: "füge jeweils noch das Herstellungsdatum an"): the
        # untouched original (<clip>.raw.mp4) or the take itself, the earlier — a re-key or a trim later moves a file's date
        days = [os.path.getmtime(p) for p in (os.path.join(ANIM, t['clip'] + '.raw.mp4'), os.path.join(ANIM, t['file'])) if os.path.exists(p)]
        t['born'] = time.strftime('%d.%m.%Y', time.gmtime(min(days))) if days else ''
        if t['clip'] in OPERATOR_OK: t.pop('made', None)
        if t['clip'] in DECIDED: continue  # the operator's ✓ / ✗ of 25.10. — no longer open
        if t['st'] == 'held':
            t['decide'] = 'me' if t['clip'] in MINE_HELD or not re.search(r'operator', t.get('note', ''), re.I) else 'you'
        elif t['st'] == 'live' and t['clip'] in MINE_LIVE:
            t['decide'] = 'mine'; t['note'] = MINE_LIVE[t['clip']]
# 2. Halloween: the clown's clips and every picture of the look
clown = []
for k, what in (('climb', 'He grips the gravestone\'s rim and pulls himself up beside it'), ('sneak', 'Tiptoe steps; the page carries him over behind BOBAI (mirrored for the other side)'),
                ('reach', 'Claws up behind BOBAI, hesitates, giggles behind his glove'), ('down', 'The climb, reversed: back down behind the stone')):
    src = os.path.join(HW, f'clown-{k}.pack.mp4'); dst = f'v/clown-{k}.mp4'; preview(src, os.path.join(OUT, dst), 220); clown.append({'k': k, 'v': dst, 'what': what})
pics = []
for p in sorted(glob.glob(os.path.join(HW, '*.webp'))):
    b = os.path.basename(p)[:-5]; w = 720 if b.startswith('back-') else 300
    still(p, os.path.join(OUT, 'hw', b + '.webp'), w); pics.append(b)
# 3. WC26
ctry = re.findall(r"code:\s*'([^']+)',\s*name:\s*'([^']+)'", open(os.path.join(WC, 'assets', 'countries.js'), encoding='utf-8').read())
codes48 = {c for c, _ in ctry}; avatars = []
for p in sorted(glob.glob(os.path.join(WC, 'illus', 'avatars', 'avatar-*'))):
    c = re.sub(r'^avatar-|\.\w+$', '', os.path.basename(p)); dst = f'wc/avatar-{c}.webp'; still(p, os.path.join(OUT, dst), 220)
    avatars.append({'code': c, 'name': dict(ctry).get(c, ''), 'img': dst, 'file': 'illus/avatars/' + os.path.basename(p), 'in48': c in codes48})
missing48 = [n for c, n in ctry if not any(a['code'] == c for a in avatars)]
ILLUS = [('dashboard-hero', 'Dashboard hero', 'Dashboard page, top banner'), ('tips-hero', 'Tips hero', 'Tips page, top banner'),
         ('bonus-hero', 'Bonus hero', 'Bonus questions page'), ('crypto-hero', 'Crypto hero', 'Crypto predictions page'),
         ('leaderboard-hero', 'Leaderboard hero', 'Leaderboard page'), ('prize-pool-hero', 'Prize pool hero', 'Prize pool page'),
         ('rules-hero', 'Rules hero', 'Rules page'), ('pool-trophy', 'Trophy flourish', 'Leaderboard + prize pool card corner'),
         ('bonus-crystal', 'Crystal ball', 'Bonus questions card corner'), ('tips-ball', 'Ball kick', 'Tips card corner'),
         ('coin-btc', 'BTC coin', 'Crypto predictions, leaderboard'), ('coin-bnb', 'BNB coin', 'Crypto predictions, leaderboard'),
         ('coin-bobai', 'BOBAI coin', 'Crypto predictions, leaderboard'), ('donation-bnb', 'Donation BNB', 'Donation box'),
         ('donation-usdt', 'Donation USDT', 'Donation box'), ('liquidity-lock', 'Liquidity lock', 'Prize pool page'),
         ('receipt-payout', 'Payout receipt', 'Prize pool page'), ('wallet-cascade', 'Wallet cascade', 'Prize pool page'),
         ('wallet-overflow', 'Wallet overflow', 'Prize pool page')]
illus = []
for f, name, used in ILLUS:
    src = next((p for p in (os.path.join(WC, 'illus', f + e) for e in ('.webp', '.png', '.jpg')) if os.path.exists(p)), None)
    if not src: illus.append({'name': name, 'used': used, 'file': f, 'img': ''}); continue
    dst = f'wc/{f}.webp'; still(src, os.path.join(OUT, dst), 560); illus.append({'name': name, 'used': used, 'file': 'illus/' + os.path.basename(src), 'img': dst})

# 4. THE NEWER THEMES AND EVERYTHING POSTED (2026-11-21, operator: "bring /builder completely up to date, Brain Pop and so
#    on, really all relevant graphics, animations and memes"): Brain Pop (the brainrot creatures and stations, the game's
#    cards), Xmas (our theme as it is now, the earlier look, its X pictures), Memes & posts (every finished X picture and
#    clip, the Giggle donation, the NFT drop cards). One generic gallery per tab: sections of pictures or clips.
os.makedirs(os.path.join(OUT, 'g'), exist_ok=True)
def item(src, name, note='', w=360):
    if not src or not os.path.exists(src) or os.path.getsize(src) == 0: return None
    b = re.sub(r'[^a-z0-9._-]+', '-', os.path.relpath(src, ROOT).replace('\\', '/').lower()).strip('-')
    born = time.strftime('%d.%m.%Y', time.gmtime(os.path.getmtime(src)))
    rel = os.path.relpath(src, ROOT).replace('\\', '/')
    if src.lower().endswith('.mp4'):
        dst = 'g/' + re.sub(r'\.mp4$', '', b) + '.mp4'; preview(src, os.path.join(OUT, dst), 360)
        return {'v': dst, 'name': name, 'note': note, 'file': rel, 'born': born}
    dst = 'g/' + re.sub(r'\.(png|jpe?g|webp|gif)$', '', b) + '.webp'; still(src, os.path.join(OUT, dst), w)
    return {'img': dst, 'name': name, 'note': note, 'file': rel, 'born': born}
def sec(id_, title, small, items): return {'id': id_, 'title': title, 'small': small, 'items': [i for i in items if i]}
TERM = os.path.join(ROOT, 'dashboard', 'terminal'); BR = os.path.join(TERM, 'br'); TJS = open(os.path.join(TERM, 'terminal.js'), encoding='utf-8').read()
CREA = re.findall(r"\{ n: '([a-z]+)', f: '([a-z_]+)'[^}]*?t: '([^']+)' \}", TJS)
STN = dict(re.findall(r"(st[a-z]+): '([A-Z ]+)'", TJS[TJS.find('const STNAME'):TJS.find('const STNAME') + 600]))
POST = {'stburn': ('BURN $BOBAI', 'flare'), 'stbobs': ('BURN $BOB (until Dec 1)', 'hammer'), 'stliq': ('ADD LIQ', 'splash'), 'stdefi': ('DEFI AGENT (until Nov 20)', 'grow'),
        'stgiggle': ('GIGGLE POT (until Nov 20)', 'laugh'), 'stcreator': ('CREATOR', 'paint'), 'sttrade': ('TRADES', 'ring')}
pop_st = []
for k, (where, fr) in POST.items():
    pop_st += [item(os.path.join(BR, k + '.webp'), f'{STN.get(k, k)}', f'Station {where} in brainrot · still', 300),
               item(os.path.join(BR, f'{k}_{fr}.webp'), f'{STN.get(k, k)} · {fr}', f'Station {where} · its move when the slice fires', 300)]
pop_cr = []
for n, f, t in CREA:
    pop_cr += [item(os.path.join(BR, n + '.webp'), t, f'Brain Pop creature ({n}) · tap it for points', 260), item(os.path.join(BR, f'{n}_{f}.webp'), f'{t} · {f}', f'its {f} frame', 260)]
SKIP = {n for n, _, _ in CREA} | {f'{n}_{f}' for n, f, _ in CREA} | set(POST) | {f'{k}_{v[1]}' for k, v in POST.items()}
pop_set = [item(p, os.path.basename(p)[:-5], 'Brainrot set piece', 420) for p in sorted(glob.glob(os.path.join(BR, '*.webp'))) if os.path.basename(p)[:-5] not in SKIP]
GAME = os.path.join(ROOT, 'dashboard', 'game')
pop_cards = [item(os.path.join(ROOT, 'dashboard', 'og-brainpop.jpg'), 'Brain Pop share card', 'og-brainpop.jpg — the link card of /pop', 560),
             item(os.path.join(GAME, 'score.jpg'), 'Score card', 'the game\'s score picture', 420), item(os.path.join(GAME, 'sticker.jpg'), 'Brain Pop sticker', '', 420),
             item(os.path.join(ROOT, 'x-posts', 'out', 'brainpop-x-1793951021240.png'), 'Brain Pop launch post', 'X picture', 560),
             item(os.path.join(ROOT, 'x-posts', 'out', 'brainpop69-1793967683233.png'), 'Brain Pop 6.9 post', 'X picture', 560),
             item(os.path.join(ROOT, 'temp', 'xpost-1113', 'creatures.png'), 'The creatures, all together', 'X picture 13 Nov', 560)]
pop_cards += [item(p, 'Friday the 13th · ' + os.path.basename(p)[:-4], 'Gameday post 13 Nov ($13 for the daily #1)', 560) for p in sorted(glob.glob(os.path.join(ROOT, 'temp', 'xpost-1113', 'friday13*.jpg')))]
pop_memes = [item(p, os.path.basename(p)[:-4], 'Brain Pop meme set 12 Nov', 420) for p in sorted(glob.glob(os.path.join(ROOT, 'temp', 'xpost-1112', 'meme-*.jpg')), key=lambda s: [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', s)])]
GAL = {'pop': {'sub': 'Brain Pop 6.9, the brainrot game inside the terminal · season Nov 6 – Nov 30, 2026 · the creatures and the stations are the brainrot look of the terminal',
               'sections': [sec('pop-st', 'Stations in brainrot', 'each slice of the tax as a creature; still + the move it makes when its slice fires', pop_st),
                            sec('pop-cr', 'The creatures', 'what you tap in the game; still + their move', pop_cr),
                            sec('pop-set', 'Set pieces', 'sky, podium, the RUG candle and the rest of the brainrot stage', pop_set),
                            sec('pop-cards', 'Cards and posts', 'share card, score, sticker, the X pictures', pop_cards),
                            sec('pop-memes', 'Meme set', 'the Brain Pop memes of 12 Nov', pop_memes)]}}
# Xmas: our theme now (code only: screenshots of it), the look before (v8, kept in git), the X pictures
XM = os.path.join(ROOT, 'xmas-themes', 'bobai-xmas-mmx_qq'); XOLD = os.path.join(OUT, 'xm-v8')
os.makedirs(XOLD, exist_ok=True)
try:
    lst = subprocess.run(['git', '-C', ROOT, 'ls-tree', '-r', '--name-only', '062ce79~1', 'xmas-themes/bobai-xmas-mmx_qq/theme/img'], capture_output=True, text=True).stdout.split()
    for f in lst:
        d = os.path.join(XOLD, os.path.basename(f))
        if not os.path.exists(d): open(d, 'wb').write(subprocess.run(['git', '-C', ROOT, 'show', f'062ce79~1:{f}'], capture_output=True).stdout)
except Exception as e: print('xmas v8 pictures not read:', e)
SHOTS = os.path.join(HERE, 'builder-shots')  # screenshots of the theme as it is, put here when it changes
xm_now = [item(p, os.path.basename(p)[:-4], 'Our Xmas theme v12 on the terminal: a painted fir with turning light strings, gifts at BOBAI\'s feet (one more per buy), garland, a ring of lights per station, quiet snow — all drawn in canvas code', 720) for p in sorted(glob.glob(os.path.join(SHOTS, 'xmas-*')))]
xm_old = [item(p, os.path.basename(p)[:-5], 'v8 "BOBAI Builds Xmas on BNB" (17 Nov), retired 21 Nov', 360) for p in sorted(glob.glob(os.path.join(XOLD, '*.webp')))]
xm_x = [item(p, os.path.basename(p)[:-4], 'Xmas X picture 17 Nov', 560) for p in sorted(glob.glob(os.path.join(ROOT, 'temp', 'xpost-1117', '*.png')))]
GAL['xmas'] = {'sub': 'The community Xmas terminal: from Dec 1 visitors pick a theme by its builder at the snowflake next to LIVE · anyone builds one with npx https://brainonbnb.com/xmas/kit.tgz · preview https://xmas.bobai-dashboard.pages.dev/?xmas=mmx_qq',
               'sections': [sec('xm-now', 'Our theme now', 'v12, 21 Nov · code, no pictures: these are screenshots', xm_now),
                            sec('xm-x', 'X pictures', 'posted 17 Nov', xm_x), sec('xm-old', 'The look before', 'v8, pictures made with OpenAI', xm_old)]}
# Memes & posts: every finished X picture and clip (not the raw generations), the Giggle donation, the NFT drop cards
FIN = lambda p: not re.search(r'(^|[\\/])(raw|base|start|strip|clip-|edit)', os.path.basename(p)) and re.search(r'\.(jpe?g|png|mp4)$', p, re.I)
def posts(folder, note):
    ps = sorted(p for p in glob.glob(os.path.join(ROOT, folder, '*')) if FIN(p))
    jpg = {os.path.splitext(p)[0] for p in ps if p.lower().endswith('.jpg')}
    return [item(p, os.path.basename(p).rsplit('.', 1)[0], note, 560) for p in ps if not (p.lower().endswith('.png') and os.path.splitext(p)[0] in jpg)]
mm = []
for folder, note in (('x-posts', 'X post'), ('temp/xpost-1001', 'X post 1 Oct · the Brain Terminal live'), ('temp/xpost-1007', 'X post 7 Oct · Halloween'),
                     ('temp/xpost-1009', 'X post 9 Oct · 1 in 100M'), ('temp/xpost-1010', 'X post 10 Oct'), ('temp/xpost-1020', 'X post 20 Oct · Halloween pumpkin'),
                     ('temp/xpost-1108', 'X post 8 Nov · Diwali'), ('temp/xpost-1108ar', 'X post 8 Nov · Arabic'), ('temp/xpost-1116', 'X post 16 Nov · board / builder')):
    mm += posts(folder, note)
NFT = os.path.join(ROOT, 'nft', 'cards')
GAL['memes'] = {'sub': 'Every finished X picture and clip, the Giggle Academy donation and the NFT drop cards · the raw generations are left out',
                'sections': [sec('mm-posts', 'X pictures and clips', 'newest folders last', mm),
                             sec('mm-giggle', 'Giggle Academy', 'the whole pot, 1.0591 BNB, donated on 20 Nov (UN World Children\'s Day)', [item(os.path.join(ROOT, 'dashboard', 'giggle-donation.webp'), 'Giggle donation', 'giggle-donation.webp — the archive card of the donation', 720)]),
                             sec('mm-nft', 'NFT drop cards', 'minted to the buyer for every $BOBAI buy of $100+ (tier by size)', [item(p, os.path.basename(p)[:-4], 'NFT card', 360) for p in sorted(glob.glob(os.path.join(NFT, '*.png')))])]}

HERO = item(os.path.join(TERM, 'fig', 'cheer.webp'), 'BOBAI cheering', 'the overview card of the terminal tab', 560)  # a still, cut out (the takes are green screen)
DATA = {'moves': moves, 'clown': clown, 'pics': pics, 'avatars': avatars, 'missing48': missing48, 'illus': illus, 'gal': GAL, 'hero': HERO}
tpl = open(os.path.join(HERE, 'builderpage.html'), encoding='utf-8').read()
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(tpl.replace('/*DATA*/null', json.dumps(DATA, ensure_ascii=False)))
# THE SAME PAGE ON brainonbnb.com/builder, behind a password (2026-10-07, operator: "put the review page on brainonbnb too,
# just not public"): dashboard/_worker.js asks for it (Pages secret BUILDER_AUTH = user:password); dashboard/builder/ is
# gitignored, so none of it reaches the public repo or the source mirror. A whole document here (the artifact adds its own
# skeleton), the site's own Inter instead of Google Fonts (the site's CSP allows fonts from 'self' only), noindex.
site = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="robots" content="noindex,nofollow"><style>@font-face{font-family:"IBM Plex Sans";src:url(/fonts/inter-var.woff2) format("woff2");font-weight:100 900}'
        'body{margin:0}</style>' + re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\n?', '', tpl.replace('/*DATA*/null', json.dumps(DATA, ensure_ascii=False)))
        + '</html>')
open(os.path.join(OUT, 'site.html'), 'w', encoding='utf-8').write(site)
FILMS = os.path.join(OUT, 'films')  # the four Halloween films, fetched once from the films artifact (244KMHzPShCE1PdLMX3pN8)
for f in glob.glob(os.path.join(FILMS, '*.mp4')):
    d = os.path.join(OUT, 'hw', os.path.basename(f))
    if not fresh(d, f): shutil.copy2(f, d)
if '--site' in sys.argv:  # copy into dashboard/builder (then: node scripts/deploy-dashboard.mjs)
    S = os.path.join(ROOT, 'dashboard', 'builder')
    for sub in ('v', 'hw', 'wc', 'g'):
        os.makedirs(os.path.join(S, sub), exist_ok=True)
        for f in glob.glob(os.path.join(OUT, sub, '*')):
            d = os.path.join(S, sub, os.path.basename(f))
            if not fresh(d, f): shutil.copy2(f, d)
    shutil.copy2(os.path.join(OUT, 'site.html'), os.path.join(S, 'index.html'))
    print('dashboard/builder updated')
files = sorted(os.path.relpath(p, OUT).replace('\\', '/') for p in glob.glob(os.path.join(OUT, '*', '*')) if not os.path.relpath(p, OUT).startswith(('films', 'xm-v8')))
json.dump(files, open(os.path.join(OUT, 'files.json'), 'w'))
size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
n = sum(len(m['takes']) for m in moves)
print(f'temp/builder: {n} takes, {len(clown)} clown clips, {len(pics)} pictures, {len(avatars)} avatars, {len(illus)} illustrations · {len(files)} files, {size / 1e6:.1f} MB')
