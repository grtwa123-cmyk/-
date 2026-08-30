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

**A dictionary value is text, not markup.** `i18n.js` paints with
`el.textContent = val`, so `&mdash;` in a string reaches the reader as those
seven characters. Two pages shipped that way — the chemotaxis and coalescent
titles, in all three languages — and nothing noticed, because the key
resolves, parity passes and the switch works. `tests/lint.mjs` refuses an
HTML entity in any dictionary or chunk. The two `ssDiameter` keys are the
exception that proves it: they carry `<b>` on purpose and are painted with
`innerHTML`, never through `data-i18n`.

**Anything hand-maintained beside the catalogue drifts, so hold it to the
catalogue in a test.** Three copies were found stale or unchecked in one pass:
a 42-URL `VERIFIED` set in `table-view.js`, the hub cards and screen-reader
nav, and the `<noscript>` list on the landing page, which was missing the five
newest experiments. Counts are not enough — the hubs had the right *number* of
cards while nothing checked they were the right ones. Add the copy to
`smoke.mjs` in both directions the same day you add the copy.

## 3b. What is already the way it should be

Written down so a later pass does not spend a day rediscovering it, or worse,
"improves" it.

- **Model and UI are already separable.** All 41 experiment scripts expose a
  `window.__x` hook, and all 56 suites drive the model through it rather than
  through the page. Splitting each file into model/renderer/ui would make 82
  new files, a script-ordering problem, and no testability that is not
  already there.
- **The stylesheet is essentially tokenised.** 1464 lines, four `!important`
  — all inside `prefers-reduced-motion`, which is what that is for — and two
  z-index values. Splitting it into nine files under a no-build site costs
  eight requests and buys nothing at this size. "Zero hex outside the token
  blocks" was claimed here once and was wrong: there are sixteen. Five are
  legend dots deliberately mirroring the fixed canvas colours they explain,
  three are gradients, and the remaining eight are foreground colours on
  coloured chrome — `#0b1024` four times, `#fff` twice — which are the only
  ones that should become tokens. Count before writing "zero".
- **i18n key parity is enforced both ways** across all three dictionaries,
  1574 keys, in `tests/smoke.mjs`.
- **Every canvas is labelled** (44 of 44), no page allocates inside `resize`,
  and `AudioContext` is gated behind a gesture with a check to prove it.

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

**A new page can put a character outside the font subset.** The site self-hosts
a Pretendard subset built from the text it actually contains, so writing `ℓ`
or `∮` for the first time makes `fonts.test.mjs` fail with the character
named. The fix is `python3 tools/build-font.py` (needs `fonttools` and
`brotli`, and network access to jsdelivr) — it is a manual step `npm test`
never runs. Korean is usually safe: the Hangul half carries all 2 350 KS X
1001 syllables. It is the mathematics that catches you out. Run the `fonts`
suite before shipping any page with new prose in it.

**Size every bound against measured scatter, not against a round number.** A
stochastic check has a standard error, and the bound has to be several of
them clear of it or the suite is a coin toss. Measure the scatter — repeat
the same measurement five or six times and take the spread — before writing
the number down. On `chemotaxis` a flatness bound of |W/ℓ| < 0.15 turned out
to be *one* sigma: a histogram is worth n·T/(W²/D) independent looks, not
n·T/Δt, because a cell tells you nothing new about where it is until it has
had time to cross the dish. Three passes went green and then it flagged a
defect that only changed a readout's text.

**The defect worth planting is the formula in place of the measurement.** A
page that quietly reports its own prediction passes every tolerance a
stochastic check can afford — on `coalescent`, substituting 2N(1 − 1/n) for
the walk's answer went through all thirty-four checks, because the textbook
value is within 1.7% of the truth and nothing was allowed to be tighter than
3%. No tolerance catches this. Two questions do: is the reported mean the
mean of the very samples the page kept, and do two runs of the same size
disagree? Measurements differ from each other; formulas do not.

**A flake that will not reproduce locally is usually a race, and load is how
you make it show.** CI runners are slow two-core machines; this container is
not. Run the suite four-up on four cores —
`for r in 1 2 3 4 5 6; do for j in 1 2 3 4; do (node tests/run.mjs <suite> | grep ^FAIL) & done; wait; done | sort | uniq -c`
— and timing races surface immediately. Twenty-two idle runs of `expression`
were clean; the first twenty-four under contention produced two failures, one
of them a pattern repeated in 111 places across 38 suites.

**Never wait a fixed number of milliseconds for something the page signals.**
The 111 sites above were sleeping 300–600 ms after clicking a language button.
`i18n.js` fetches the page's chunk and only then paints, and painting is what
sets `<html lang>` — so the attribute is the completion signal and the sleep
was a guess. `tests/lib/harness.mjs` now exports `lang(page, code)`, which
waits for it. Look for the same shape wherever a test sleeps after an action:
if the page changes something observable when it is done, wait for that.

**Hunt flakes locally in bulk, not one CI round-trip at a time.** A suite
that fails CI on a page nothing touched has a flaky check in it, and the way
to find it is `for i in $(seq 1 30); do node tests/run.mjs <suite> | grep
^FAIL; done | sort | uniq -c`. Thirty runs of a twelve-second suite is six
minutes and it enumerates *every* flaky check at once with its rate attached;
chasing them through CI is twenty minutes each and finds one. `diffusion` had
three, all found this way, and all three were bounds sitting between one and
two sigma of their own noise.

