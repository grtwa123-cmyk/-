# Working on Science Lab

Notes for anyone — human or agent — picking this repository up. Everything
here was learned by getting it wrong first; each entry says what the rule is
and what happened without it, because a rule with no scar attached tends to
get optimised away.

---

## 1. The one principle

**The physics has to emerge from the mechanism. It is never asserted.**

A page may run particles, integrate an equation, or step a rate law. What it
must not do is compute the textbook answer and print it. The test for whether
a page obeys this is simple: *if you deleted the closed form from the file,
would the page still produce the right number?*

Three things follow, and they are not negotiable:

- **Every check must be proven capable of failing.** Plant a deliberate
  defect, watch the check go red, then take the defect out. A check nobody
  has seen fail is a decoration. The galvanic cell's suite passed 28/28 with
  the Nernst equation typed in place of the kinetics — until a Tafel check
  and a source check were added that could tell the difference.
- **Claims the data does not support are withdrawn, not loosened.** The
  phases page lost a solid-phase claim; the solar system lost its
  "Integrated" badge; a diode check about back-and-forth traffic was deleted
  because counting the crossings showed there is no such traffic to average.
  Deleting a check is a legitimate result. Widening it to pass is not.
- **When a measurement is noisy, improve the measurement.** `gas` failed
  P ∝ N at 2.9σ. The fix was forty averaging windows instead of eighteen
  (0.995 ± 0.052 → 1.006 ± 0.039), not a wider bound.

**Verify numerically in node against the closed form *before* building the
page.** Every simulation here was checked in a throwaway script first. The
galvanic cell's Butler–Volmer reproduces Nernst to 1e-16 V; that was known
before a line of HTML existed.

---

## 2. Method badges

Each experiment carries exactly one, and the words mean what they say:

| badge | means |
|---|---|
| `measured` | The mechanism runs and the textbook result is read back out of it. Nothing on the page types the answer in. |
| `model` ("Real data") | A three-dimensional structure built from measured constants — geometry rather than simulation. |
| `integrated` | The equations of motion are stepped forward in time. What you see is where they go. |
| `illustrated` ("Illustration") | An animation of the idea. There is no quantitative model behind it. |
| `verified` | An automated suite holds this page's physics against its closed form on every commit. |

`verified` is an invariant, not a label: it is true iff
`tests/experiments/<name>.test.mjs` exists, the page carries a
`.method-verified` span, **and** the URL is in the `VERIFIED` set in
`assets/index/table-view.js`. `tests/method-badges.test.mjs` enforces all
three, and also that the page's badge matches the `method` field of its row
in `assets/index/experiments.js` — change one and it will tell you about the
other.

`illustrated` does not license illustrating the wrong thing. The diode was
badged an illustration and still conducted more freely in reverse than
forward; that was a bug, and the badge was no defence.

---

## 3. House conventions

**No build step.** Vanilla HTML, CSS, Canvas 2D and WebGL. Three.js is loaded
from a CDN, and only by `solarsystem` and `blackhole`.

**Canvas colours are fixed and opaque — never the theme's.** The stages paint
their own dark ground in both themes, so ink taken from `--text`, `--muted`,
`--border` or `--accent` is dark-on-dark for a light-theme reader. This
shipped twice (the galvanic cell, then the orbit page's Kepler plot at
1.16:1 where 4.5:1 is the floor for text). `tests/lint.mjs` refuses the
pattern outright now. Use the dark theme's own values as constants so dark
mode is unchanged. Opaque, not translucent: some checks count pixels at
alpha ≥ 200, and 55% ink is 140.

**Deferred scripts execute at `readyState === "interactive"`, not
`"loading"`.** Parsing is finished and `DOMContentLoaded` has *not* fired.
A guard written as `if (readyState === "loading") wait; else init()` runs
immediately, before the page's own script has touched anything. Wait on
`DOMContentLoaded`.

**Reduced motion.** `assets/reduced-motion.js` gates animation by freezing
the timestamp handed to `requestAnimationFrame`. That stops any loop taking
its `dt` from that timestamp. It does **not** stop:

- a loop that reads `performance.now()` itself — ask
  `window.ReducedMotion.clock()` instead (`electrolysis.js`,
  `refraction.js`, `solarsystem.js` do);
