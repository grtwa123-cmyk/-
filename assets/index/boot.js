/*
 * View chooser for the landing page.
 *
 * Two ways in, remembered between visits:
 *
 *   wall   the curved Three.js index — the front door
 *   table  one ordinary table of every experiment
 *
 * The choice is made *before* anything heavy loads, which is the point of
 * doing it here rather than inside main.js: in table mode neither Three.js
 * nor gsap is ever requested, so the page needs no CDN, no WebGL context and
 * no drag gesture. That also makes the table the honest fallback when the
 * wall cannot start — a blocked CDN now lands on the full catalogue instead
 * of three hub links.
 */

import { mountTable } from "./table-view.js";

const KEY = "ui-mode";
const GSAP_SRC = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";

const scene = document.getElementById("scene");
const tableRoot = document.getElementById("tableView");
const loader = document.getElementById("loader");
const switcher = document.getElementById("uiSwitch");

const read = () => {
  try { return localStorage.getItem(KEY); } catch (_) { return null; }
};
const write = (v) => {
  try { localStorage.setItem(KEY, v); } catch (_) {}
};

let mode = read() === "table" ? "table" : "wall";
let wallStarted = false;
let tableMounted = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

function showTable() {
  document.body.classList.add("ui-table");
  if (scene) scene.hidden = true;
  tableRoot.hidden = false;
  if (loader) loader.classList.add("gone");
  if (!tableMounted) { mountTable(tableRoot); tableMounted = true; }
}

async function startWall() {
  document.body.classList.remove("ui-table");
  tableRoot.hidden = true;
  if (scene) scene.hidden = false;
  if (wallStarted) return;
  wallStarted = true;
  try {
    await loadScript(GSAP_SRC);
    await import("./main.js");
  } catch (err) {
    // The wall needs the CDN. If it cannot be reached, say so once and hand
    // the reader the plain view rather than a spinner that never finishes.
    console.error(err);
    wallStarted = false;
    mode = "table";
    showTable();
    paint();
    const note = document.getElementById("uiFallbackNote");
    if (note) note.hidden = false;
  }
}

function paint() {
  if (!switcher) return;
  switcher.querySelectorAll("[data-ui]").forEach((b) => {
    const on = b.dataset.ui === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function apply() {
  paint();
  if (mode === "table") showTable();
  else startWall();
}

if (switcher) {
  switcher.querySelectorAll("[data-ui]").forEach((b) => {
    b.addEventListener("click", (ev) => {
      const next = b.dataset.ui;
      if (next === mode) return;
      mode = next;
      /*
       * Only a real click is a choice.
       *
       * index.html gives up on the wall after eight seconds and recovers by
       * calling .click() on the table button — which came through here and
       * was written down as the reader's preference. One slow load, one
       * captive portal, one CDN hiccup, and the wall was off permanently:
       * the stored choice outlived the outage that caused it, and the next
       * visit went straight to the table with the network working perfectly.
       * Reproduced by loading once with the CDN unreachable and again with
       * it reachable — the second visit still showed the table.
       *
       * isTrusted is exactly this distinction: true for a person, false for
       * element.click(). The fallback still switches the view, it just does
       * not claim the reader asked for it.
       */
      if (ev.isTrusted) write(mode);
      const note = document.getElementById("uiFallbackNote");
      if (note) note.hidden = true;
      // The wall builds a scene graph and installs global listeners at import
      // time and has no teardown, so switching back to it after it has been
      // hidden is a reload rather than a re-mount.
      if (mode === "wall" && !wallStarted) apply();
      else if (mode === "wall") location.reload();
      else apply();
    });
  });
}

apply();
