#!/usr/bin/env python3
"""
Rebuild assets/fonts/PretendardVariable.subset.woff2.

The site ships one self-hosted font rather than pulling one from a CDN. That
is not only a privacy or offline nicety: the whole reason for adopting
Pretendard was that the old stack (-apple-system / Segoe UI / Apple SD Gothic
Neo / Noto Sans KR) resolves to a *different* Korean face on every platform,
each with its own advance widths. The wall draws card titles into a canvas and
wraps them by measuring, so different widths meant a different number of lines
on different machines. A font fetched at runtime from a third party would put
that determinism back at the mercy of the network.

What goes in the subset
-----------------------
Pretendard covers Latin and all 11 172 modern Hangul syllables but *no* CJK
ideographs, so Chinese still falls through to the system stack — see the
--font-ui declaration in styles.css.

Shipping all 11 172 syllables costs 1.7 MB. Shipping only the 758 the site
currently uses costs 187 KB but breaks the moment anyone writes a new Korean
word. The middle is KS X 1001: the 2 350 syllables of the national standard,
which covers ordinary Korean prose, costs 453 KB, and already contains every
syllable in the three dictionaries. tests/fonts.test.mjs fails if that ever
stops being true, and names the characters that fell outside.

Usage
-----
    pip install fonttools brotli
    python3 tools/build-font.py

Needs network access to fetch the upstream font. It is a rare, manual step —
`npm test` never runs it.
"""

import glob
import io
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

VERSION = "v1.3.9"
UPSTREAM = (
    f"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@{VERSION}"
    "/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"
)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts", "PretendardVariable.subset.woff2")
COVERAGE = os.path.join(ROOT, "assets", "fonts", "coverage.json")

# Where the site's own text lives. Everything here is scanned, so the symbols
# that end up in the subset are the ones the pages actually use rather than a
# list somebody has to remember to update.
TEXT_GLOBS = (
    "i18n/*.js",
    "*.html",
    "experiments/*.html",
    "experiments/*.js",
    "assets/**/*.js",
)


def ks_x_1001_syllables():
    """The 2 350 precomposed syllables of KS X 1001.

    Python's euc_kr codec is really CP949, which encodes all 11 172 syllables,
    so the standard's own set has to be picked out by lead byte: the hangul
    block sits in rows 0xB0-0xC8.
    """
    out = set()
    for cp in range(0xAC00, 0xD7A4):
        try:
            b = chr(cp).encode("euc_kr")
        except UnicodeEncodeError:
            continue
        if len(b) == 2 and 0xB0 <= b[0] <= 0xC8:
            out.add(cp)
    return out


def site_characters():
    """Every character that appears anywhere in the site's text."""
    chars = set()
    for pattern in TEXT_GLOBS:
        for f in glob.glob(os.path.join(ROOT, pattern), recursive=True):
            with io.open(f, encoding="utf-8") as fh:
                chars |= set(fh.read())
    return {ord(c) for c in chars if ord(c) > 0x1F}


def main():
    ks = ks_x_1001_syllables()
    used = site_characters()

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "PretendardVariable.woff2")
        print(f"fetching {UPSTREAM}")
        with urllib.request.urlopen(UPSTREAM) as r, open(src, "wb") as f:
            f.write(r.read())
        print(f"  upstream: {os.path.getsize(src) / 1024:.1f} KB")

        from fontTools.ttLib import TTFont
        have = set(TTFont(src).getBestCmap().keys())

        # Asking for a codepoint the upstream font lacks is a silent no-op, so
        # split the site's characters into the ones Pretendard can supply and
        # the ones that will always fall through to a system face. The second
        # list is written out beside the font, and tests/fonts.test.mjs holds
        # the site to it — a *new* uncovered character is then a test failure
        # rather than a glyph that quietly changes shape.
        supported = used & have
        unsupported = sorted(used - have)

        cps = set()
        cps |= set(range(0x20, 0x7F)) & have          # ASCII
        cps |= set(range(0xA0, 0x100)) & have         # Latin-1 supplement
        cps |= set(range(0x3131, 0x3164)) & have      # compatibility jamo
        cps |= ks & have                              # KS X 1001 hangul
        cps |= supported                              # whatever else is used

        print(f"KS X 1001 syllables : {len(ks)}")
        print(f"site characters     : {len(used)}  "
              f"({len(supported)} in Pretendard, {len(unsupported)} not)")
        print(f"codepoints requested: {len(cps)}")

        spec = os.path.join(tmp, "unicodes.txt")
        io.open(spec, "w").write(",".join(f"U+{c:04X}" for c in sorted(cps)))

        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        subprocess.run(
            [
                sys.executable, "-m", "fontTools.subset", src,
                f"--unicodes-file={spec}",
                "--flavor=woff2",
                "--layout-features=*",
                "--no-hinting",
                f"--output-file={OUT}",
            ],
            check=True,
        )

        # Only record the ones a reader could actually meet on a page: CJK is
        # a whole script Pretendard does not carry and is noted in the CSS, so
        # listing all 1 000-odd ideographs here would bury the interesting few.
        notable = [c for c in unsupported if not (0x4E00 <= c <= 0x9FFF)]
        io.open(COVERAGE, "w", encoding="utf-8").write(json.dumps({
            "_comment": (
                "Generated by tools/build-font.py. Characters found in the site's "
                "source text that Pretendard has no glyph for, so they fall "
                "through to the system font stack. The scan covers whole files, "
                "so a few of these may only ever appear in code comments. CJK "
                "ideographs are excluded: Pretendard carries none at all, which "
                "the font-stack comments already say."
            ),
            "pretendard": VERSION,
            "unsupported": [f"U+{c:04X}" for c in notable],
            "unsupportedChars": "".join(chr(c) for c in notable),
        }, ensure_ascii=False, indent=2) + "\n")
        print(f"  coverage: {len(notable)} non-CJK characters fall back "
              f"->  {COVERAGE}")

    print(f"  subset  : {os.path.getsize(OUT) / 1024:.1f} KB  ->  {OUT}")


if __name__ == "__main__":
    main()
