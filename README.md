# Science Lab

A browser-based science sandbox: a collection of interactive physics and chemistry simulations built with vanilla HTML, CSS, and JavaScript. No build step, no dependencies — every page runs by opening the HTML file in a browser. The UI is available in English, 한국어, and 中文.

**Live demo:** https://grtwa123-cmyk.github.io/-/

## Experiments

### Physics

| Experiment | Description |
|---|---|
| **Projectile Motion** | Launch a projectile with adjustable velocity, angle, and gravity; live readouts for range, max height, and time of flight. |
| **Pendulum** | Single or coupled wave-pendulum mode; tune length, gravity, initial angle, and damping. |
| **Semiconductors & Battery** | Compare intrinsic / n-type / p-type silicon under the same battery and flip polarity. |
| **PN Junction Diode** | Watch the depletion region grow and shrink under forward vs reverse bias. |
| **Newton's Cannon** | Fire a cannonball horizontally and find the speed where falling turns into orbiting. |
| **Gravity & Orbits** | Drag on the canvas to place planets around a central star, with collision effects. |
| **Impulse & Force (Egg Drop)** | Drop an egg onto three cushions and compare peak force, average force, and impulse on a live F–t graph. |
| **Solar System & Black Holes** | Eight planets at real size ratios; tap to summon dynamic black holes that drain the Sun via an accretion stream. |

### Chemistry

| Experiment | Description |
|---|---|
| **Molecule Viewer** | Rotate common molecules (H₂O, CH₄, NH₃, C₆H₆, …) in 3D with CPK colors, bond orders, and hybridization info. |
| **Crystal Lattice** | Browse SC, BCC, FCC, NaCl, CsCl, and diamond structures with optional 2×2×2 expansion. |

## Running locally

There is nothing to install. Clone the repository and open `index.html`:

```bash
git clone https://github.com/grtwa123-cmyk/-.git
cd -
open index.html         # macOS
# xdg-open index.html   # Linux
# start index.html      # Windows
```

If you prefer a local server (recommended for consistent `fetch` and DPR behavior):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Tech stack

- **HTML5 Canvas** for all 2D rendering, with `devicePixelRatio` scaling for crisp output on retina displays.
- **Vanilla JavaScript** (ES2018+) — no frameworks, no transpilation, no bundlers.
- **CSS custom properties** for theming, with separate Physics (blue) and Chemistry (violet) palettes via `[data-theme]`.
- **Custom i18n layer** (`i18n.js`) providing English / Korean / Chinese translations through `data-i18n` attributes and a lightweight `i18n.t()` helper.
- **Numerical integration** — RK4, leapfrog, and sub-stepped Euler depending on the experiment; mass and momentum are conserved where the physics calls for it.

## Project structure

```
index.html              # Landing page (Physics / Chemistry chooser)
physics.html            # Physics hub
chemistry.html          # Chemistry hub
styles.css              # Shared styles + per-theme overrides
i18n.js                 # Shared EN / KO / ZH dictionary
experiments/
  projectile.{html,js}
  pendulum.{html,js}
  semiconductor.{html,js}
  diode.{html,js}
  cannon.{html,js}
  orbit.{html,js}
  impact.{html,js}
  solar.{html,js}
  molecule.{html,js}
  crystal.{html,js}
```
