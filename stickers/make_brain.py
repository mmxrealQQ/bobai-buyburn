#!/usr/bin/env python3
"""
Extract a clean transparent BOBAI brain from the REAL dextools logo.
The logo brain sits on a dark vignette that fades brown -> black at the corners.
Keying only the black leaves a brown halo, so we remove ALL dark pixels (lum < T)
that are CONNECTED TO THE BORDER (border-flood), which preserves dark details
INSIDE the brain. Then erode 1px + feather to kill the residual fringe.

The brain is NEVER AI-generated (brand rule) — this only background-removes the original.
"""
import numpy as np
from collections import deque
from PIL import Image, ImageFilter

SRC = r'd:/ai/fourmeme/dashboard/worldcup/_refs/bobai-logo-dextools-200x200.png'
OUT = r'd:/ai/fourmeme/stickers/assets/brain.png'
T = 110  # luminance below which a border-connected pixel is treated as background

orig = Image.open(SRC).convert('RGB')
rgb = np.array(orig)
lum = 0.299*rgb[:,:,0] + 0.587*rgb[:,:,1] + 0.114*rgb[:,:,2]
H, W = lum.shape
bg_cand = lum < T

# border-connected flood (4-connectivity) over the dark candidates
visited = np.zeros_like(bg_cand)
dq = deque()
for x in range(W):
    for y in (0, H-1):
        if bg_cand[y, x]:
            visited[y, x] = True; dq.append((y, x))
for y in range(H):
    for x in (0, W-1):
        if bg_cand[y, x] and not visited[y, x]:
            visited[y, x] = True; dq.append((y, x))
while dq:
    y, x = dq.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y+dy, x+dx
        if 0 <= ny < H and 0 <= nx < W and bg_cand[ny, nx] and not visited[ny, nx]:
            visited[ny, nx] = True; dq.append((ny, nx))

alpha = np.where(visited, 0, 255).astype('uint8')
am = Image.fromarray(alpha, 'L')
am = am.filter(ImageFilter.MinFilter(3))      # erode kept region 1px -> eats fringe
am = am.filter(ImageFilter.GaussianBlur(0.8)) # soft edge

out = Image.merge('RGBA', (*orig.split(), am))
bbox = out.getchannel('A').getbbox()
out = out.crop(bbox)
out.save(OUT)

# report
a = np.array(out.getchannel('A')); r = np.array(out.convert('RGB'))
op = a >= 245
ol = 0.299*r[:,:,0]+0.587*r[:,:,1]+0.114*r[:,:,2]
brown = op & (ol < 60)
print(f"brain.png -> {out.size}, opaque={int(op.sum())}, dark/brown-opaque={int(brown.sum())}")
