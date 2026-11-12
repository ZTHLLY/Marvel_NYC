#!/usr/bin/env python3
"""Stitch screenshots into a labelled contact sheet: montage.py out.jpg cols img1 img2 ..."""
import sys, os
from PIL import Image, ImageDraw
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h), (0, 0, 0))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im.resize((w, h)), (x, y))
    label = os.path.splitext(os.path.basename(files[i]))[0]
    d.rectangle([x, y, x + 8 * len(label) + 10, y + 16], fill=(0, 0, 0))
    d.text((x + 4, y + 2), label, fill=(255, 220, 120))
sheet.save(out, quality=86)
