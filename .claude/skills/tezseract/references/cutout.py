#!/usr/bin/env python3
"""
cutout.py: knock a flat background out of a generated scene still.

Border-connected flood fill, not a global colour match. That distinction matters: a clay
diorama on a cream background usually has cream walls inside it too, and a global
"delete every pixel near this colour" pass punches holes straight through them. This only
removes background that is actually reachable from the edge of the frame.

Usage
    python3 cutout.py still_farm.png farm.png
    python3 cutout.py still_farm.png farm.png --tolerance 26 --feather 1.2
    python3 cutout.py 'stills/*.png' out/          # glob in, directory out

Requires Pillow. Output is RGBA PNG; convert to webp afterwards:
    cwebp -q 84 -resize 1800 0 farm.png -o farm.webp
"""

import argparse
import glob
import os
import sys
from collections import deque

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("cutout.py needs Pillow:  pip install Pillow")


def sample_background(px, w, h, inset=2):
    """Median-ish background colour, sampled around the border."""
    pts = []
    for x in range(inset, w - inset, max(1, w // 64)):
        pts.append(px[x, inset])
        pts.append(px[x, h - 1 - inset])
    for y in range(inset, h - inset, max(1, h // 64)):
        pts.append(px[inset, y])
        pts.append(px[w - 1 - inset, y])
    pts = [p[:3] for p in pts]
    pts.sort(key=lambda c: c[0] * 299 + c[1] * 587 + c[2] * 114)
    return pts[len(pts) // 2]


def flood_mask(px, w, h, bg, tol):
    """True where a pixel is background AND reachable from the frame edge."""
    tol2 = tol * tol * 3
    seen = bytearray(w * h)
    q = deque()

    def near(x, y):
        r, g, b = px[x, y][:3]
        dr, dg, db = r - bg[0], g - bg[1], b - bg[2]
        return dr * dr + dg * dg + db * db <= tol2

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and near(x, y):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and near(x, y):
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                i = ny * w + nx
                if not seen[i] and near(nx, ny):
                    seen[i] = 1
                    q.append((nx, ny))
    return seen


def cut(src_path, dst_path, tol, feather):
    im = Image.open(src_path).convert("RGB")
    w, h = im.size
    px = im.load()

    bg = sample_background(px, w, h)
    seen = flood_mask(px, w, h, bg, tol)

    # 255 where the subject is, 0 where the background is.
    alpha = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in seen))
    if feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))

    out = im.convert("RGBA")
    out.putalpha(alpha)
    out.save(dst_path)

    kept = sum(1 for v in seen if not v) / (w * h)
    print(f"{os.path.basename(src_path)} -> {dst_path}  bg={bg}  subject={kept:.0%}")
    if kept > 0.95:
        print("  warning: almost nothing was removed. Raise --tolerance.")
    elif kept < 0.05:
        print("  warning: almost everything was removed. Lower --tolerance.")


def main():
    ap = argparse.ArgumentParser(description="Border-connected background knockout.")
    ap.add_argument("src", help="input PNG, or a quoted glob")
    ap.add_argument("dst", help="output PNG, or a directory when src is a glob")
    ap.add_argument("--tolerance", type=float, default=22,
                    help="per-channel colour distance treated as background (default 22)")
    ap.add_argument("--feather", type=float, default=0.8,
                    help="gaussian blur radius on the alpha edge (default 0.8, 0 disables)")
    a = ap.parse_args()

    files = sorted(glob.glob(a.src)) if any(c in a.src for c in "*?[") else [a.src]
    if not files:
        sys.exit(f"no files matched {a.src}")

    into_dir = len(files) > 1 or os.path.isdir(a.dst)
    if into_dir:
        os.makedirs(a.dst, exist_ok=True)

    for f in files:
        dst = os.path.join(a.dst, os.path.basename(f)) if into_dir else a.dst
        cut(f, dst, a.tolerance, a.feather)


if __name__ == "__main__":
    main()
