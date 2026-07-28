# Science Lab

> A browser-based science sandbox — **28 hands-on physics, chemistry, and biology simulations** rendered with **vanilla HTML, CSS, Canvas, and WebGL**. Molecules, crystals, and DNA are real 3D models you can orbit; every simulation has procedural Web Audio sound tied to its own physics. No build step, no runtime dependencies. The UI ships in English, 한국어, and 中文.

<p>
  <a href="https://grtwa123-cmyk.github.io/-/">
    <img alt="Live demo" src="https://img.shields.io/badge/demo-live-2ea44f?style=flat-square" />
  </a>
  <img alt="Experiments" src="https://img.shields.io/badge/experiments-28-8957e5?style=flat-square" />
  <img alt="Dependencies" src="https://img.shields.io/badge/runtime%20deps-0-blue?style=flat-square" />
  <img alt="No build" src="https://img.shields.io/badge/build-none-lightgrey?style=flat-square" />
  <img alt="Languages" src="https://img.shields.io/badge/i18n-EN%20%C2%B7%20KO%20%C2%B7%20ZH-orange?style=flat-square" />
</p>

**Live demo:** https://grtwa123-cmyk.github.io/-/

The landing page is a curved phantom-style index — drag horizontally to scroll infinitely through cards, drag vertically to nudge rows, **press and hold a card to enter** the experiment.

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

### Physics (16)

| Experiment | Description |
| --- | --- |
| **Projectile Motion** | Launch a projectile with adjustable velocity, angle, and gravity; live readouts for range, max height, and time of flight. |
| **Pendulums** | Three of them. A wave pendulum whose row of slightly different periods drifts in and out of step; Foucault's pendulum, solved in the rotating frame so the plane precesses at Ω·sin φ — 23.93 h at the pole, 31.8 h in Paris, never at the equator; and Newton's cradle, where k balls in gives exactly k out because equal-mass elastic collisions leave no other option. |
| **Wave Interference** | Two coherent point sources radiate circular waves; adjust spacing, wavelength, amplitudes, and phase to watch fringes form and shift. |
| **Doppler Effect** | A moving source emits circular wavefronts that compress ahead and stretch behind; cross the wave speed and the rings collapse into a Mach cone. |
| **Newton's Cannon** | Fire a cannonball horizontally and find the speed where falling turns into orbiting. |
| **Gravity & Orbits** | Drag on the canvas to place planets around a central star, with collision effects. |
| **Impulse & Force (Egg Drop)** | Drop an egg onto three cushions and compare peak / average force and impulse on a live F–t graph. |
| **Solar System & Black Holes** | Eight planets at real size ratios; summon dynamic black holes that drain the Sun via an accretion stream. |
| **Solar System Tour (3D)** | Cinematic 3D tour: procedural planet surfaces, atmospheric glow, Saturn / Uranus rings, asteroid belt, tap-to-inspect cards. |
| **Black Hole Lensing (WebGL)** | Real-time Schwarzschild ray tracer: GPU integrates photon geodesics per pixel, Doppler-boosted accretion disk. |
| **Semiconductors & Battery** | Compare intrinsic / n-type / p-type silicon under the same battery and flip the polarity. |
| **PN Junction Diode** | Watch the depletion region grow and shrink under forward vs reverse bias. |
| **Refraction & TIR** | A ray bends across an interface by Snell's law, with the critical angle, total internal reflection, and Fresnel reflectance. |
| **Electromagnetic Generator** | A water wheel spins a bar magnet inside a pickup coil; Faraday's law EMF = N·B·A·ω·sin(ωt) lights a bulb, with the live rotating dipole field. |
| **Photoelectric Effect** | Red light at full brightness does nothing; a faint violet beam ejects electrons instantly. Sweep the wavelength and the KEₘₐₓ-vs-frequency line plots itself — slope h, intercept the threshold frequency. |
| **Ohm's Law — Series & Parallel** | Three resistors wired end to end or side by side, solved from the closed forms. Carriers move at the real current in each wire, so a parallel rail visibly slows as every branch taps its share; bodies warm with dissipated power, and both Kirchhoff residuals stay printed at zero. |

### Chemistry (9)

