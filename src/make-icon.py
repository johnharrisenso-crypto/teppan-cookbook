"""Draws the Teppan Cookbook icon: a dark griddle with one okonomiyaki on it. Writes 180 and 512 px PNGs.
Usage: python3 make-icon.py OUTDIR"""
import sys
from PIL import Image, ImageDraw
def draw(size):
    S = 4 * size  # draw large, then shrink for smooth edges
    im = Image.new("RGB", (S, S), (47, 107, 58))              # nori green, full bleed (iOS rounds the corners)
    d = ImageDraw.Draw(im)
    m = S * 0.16
    d.rounded_rectangle([m, S*0.22, S-m, S*0.78], radius=S*0.07, fill=(29, 35, 48))       # griddle
    cx, cy, r = S/2, S*0.5, S*0.2
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(214, 165, 125))                             # pancake
    for i, dy in enumerate((-0.09, 0.0, 0.09)):                                           # sauce and mayo zigzag
        y = cy + dy*S
        d.line([(cx-r*0.7, y), (cx+r*0.7, y)], fill=(91, 58, 34) if i != 1 else (247, 240, 220), width=int(S*0.022))
    d.ellipse([S*0.70, S*0.30, S*0.76, S*0.36], fill=(200, 50, 74))                        # beni shoga
    return im.resize((size, size), Image.LANCZOS)
out = sys.argv[1]
draw(180).save(out + "/apple-touch-icon.png")
draw(512).save(out + "/icon-512.png")
print("icons written")
