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

DATA = {'moves': moves, 'clown': clown, 'pics': pics, 'avatars': avatars, 'missing48': missing48, 'illus': illus}
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
    for sub in ('v', 'hw', 'wc'):
        os.makedirs(os.path.join(S, sub), exist_ok=True)
        for f in glob.glob(os.path.join(OUT, sub, '*')):
            d = os.path.join(S, sub, os.path.basename(f))
            if not fresh(d, f): shutil.copy2(f, d)
    shutil.copy2(os.path.join(OUT, 'site.html'), os.path.join(S, 'index.html'))
    print('dashboard/builder updated')
files = sorted(os.path.relpath(p, OUT).replace('\\', '/') for p in glob.glob(os.path.join(OUT, '*', '*')) if not os.path.relpath(p, OUT).startswith('films'))
json.dump(files, open(os.path.join(OUT, 'files.json'), 'w'))
size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
n = sum(len(m['takes']) for m in moves)
print(f'temp/builder: {n} takes, {len(clown)} clown clips, {len(pics)} pictures, {len(avatars)} avatars, {len(illus)} illustrations · {len(files)} files, {size / 1e6:.1f} MB')
