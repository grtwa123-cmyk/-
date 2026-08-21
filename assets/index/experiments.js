/**
 * Experiment catalogue rendered on the curved index wall.
 *
 * Kept in its own module so the catalogue can grow without touching the
 * scene/input/loop code, and so other surfaces (hub pages, hidden a11y
 * nav, sitemap generation) can import the same data later.
 *
 * Schema:
 *   titleKey  – i18n key for the card title
 *   url       – relative URL from the project root
 *   cat       – "Physics" | "Chemistry" | "Biology"
 *   method    – how the numbers on the page are produced. One of:
 *                 measured    the mechanism runs and the textbook result is
 *                             read back out of it, never typed in
 *                 integrated  equations of motion stepped forward in time
 *                 solved      the governing equation solved numerically
 *                 formula     a closed-form expression evaluated and drawn
 *                 model       a 3D structure built from measured constants
 *                 illustrated an animation of the idea, no quantitative model
 *               Whether a page is additionally *verified* is not stored here:
 *               it is derived from whether tests/experiments/<name>.test.mjs
 *               exists, so the claim cannot drift away from the evidence.
 *   tags      – short uppercase tokens shown on the bottom row
 *   colors    – [from, to] gradient stops for the card's image block
 *   motif     – key handled by motifs.js (line-art glyph)
 */
