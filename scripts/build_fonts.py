#!/usr/bin/env python3
"""
Build the self-hosted serif web font for the site.

Google Fonts is unreachable from parts of the site's audience, so the site
ships its own subset of Noto Serif SC (SIL Open Font License 1.1). The input is
the set of variable-font slices Google serves for the family (see README);
this script instantiates them at weights 400 and 700, keeps only the characters
that occur in the site (UI strings + the JSON data), merges the slices, and
writes two chunks per weight:

  * `core`  — characters that appear in the site's own markup/scripts and in
              summary.json / concepts.json (needed on every page)
  * `rest`  — everything else (witness titles, quotations, dictionary text),
              fetched only when a page renders such characters (unicode-range)

The family is renamed to "LZ Serif SC": the OFL asks that modified versions
are not distributed under the original name.

Usage:
    python scripts/build_fonts.py --slices <dir with 400-N.woff2 + slices.json>
                                  [--site docs] [--out docs/assets/fonts]
"""
import argparse
import glob
import io
import json
import os
import re
import sys
import tempfile

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FAMILY = "LZ Serif SC"
WEIGHTS = (400, 700)
ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
PUNCT = "，。、；：？！「」『』（）《》〈〉【】—…·‧–　○●◐■□◆◇▲△▸▾▴▵→←↑↓↔≥≤×÷±≈≠∞−"


def parse_range(spec):
    out = set()
    for part in spec.split(","):
        part = part.strip().upper().replace("U+", "")
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            out.update(range(int(a, 16), int(b, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


def chars_in(paths):
    chars = set()
    for f in paths:
        with open(f, encoding="utf-8") as fh:
            text = fh.read()
        if f.endswith(".json"):
            try:
                text = json.dumps(json.loads(text), ensure_ascii=False)
            except ValueError:
                pass
        chars.update(text)
    return {c for c in chars if not c.isspace() or c == " "}


def collect(site):
    core = chars_in(glob.glob(os.path.join(site, "*.html")) + glob.glob(os.path.join(site, "assets/js/*.js"))
                    + glob.glob(os.path.join(site, "assets/css/*.css")) + [os.path.join(site, "data/summary.json"),
                    os.path.join(site, "data/concepts.json"), os.path.join(site, "data/persons.json")])
    core |= set(ASCII) | set(PUNCT)
    rest = chars_in(glob.glob(os.path.join(site, "data/**/*.json"), recursive=True)) - core
    return core, rest


def rename(font, weight):
    style = "Bold" if weight == 700 else "Regular"
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID == 2:
            rec.string = style
        elif rec.nameID == 4:
            rec.string = FAMILY + " " + style
        elif rec.nameID == 6:
            rec.string = "LZSerifSC-" + style
        elif rec.nameID == 3:
            rec.string = "LZ;" + rec.toUnicode()
    font["OS/2"].usWeightClass = weight


def subset_font(font, codepoints):
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.hinting = False
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.recalc_average_width = True
    opts.drop_tables += ["vhea", "vmtx", "BASE", "STAT", "gasp", "prep", "fpgm", "cvt "]
    s = subset.Subsetter(opts)
    s.populate(unicodes=codepoints)
    s.subset(font)
    return font


def build_weight(slices, weight, chunks, out_dir):
    """chunks: {name: set(codepoints)} → writes one woff2 per chunk, returns css rules."""
    rules = []
    for chunk_name, cps in chunks.items():
        pieces = []
        tmpdir = tempfile.mkdtemp(prefix="lzfont_")
        for s in slices:
            wanted = sorted(cps & parse_range(s["range"]))
            if not wanted:
                continue
            src = os.path.join(s["dir"], f"{s['weight']}-{s['idx']}.woff2")
            font = TTFont(src)
            font.flavor = None
            if "fvar" in font:
                font = instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True, updateFontNames=False)
            subset_font(font, wanted)
            if font["maxp"].numGlyphs <= 1:
                font.close()
                continue
            p = os.path.join(tmpdir, f"{s['idx']}.ttf")
            font.save(p)
            font.close()
            pieces.append(p)
        if not pieces:
            continue
        merged = Merger().merge(pieces) if len(pieces) > 1 else TTFont(pieces[0])
        rename(merged, weight)
        merged.flavor = "woff2"
        out_name = f"lz-serif-sc-{chunk_name}-{weight}.woff2"
        merged.save(os.path.join(out_dir, out_name))
        covered = sorted({cp for cp in cps if cp in merged.getBestCmap()})
        merged.close()
        size = os.path.getsize(os.path.join(out_dir, out_name))
        print(f"[build_fonts] {out_name}: {len(covered)} glyphs, {size / 1024:.0f} KB", file=sys.stderr)
        rules.append("@font-face{font-family:'%s';font-style:normal;font-weight:%d;font-display:swap;src:url(%s) format('woff2');unicode-range:%s}"
                     % (FAMILY, weight, out_name, ",".join(compress_ranges(covered))))
    return rules


def compress_ranges(cps):
    out, start, prev = [], None, None
    for cp in cps:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            out.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
            start = prev = cp
    if start is not None:
        out.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slices", required=True)
    ap.add_argument("--site", default=os.path.join(ROOT, "docs"))
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "assets", "fonts"))
    args = ap.parse_args()
    slices = [dict(s, dir=args.slices) for s in json.load(open(os.path.join(args.slices, "slices.json"), encoding="utf-8")) if s["weight"] == "400"]
    core, rest = collect(args.site)
    print(f"[build_fonts] core {len(core)} chars, rest {len(rest)} chars", file=sys.stderr)
    os.makedirs(args.out, exist_ok=True)
    for old in glob.glob(os.path.join(args.out, "*.woff2")):
        os.remove(old)
    chunks = {"core": {ord(c) for c in core}, "rest": {ord(c) for c in rest}}
    css = [f"/* {FAMILY}: subset of Noto Serif SC (SIL OFL 1.1, see OFL.txt) generated by scripts/build_fonts.py */"]
    for w in WEIGHTS:
        css += build_weight(slices, w, chunks, args.out)
    with open(os.path.join(args.out, "fonts.css"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(css) + "\n")
    total = sum(os.path.getsize(f) for f in glob.glob(os.path.join(args.out, "*.woff2")))
    print(f"[build_fonts] total {total / 1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
