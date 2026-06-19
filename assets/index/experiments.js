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
 *   cat       – "Physics" | "Chemistry"
 *   tags      – short uppercase tokens shown on the bottom row
 *   colors    – [from, to] gradient stops for the card's image block
 *   motif     – key handled by motifs.js (line-art glyph)
 */
export const EXPERIMENTS = Object.freeze([
  { titleKey: "projectileTitle",  url: "experiments/projectile.html",    cat: "Physics",   tags: ["MOTION", "2D"],         colors: ["#1a2742", "#f0a85e"], motif: "projectile" },
  { titleKey: "pendulumTitle",    url: "experiments/pendulum.html",      cat: "Physics",   tags: ["MOTION", "OSCILLATE"],  colors: ["#0c1a36", "#5db0d6"], motif: "pendulum" },
  { titleKey: "cannonTitle",      url: "experiments/cannon.html",        cat: "Physics",   tags: ["GRAVITY", "ORBIT"],     colors: ["#102132", "#5fa4b8"], motif: "cannon" },
  { titleKey: "orbitsTitle",      url: "experiments/orbit.html",         cat: "Physics",   tags: ["GRAVITY", "N-BODY"],    colors: ["#070914", "#d4c065"], motif: "orbit" },
  { titleKey: "impactTitle",      url: "experiments/impact.html",        cat: "Physics",   tags: ["FORCE", "GRAPH"],       colors: ["#1d1908", "#e2a45a"], motif: "impact" },
  { titleKey: "solarTitle",       url: "experiments/solar.html",         cat: "Physics",   tags: ["GRAVITY", "3D"],        colors: ["#080a1e", "#8095e6"], motif: "solar" },
  { titleKey: "solarSystemTitle", url: "experiments/solarsystem.html",   cat: "Physics",   tags: ["3D", "TOUR"],           colors: ["#0a0e22", "#7da3d4"], motif: "solarsystem" },
  { titleKey: "bhTitle",          url: "experiments/blackhole.html",     cat: "Physics",   tags: ["RELATIVITY", "WEBGL"],  colors: ["#1a0a06", "#e08a4a"], motif: "blackhole" },
  { titleKey: "semiTitle",        url: "experiments/semiconductor.html", cat: "Physics",   tags: ["QUANTUM", "FIELD"],     colors: ["#22153a", "#a06fc8"], motif: "semi" },
  { titleKey: "diodeTitle",       url: "experiments/diode.html",         cat: "Physics",   tags: ["QUANTUM", "FIELD"],     colors: ["#2c0e22", "#d65a8a"], motif: "diode" },
  { titleKey: "moleculeTitle",    url: "experiments/molecule.html",      cat: "Chemistry", tags: ["3D", "MODEL"],          colors: ["#0a1f15", "#6fbf8a"], motif: "molecule" },
  { titleKey: "crystalTitle",     url: "experiments/crystal.html",       cat: "Chemistry", tags: ["LATTICE", "3D"],        colors: ["#0a1822", "#6fc4d4"], motif: "crystal" },
]);
