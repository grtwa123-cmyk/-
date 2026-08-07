# Science Lab

> A browser-based science sandbox — **36 hands-on physics, chemistry, and biology simulations** rendered with **vanilla HTML, CSS, Canvas, and WebGL**. Molecules, crystals, and DNA are real 3D models you can orbit; every simulation has procedural Web Audio sound tied to its own physics. No build step, no runtime dependencies. The UI ships in English, 한국어, and 中文.

<p>
  <a href="https://grtwa123-cmyk.github.io/-/">
    <img alt="Live demo" src="https://img.shields.io/badge/demo-live-2ea44f?style=flat-square" />
  </a>
  <img alt="Experiments" src="https://img.shields.io/badge/experiments-36-8957e5?style=flat-square" />
  <img alt="Dependencies" src="https://img.shields.io/badge/runtime%20deps-0-blue?style=flat-square" />
  <img alt="No build" src="https://img.shields.io/badge/build-none-lightgrey?style=flat-square" />
  <img alt="Languages" src="https://img.shields.io/badge/i18n-EN%20%C2%B7%20KO%20%C2%B7%20ZH-orange?style=flat-square" />
</p>

**Live demo:** https://grtwa123-cmyk.github.io/-/

Every experiment's controls live in its URL, so a setup is a link: move a
slider and the address bar follows, paste that address somewhere and the page
comes back running it. Only the settings you changed are in there, so a link
carries the point and nothing else.

The landing page offers two ways in, remembered between visits. **Wall** is the curved phantom-style index — drag horizontally to scroll infinitely through cards, drag vertically to nudge rows, **press and hold a card to enter**. **Table** is one ordinary table of every experiment, filterable by category: no WebGL, no CDN, no gesture, and it doubles as the fallback if the wall cannot start. Each row carries the same two colours the wall paints that experiment's card with — as a rail down its left edge, a wash under it on hover and a tint on its title — so the two views are recognisably one catalogue. The method badges differ in **shape** as well as hue (`●` measured, `∫` integrated, `≈` solved, `=` closed form, `◆` real data, `○` illustration), because six pills that differ only in colour are six pills a colour-blind reader cannot tell apart.

---

## Table of contents