**Two mechanisms enforcing one rule will hide a bug in each other.** The same
page had a fresh-tally guard in two places, so a defect planted in either one
walked past both and neither was ever exercised. When a planted defect is not
caught, check whether the code has a second path doing the same job before
adding a check — usually the right fix is to delete one of them.

**That is the cheap way to find a flaky check: plant a defect that cannot
possibly matter.** Rewire one panel readout to display the wrong quantity and
run the suite. Exactly one check should fail. Anything else that fails is
flaking, and it flakes at whatever rate it just demonstrated.

**When the scatter is too wide, buy more data — do not widen the bound.** The
fix is nearly always more replicates, a longer window, or a parameter choice
that decorrelates the samples faster. On `chemotaxis` the tumble-rate fit
scattered 1.4% against a 4% bound at 24 replicates; at 48 it scatters 0.76%,
and the bound was **tightened** to 3%.

**A bound is sized from the scatter of the statistic the check computes, over
at least thirty trials.** Two chemotaxis bounds went red in consecutive CI
runs and both had the same cause: the sizing runs were too short, and the
number written down was the mean of |error| rather than its sigma. For a
zero-mean scatter those differ by 0.8, which turns four sigma into 2.7. And
if the check takes the WORST of n settings, size the max of n — not one
setting: four folded normals at 2.2 sigma each clear their bound once in
forty runs, which is a red CI every other day.

**A number divided by "however long you have been watching" is not a constant.**
`phases` reported D as ⟨r²⟩/4t from a single reference — which is exactly what
the label ⟨r²⟩ = 4Dt says, and is right wherever that law is right. In a solid
it is not: the walk is caged, ⟨r²⟩ plateaus, and the readout became the plateau
divided by the age of the page — 1.4e-2 at half a time unit, 1.8e-4 at a
hundred. Two readers of the same crystal got different numbers. Wherever a
quantity is a ratio to elapsed time, ask what it does as the elapsed time
grows; if the answer is "shrinks forever", it is a chord and the thing wanted
is a slope over a trailing window.

**Where a magnitude bound cannot separate two estimators, the sign often can.**
Both the chord and the slope read ~1e-4 for a solid against a liquid's 4e-2,
so "much smaller than a liquid" passes either way. But a plateau divided by t
is positive every single time, and a slope through a plateau is as often below
zero as above: 0 of 16 crystals against 8 of 16. Under "the true value is
zero" the count below zero is Binomial(n, ½), which needs no tolerance to be
chosen and no scatter to be measured.

**A readout whose band is narrower than its own noise is a defect in the
readout.** equilibrium called the mixture "at equilibrium" when Q was within
10% of K, and Q — a ratio of three small integer counts — scatters by 17.5%
of K at equilibrium. The label flickered between three contradictory
statements several times a second, and the check that asked once had been
landing right. Before widening a bound in a test that reads a *label*, ask
whether the label's own threshold is inside the noise; if it is, the fix is
on the page.

**An exception granted to a check must be held to its reason.** blackhole
renders at 0.8 of the device ratio on purpose — every pixel is a ray-marched
geodesic — so the 2× sweep has to let it through. Putting it on an allowed
list would let a genuinely lost devicePixelRatio hide behind the same number
forever, so the check asserts the reason instead: Medium is dpr × 0.8, High
is the full dpr, Ultra exceeds High. An exception you cannot state as a
positive claim is a hole.

**There is no property of a number that says whether it is a count.** Twice
the Reset sweep tried to infer which readouts are tallies — "opens empty and
fills" lets in a fit, "climbs" lets in an r², "opens at a literal 0" lets in
a hopeless fit printing 0.000 — and twice chemotaxis found the hole. Name
them. Five pages carry a real count, the elements are listed, and a second
check requires each to have been climbing before the Reset so that a page
which stops carrying one is named rather than dropping out of the coverage.

**This container's browser cannot reach a CDN and CI's can.** Any sweep that
walks every page therefore covers 40 here and 42 there, and the two missing
are blackhole and solarsystem — the heaviest and least ordinary renderers on
the site. `serveCdn(ctx)` from the harness closes it. If a whole-catalogue
check passes here three times and fails on CI naming a 3D page, this is why.

**A sigma is not enough — look at the shape of the tail.** `epidemic` held R₀
to 6% on four replicates whose per-run scatter is 2.6%, which reads like four
sigma and is not. 25,000 runs at R₀ = 1.5 put 116 of them under half the
population, a left tail about ten times fatter than a Gaussian, and one of
those in a batch of four moves the average by 3%. When a check sits near a
threshold, a critical point, or anywhere the answer is steep in what is being
measured, sample the distribution before trusting its standard deviation.

**A filter is a claim, so check what it threw away.** The same sweep kept runs
that reached 2% of the population, while a note in the same file had already
measured that a *subcritical* chain reaches 3.8% — so dead runs were being
averaged in as epidemics. Every `if (…) keep` in a test is an assertion about
the mechanism and should be written as one: the sweep now fails unless nine
of every ten runs took off.

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
