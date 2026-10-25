#!/usr/bin/env python3
"""
THE REVIEW PAGE (2026-10-03, operator: "a local page with all videos to watch, each with a code like A1 B2 C4, saying
whether it is live and where — then I tell you per code what to change"). Every take of every move, playable, with:
  - a code that stays the same: the LETTER is the move (fixed order below, new moves appended), the NUMBER is the take
    (hub-burn = C1, hub-burn-v4 = C4), so a code means the same clip tomorrow
  - LIVE (in dashboard/terminal/anim/clips.json) · WITHHELD (with the reason from anim/cut.txt) · PENDING REVIEW
  - WHEN/WHERE it plays in the terminal (clipmap.WHEN)
Writes anim/review.html next to the videos (open it straight from disk) and anim/review-codes.txt (code -> clip, for me).
Usage: python clippage.py
"""
import os, re, json, html, glob, string
HERE = os.path.dirname(os.path.abspath(__file__)); ANIM = os.path.join(HERE, 'anim')
src = open(os.path.join(HERE, 'clipmap.py'), encoding='utf-8').read()
WHEN = eval(src[src.index('WHEN = {') + 7: src.index('\n}\n', src.index('WHEN = {')) + 2])  # one source for the WHEN texts
live = set(json.load(open(os.path.join(HERE, '..', '..', 'dashboard', 'terminal', 'anim', 'clips.json'))))
why, pending, last, named = {}, set(), '', False
for l in open(os.path.join(ANIM, 'cut.txt'), encoding='utf-8').read().split('\n'):
    s = l.strip()
    if s.startswith('#'):  # a note runs over several comment lines: a dated line (or the first after names) starts one
        t = s.lstrip('# ').strip()  # (2026-10-15: only the last line was kept, "FAIL hoodie. golive.mjs now refuses ...")
        last = t if named or not last or re.match(r'\d{1,2}\.\d{1,2}\.', t) else last + ' ' + t; named = False
    elif s:
        named = True
        why[s] = last
        if 'PENDING' in last.upper(): pending.add(s)
def base(c):
    b = re.sub(r'-v\d+$', '', c); b = re.sub(r'^hub-', '', b)
    return 'enter' if b.startswith('enter-') else b
def take(c):
    m = re.search(r'-v(\d+)$', c); return int(m.group(1)) if m else 1
# every take we have a video of: the hub takes and the standing ones (the old non-hub takes never play any more)
# (the entrances are out for good, operator 2.10.: never shown here). A take kept only as its packed file (colour on top,
# alpha below) is shown by its top half
vids = {}
for p in glob.glob(os.path.join(ANIM, '*.mp4')):
    b = os.path.basename(p)
    if re.search(r'\.(raw|sq)\.mp4$', b) or not re.match(r'(hub-|idle|rest)', b) or '-enter-' in b: continue
    c = b[:-9] if b.endswith('.pack.mp4') else b[:-4]
    if b.endswith('.pack.mp4'): vids.setdefault(c, b)
    else: vids[c] = b
clips = sorted(vids)
# DEFI ROLES (operator, 2026-10-05: "Q4 and Q5 are not defi but defi-buy"): the terminal plays the coin takes only when the
# DeFi agent buys BOBAI and the blue ones only for new capital — read from terminal.js so the page says what it does
tjs = open(os.path.join(HERE, '..', 'terminal-site', 'terminal', 'terminal.js'), encoding='utf-8').read()
ROLE = {}
for var, role in (('DEFI_COIN', 'defi-buy: only when the DeFi agent buys BOBAI'), ('DEFI_BLUE', 'defi-cap: new capital put to work')):
    m = re.search(var + r" = \[([^\]]*)\]", tjs)
    for c in re.findall(r"'([^']+)'", m.group(1) if m else ''): ROLE[c] = role
groups = {}
for c in clips: groups.setdefault(base(c), []).append(c)
ORDER = ['idle', 'rest', 'buy-nice', 'buy-big', 'buy-huge', 'buy-whale', 'buy-thunder', 'buy-kraken', 'burn', 'burn-small',
         'burn-nice', 'burn-big', 'burn-mega', 'burn-apocalypse', 'burn-supernova', 'liq', 'defi', 'giggle', 'nft', 'cheer',
         'saber', 'bull', 'dance', 'moon', 'coffee', 'think', 'shrug', 'walk', 'pushups', 'hodl', 'laugh', 'build', 'enter']