- a loop that steps a fixed count per callback and never reads the clock;
- a CSS animation on a page that does not link `styles.css`;
- **a step of zero duration that still does work.** `kinetics` held its
  particles still and went on counting collisions into its Boltzmann tally,
  and the bars drawn from that tally moved. Guard with `if (dt > 0)`.

Where a bar must be shown on a full-bleed page with no `.stage`, it floats
rather than displacing: prepending it to `body` pushed a viewport-height
canvas down an `overflow:hidden` page and cut the bottom off the scene.

**i18n.** `i18n.js` plus `i18n/{en,ko,zh}.js`, split per page into
`i18n/pages/<lang>/<page>.js` by `tools/split-i18n.py`. All three
dictionaries must have **exact key parity**. The event is `langchange` on
`document` — not `i18n:change` on `window`. Keys built dynamically
(`"series_" + k`) still have to exist; a sweep for that is worth repeating.

**Counts are generated, never typed.** `tools/build-seo.mjs` owns every
sentence that states how many experiments there are — in `index.html`,
`package.json`, `README.md`, the per-category headings, and the social card.
A reworded sentence stops the build rather than going quietly stale. The
social card is the one that had been wrong longest: a number baked into a
JPEG, where no check can read it.

**`index.html`'s screen-reader nav is hand-written.** A new experiment needs
a row there too; `tests/smoke.mjs` will say so.

---

## 4. Tests

`npm test` runs everything: `tests/run.mjs` walks `tests/*.test.mjs`,
`tests/smoke.mjs` and `tests/experiments/*.test.mjs`. Useful flags:

```
node tests/run.mjs --list              # what would run
node tests/run.mjs --shard 2/4         # every 4th suite
node tests/experiments/gas.test.mjs    # one suite, on its own
```

`tests/lib/harness.mjs` gives every suite a server, a browser and
`chk/rows/finish`. It also exports `serveCdn(ctx)`, which fulfils CDN
requests from a disk cache filled by curl — the two 3D pages need it here,
and it means neither suite can be turned red by someone else's outage.

**CI runs four shards on four runners** with `fail-fast: false`, triggered by
`pull_request` (and pushes to `main`) — one run per push, not two. The job
ceiling is 25 minutes and it is a ceiling, not a target: the suite once grew
past it and four commits landed while every run was being killed and
reported as **"cancelled"**, the same word GitHub uses for a superseded run.
If a run says cancelled, check the duration before believing it.

**Known flake, do not chase:** `kinetics` fails about 1.24% of runs by
construction. Four hypotheses were tested and all four killed by
measurement; the bounds cannot be widened without losing the defect they
exist to catch. The whole investigation is in the suite header.

---

## 5. This environment

- **The container filesystem rewinds without warning.** It happened four
  times in one session, twice discarding uncommitted work, once dropping two
  already-merged commits out of the local object database. **The remote is
  the only durable store.** Commit early, push often, and check
  `git log --oneline -1` before trusting the tree.
- **The dev container's headless browser cannot reach CDNs.** `curl` can.
  This was recorded backwards for a long time as "CI cannot reach the CDN",
  which cost two pages their suites; CI reaches it perfectly well. Use
  `serveCdn` rather than concluding a page is untestable.
- **Background `sleep` does not consume wall time between turns.** To wait,
  use `end=$(( $(date +%s) + N )); until [ $(date +%s) -ge $end ]; do :; done`.
- **GitHub REST is blocked.** Use the `mcp__github__*` tools. CI logs are
  reachable: `mcp__github__get_job_logs` without `return_content` gives a
  `results-receiver` URL that `curl` can fetch in full.
- Environment: `NODE_PATH=/opt/node22/lib/node_modules`,
  `CHROMIUM_PATH=/opt/pw-browsers/chromium`,
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

---

## 6. Git

Work lands through pull requests, which are **squash-merged**. After a merge
the branch must be restarted from the new `main` rather than built on:

```
git fetch origin main
git checkout -B <branch> origin/main
git push -u origin <branch> --force-with-lease
```

Bump `version` in `package.json` and `VERSION` in `sw.js` together whenever
anything the site ships changes — the service worker uses it to decide what
to re-fetch. Page-level `version-tag` spans bump with their own page.

Commit messages say what was wrong, what the measurement was, and what was
proven — not just what changed. Do not put a model identifier in anything
that gets pushed.