| Experiment | Description |
| --- | --- |
| **Molecule Viewer** | A real 3D ball-and-stick model of H₂O, CH₄, NH₃, C₆H₆, … — orbit it freely, with CPK colours, split-colour bonds, bond orders, and hybridization info. |
| **Crystal Lattice** | SC, BCC, FCC, NaCl, CsCl, and diamond as true 3D unit cells you can turn in any direction, with the cell drawn as real edge geometry and optional 2×2×2 expansion. |
| **Acid–Base Titration** | Drip NaOH into HCl or acetic acid: exact charge-balance pH solver, live pH–V curve, buffer region, equivalence point, phenolphthalein colour change. |
| **Ideal Gas & Kinetic Theory** | Particles in a piston chamber: pressure measured from real wall impacts tracks PV = NkT; drag the piston and ride the isotherm. |
| **Radioactive Decay** | A grid of nuclei decays by pure per-nucleus chance and traces the exact exponential half-life curve N = N₀·2^(−t/T½); live activity and half-life markers. |
| **Electrolysis of Water** | Above 1.23 V the cell runs and Faraday's laws fill the tubes: n(H₂)=Q/2F, n(O₂)=Q/4F — a live 2:1 volume ratio. |
| **Reaction Rates & Collision Theory** | A+B→C only when the line-of-centres collision energy beats Ea; the measured per-collision success converges exactly to e^(−Ea/kT). |
| **Build an Atom** | Drag protons, neutrons, and electrons onto an atom: proton count names the element (H–Ne), electrons set the charge, neutrons make isotopes, with a real stable/unstable nuclide readout. |
| **Hydrogen Spectrum** | Excite the electron and let it cascade back down; every jump emits one photon, drawn in its true colour. The Balmer lines land on 656.5 / 486.3 / 434.2 / 410.3 nm (vacuum) straight from the Rydberg formula. |

### Biology (3)

| Experiment | Description |
| --- | --- |
| **DNA Double Helix** | Type a 5'→3' sequence and a true 3D B-form duplex builds itself — real 3.4 Å rise, 20 Å diameter, 10.5 bp/turn, and a 120° strand offset that opens genuine major and minor grooves. GC content, melting temperature, and an mRNA transcript update live. |
| **Predator & Prey** | The Lotka–Volterra equations integrated with RK4: populations oscillate, a phase portrait traces the closed orbit, and the conserved invariant is shown live. |
| **Natural Selection & Genetic Drift** | One locus, two alleles, three tunable fitnesses. A finite Wright–Fisher population runs against the infinite-population recursion, so selection shows as the trend and drift as the wobble. Recessive lethals decay as qₜ = q₀/(1 + tq₀), heterozygote advantage holds a balanced polymorphism at p*, and mean fitness never falls. |

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

Any static-file server works (`npx http-server`, `caddy file-server`, `python3 -m http.server`, etc.). There is nothing to install — `package.json` is metadata only.

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
├── assets/
│   ├── gl3d.js                 WebGL ball-and-stick 3D viewer (orbit + lighting)
│   ├── sfx.js                  Procedural Web Audio SFX engine + mute toggle
│   └── index/                  Landing-page modules
│       ├── index.css           Curved-grid HUD + cursor styles
│       ├── main.js             Scene, camera, input, scroll, transitions
│       ├── card-texture.js     Procedural card canvas (gradient + grain + motif)
│       ├── motifs.js           28 line-art glyphs, one per experiment
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
    ├── lotka.{html,js}
    └── selection.{html,js}
```

---

## Architecture

- **No build step.** Every page is `<script>`-includes only. Three.js loads as an ES module from the jsDelivr CDN; GSAP loads as a classic deferred script.
- **Modules where they pay off.** The landing page's wall is split into `main.js` (scene / input / loop), `card-texture.js` (the procedural card), `motifs.js` (28 small line-art glyphs), and `experiments.js` (the catalogue). Each experiment ships its own `.js` because the simulations don't share more than a canvas and a slider.
- **Theming via CSS custom properties.** `:root` defines the Physics palette; `body[data-theme="chemistry"]` swaps a handful of tokens. The categories never need a separate stylesheet.
- **i18n** is a 250-line single file. `data-i18n="key"` on any element + `i18n.applyLang('ko')` walks the DOM, replaces text content, updates `<html lang>`, and emits a `langchange` event the landing page listens for to re-render its canvas cards.
- **Numerical integration.** RK4, leapfrog, and sub-stepped Euler depending on the experiment. Mass and momentum are conserved where the physics calls for it.
- **Real 3D where the science is 3D.** `assets/gl3d.js` is a small ball-and-stick viewer written straight on WebGL — perspective camera, depth buffer, Blinn–Phong shading, and orbit on both axes — with no runtime dependency, so the molecule, crystal, and DNA models keep working offline. Scenes are just lists of spheres and cylinders; a 2D overlay canvas carries the labels, positioned by projecting world points back to CSS pixels. The loop redraws only when something actually changed, so a model sitting still costs no frames at all.
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

- **Keyboard reachable everywhere.** Every interactive element is a real `<a>`, `<button>`, or `<input>`. The landing-page canvas ships a visually hidden `<nav class="sr-only">` with anchor links to all 28 experiments, so screen readers and search engines can discover the catalogue. The 3D models take focus and are fully operable from the keyboard: **arrow keys** orbit (hold <kbd>Shift</kbd> for bigger steps), <kbd>+</kbd> / <kbd>−</kbd> zoom, and <kbd>0</kbd> restores the starting view.
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