- [Experiments](#experiments)
- [Running locally](#running-locally)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Browser support](#browser-support)
- [Accessibility & i18n](#accessibility--i18n)
- [Contributing](#contributing)

---

## Experiments

Every experiment says on its own page how its numbers are produced, and the
same badge appears in the table view. The point of most of this site is that
the textbook result is *measured out of a running mechanism* rather than typed
in — which is invisible unless it is said. Saying it honestly also means saying
so where it is **not** true, which is why the last row exists. **Closed form** is
gone from the table as of v1.29.0 — the last page carrying it was `diffraction`,
and it now sums the aperture instead of evaluating the pattern.

| Badge | What it means | Count |
| --- | --- | --- |
| **Measured** | The mechanism runs and the textbook result is read back out of it. Nothing on the page types the answer in. | 20 |
| **Integrated** | The equations of motion are stepped forward in time. What you see is where they go. | 8 |
| **Real data** | A three-dimensional structure built from measured constants — geometry rather than simulation. | 4 |
| **Solved** | The governing equation is solved numerically every frame, rather than pieced together from special cases. | 2 |
| **Illustration** | An animation of the idea. There is no quantitative model behind it. | 2 |

A separate **✓ Verified** mark means a dedicated suite holds that page's physics
against its closed form on every commit — 19 of the 36 so far. It is not stored
anywhere: `tests/method-badges.test.mjs` derives it from what is actually in
`tests/experiments/`, and fails if a page claims it without one. The same suite
requires any page badged **Measured** to expose a `window.__*` hook, because a
page that cannot be interrogated cannot support the claim.

### Physics (20)

| Experiment | Description |
| --- | --- |
| **Projectile Motion** | Newton's second law with quadratic air drag, ẍ = −b\|v\|vₓ and ÿ = −g − b\|v\|v_y, integrated with RK4. Range, apex and flight time are *measured* off the trajectory — the landing point is where y actually crosses zero, found by bisection on the final step. With the drag at zero those measurements reproduce v₀²sin2θ/g to one part in 10¹³, which is the integrator proving itself where the answer is known exactly. Turn it up and the arc goes lopsided: fired at 45° the ball lands at 61°. Nowhere in the file is the number 45 written down — *Find best angle* flies 91 launches and reports the peak, which is 45.00° in vacuum and 39.5° at b = 0.01. |
| **Pendulums** | Three of them. A wave pendulum whose row of slightly different periods drifts in and out of step; Foucault's pendulum, solved in the rotating frame so the plane precesses at Ω·sin φ — 23.93 h at the pole, 31.8 h in Paris, never at the equator; and Newton's cradle, where k balls in gives exactly k out because equal-mass elastic collisions leave no other option. |
| **Wave Interference** | Two point sources add, and that is the whole input. The intensity is averaged over a cycle, scanned down a screen, and the fringes are *located* as peaks in that scan — the ticks are drawn next to the profile they came out of, not where a formula says. So the spacing is a measurement, and it lands on the exact crossing of the hyperbola r₁ − r₂ = qλ to a part in 10⁶, which is what makes Δy = λL/d worth printing beside it. The textbook line is low by exactly √(1 − (λ/d)²) ⁄ √(1 + (d² − λ²)/4L²): obliquity times a near-screen term. Stand the scan ten times further back and the second one fades — 11.8% down to 0.4% at λ/d = 0.075 — while the first will not move, sticking at 6.1% at λ/d = 0.343 however far the screen goes. The envelope tells the two kinds of fringe apart: it tilts the bright ones by a few parts in a thousand and leaves the dark ones, pinned by phase rather than amplitude, ten to seventy times tighter. |
| **Doppler Effect** | A moving source emits circular wavefronts that compress ahead and stretch behind; cross the wave speed and the rings collapse into a Mach cone. |
| **Newton's Cannon** | Fire a cannonball horizontally and find the speed where falling turns into orbiting. |
| **Gravity & Orbits** | Drag on the canvas to place planets around a central star, with collision effects. |
| **Impulse & Force (Egg Drop)** | Drop an egg onto three cushions and compare peak / average force and impulse on a live F–t graph. |
| **Solar System & Black Holes** | Eight planets at real size ratios; summon dynamic black holes that drain the Sun via an accretion stream. |
| **Solar System Tour (3D)** | Cinematic 3D tour: procedural planet surfaces, atmospheric glow, Saturn / Uranus rings, asteroid belt, tap-to-inspect cards. |
| **Black Hole Lensing (WebGL)** | Real-time Schwarzschild ray tracer: GPU integrates photon geodesics per pixel, Doppler-boosted accretion disk. |
| **Semiconductors & Battery** | Compare intrinsic / n-type / p-type silicon under the same battery and flip the polarity. |
| **PN Junction Diode** | Watch the depletion region grow and shrink under forward vs reverse bias. |
| **Refraction & TIR** | Snell's law is never applied. The incoming wavefront sweeps the interface, every point struck starts a Huygens wavelet spreading into the second medium at c/n₂, and the refracted wavefront is *found* — a search for the one straight line those wavelets are all tangent to. θ₂ is what the search returns, so n₁ sin θ₁ = n₂ sin θ₂ is a measurement, exact to 8 parts in 10¹⁶ over 2562 geometries. `arcsin((n₁/n₂)·sin θ₁)` appears nowhere in the file, and a check greps the source to keep it that way. Total internal reflection is that tangent line ceasing to exist: past critical the wavelets outrun the sweep, the search closes on nothing, and the leftover disagreement is exactly (n₁/n₂)sin θ₁ − 1. The critical angle is bisected on that failure. Fermat's least-time path, run independently, picks out the same geometry to one part in 10⁷. |
| **Electromagnetic Generator** | A water wheel spins a bar magnet inside a pickup coil, and no sine is written anywhere on the path from field to voltage — a check slices those functions out of the source and greps them to prove it. What goes in is a bore field pointing along the magnet and fading away from the axis; the flux through a turn is its surface integral over the coil face on a 32×64 polar grid, converging at the second order a midpoint rule should (the error quarters each time the cell halves). The EMF is that flux differenced in time with Faraday's minus sign. Out comes a sinusoid carrying no harmonic above 1 part in 10⁹, rms exactly peak/√2, lagging the flux by 90.000°, its sign never once agreeing with dΦ/dt. The peak is linear in N, B and ω to nine figures — but **A^0.57**, not A: the textbook Φ = N·B·A·cos θ assumes a field that is the same everywhere across the coil, and a wider loop instead reaches into weaker field. The page reports the exponent it measures. The peak on screen is not predicted either; it is the largest EMF the machine actually produced in its last complete turn. |
| **Photoelectric Effect** | Nothing here is handed KEₘₐₓ. Each photon frees one electron, which pays the work function and gives up a random share of the rest on the way out, so the population fills [0, hf − φ] without that ceiling ever being written down — and the current is *counted*, not evaluated. That makes the stopping voltage a measurement: bisect on where the count first reads zero and it lands on hf − φ to five parts in a million. Which is the point, because it is Millikan's experiment. **Measure h** takes stopping voltages at nine wavelengths and fits the line: slope 4.1356×10⁻¹⁵ eV·s against a true 4.1357×10⁻¹⁵, and an intercept that returns the work function to three decimals — from counting electrons. |
| **Double-Slit Interference & Diffraction** | No formula does any of it. Every point of every open slit is a source in phase, and the amplitude toward a direction is the sum of all of them — a sum that separates, because the slits are alike, into one slit interfering with itself times the slits interfering with each other. Neither `sin α/α` nor `sin Nβ/sin β` is in the file and a check greps for both. The fringes are then *located* in that sum, so d·sinθ = mλ is a measurement — and the peak you can see is not quite on it: the envelope leans on each maximum and drags it toward the axis, putting the fourth order at m = 3.90 with two slits. The pull dies as 1/N², down to three parts in a thousand by ten, which is why a grating is a measuring instrument and a double slit is not. Orders go missing where the *measured* envelope is dark, which catches d/a = 3.03 as well as d/a = 3. The N−2 subsidiary maxima between neighbours are counted; N × the measured half-height width settles at 0.886 λL/d. And the far field is an assumption with a price tag: the same aperture summed with true path lengths disagrees by 0.003% at the defaults and by most of the picture at ten slits 400 µm apart, and the page prints the number. |
| **Lenses & Image Formation** | A fan of rays leaves the object and each is bent by the one rule a thin lens has, θ′ = θ − y/f. The image is wherever they cross — and that they cross at all *is* 1/v − 1/u = 1/f falling out of the algebra. Newton's x·x′ = f² agrees independently, and the readout reports how far any traced ray misses the image point by: 1e-14 cm. |
| **Driven Oscillation & Resonance** | The mass is integrated from ẍ + 2ζω₀ẋ + ω₀²x = X₀ω₀²cos ωt with RK4, transient and all, and the amplitude and phase it settles into are then *measured back out* of the motion by Fourier component and compared with the closed form — agreeing to a few parts in 10⁴. Amplitude peaks at √(1−2ζ²), the phase lag is exactly 90° at f₀ for every damping, and past ζ = 1/√2 there is no peak at all. |
| **Standing Waves & Harmonics** | 720 points obeying ∂²y/∂t² = c²∂²y/∂x², with nothing added but two fixed ends. No harmonic is written down: a Fourier transform of the shape finds the frequencies at exact whole-number multiples of c/2L, because those are the only wavelengths that fit. Where you pluck decides which harmonics exist at all — at the midpoint every even one vanishes to one part in 10¹⁶, at a third every third goes, and the surviving amplitudes follow sin(nπp)/n² to 0.01%. Four times the tension is exactly one octave, and additive synthesis from the measured spectrum lets you hear the pluck position change the timbre. |
| **Ohm's Law — Series & Parallel** | Three resistors wired end to end or side by side, solved from the closed forms. Carriers move at the real current in each wire, so a parallel rail visibly slows as every branch taps its share; bodies warm with dissipated power, and both Kirchhoff residuals stay printed at zero. |

### Chemistry (11)

| Experiment | Description |
| --- | --- |
| **Molecule Viewer** | A real 3D ball-and-stick model of H₂O, CH₄, NH₃, C₆H₆, … — orbit it freely, with CPK colours, split-colour bonds, bond orders, and hybridization info. |
| **Crystal Lattice** | SC, BCC, FCC, NaCl, CsCl, and diamond as true 3D unit cells you can turn in any direction, with the cell drawn as real edge geometry and optional 2×2×2 expansion. |
| **Acid–Base Titration** | Drip NaOH into HCl or acetic acid: exact charge-balance pH solver, live pH–V curve, buffer region, equivalence point, phenolphthalein colour change. |
| **Ideal Gas & Kinetic Theory** | Particles in a piston chamber: pressure measured from real wall impacts tracks PV = NkT; drag the piston and ride the isotherm. |
| **Radioactive Decay** | A grid of nuclei decays by pure per-nucleus chance and traces the exact exponential half-life curve N = N₀·2^(−t/T½); live activity and half-life markers. |
| **Electrolysis of Water** | Nothing divides the charge by 2F or 4F. Q = ∫I dt becomes moles of electrons, and then the half-reactions spend them — two at the cathode buy one H₂, four at the anode buy one O₂ — with the molecules counted as they are made, one bubble at a time. So the bubbles *are* the gas, the cathode visibly fizzing twice as fast, and 2 : 1 is a measurement that comes out at 2.000 rather than an consequence of the arithmetic. The counted moles track Q/2F to within one bubble. Faraday's first law is checkable too: the same 120 C makes the same gas whether it took 30 s or 240 s. |
| **Reaction Rates & Collision Theory** | A+B→C only when the line-of-centres collision energy beats Ea; the measured per-collision success converges exactly to e^(−Ea/kT). |
| **Chemical Equilibrium & Le Chatelier** | A + B ⇌ C by exact stochastic simulation, one reaction event at a time. K is never entered: it is measured from the counts once they settle and lands on k₊/k₋, because at equilibrium the two channels fire equally often — the derivation run forwards rather than asserted. The event counters show equilibrium is not the reaction stopping. Injecting A, moving the piston and heating all shift the position, and only temperature moves K itself; van 't Hoff comes out exact, slope −ΔH°/R and intercept ΔS°/R. The catalyst is the honest test: lower both barriers and equilibrium arrives over 50× sooner with K unchanged to twelve decimals. |
| **Build an Atom** | Drag protons, neutrons, and electrons onto an atom: proton count names the element (H–Ne), electrons set the charge, neutrons make isotopes, with a real stable/unstable nuclide readout. |
| **Hydrogen Spectrum** | The levels are the model, Eₙ = −E₁/n², and everything else follows: a jump releases the difference, one photon carries it, λ = hc/ΔE. Written that way round the Rydberg formula is a *consequence*, which is what makes it worth measuring — **Measure R** fits 1/λ against (1/n₁² − 1/n₂²) over the lines this atom actually emitted and recovers R_H. Which lines exist at all is decided by the cascade: from n = 2 there is only one, from n = 5 there are ten, and the first hop is uniform over the rungs below. Fixing this turned up a real inconsistency — the ladder was drawn from R_∞ (13.605693 eV) while the wavelengths came from R_H, so the page drew one hydrogen and emitted from another, 0.055% apart. |
| **States of Matter** | One Lennard-Jones potential and Newton's second law, integrated with velocity Verlet. Nowhere does the code know what a solid is: cool it and the particles hold a triangular lattice with ψ₆ ≈ 0.9 and no diffusion, warm it past T\* ≈ 0.4 and ψ₆ collapses while D jumps by more than 50×. g(r) shows sharp shells, then one broad peak, then nothing. Speeds start as a single spike — every particle at the same speed — and collisions alone carry them onto Maxwell–Boltzmann. Thin the gas and cool it and it pulls itself into a droplet with a surface nobody drew. Thermostat off, the total energy holds to a tenth of a percent. |

### Biology (5)

| Experiment | Description |
| --- | --- |
| **DNA Double Helix** | Type a 5'→3' sequence and a true 3D B-form duplex builds itself — real 3.4 Å rise, 20 Å diameter, 10.5 bp/turn, and a 120° strand offset that opens genuine major and minor grooves. GC content, melting temperature, and an mRNA transcript update live. |
| **Predator & Prey** | The Lotka–Volterra equations integrated with RK4: populations oscillate, a phase portrait traces the closed orbit, and the conserved invariant is shown live. |
| **Natural Selection & Genetic Drift** | One locus, two alleles, three tunable fitnesses. A finite Wright–Fisher population runs against the infinite-population recursion, so selection shows as the trend and drift as the wobble. Recessive lethals decay as qₜ = q₀/(1 + tq₀), heterozygote advantage holds a balanced polymorphism at p*, and mean fitness never falls. |
| **Nerve Impulse &mdash; Hodgkin&ndash;Huxley** | Four coupled ODEs integrated exactly as Hodgkin and Huxley wrote them in 1952. No line of code compares the voltage against a threshold, yet one is there and it is sharp: bisecting the model itself brackets it to three decimals, and 1% under it the membrane merely sags while 1% over it fires a full spike — a 90 mV difference from a 2% change in stimulus. Above threshold the peak varies by under 4 mV across a 6.7× range of current. The refractory period (~10 ms) is h needing time to reopen; firing under sustained current switches on abruptly at ~50 Hz rather than easing up from zero, and stops again past ~80 µA/cm² as depolarisation block sets in. |
| **Enzyme Kinetics — Michaelis–Menten** | No line of code evaluates the rate law. Every enzyme molecule is its own continuous-time Markov chain over free / ES / EI / ESI, jumping with the mechanism's own constants and exponential waiting times; the products are counted and divided by the elapsed time. The hyperbola that the counts land on is v = Vₘₐₓ[S]/(Kₘ+[S]) to better than 1%, and each of the three inhibitors moves exactly the constant it should — competitive shares the Lineweaver–Burk y-intercept, non-competitive the x-intercept, uncompetitive the slope. |

---

## Running locally

The site is fully static — open `index.html` in any modern browser:

```bash
git clone https://github.com/grtwa123-cmyk/-.git science-lab
cd science-lab
open index.html         # macOS
# xdg-open index.html   # Linux
# start index.html      # Windows
```

For consistent `fetch` / module / DPR behaviour, prefer a local server:

```bash
npm run serve            # python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static-file server works (`npx http-server`, `caddy file-server`, `python3 -m http.server`, etc.). There is nothing to install — `package.json` declares no dependencies.

### Checks

Both run on Node's standard library alone, so there is still nothing to install:

```bash
npm run lint             # syntax + .editorconfig, every tracked file
npm test                 # 28 suites, 880 checks
npm test -- enzyme lens  # just the suites whose path matches
```

`npm run lint` parses all 50 JavaScript files and checks the whole tree against
`.editorconfig`. ES modules are copied to a `.mjs` temporary first, because
`node --check` reports success without fully parsing a `.js` file that contains
`export`.

`npm test` runs every suite in its own process, each serving the repo on an
ephemeral port for as long as it needs — nothing to start first, and no fixed
port to collide with `npm run serve`.

| Suite | What it holds to |
| --- | --- |
| `smoke` | Catalogue entries resolve to real files and defined title keys, `en`/`ko`/`zh` key sets are identical, every experiment is linked from its hub, and the landing page, hubs and one experiment per category load with no console error. |
| `i18n` | Each locale fetches exactly one dictionary, switching loads on demand without refetching, subdirectory pages resolve the path, and no element ever shows a raw key. |
| `reduced-motion` | Ten simulations hold still under `prefers-reduced-motion`, stay painted and responsive, and resume on Play — and are untouched without the preference. |
| `view-switcher` | Wall and table, persistence, category filters, and that table mode requests no CDN and creates no WebGL context. Also that the table *fits*: the landing page puts `overflow: hidden` on `html` and `body` so the wall can own the viewport, which meant the usual document-level overflow check could not fail — it read 390 = 390 while a nowrap heading held the table at 488px and sliced it off at the edge. The scroller and the table are measured instead. |
| `circuit`, `decay`, `diffraction`, `electrolysis`, `enzyme`, `equilibrium`, `generator`, `lens`, `neuron`, `pendulum`, `phases`, `photoelectric`, `projectile`, `refraction`, `resonance`, `selection`, `spectra`, `string`, `wave` | The physics. Each simulation is checked against its closed form — Ohm's law and Kirchhoff residuals, the N-slit intensity and its missing orders, Michaelis–Menten from counted turnovers, equilibrium constants from counted reaction events against k₊/k₋ and van 't Hoff, the thin-lens equation from traced rays, Hodgkin–Huxley threshold and refractory period, Foucault precession at Ω·sin φ, a projectile's measured range against v₀²sin2θ/g and the optimal launch angle found by sweep, Planck's constant fitted from counted stopping voltages, the Rydberg constant fitted from emitted lines, Faraday's 2 : 1 counted out of the bubbles, Snell's law read off a Huygens wavelet envelope and cross-checked against Fermat's least-time path, an AC waveform and its quarter-turn phase produced by differentiating an integrated flux, Lennard-Jones melting, condensation and Maxwell–Boltzmann relaxation, the resonant amplitude and phase measured back out of the motion, Wright–Fisher against the infinite-population recursion, counted survivors held to N₀·2^(−t/T½) against the binomial spread of the count itself, harmonics found by transforming a plucked string rather than written down, located interference fringes held to the hyperbola they sit on rather than to the small-angle form of it, and a diffraction pattern summed over the aperture and then searched, with the grating equation read off the peaks the search returned. Where a check is statistical the bound is derived from the run's own counts, not picked. Where an approximation is on screen it is held to its own error term, not waved through: `wave` fails if λL/d is out by anything other than √(1 − (λ/d)²) ⁄ √(1 + (d² − λ²)/4L²), and `diffraction` fails if the aperture sum has not converged — each doubling of the sample count has to quarter the change, because a sum that has not converged is a formula with extra steps. |
| `theme` | Light and dark. That the preference is stamped before the first paint (a deferred script would mean a flash on every navigation), that auto follows the OS while an explicit choice ignores it, that the choice survives a reload and a change of directory — and, the part worth having, that **every piece of text clears WCAG AA against what it actually sits on**, computed by compositing the real stack of translucent panes, gradient fills and gradient text rather than by eye. It walks a hub, an experiment and the landing table, and names the chips as well as the prose — a pill whose whole job is colour is exactly the thing a tag-name selector walks past. |
| `fonts` | The self-hosted Pretendard subset. Every Korean syllable, Latin character and symbol the three dictionaries can put on screen must be in the shipped font, or the check names the ones that fell out and points at `tools/build-font.py`. It also holds the site to `assets/fonts/coverage.json` — the characters Pretendard genuinely lacks and that therefore fall back — in both directions, so neither the font nor the note about it can drift. It also takes the non-ASCII glyphs off the *rendered* chrome rather than out of the dictionaries — the theme toggle picks its icon in JavaScript, so no dictionary ever sees it — and confirms the font costs no third-party request. |
| `method-badges` | The badge each page shows about itself. The method on the page must match the catalogue, **Verified** must match what is actually in `tests/experiments/`, and anything badged **Measured** must expose a hook a measurement can be read from — so the claim can never outrun the evidence. |
| `url-state` | That a link carries a setup. A moved slider appears in the query string and a default one does not, a shared URL brings the *model* back and not merely the slider positions, Reset empties it, and eight slider moves add nothing to the back button. And that the query string is treated as the untrusted input it is: out of range, off the step grid, not a number, longer than any real value, an id that is not a control — nine malformed values, all refused, none of them reaching the page. |
| `bespoke3d` | The two pages with no `.js` file of their own, so nothing else reaches them: the Solar System tour and the black-hole renderer, each checked both with three.js delivered and with the CDN blocked — because a reader behind a corporate proxy gets the second one. |

The browser suites need `CHROMIUM_PATH`. In
[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web),
`.claude/hooks/session-start.sh` exports it automatically; CI resolves it from
Playwright. `smoke` alone will skip its browser section and still run the rest
(`npm run test:smoke`).

---

## Project structure

```
.
├── index.html                  Curved-grid landing (Three.js wall)
├── physics.html                Physics hub (grid view)
├── chemistry.html              Chemistry hub (grid view)
├── biology.html                Biology hub (grid view)
├── 404.html                    Graceful not-found fallback
├── styles.css                  Shared hub / experiment styles + per-theme tokens
├── i18n.js                     EN / KO / ZH dictionary + data-i18n binding
├── tools/
│   └── build-font.py           Regenerates the Pretendard subset (manual, rare)
├── assets/
│   ├── fonts/                  Self-hosted Pretendard subset + OFL licence
│   ├── theme.js                Light / dark, stamped before first paint
│   ├── gl3d.js                 WebGL ball-and-stick 3D viewer (orbit + lighting)
│   ├── sfx.js                  Procedural Web Audio SFX engine + mute toggle
│   ├── reset-defaults.js       One meaning for Reset, snapshotted per page
│   ├── url-state.js            The query string mirrors the controls
│   └── index/                  Landing-page modules
│       ├── index.css           Curved-grid HUD + cursor styles
│       ├── main.js             Scene, camera, input, scroll, transitions
│       ├── card-texture.js     Procedural card canvas (gradient + grain + motif)
│       ├── boot.js            Picks wall vs table, loads the CDN only for the wall
│       ├── table-view.js      Plain table of the catalogue (no dependencies)
│       ├── motifs.js           36 line-art glyphs, one per experiment
│       └── experiments.js      Frozen catalogue of experiments
└── experiments/
    ├── projectile.{html,js}
    ├── pendulum.{html,js}
    ├── wave.{html,js}
    ├── doppler.{html,js}
    ├── dna.{html,js}
    ├── cannon.{html,js}
    ├── orbit.{html,js}
    ├── impact.{html,js}
    ├── solar.{html,js}
    ├── solarsystem.html        Bespoke 3D tour (inline JS)
    ├── blackhole.html          Bespoke WebGL ray tracer (inline JS + GLSL)
    ├── semiconductor.{html,js}
    ├── diode.{html,js}
    ├── refraction.{html,js}
    ├── generator.{html,js}
    ├── photoelectric.{html,js}
    ├── diffraction.{html,js}
    ├── lens.{html,js}
    ├── resonance.{html,js}
    ├── string.{html,js}
    ├── circuit.{html,js}
    ├── molecule.{html,js}
    ├── crystal.{html,js}
    ├── titration.{html,js}
    ├── gas.{html,js}
    ├── decay.{html,js}
    ├── electrolysis.{html,js}
    ├── kinetics.{html,js}
    ├── atom.{html,js}
    ├── spectra.{html,js}
    ├── equilibrium.{html,js}
    ├── phases.{html,js}
    ├── lotka.{html,js}
    ├── selection.{html,js}
    ├── enzyme.{html,js}
    └── neuron.{html,js}
```

---

## Architecture

- **No build step.** Every page is `<script>`-includes only. Three.js loads as an ES module from the jsDelivr CDN; GSAP loads as a classic deferred script.
- **Modules where they pay off.** The landing page is split into `boot.js` (picks the view), `main.js` (scene / input / loop), `card-texture.js` (the procedural card), `motifs.js` (36 small line-art glyphs), `table-view.js` (the plain view), and `experiments.js` (the catalogue). `table-view.js` imports only the catalogue, so choosing Table means Three.js and gsap are never requested at all. Each experiment ships its own `.js` because the simulations don't share more than a canvas and a slider.
- **Theming via CSS custom properties.** `:root` defines the Physics palette; `body[data-theme="chemistry"]` swaps a handful of tokens. The categories never need a separate stylesheet.
- **i18n** is a 250-line single file. `data-i18n="key"` on any element + `i18n.applyLang('ko')` walks the DOM, replaces text content, updates `<html lang>`, and emits a `langchange` event the landing page listens for to re-render its canvas cards.
- **Numerical integration.** RK4, leapfrog, and sub-stepped Euler depending on the experiment. Mass and momentum are conserved where the physics calls for it.
- **Real 3D where the science is 3D.** `assets/gl3d.js` is a small ball-and-stick viewer written straight on WebGL — perspective camera, depth buffer, Blinn–Phong shading, and orbit on both axes — with no runtime dependency, so the molecule, crystal, and DNA models keep working offline. Scenes are just lists of spheres and cylinders; a 2D overlay canvas carries the labels, positioned by projecting world points back to CSS pixels. The loop redraws only when something actually changed, so a model sitting still costs no frames at all.
- **Light and dark.** A three-state toggle — auto, light, dark — with auto following the operating system, so a reader who has already told their machine which they want is not asked twice. `assets/theme.js` is loaded *blocking* from `<head>` and stamps the resolved theme on `<html>` before the first paint, because the alternative is a flash of the wrong theme on every navigation; the stylesheets then have exactly two cases to style and never an "auto" to reason about. Liquid Glass is re-derived rather than inverted: on a dark page the panes are lit by a white specular edge over a white tint, and on a light one that highlight has nothing to say, so the tint goes toward white while the borders and shadows carry the elevation. The simulation canvases stay dark in both — their colours are data, chosen against a dark field — and get a frame in light mode so they read as instruments set into the page rather than holes punched through it. The landing wall is WebGL and cannot be styled, so the page colour is handed to the renderer's clear colour and its fog, and the cards keep their colour at rest instead of the dark theme's grey-until-hovered.
- **One font, pinned.** The site self-hosts a 458 KB subset of [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1) rather than naming a stack of system faces. That is not decoration: the landing wall draws each card title into a canvas and wraps it by *measuring* it, so when `-apple-system` / `Segoe UI` / `Apple SD Gothic Neo` resolved to a different Korean face on every platform, the same card could break onto a different number of lines depending on who was looking. `tools/build-font.py` cuts the upstream variable font down to KS X 1001 — the 2 350-syllable national standard, which already contains every syllable the three dictionaries use — plus the Latin and the Greek and mathematical symbols the copy actually contains, found by scanning the source rather than by keeping a list. Pretendard carries no CJK ideographs, so Chinese still falls through to the system stack; `assets/fonts/coverage.json` records exactly which characters do, and the `fonts` suite fails if that ever stops being true.
- **Procedural sound.** `assets/sfx.js` is a tiny Web Audio engine — every effect is synthesised from oscillators and noise buffers (no audio files, nothing to download), tied to each experiment's real events: a Geiger crackle per radioactive decay, the generator's hum rising with the wheel speed, a Doppler-shifted tone, electrolysis fizz, titration drips, and more. Audio unlocks on the first gesture and a floating 🔊 toggle (persisted to `localStorage`) mutes the whole site.
- **WebGL black hole.** Vector Binet equation `a = −3Mh²x/r⁵` integrated with leapfrog (adaptive steps) for the exact photon-sphere shadow; Novikov–Thorne emissivity for the disk; bolometric beaming `I ∝ g⁴`.

---

## Browser support

| Browser | Minimum | Notes |
| --- | --- | --- |
| Chrome / Edge | 96+ | Reference target. |
| Firefox | 93+ | All experiments render. |
| Safari | 15.4+ | iOS Safari needs `viewport-fit=cover` for the curved index — already set. |

The site requires WebGL 1.0 for the landing page and the WebGL experiments. Touch is fully supported (Pointer Events, `touch-action: none` where appropriate, pinch zoom on the index).

---

## Accessibility & i18n

- **Keyboard reachable everywhere.** Every interactive element is a real `<a>`, `<button>`, or `<input>`. The landing-page canvas ships a visually hidden `<nav class="sr-only">` with anchor links to all 36 experiments, so screen readers and search engines can discover the catalogue. The 3D models take focus and are fully operable from the keyboard: **arrow keys** orbit (hold <kbd>Shift</kbd> for bigger steps), <kbd>+</kbd> / <kbd>−</kbd> zoom, and <kbd>0</kbd> restores the starting view.
- **`prefers-reduced-motion`** is honoured across the whole site: the landing wall skips its intro stagger and disables idle drift, CSS animations are short-circuited via a media query in `styles.css`, and the 3D viewers start held still — a JS animation loop can't be reached by the media query, so `gl3d.js` checks the preference itself and the on-screen control reflects it, leaving the reader free to start the rotation.
- **Focus rings** use `:focus-visible` so mouse users don't see them on click but keyboard users always do.
- **Three languages.** Switching `EN / 한 / 中` re-walks the DOM and repaints the canvas cards on the index. The chosen language is persisted to `localStorage`.

---

## Contributing

Issues and PRs are welcome. The codebase is small enough to read end-to-end — start at `index.html` for the landing wall or `experiments/<name>.html` + `<name>.js` for an individual simulation.

A few conventions:

- **No build tooling.** Anything that requires `npm run build` is out of scope.
- **No runtime dependencies** for the existing experiments. Three.js / GSAP are loaded from CDNs and only on pages that need them.
- **Theming through tokens.** New experiments should use the existing CSS custom properties (`--accent`, `--surface`, `--muted`, etc.).
- **i18n every user-visible string.** Add a key to `i18n.js` and reference it with `data-i18n` on the element.
