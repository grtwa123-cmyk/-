#!/usr/bin/env python3
"""
Cut the three dictionaries into one chunk per page.

Every page used to fetch every string the site owns: 1333 keys, 98.6 KB raw
and 34.7 KB gzipped, on a page that displays between 29 and 102 of them. That
was the largest single item in a first visit once the font was split.

So each page now gets its own chunk, and the chunks are cut here rather than
at runtime. A page's keys come from its own source — the data-i18n attributes
in its markup and the dictionary keys named as string literals in the scripts
it loads — plus the handful shared by the chrome.

Read from source, not from watching a page run
----------------------------------------------
Watching was tried first and is not safe. Loading all 40 pages and switching
languages on each sees only 1109 of the 1333 keys: the other 224 are the ones
a reader has to earn. dopplerRegimeSupersonic needs the source pushed past
Mach 1, waveResumeBtn needs the run paused, webglUnavailable needs a machine
without WebGL. A chunk cut from what a page happens to show on load would omit
every one of them, and the page would print a raw key name the moment someone
touched the right control.

Reading the source over-approximates instead, which is the safe direction: a
key mentioned in a file that never reaches the screen costs a few bytes, while
a key that reaches the screen and is missing is a visible defect.

Some keys are assembled at runtime and so appear in no file as a literal.
Those are added by rule, and the rules are listed rather than guessed at —
each came from searching the source for concatenation into a lookup:

  <name>Title -> <name>Desc     the catalogue derives one from the other
  method<X>   -> method<X>Why   the badge's tooltip
  theme*                        assets/theme.js builds "theme" + the mode
  series_*                      spectra.js builds "series_" + the series

Writing that list out by hand is a thing that can rot, which is what the
fallback below is for. A first pass without the last two shipped chunks
missing themeAuto on all 40 pages and series_lyman on spectra; the check that
found them is the one described next, and it is what will find the next one.

And a miss is not fatal in any case: i18n.js falls back to fetching the whole
dictionary, so a chunk this script gets wrong self-heals at the cost of one
request. tests/i18n.test.mjs asserts that net never fires on any page, so a
wrong manifest is a test failure rather than a silent tax.

Usage
-----
    python3 tools/split-i18n.py

No network. Rerun it after adding a key, a page, or a script — `npm test`
fails if the chunks on disk disagree with what this would write.
"""

import io
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node") or "/opt/node22/bin/node"
LANGS = ("en", "ko", "zh")
OUT_DIR = os.path.join(ROOT, "i18n", "pages")

# Scripts every page pulls in, whose keys therefore belong in every chunk.
# Listed rather than discovered so that a page which stops loading one does not
# silently lose strings the chrome still draws.
SHARED_SCRIPTS = (
    "i18n.js",
    "assets/theme.js",
    "assets/sfx.js",
    "assets/reset-defaults.js",
    "assets/url-state.js",
)

# Keys assembled at runtime rather than written down. Each entry names the
# script that builds them and the prefix it builds under: a page that loads
# that script gets every dictionary key with the prefix. experiments/solar.js
# concatenates 'added' + n in the same shape, but those are planet ids and no
# dictionary key begins with it, so it is not here.
DYNAMIC_PREFIXES = (
    ("assets/theme.js", "theme"),
    ("experiments/spectra.js", "series_"),
)

STRING_RE = re.compile(r"""["'`]([A-Za-z][A-Za-z0-9_]{2,})["'`]""")
ATTR_RE = re.compile(r"""data-i18n(?:-[a-z]+)?\s*=\s*["']([^"']+)["']""")
SRC_RE = re.compile(r"""<script[^>]+src\s*=\s*["']([^"']+)["']""")
IMPORT_RE = re.compile(r"""\bimport\s(?:[^;'"]*?\sfrom\s)?["']([^"']+)["']""")


