# What's next

The catalogue is 41 experiments, every one of them `verified`: 20 physics,
12 chemistry, 9 biology. 55 test suites, 1550-odd checks. The obvious
remaining asymmetry was biology, and that is what this plan is about. Two of
its three items are built; one is left.

Numbers below were checked in node before being written down (see §4).

---

## 1. Biology, 7 → 10

Biology has `dna`, `lotka`, `epidemic`, `expression`, `selection`, `enzyme`
and `neuron`. Between them they cover structure, population dynamics,
stochastic gene expression, allele frequencies, enzyme kinetics and the
action potential. Three things are missing that have hard closed forms and
do not overlap any of the above.

### 1a. Coalescent — where a family tree comes from

Trace a sample of *n* chromosomes backwards until they meet. Kingman's
coalescent says that with *k* lineages left, pairs merge at rate
*k*(*k*−1)/2, so in units of 2*N* generations:

```
E[T_k]      = 2 / (k(k−1))          waiting time with k lineages
E[T_MRCA]   = 2 (1 − 1/n)           height of the whole tree
E[L_total]  = 2 · H(n−1)            total branch length, H = harmonic number
```

The page runs a Wright–Fisher population forwards — every individual picks a
parent at random — and then walks the sample's ancestry back. **None of those
three formulas appear in it.** The tree height and total branch length are
measured off the genealogy the population actually produced.

The payoff is Watterson's estimator: sprinkle mutations on the branches at a
constant rate and the number of segregating sites gives θ̂ = S / H(n−1) back.
A reader can watch a statistic used on real sequence data fall out of a
cartoon population.

Why it earns a page: it is the only one here where the *randomness itself* is
the subject — the same population gives a different tree every time, and the
theory is a statement about the average of those trees. That needs many runs
to see, which is exactly what a simulation is for and a textbook figure is
not.

### 1b. Diffusion across a membrane — Fick, from a random walk ✅ **done**

Particles on both sides of a semipermeable barrier, each taking an unbiased
step. Two closed forms, from one mechanism:

```
⟨x²⟩ = 2Dt                     spreading, with no net drift at all
J    = −D dC/dx                Fick's first law, measured as a flux
```

The second is the one worth showing. Nothing in the walk knows about
concentration — each particle steps left or right with probability ½ — and
yet a net flow appears from high concentration to low, and stops exactly when
the two sides are equal. There is no force; there is only counting.

Contrast with `gas`, which is about pressure and speed distributions, and
with the galvanic cell's concentration cell, which is the same asymmetry
expressed as a voltage.

**Built, and one claim withdrawn on the way.** The page carries four
measured results — ⟨r²⟩ = 4Dt with D = L²/4h, Fick's straight line through
the origin, the heavy two-way traffic whose difference is the flow, and an
exponential close to r² > 0.99. A fifth was planned here and is not in the
page: this section originally said nothing about how the flow should depend
on the size of the hole, but the first draft of the suite assumed
proportionality. Measured, **eight times the opening gives 3.2 times the
flow** — in two dimensions a walker that misses the hole slides along the
wall and tries again, so what limits the traffic is finding the hole rather
than fitting through it. The sub-linearity is what the page teaches instead.

Two of my own measurements were wrong and were fixed rather than
accommodated: ⟨r²⟩ = 4Dt came back 22% low at the longest step because the
cloud reached the walls inside the window, and the exponential fit was
judged on a single run whose ΔN carries a noise of order √N.

### 1c. Chemotaxis — run and tumble ✅ **done**

A bacterium swims straight, then tumbles to a new random direction. Runs are
exponentially distributed. With no gradient it goes nowhere on average but
spreads:

```
D_eff = v²τ / 2                 in two dimensions
⟨r²⟩  = 4 D_eff t               once t ≫ τ
```

Then bias it: make the tumble *less* likely when swimming up an attractant
gradient. A drift velocity appears without the cell ever measuring a
direction — it cannot; it is too small to tell its head from its tail. It
only compares now with a moment ago. That is a real and slightly startling
piece of biology and it emerges from one `if`.

**Built, and the caveat above turned out to be the whole design.** Waiting for
the diffusive limit was never going to work: at a tenth of a run the
asymptote 4Dt is *twenty times* the truth, and the dish is far too small to
run to where it stops mattering. The page fits the crossover instead,

```
⟨r²⟩ = 2v²τ²(t/τ − 1 + e^(−t/τ))
```

which is right at every t, and shows both of its limits as the dashed lines
they are. Measured, it tracks that to 5% over 2400× in t.

Two further results came out of building it that were not in this plan:

- **ℓ = D/v_d = τW/β contains no swimming speed.** A cell that swims three
  times faster drifts nine times faster — it perceives the ramp three times
  more steeply as well — and it spreads nine times faster. The ratio does not
  move: 214, 217, 216 px at v = 40, 80, 120. Nothing about the design
  anticipated that; it fell out of the algebra once k = βv/W was written down,
  and it is now a check.
- **The measurement, not the model, was the hard part.** The dish is
  716 × 244 and a cell crosses it in seconds, so ⟨r²⟩ measured between the
  walls saturates and reads 72% low by t = 100τ. Every cell therefore carries
  an unfolded position: a reflection is a mirror, so a sign flipped at each
  wall keeps the unfolded path running as though the wall were not there.
  That is exact while the tumble rate is blind to direction, which is why the
  spreading law is only claimed with the memory off — and it is why the graph
  does not move when the memory is turned up, since unfolding mirrors the
  attractant ramp along with the dish.

Four checks were re-cut during the build rather than accommodated. The
ballistic check spanned t/τ = 0.33, where the ballistic limit is genuinely
10% high — restricted to t/τ ≤ 0.1 and *tightened* to 4%. The flatness check
|W/ℓ| < 0.15 was a one-sigma bound that passed three runs and then flagged a
display-only defect: the histogram is worth n·T/(W²/D) independent looks, so
the swimmers now run at the top of the slider where a look costs 87 s instead
of 475, two dishes are pooled, and it is five sigma. The k fit at 24
replicates scattered 1.4% against a 4% bound, so it was paid up to 48
replicates and the bound *tightened* to 3%. The saturation ceiling was
checked on 1200 walks where (x₁−x₀)² has a coefficient of variation of 1.06;
it is now 9600.

Seventeen deliberate defects were planted and all seventeen were caught. The
one that matters most is a cell given a 2% preference for swimming right,
with no memory involved at all — the page's whole claim is that no such
preference exists anywhere in it, and the check that catches it is the tumble
rate being flat in cos θ to |k| < 0.01.

**Order:** 1b first (simplest mechanism, two clean laws) — **done**; then 1c
(reuses the walker machinery) — **done**; then 1a (most work, most novel).

---

## 2. Each page ships with

Non-negotiable, per `CLAUDE.md`:

- closed forms verified in node **before** the page exists;
- a suite that measures them off the running page;
- planted defects proving each check can fail;
- en/ko/zh with exact key parity;
- registration in the catalogue, the hub, `index.html`'s screen-reader nav,
  and the `VERIFIED` set;
- counts regenerated by `tools/build-seo.mjs`.

---

## 3. Smaller items

- **`solved` is a category of one.** `circuit` carries it and no other page
  does. Either the badge earns a second page or it should be folded into
  `measured` — a badge with one member is a footnote, not a category.
- **Physics is 20 of 39.** Not a problem to fix by adding, but worth not
  adding to for a while.
- **Repo metadata.** The GitHub description still reads `SE`, and Website and
  Topics are empty. The API path is blocked from this environment, so this
  one needs a human.

---

## 4. Arithmetic, checked

```
coalescent n= 2  T_MRCA 0.9951 vs 1.0000   total length 1.9902 vs 2.0000
coalescent n= 5  T_MRCA 1.6069 vs 1.6000   total length 4.1815 vs 4.1667
coalescent n=10  T_MRCA 1.7985 vs 1.8000   total length 5.6507 vs 5.6579
coalescent n=20  T_MRCA 1.8973 vs 1.9000   total length 7.0884 vs 7.0955
diffusion t= 50  <x²> 49.5 vs 2Dt = 50.0
diffusion t=200  <x²> 201.2 vs 2Dt = 200.0
diffusion t=800  <x²> 781.5 vs 2Dt = 800.0
run-and-tumble   <r²> 1906.6 vs 4·D_eff·t = 2000.0
```

One caveat recorded now rather than discovered later: the run-and-tumble
figure is 5% low because at *t*/τ = 40 the walk has not fully left the
ballistic regime, where ⟨r²⟩ grows as *t*² rather than *t*. The page will
have to run long enough, or the check will have to fit the crossover instead
of assuming the limit. It is not noise and it must not be treated as noise.

**It was the crossover, and the deficit is worse than 5% far longer than
this line suggests.** Measured against `2v²τ²(t/τ − 1 + e^(−t/τ))`:

```
t/τ =   0.1   4Dt is 20.7× the truth
t/τ =   1     4Dt is  2.7×
t/τ =  10     4Dt is  1.11×
t/τ = 100     4Dt is  1.01×
```

Running long enough would have meant a hundred runs, in a dish a cell crosses
in eight. Fitting the crossover costs nothing and is right everywhere.
