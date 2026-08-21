/*
 * The plain view.
 *
 * The curved wall is the front door, but it costs a WebGL context, two CDN
 * downloads and a drag gesture before you can read a single title. This is
 * the other option: one ordinary table of every experiment, sorted, filterable
 * by category, keyboard-navigable, and readable by anything that can render
 * HTML.
 *
 * It imports the catalogue and nothing else — no Three.js, no gsap, no
 * WebGL — which is why it can also stand in when the CDN is unreachable.
 */

import { EXPERIMENTS } from "./experiments.js";

const CATS = ["Physics", "Chemistry", "Biology"];

const METHOD_KEY = {
  measured: "methodMeasured", integrated: "methodIntegrated", solved: "methodSolved",
  formula: "methodFormula", model: "methodModel", illustrated: "methodIllustrated",
};

/*
 * A marker beside each method label. Six pills that differ only in hue are
 * six pills a colour-blind reader cannot tell apart, so the shape carries the
 * distinction and the colour only reinforces it: a filled dot for a
 * measurement, an integral sign for something stepped forward in time, an
 * approximation sign for a numerical solve, an equals sign for a closed form,
 * a solid diamond for a built structure, an empty circle for an illustration.
 *
 * Every glyph here is one upstream Pretendard actually has, and
 * tests/fonts.test.mjs walks the rendered table and fails on one that is not.
 * That walk reads textContent, which is also why these live in a <span> and
 * not a CSS ::before — a pseudo-element's glyph is invisible to it, and the
 * theme toggle already shipped two missing icons that way once.
 */
const METHOD_MARK = {
  measured: "●", integrated: "∫", solved: "≈",
  formula: "=", model: "◆", illustrated: "○",
};

/*
 * Which experiments a dedicated physics suite holds against a closed form.
 * Listed rather than derived because the browser cannot see the tests
 * directory — `tests/method-badges.test.mjs` fails if this drifts from what
 * is actually on disk, so the claim can never outrun the evidence.
 */
const VERIFIED = new Set([
  "experiments/cannon.html",
  "experiments/circuit.html", "experiments/decay.html", "experiments/diffraction.html",
  "experiments/atom.html", "experiments/crystal.html", "experiments/dna.html",
  "experiments/diode.html", "experiments/semiconductor.html",
  "experiments/blackhole.html", "experiments/solarsystem.html",
  "experiments/redox.html",
  "experiments/diffusion.html",
  "experiments/solar.html",
  "experiments/doppler.html",
  "experiments/molecule.html",
  "experiments/epidemic.html",
  "experiments/expression.html",
  "experiments/electrolysis.html",
  "experiments/enzyme.html", "experiments/gas.html", "experiments/generator.html",
  "experiments/impact.html", "experiments/kinetics.html",
  "experiments/equilibrium.html", "experiments/lens.html", "experiments/neuron.html",
  "experiments/lotka.html", "experiments/orbit.html", "experiments/pendulum.html",
  "experiments/phases.html",
  "experiments/photoelectric.html",
  "experiments/projectile.html", "experiments/refraction.html",
  "experiments/resonance.html",
  "experiments/selection.html", "experiments/spectra.html", "experiments/string.html",
  "experiments/titration.html",
  "experiments/wave.html",
]);
const CAT_KEY = {
  Physics: "categoryPhysics",
  Chemistry: "categoryChemistry",
  Biology: "categoryBiology",
};

const tr = (key, fallback) =>
  (window.i18n && window.i18n.t(key)) || fallback || key;

/*
 * The order the legend lists them in: most of the site first, least of it
 * last. `formula` has no pages at the moment and the legend leaves it out
 * rather than printing a category with nothing in it — add one and it
 * reappears on its own.
 */
const METHOD_ORDER = ["measured", "integrated", "solved", "formula", "model", "illustrated"];

/** A badge's shape marker: decorative, so the label is what gets read out. */
function mark(glyph) {
  const s = document.createElement("span");
  s.className = "method-mark";
  s.setAttribute("aria-hidden", "true");
  s.textContent = glyph || "";
  return s;
}

let filter = "All";
let root = null;

function counts() {
  const c = { All: EXPERIMENTS.length };
  for (const cat of CATS) c[cat] = EXPERIMENTS.filter((e) => e.cat === cat).length;
  return c;
}

function buildFilters() {
  const n = counts();
  const bar = document.createElement("div");
  bar.className = "tv-filters";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", tr("tvFilterLabel", "Filter by category"));
  for (const cat of ["All", ...CATS]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tv-filter" + (cat === filter ? " active" : "");
    b.dataset.cat = cat;
    b.setAttribute("aria-pressed", String(cat === filter));
    b.innerHTML =
      `<span>${cat === "All" ? tr("tvAll", "All") : tr(CAT_KEY[cat], cat)}</span>` +
      `<small>${n[cat]}</small>`;
    b.addEventListener("click", () => { filter = cat; render(); });
    bar.appendChild(b);
  }
  return bar;
}