def load_dict(lang):
    """
    The dictionary as a plain dict.

    Run through node rather than parsed here. The values are JS string
    literals — escapes, quotes inside quotes, the odd concatenation — and a
    regex that turns them into JSON gets one of them wrong sooner or later.
    The file's own runtime is the only thing that reads them correctly.
    """
    src = os.path.join(ROOT, "i18n", f"{lang}.js")
    prog = (
        "globalThis.window = globalThis;"
        "window.i18nRegister = (l, d) => process.stdout.write(JSON.stringify(d));"
        f"require({json.dumps(src)});"
    )
    out = subprocess.run([NODE, "-e", prog], capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout:
        sys.exit(f"could not read i18n/{lang}.js through node: {out.stderr.strip()}")
    return json.loads(out.stdout)


def pages():
    """Every HTML page on the site, as (chunk name, path relative to root)."""
    out = []
    for f in sorted(os.listdir(ROOT)):
        if f.endswith(".html"):
            out.append((f[:-5], f))
    exp = os.path.join(ROOT, "experiments")
    for f in sorted(os.listdir(exp)):
        if f.endswith(".html"):
            out.append((f[:-5], f"experiments/{f}"))
    return out


def scripts_of(rel):
    """
    Every same-origin script a page ends up running, relative to the root.

    The <script src> tags are only the entry points. The landing page loads one
    module which imports five more, and the table view is one of those — the
    first version of this stopped at the tags and cut index.html's chunk
    without a single string the plain view draws. So module imports are
    followed transitively from each entry.
    """
    seen, out = set(), []
    src = io.open(os.path.join(ROOT, rel), encoding="utf-8").read()
    here = os.path.dirname(rel)
    queue = [os.path.normpath(os.path.join(here, s)) for s in SRC_RE.findall(src)
             if not s.startswith(("http:", "https:", "//"))]
    while queue:
        cur = queue.pop()
        if cur in seen:
            continue
        seen.add(cur)
        out.append(cur)
        path = os.path.join(ROOT, cur)
        if not os.path.exists(path):
            continue
        text = io.open(path, encoding="utf-8").read()
        for spec in IMPORT_RE.findall(text):
            if spec.startswith(("http:", "https:", "//")):
                continue
            queue.append(os.path.normpath(os.path.join(os.path.dirname(cur), spec)))
    return out


def literals(paths):
    """Every identifier-shaped string literal in these files."""
    found = set()
    for rel in paths:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        text = io.open(p, encoding="utf-8").read()
        found |= set(STRING_RE.findall(text))
        found |= set(ATTR_RE.findall(text))
    return found


def dynamic_for(paths, all_keys):
    """Keys whose prefix is built at runtime by one of these scripts."""
    out = set()
    for script, prefix in DYNAMIC_PREFIXES:
        if script in paths:
            out |= {k for k in all_keys if k.startswith(prefix)}
    return out


def close_over(keys, all_keys):
    """Add the two key families that are built rather than written down."""
    out = set(keys)
    for k in list(keys):
        if k.endswith("Title"):
            d = k[: -len("Title")] + "Desc"
            if d in all_keys:
                out.add(d)
        if k.startswith("method") and (k + "Why") in all_keys:
            out.add(k + "Why")
    return out


def main():
    dicts = {lang: load_dict(lang) for lang in LANGS}
    en = dicts["en"]
    all_keys = set(en)
    for lang in LANGS:
        if set(dicts[lang]) != all_keys:
            sys.exit(f"i18n/{lang}.js has a different key set from en — "
                     "run the i18n tests, not this")

    shared = close_over(literals(SHARED_SCRIPTS) & all_keys, all_keys)
    shared |= dynamic_for(SHARED_SCRIPTS, all_keys)

    os.makedirs(OUT_DIR, exist_ok=True)
    for lang in LANGS:
        os.makedirs(os.path.join(OUT_DIR, lang), exist_ok=True)

    manifest, total = {}, {lang: 0 for lang in LANGS}
    for name, rel in pages():
        own = scripts_of(rel)
        # 404.html and offline.html carry no translated text and never load the
        # runtime, so a chunk for them would be three files nothing fetches.
        if not any(s.endswith("i18n.js") for s in own):
            continue
        keys = literals([rel] + own) & all_keys
        keys = close_over(keys, all_keys) | dynamic_for(own, all_keys) | shared
        manifest[name] = sorted(keys)
        for lang in LANGS:
            obj = {k: dicts[lang][k] for k in sorted(keys)}
            body = json.dumps(obj, ensure_ascii=False, indent=2)
            out = os.path.join(OUT_DIR, lang, f"{name}.js")
            io.open(out, "w", encoding="utf-8").write(
                f'window.i18nRegister("{lang}", {body});\n')
            total[lang] += os.path.getsize(out)

    io.open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8").write(
        json.dumps({
            "_comment": (
                "Generated by tools/split-i18n.py. Which dictionary keys each "
                "page's chunk carries. tests/i18n.test.mjs regenerates this "
                "logic and fails if the chunks on disk have drifted."
            ),
            "shared": sorted(shared),
            "pages": manifest,
        }, ensure_ascii=False, indent=2) + "\n")

    n = len(manifest)
    sizes = sorted(len(v) for v in manifest.values())
    full = os.path.getsize(os.path.join(ROOT, "i18n", "en.js"))
    print(f"{len(all_keys)} keys, {n} pages, {len(shared)} shared")
    print(f"  keys per page: {sizes[0]} min, {sizes[len(sizes)//2]} median, {sizes[-1]} max")
    for lang in LANGS:
        print(f"  {lang}: {total[lang]/1024:.1f} KB across {n} chunks "
              f"(avg {total[lang]/n/1024:.1f} KB, was {full/1024:.1f} KB every page)")


if __name__ == "__main__":
    main()
