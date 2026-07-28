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
const CAT_KEY = {
  Physics: "categoryPhysics",
  Chemistry: "categoryChemistry",
  Biology: "categoryBiology",
};

const tr = (key, fallback) =>
  (window.i18n && window.i18n.t(key)) || fallback || key;

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
    `<th scope="col" class="tv-tags">${tr("tvColTopics", "Topics")}</th>` +
    "</tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const e of rows) {
    const tr_ = document.createElement("tr");

    const num = document.createElement("td");
    num.className = "tv-num";
    num.textContent = String(e.index + 1).padStart(2, "0");

    const name = document.createElement("td");
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

    const tags = document.createElement("td");
    tags.className = "tv-tags";
    tags.textContent = (e.tags || []).join(" · ");

    tr_.append(num, name, cat, tags);
    tr_.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;      // let the real link win
      location.href = e.url;
    });
    tbody.appendChild(tr_);
  }
  table.appendChild(tbody);
  return table;
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
  head.append(h1, p);

  root.append(head, buildFilters(), buildTable());
}

/** Mount the plain view into `el` and keep it in step with the language. */
export function mountTable(el) {
  root = el;
  render();
  document.addEventListener("langchange", render);
}