export const EXPERIMENTS = Object.freeze([
  { titleKey: "projectileTitle",  url: "experiments/projectile.html",    cat: "Physics",   tags: ["MOTION", "DRAG"],       colors: ["#1a2742", "#f0a85e"], method: "measured", motif: "projectile" },
  { titleKey: "pendulumTitle",    url: "experiments/pendulum.html",      cat: "Physics",   tags: ["MOTION", "OSCILLATE"],  colors: ["#0c1a36", "#5db0d6"], method: "measured", motif: "pendulum" },
  { titleKey: "waveTitle",        url: "experiments/wave.html",          cat: "Physics",   tags: ["WAVES", "INTERFERE"],   colors: ["#0a1a2e", "#7ad9ee"], method: "measured", motif: "wave" },
  { titleKey: "dopplerTitle",     url: "experiments/doppler.html",       cat: "Physics",   tags: ["WAVES", "DOPPLER"],     colors: ["#101830", "#ff9b6b"], method: "measured", motif: "doppler" },
  { titleKey: "cannonTitle",      url: "experiments/cannon.html",        cat: "Physics",   tags: ["GRAVITY", "ORBIT"],     colors: ["#102132", "#5fa4b8"], method: "measured", motif: "cannon" },
  { titleKey: "orbitsTitle",      url: "experiments/orbit.html",         cat: "Physics",   tags: ["GRAVITY", "KEPLER"],    colors: ["#070914", "#d4c065"], method: "measured", motif: "orbit" },
  { titleKey: "impactTitle",      url: "experiments/impact.html",        cat: "Physics",   tags: ["FORCE", "IMPULSE"],     colors: ["#1d1908", "#e2a45a"], method: "measured", motif: "impact" },
  { titleKey: "dnaTitle",         url: "experiments/dna.html",           cat: "Biology",   tags: ["DNA", "HELIX"],         colors: ["#150828", "#e58fff"], method: "model", motif: "dna" },
  { titleKey: "solarSystemTitle", url: "experiments/solarsystem.html",   cat: "Physics",   tags: ["3D", "TOUR"],           colors: ["#0a0e22", "#7da3d4"], method: "model", motif: "solarsystem" },
  { titleKey: "bhTitle",          url: "experiments/blackhole.html",     cat: "Physics",   tags: ["RELATIVITY", "WEBGL"],  colors: ["#1a0a06", "#e08a4a"], method: "integrated", motif: "blackhole" },
  { titleKey: "semiTitle",        url: "experiments/semiconductor.html", cat: "Physics",   tags: ["QUANTUM", "FIELD"],     colors: ["#22153a", "#a06fc8"], method: "illustrated", motif: "semi" },
  { titleKey: "diodeTitle",       url: "experiments/diode.html",         cat: "Physics",   tags: ["QUANTUM", "FIELD"],     colors: ["#2c0e22", "#d65a8a"], method: "illustrated", motif: "diode" },
  { titleKey: "refractionTitle",  url: "experiments/refraction.html",    cat: "Physics",   tags: ["OPTICS", "SNELL"],      colors: ["#0a1428", "#6ea8ff"], method: "measured", motif: "refraction" },
  { titleKey: "generatorTitle",   url: "experiments/generator.html",     cat: "Physics",   tags: ["INDUCTION", "FARADAY"], colors: ["#1d1405", "#ffe14a"], method: "measured", motif: "generator" },
  { titleKey: "peTitle",          url: "experiments/photoelectric.html", cat: "Physics",   tags: ["QUANTUM", "PHOTON"],    colors: ["#160b2a", "#b98cff"], method: "measured", motif: "photoelectric" },
  { titleKey: "circuitTitle",     url: "experiments/circuit.html",       cat: "Physics",   tags: ["CIRCUIT", "OHM"],       colors: ["#0a1a1c", "#5fd6c0"], method: "solved", motif: "circuit" },
  { titleKey: "diffTitle",        url: "experiments/diffraction.html",   cat: "Physics",   tags: ["OPTICS", "QUANTUM"],    colors: ["#101024", "#8ab4ff"], method: "measured", motif: "diffraction" },
  { titleKey: "lensTitle",        url: "experiments/lens.html",          cat: "Physics",   tags: ["OPTICS", "IMAGE"],      colors: ["#0b1526", "#7fd4ff"], method: "measured", motif: "lens" },
  { titleKey: "resTitle",         url: "experiments/resonance.html",     cat: "Physics",   tags: ["OSCILLATE", "RESONANCE"], colors: ["#24101a", "#ff8aa3"], method: "measured", motif: "resonance" },
  { titleKey: "solarTitle",       url: "experiments/solar.html",         cat: "Physics",   tags: ["GRAVITY", "N-BODY"],    colors: ["#0d0a1e", "#e0a24a"], method: "integrated", motif: "solar" },
  { titleKey: "moleculeTitle",    url: "experiments/molecule.html",      cat: "Chemistry", tags: ["3D", "MODEL"],          colors: ["#0a1f15", "#6fbf8a"], method: "model", motif: "molecule" },
  { titleKey: "crystalTitle",     url: "experiments/crystal.html",       cat: "Chemistry", tags: ["LATTICE", "3D"],        colors: ["#0a1822", "#6fc4d4"], method: "model", motif: "crystal" },
  { titleKey: "titrationTitle",   url: "experiments/titration.html",     cat: "Chemistry", tags: ["ACID", "PH"],           colors: ["#200a1c", "#f06ac0"], method: "measured", motif: "titration" },
  { titleKey: "gasTitle",         url: "experiments/gas.html",           cat: "Chemistry", tags: ["GAS", "KINETIC"],       colors: ["#231407", "#f0b060"], method: "measured", motif: "gas" },
  { titleKey: "decayTitle",       url: "experiments/decay.html",         cat: "Chemistry", tags: ["NUCLEAR", "HALF-LIFE"], colors: ["#0a1e14", "#6effc6"], method: "measured", motif: "decay" },
  { titleKey: "elTitle",          url: "experiments/electrolysis.html",  cat: "Chemistry", tags: ["REDOX", "FARADAY"],     colors: ["#0a1626", "#8cdcff"], method: "measured", motif: "electrolysis" },
  { titleKey: "rxTitle",          url: "experiments/redox.html",         cat: "Chemistry", tags: ["REDOX", "NERNST"],      colors: ["#06180f", "#6effc6"], method: "measured", motif: "redox" },
  { titleKey: "kinTitle",         url: "experiments/kinetics.html",      cat: "Chemistry", tags: ["ARRHENIUS", "RATE"],    colors: ["#22091a", "#ff8aa3"], method: "measured", motif: "kinetics" },
  { titleKey: "atomTitle",        url: "experiments/atom.html",          cat: "Chemistry", tags: ["ELEMENT", "ISOTOPE"],   colors: ["#0a1424", "#6ea8ff"], method: "model", motif: "atom" },
  { titleKey: "spectraTitle",     url: "experiments/spectra.html",       cat: "Chemistry", tags: ["QUANTUM", "SPECTRUM"],  colors: ["#12081f", "#ff5ea8"], method: "measured", motif: "spectra" },
  { titleKey: "lotkaTitle",       url: "experiments/lotka.html",         cat: "Biology",   tags: ["ECOLOGY", "VOLTERRA"],  colors: ["#101f14", "#7be0d0"], method: "measured", motif: "lotka" },
  { titleKey: "epidemicTitle",  url: "experiments/epidemic.html",      cat: "Biology",   tags: ["EPIDEMIC", "SIR"],      colors: ["#1d0f14", "#ff6b8a"], method: "measured", motif: "epidemic" },
  { titleKey: "expressionTitle", url: "experiments/expression.html",   cat: "Biology",   tags: ["EXPRESSION", "NOISE"],  colors: ["#150f1d", "#ff6b8a"], method: "measured", motif: "expression" },
  { titleKey: "nsTitle",          url: "experiments/selection.html",     cat: "Biology",   tags: ["EVOLUTION", "DRIFT"],   colors: ["#1a0f24", "#c79bff"], method: "measured", motif: "selection" },
  { titleKey: "mmTitle",          url: "experiments/enzyme.html",        cat: "Biology",   tags: ["ENZYME", "KINETICS"],   colors: ["#0c1f1c", "#7be0d0"], method: "measured", motif: "enzyme" },
  { titleKey: "hhTitle",         url: "experiments/neuron.html",        cat: "Biology",   tags: ["NEURON", "SPIKE"],      colors: ["#1b1206", "#ffd166"], method: "measured", motif: "neuron" },
  { titleKey: "eqTitle",          url: "experiments/equilibrium.html",   cat: "Chemistry", tags: ["EQUILIBRIUM", "SHIFT"], colors: ["#08130f", "#6fbf8a"], method: "measured", motif: "equilibrium" },
  { titleKey: "swTitle",          url: "experiments/string.html",        cat: "Physics",   tags: ["WAVES", "HARMONICS"],   colors: ["#080e1a", "#7ad9ee"], method: "measured", motif: "standing" },
  { titleKey: "mdTitle",          url: "experiments/phases.html",        cat: "Chemistry", tags: ["PHASE", "DYNAMICS"],    colors: ["#120d06", "#f0b060"], method: "measured", motif: "phases" },
]);
