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
 *   tags      – short uppercase tokens shown on the bottom row
 *   colors    – [from, to] gradient stops for the card's image block
 *   motif     – key handled by motifs.js (line-art glyph)
 */
export const EXPERIMENTS = Object.freeze([
  { titleKey: "projectileTitle",  url: "experiments/projectile.html",    cat: "Physics",   tags: ["MOTION", "2D"],         colors: ["#1a2742", "#f0a85e"], motif: "projectile" },
  { titleKey: "pendulumTitle",    url: "experiments/pendulum.html",      cat: "Physics",   tags: ["MOTION", "OSCILLATE"],  colors: ["#0c1a36", "#5db0d6"], motif: "pendulum" },
  { titleKey: "waveTitle",        url: "experiments/wave.html",          cat: "Physics",   tags: ["WAVES", "INTERFERE"],   colors: ["#0a1a2e", "#7ad9ee"], motif: "wave" },
  { titleKey: "dopplerTitle",     url: "experiments/doppler.html",       cat: "Physics",   tags: ["WAVES", "DOPPLER"],     colors: ["#101830", "#ff9b6b"], motif: "doppler" },
  { titleKey: "cannonTitle",      url: "experiments/cannon.html",        cat: "Physics",   tags: ["GRAVITY", "ORBIT"],     colors: ["#102132", "#5fa4b8"], motif: "cannon" },
  { titleKey: "orbitsTitle",      url: "experiments/orbit.html",         cat: "Physics",   tags: ["GRAVITY", "N-BODY"],    colors: ["#070914", "#d4c065"], motif: "orbit" },
  { titleKey: "impactTitle",      url: "experiments/impact.html",        cat: "Physics",   tags: ["FORCE", "GRAPH"],       colors: ["#1d1908", "#e2a45a"], motif: "impact" },
  { titleKey: "dnaTitle",         url: "experiments/dna.html",           cat: "Biology",   tags: ["DNA", "HELIX"],         colors: ["#150828", "#e58fff"], motif: "dna" },
  { titleKey: "solarSystemTitle", url: "experiments/solarsystem.html",   cat: "Physics",   tags: ["3D", "TOUR"],           colors: ["#0a0e22", "#7da3d4"], motif: "solarsystem" },
  { titleKey: "bhTitle",          url: "experiments/blackhole.html",     cat: "Physics",   tags: ["RELATIVITY", "WEBGL"],  colors: ["#1a0a06", "#e08a4a"], motif: "blackhole" },
  { titleKey: "semiTitle",        url: "experiments/semiconductor.html", cat: "Physics",   tags: ["QUANTUM", "FIELD"],     colors: ["#22153a", "#a06fc8"], motif: "semi" },
  { titleKey: "diodeTitle",       url: "experiments/diode.html",         cat: "Physics",   tags: ["QUANTUM", "FIELD"],     colors: ["#2c0e22", "#d65a8a"], motif: "diode" },
  { titleKey: "refractionTitle",  url: "experiments/refraction.html",    cat: "Physics",   tags: ["OPTICS", "SNELL"],      colors: ["#0a1428", "#6ea8ff"], motif: "refraction" },
  { titleKey: "generatorTitle",   url: "experiments/generator.html",     cat: "Physics",   tags: ["INDUCTION", "FARADAY"], colors: ["#1d1405", "#ffe14a"], motif: "generator" },
  { titleKey: "peTitle",          url: "experiments/photoelectric.html", cat: "Physics",   tags: ["QUANTUM", "PHOTON"],    colors: ["#160b2a", "#b98cff"], motif: "photoelectric" },
  { titleKey: "circuitTitle",     url: "experiments/circuit.html",       cat: "Physics",   tags: ["CIRCUIT", "OHM"],       colors: ["#0a1a1c", "#5fd6c0"], motif: "circuit" },
  { titleKey: "diffTitle",        url: "experiments/diffraction.html",   cat: "Physics",   tags: ["OPTICS", "QUANTUM"],    colors: ["#101024", "#8ab4ff"], motif: "diffraction" },
  { titleKey: "lensTitle",        url: "experiments/lens.html",          cat: "Physics",   tags: ["OPTICS", "IMAGE"],      colors: ["#0b1526", "#7fd4ff"], motif: "lens" },
  { titleKey: "resTitle",         url: "experiments/resonance.html",     cat: "Physics",   tags: ["OSCILLATE", "RESONANCE"], colors: ["#24101a", "#ff8aa3"], motif: "resonance" },
  { titleKey: "solarTitle",       url: "experiments/solar.html",         cat: "Physics",   tags: ["GRAVITY", "N-BODY"],    colors: ["#0d0a1e", "#e0a24a"], motif: "solar" },
  { titleKey: "moleculeTitle",    url: "experiments/molecule.html",      cat: "Chemistry", tags: ["3D", "MODEL"],          colors: ["#0a1f15", "#6fbf8a"], motif: "molecule" },
  { titleKey: "crystalTitle",     url: "experiments/crystal.html",       cat: "Chemistry", tags: ["LATTICE", "3D"],        colors: ["#0a1822", "#6fc4d4"], motif: "crystal" },
  { titleKey: "titrationTitle",   url: "experiments/titration.html",     cat: "Chemistry", tags: ["ACID", "PH"],           colors: ["#200a1c", "#f06ac0"], motif: "titration" },
  { titleKey: "gasTitle",         url: "experiments/gas.html",           cat: "Chemistry", tags: ["GAS", "KINETIC"],       colors: ["#231407", "#f0b060"], motif: "gas" },
  { titleKey: "decayTitle",       url: "experiments/decay.html",         cat: "Chemistry", tags: ["NUCLEAR", "HALF-LIFE"], colors: ["#0a1e14", "#6effc6"], motif: "decay" },
  { titleKey: "elTitle",          url: "experiments/electrolysis.html",  cat: "Chemistry", tags: ["REDOX", "FARADAY"],     colors: ["#0a1626", "#8cdcff"], motif: "electrolysis" },
  { titleKey: "kinTitle",         url: "experiments/kinetics.html",      cat: "Chemistry", tags: ["ARRHENIUS", "RATE"],    colors: ["#22091a", "#ff8aa3"], motif: "kinetics" },
  { titleKey: "atomTitle",        url: "experiments/atom.html",          cat: "Chemistry", tags: ["ELEMENT", "ISOTOPE"],   colors: ["#0a1424", "#6ea8ff"], motif: "atom" },
  { titleKey: "spectraTitle",     url: "experiments/spectra.html",       cat: "Chemistry", tags: ["QUANTUM", "SPECTRUM"],  colors: ["#12081f", "#ff5ea8"], motif: "spectra" },
  { titleKey: "lotkaTitle",       url: "experiments/lotka.html",         cat: "Biology",   tags: ["ECOLOGY", "CYCLES"],    colors: ["#101f14", "#7be0d0"], motif: "lotka" },
  { titleKey: "nsTitle",          url: "experiments/selection.html",     cat: "Biology",   tags: ["EVOLUTION", "DRIFT"],   colors: ["#1a0f24", "#c79bff"], motif: "selection" },
  { titleKey: "mmTitle",          url: "experiments/enzyme.html",        cat: "Biology",   tags: ["ENZYME", "KINETICS"],   colors: ["#0c1f1c", "#7be0d0"], motif: "enzyme" },
  { titleKey: "hhTitle",         url: "experiments/neuron.html",        cat: "Biology",   tags: ["NEURON", "SPIKE"],      colors: ["#1b1206", "#ffd166"], motif: "neuron" },
  { titleKey: "eqTitle",          url: "experiments/equilibrium.html",   cat: "Chemistry", tags: ["EQUILIBRIUM", "SHIFT"], colors: ["#08130f", "#6fbf8a"], motif: "equilibrium" },
  { titleKey: "swTitle",          url: "experiments/string.html",        cat: "Physics",   tags: ["WAVES", "HARMONICS"],   colors: ["#080e1a", "#7ad9ee"], motif: "standing" },
]);
