# Science Lab

> A browser-based science sandbox — a collection of hands-on physics and chemistry simulations rendered with **vanilla HTML, CSS, Canvas, and WebGL**. No build step, no runtime dependencies. The UI ships in English, 한국어, and 中文.

<p>
  <a href="https://grtwa123-cmyk.github.io/-/">
    <img alt="Live demo" src="https://img.shields.io/badge/demo-live-2ea44f?style=flat-square" />
  </a>
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

### Physics

| Experiment | Description |
| --- | --- |
| **Projectile Motion** | Launch a projectile with adjustable velocity, angle, and gravity; live readouts for range, max height, and time of flight. |
| **Pendulum** | Single or coupled wave-pendulum; tune length, gravity, initial angle, and damping. |
| **Wave Interference** | Two coherent point sources radiate circular waves; adjust spacing, wavelength, amplitudes, and phase to watch fringes form and shift. |
| **Newton's Cannon** | Fire a cannonball horizontally and find the speed where falling turns into orbiting. |
| **Gravity & Orbits** | Drag on the canvas to place planets around a central star, with collision effects. |
| **Impulse & Force (Egg Drop)** | Drop an egg onto three cushions and compare peak / average force and impulse on a live F–t graph. |
| **Solar System & Black Holes** | Eight planets at real size ratios; summon dynamic black holes that drain the Sun via an accretion stream. |
| **Solar System Tour (3D)** | Cinematic 3D tour: procedural planet surfaces, atmospheric glow, Saturn / Uranus rings, asteroid belt, tap-to-inspect cards. |
| **Black Hole Lensing (WebGL)** | Real-time Schwarzschild ray tracer: GPU integrates photon geodesics per pixel, Doppler-boosted accretion disk. |
| **Semiconductors & Battery** | Compare intrinsic / n-type / p-type silicon under the same battery and flip the polarity. |
| **PN Junction Diode** | Watch the depletion region grow and shrink under forward vs reverse bias. |

### Chemistry

| Experiment | Description |
| --- | --- |
| **Molecule Viewer** | Rotate common molecules (H₂O, CH₄, NH₃, C₆H₆, …) in 3D with CPK colors, bond orders, and hybridization info. |
| **Crystal Lattice** | Browse SC, BCC, FCC, NaCl, CsCl, and diamond structures with optional 2×2×2 expansion. |

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
├── 404.html                    Graceful not-found fallback
├── styles.css                  Shared hub / experiment styles + per-theme tokens
├── i18n.js                     EN / KO / ZH dictionary + data-i18n binding
├── assets/
│   └── index/                  Landing-page modules
│       ├── index.css           Curved-grid HUD + cursor styles
│       ├── main.js             Scene, camera, input, scroll, transitions
│       ├── card-texture.js     Procedural card canvas (gradient + grain + motif)
│       ├── motifs.js           12 line-art glyphs, one per experiment
│       └── experiments.js      Frozen catalogue of experiments
└── experiments/
    ├── projectile.{html,js}
    ├── pendulum.{html,js}
    ├── wave.{html,js}
    ├── cannon.{html,js}
    ├── orbit.{html,js}
    ├── impact.{html,js}
    ├── solar.{html,js}
    ├── solarsystem.html        Bespoke 3D tour (inline JS)
    ├── blackhole.html          Bespoke WebGL ray tracer (inline JS + GLSL)
    ├── semiconductor.{html,js}
    ├── diode.{html,js}
    ├── molecule.{html,js}
    └── crystal.{html,js}
```

---

## Architecture

- **No build step.** Every page is `<script>`-includes only. Three.js loads as an ES module from the jsDelivr CDN; GSAP loads as a classic deferred script.
- **Modules where they pay off.** The landing page's wall is split into `main.js` (scene / input / loop), `card-texture.js` (the procedural card), `motifs.js` (12 small line-art glyphs), and `experiments.js` (the catalogue). Each experiment ships its own `.js` because the simulations don't share more than a canvas and a slider.
- **Theming via CSS custom properties.** `:root` defines the Physics palette; `body[data-theme="chemistry"]` swaps a handful of tokens. The categories never need a separate stylesheet.
- **i18n** is a 250-line single file. `data-i18n="key"` on any element + `i18n.applyLang('ko')` walks the DOM, replaces text content, updates `<html lang>`, and emits a `langchange` event the landing page listens for to re-render its canvas cards.
- **Numerical integration.** RK4, leapfrog, and sub-stepped Euler depending on the experiment. Mass and momentum are conserved where the physics calls for it.
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

- **Keyboard reachable everywhere.** Every interactive element is a real `<a>`, `<button>`, or `<input>`. The landing-page canvas ships a visually hidden `<nav class="sr-only">` with anchor links to all 12 experiments, so screen readers and search engines can discover the catalogue.
- **`prefers-reduced-motion`** is honoured across the whole site: the landing wall skips its intro stagger and disables idle drift; CSS animations are short-circuited via a media query in `styles.css`.
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
