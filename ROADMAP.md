# What's next

The catalogue is 39 experiments, every one of them `verified`: 20 physics,
12 chemistry, 7 biology. 53 test suites, 1500-odd checks. The obvious
remaining asymmetry is biology, and that is what this plan is about.

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

### 1c. Chemotaxis — run and tumble

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

**Order:** 1b first (simplest mechanism, two clean laws) — **done**; then 1c
(reuses the walker machinery), then 1a (most work, most novel).

The walker machinery 1c was meant to reuse now exists in
`experiments/diffusion.js`: a fixed sub-step decoupled from the frame rate, a
box with reflecting walls, and a hook that advances simulated seconds
directly. Chemotaxis needs one thing added to it — a direction that persists
between tumbles instead of being redrawn every step.

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