function buildTable() {
  const rows = EXPERIMENTS
    .map((e, i) => ({ ...e, index: i }))
    .filter((e) => filter === "All" || e.cat === filter);

  const table = document.createElement("table");
  table.className = "tv-table";

  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr>" +
    `<th scope="col" class="tv-num">#</th>` +
    `<th scope="col">${tr("tvColExperiment", "Experiment")}</th>` +
    `<th scope="col">${tr("tvColCategory", "Category")}</th>` +
    `<th scope="col" class="tv-method">${tr("methodLegend", "How the numbers are produced")}</th>` +
    `<th scope="col" class="tv-tags">${tr("tvColTopics", "Topics")}</th>` +
    "</tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const e of rows) {
    const tr_ = document.createElement("tr");

    /*
     * The two colours the wall paints this experiment's card with, handed to
     * the stylesheet as custom properties: --row-a is the accent, --row-b the
     * deep base. The row's rail, its hover wash and its title on hover are all
     * mixed from them, so the table and the wall are recognisably one
     * catalogue rather than two lists that happen to agree.
     */
    const [deep, accent] = e.colors || [];
    if (accent) tr_.style.setProperty("--row-a", accent);
    if (deep) tr_.style.setProperty("--row-b", deep);

    const num = document.createElement("td");
    num.className = "tv-num";
    num.textContent = String(e.index + 1).padStart(2, "0");

    const name = document.createElement("td");
    name.className = "tv-name";
    const a = document.createElement("a");
    a.href = e.url;
    a.className = "tv-link";
    a.textContent = tr(e.titleKey, e.titleKey);
    // The whole row is clickable, but the anchor is what carries the
    // semantics — keyboard and screen readers get a real link, not a
    // click handler bolted onto a <tr>.
    name.appendChild(a);
    const desc = document.createElement("div");
    desc.className = "tv-desc";
    const descKey = e.titleKey.replace(/Title$/, "Desc");
    const d = window.i18n && window.i18n.t(descKey);
    if (d) desc.textContent = d;
    name.appendChild(desc);

    const cat = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = "tv-cat tv-cat-" + e.cat.toLowerCase();
    chip.textContent = tr(CAT_KEY[e.cat], e.cat);
    cat.appendChild(chip);

    // How the page produces its numbers, and whether a suite checks it.
    const method = document.createElement("td");
    method.className = "tv-method";
    const mTag = document.createElement("span");
    mTag.className = "method-tag";
    mTag.dataset.method = e.method;
    mTag.append(mark(METHOD_MARK[e.method]), tr(METHOD_KEY[e.method], e.method));
    mTag.title = tr(METHOD_KEY[e.method] + "Why", "");
    method.appendChild(mTag);
    if (VERIFIED.has(e.url)) {
      const v = document.createElement("span");
      v.className = "method-verified";
      v.append(mark("✓"), tr("methodVerified", "Verified"));
      v.title = tr("methodVerifiedWhy", "");
      method.appendChild(v);
    }

    const tags = document.createElement("td");
    tags.className = "tv-tags";
    tags.textContent = (e.tags || []).join(" · ");

    tr_.append(num, name, cat, method, tags);
    tr_.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;      // let the real link win
      location.href = e.url;
    });
    tbody.appendChild(tr_);
  }
  table.appendChild(tbody);
  return table;
}

/*
 * What the badges in the method column mean, spelled out on the page.
 *
 * They already carried an explanation, in a `title` tooltip — which is to say
 * they carried one for readers with a mouse and nobody else. A tooltip never
 * opens on a touchscreen, so on a phone the six badges were six words with no
 * way to find out what any of them claimed.
 *
 * The counts are taken from the catalogue rather than written down, so the
 * legend cannot come to disagree with the table above it, and a method with
 * no pages simply does not appear.
 */
function buildLegend() {
  const tally = {};
  for (const e of EXPERIMENTS) tally[e.method] = (tally[e.method] || 0) + 1;

  const sec = document.createElement("section");
  sec.className = "tv-legend";

  const h2 = document.createElement("h2");
  h2.textContent = tr("methodLegend", "How the numbers are produced");
  sec.appendChild(h2);

  const dl = document.createElement("dl");
  const row = (glyph, label, count, why, extra) => {
    const dt = document.createElement("dt");
    if (extra) dt.className = extra;
    dt.append(mark(glyph), label);
    if (count !== null) {
      const n = document.createElement("span");
      n.className = "tv-legend-n";
      n.textContent = String(count);
      dt.appendChild(n);
    }
    const dd = document.createElement("dd");
    dd.textContent = why;
    dl.append(dt, dd);
  };

  for (const m of METHOD_ORDER) {
    if (!tally[m]) continue;
    row(METHOD_MARK[m], tr(METHOD_KEY[m], m), tally[m], tr(METHOD_KEY[m] + "Why", ""));
  }
  // Verified is not a method but a second, independent claim, so it sits
  // apart from the six and is counted the same way the rows are marked.
  row("✓", tr("methodVerified", "Verified"),
      EXPERIMENTS.filter((e) => VERIFIED.has(e.url)).length,
      tr("methodVerifiedWhy", ""), "tv-legend-verified");

  sec.appendChild(dl);
  return sec;
}

function render() {
  if (!root) return;
  root.textContent = "";

  const head = document.createElement("header");
  head.className = "tv-head";
  const h1 = document.createElement("h1");
  h1.textContent = tr("pageTitle", "Science Lab");
  const p = document.createElement("p");
  p.textContent = tr("tvIntro",
    "Every experiment on one page. Pick a row to open it.");
  // The thing that makes this catalogue different from a list of animations,
  // said on the front door instead of only in the source.
  const principle = document.createElement("p");
  principle.className = "tv-principle";
  principle.textContent = tr("tvPrinciple", "");
  head.append(h1, p, principle);

  root.append(head, buildFilters(), buildTable(), buildLegend());
}

/** Mount the plain view into `el` and keep it in step with the language. */
export function mountTable(el) {
  root = el;
  render();
  document.addEventListener("langchange", render);
}