order = [k for k in ORDER if k in groups] + sorted(k for k in groups if k not in ORDER)
letter = lambda i: string.ascii_uppercase[i] if i < 26 else 'Z' + letter(i - 26)  # any count of moves (52+ since ouch, 2026-10-06)
# THE LETTERS STAND STILL (2026-10-25, operator: "irgendwie stimmen die Bezeichnungen nicht mehr"): a move outside ORDER
# used to take its letter from its alphabetical place among all moves, so the three board moves (board-…, sorted before
# guitar) moved guitar … zen three letters on. Every such move now has its letter written here — the ones the operator
# knew before 25.10. exactly as they were — and a move that is new gets the next free letter after the last one here,
# never moving another. Add each new move to FIXED once it is in.
FIXED = {'guitar': 'ZZN', 'hire': 'ZZO', 'ouch': 'ZZP', 'paid': 'ZZQ', 'popcorn': 'ZZR', 'settle': 'ZZS', 'venus': 'ZZT', 'zen': 'ZZU',
         'board-bug': 'ZZV', 'board-detective': 'ZZW', 'board-plane': 'ZZX'}
_idx = lambda L: (string.ascii_uppercase.index(L) if len(L) == 1 else 26 + _idx(L[1:]))
_new = sorted(k for k in groups if k not in ORDER and k not in FIXED)
def code_of(k):
    if k in ORDER: return letter(ORDER.index(k))
    if k in FIXED: return FIXED[k]
    return letter(max(_idx(v) for v in FIXED.values()) + 1 + _new.index(k))
if _new: print(f'clippage: new move(s) without a fixed letter — add to FIXED: {", ".join(f"{k} {code_of(k)}" for k in _new)}')
codes, secs, n = [], [], {'live': 0, 'held': 0, 'pend': 0}
chips = []  # THE OVERVIEW (operator, 2026-10-05: "really the complete overview, may be shown differently so it stays clear"):
            # one row per move, every take as a chip in its status colour, a click jumps to the video
# NEW ONES FIRST (operator, 2026-10-04: "put the new ones at the very top, sort them in only once I released them"): a
# pending take is shown in its own section above all moves, and joins its move's section after the release
pend_figs = []
data = []  # the same, as data, for the builder page (builderpage.py)
for k in order:
    L = code_of(k)
    figs = []; mv = {'letter': L, 'move': k, 'when': WHEN.get(k, ''), 'takes': []}; data.append(mv)
    for c in sorted(groups[k], key=lambda c: (take(c), c)):
        code = f'{L}{take(c)}' 
        st = 'live' if c in live else 'pend' if c in pending else 'held'; n[st] += 1
        lab = {'live': 'LIVE', 'pend': 'PENDING REVIEW', 'held': 'WITHHELD'}[st]
        note = '' if st == 'live' else html.escape(why.get(c, 'not in clips.json, no reason written'))
        codes.append(f'{code}\t{c}\t{lab}')
        mv['takes'].append({'code': code, 'clip': c, 'file': vids[c], 'st': st, 'note': why.get(c, '') if st != 'live' else '', 'role': ROLE.get(c, '')})
        (pend_figs if st == 'pend' else figs).append(f'<figure class="{st}" id="{code}"><div class="vb{' pk' if vids[c].endswith('.pack.mp4') else ''}"><video src="{html.escape(vids[c])}" muted loop playsinline preload="metadata" controls></video></div>'
                    f'<figcaption><b class="code">{code}</b> <span class="st">{lab}</span>' + (f' · {html.escape(k)}' if st == 'pend' else '') + f'<br><code>{html.escape(c)}</code>'
                    + (f'<br><b class="role">{html.escape(ROLE[c])}</b>' if c in ROLE else '')
                    + (f'<br><small>{note}</small>' if note else '') + '</figcaption></figure>')
    st_of = lambda c: 'live' if c in live else 'pend' if c in pending else 'held'
    nl = sum(c in live for c in groups[k])
    chips.append(f'<tr><td class="code">{L}</td><td><a href="#m-{k}">{html.escape(k)}</a></td><td>{nl}/{len(groups[k])}</td><td>'
                 + ' '.join(f'<a class="chip {st_of(c)}" href="#{L}{take(c)}" title="{html.escape(c)}">{L}{take(c)}</a>' for c in sorted(groups[k], key=lambda c: (take(c), c)))
                 + '</td></tr>')
    if not figs: continue  # a move with only pending takes shows them at the top alone
    secs.append(f'<section id="m-{k}"><h2><span class="code">{L}</span> {html.escape(k)} <small>{nl} live of {len(groups[k])}</small></h2>'
                f'<p class="when">{html.escape(WHEN.get(k, "?"))}</p><div class="grid">{"".join(figs)}</div></section>')
if pend_figs: secs.insert(0, f'<section id="m-new"><h2><span class="code">NEW</span> waiting for your review <small>{len(pend_figs)}</small></h2>'
                           f'<p class="when">Release or pull each by its code; a released take moves into its move below.</p><div class="grid">{"".join(pend_figs)}</div></section>')
secs.insert(1 if pend_figs else 0, '<section id="m-all"><h2><span class="code">ALL</span> overview <small>green live · red withheld · yellow new — '
                 'click a code to see the video</small></h2><table class="ov"><tr><th></th><th>move</th><th>live</th><th>takes</th></tr>'
                 + ''.join(chips) + '</table></section>')
nav = '<a href="#m-all"><b>ALL</b> overview</a> ' + ('<a href="#m-new"><b>NEW</b> to review</a> ' if pend_figs else '') + ' '.join(f'<a href="#m-{k}"><b>{code_of(k)}</b> {k}</a>' for k in order)
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOBAI Clip Review</title><style>
:root{{--bg:#0d0c16;--fg:#ece9f5;--mut:#9a95ad;--card:#1a1828;--live:#7ee0a0;--held:#ff7b8a;--pend:#f5c26b;--acc:#f0b90b}}
:root[data-theme="light"]{{--bg:#f7f6fb;--fg:#1b1830;--mut:#5d5873;--card:#fff;--live:#16794a;--held:#b4232f;--pend:#9a6400;--acc:#a87f00}}
@media (prefers-color-scheme:light){{:root:not([data-theme="dark"]){{--bg:#f7f6fb;--fg:#1b1830;--mut:#5d5873;--card:#fff;--live:#16794a;--held:#b4232f;--pend:#9a6400;--acc:#a87f00}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}}main{{max-width:1600px;margin:auto;padding:16px}}
h1{{font-size:1.5rem;margin:.2em 0}}.top{{position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2;border-bottom:1px solid #8884}}
nav{{font-size:.85rem;display:flex;flex-wrap:wrap;gap:4px 12px}}nav a{{color:var(--fg);text-decoration:none}}nav b{{color:var(--acc)}}
.filt{{margin:6px 0 0;font-size:.85rem;color:var(--mut)}}.filt label{{margin-right:14px;cursor:pointer}}
section{{margin:1.6em 0 2em}}h2{{font-size:1.2rem;margin:0}}h2 small{{color:var(--mut);font-weight:400;font-size:.8rem}}.code{{color:var(--acc);font-weight:800}}
.when{{color:var(--mut);margin:.2em 0 .8em;font-size:.9rem}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}}
figure{{margin:0;background:var(--card);border-radius:8px;padding:6px;border-top:3px solid var(--live)}}figure.held{{border-color:var(--held)}}figure.pend{{border-color:var(--pend)}}
video{{width:100%;aspect-ratio:9/16;background:#00b140;border-radius:5px;display:block}}.pk{{aspect-ratio:9/16;overflow:hidden;border-radius:5px}}.pk video{{aspect-ratio:auto;height:auto;border-radius:0;background:#000}}figcaption{{font-size:.82rem;margin-top:5px;word-break:break-word}}
.live .st{{color:var(--live)}}.held .st{{color:var(--held)}}.pend .st{{color:var(--pend)}}.st{{font-weight:700;font-size:.75rem}}small{{color:var(--mut)}}.role{{color:var(--acc);font-size:.75rem}}
body.nolive figure.live,body.noheld figure.held{{display:none}}
.ov{{border-collapse:collapse;font-size:.85rem;width:100%}}.ov td,.ov th{{padding:4px 8px;border-bottom:1px solid #8883;text-align:left;vertical-align:top}}
.ov a{{color:var(--fg)}}.chip{{display:inline-block;margin:2px 3px 2px 0;padding:1px 7px;border-radius:10px;font-weight:700;font-size:.78rem;text-decoration:none;border:1.5px solid}}
.chip.live{{border-color:var(--live);color:var(--live)!important}}.chip.held{{border-color:var(--held);color:var(--held)!important;opacity:.8}}.chip.pend{{border-color:var(--pend);color:var(--pend)!important;background:#f5c26b22}}
figure:target{{outline:3px solid var(--acc)}}
</style></head><body><main><div class="top"><h1>BOBAI clip review</h1>
<nav>{nav}</nav><div class="filt">{n["live"]} live · {n["held"]} withheld · {n["pend"]} pending &nbsp;
<label><input type="checkbox" checked onchange="document.body.classList.toggle('nolive',!this.checked)"> show live</label>
<label><input type="checkbox" checked onchange="document.body.classList.toggle('noheld',!this.checked)"> show withheld</label>
Hover a clip to play it. The green is the raw take before keying; in the terminal it is cut out.</div></div>
{''.join(secs)}</main><script>
document.querySelectorAll('video').forEach(v=>{{v.addEventListener('mouseenter',()=>v.play().catch(()=>{{}}));v.addEventListener('mouseleave',()=>v.pause())}});
</script></body></html>'''
open(os.path.join(ANIM, 'review.html'), 'w', encoding='utf-8').write(page)
json.dump(data, open(os.path.join(ANIM, 'review-data.json'), 'w', encoding='utf-8'), indent=1)
open(os.path.join(ANIM, 'review-codes.txt'), 'w', encoding='utf-8').write('\n'.join(codes) + '\n')
print(f'anim/review.html: {len(clips)} takes, {len(order)} moves · live {n["live"]} · withheld {n["held"]} · pending {n["pend"]}')
