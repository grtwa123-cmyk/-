/*
 * The quality setting — how finely a simulation steps, never what it finds.
 *
 * Every stochastic page here advances by a fixed time step, and the step is a
 * compromise: fine enough that the counted statistics land on their closed
 * forms, coarse enough that a phone animates smoothly. "Fine" moves that
 * compromise the other way, like running the same experiment on better
 * instruments — the gene-expression field steps at 0.4ms-of-cell-time
 * instead of 1, the epidemic's first-order recovery roll shrinks from
 * γ·0.05 per step to γ·0.02, the decay sub-step cap drops from 5% of a
 * half-life to 2%.
 *
 * Two promises, and the tests hold both:
 *
 *   · The answers do not move. A finer step sharpens the agreement with the
 *     closed forms; it must never be needed for it. tests/quality.test.mjs
 *     re-runs the physics at Fine against the same tolerances the standard
 *     suites use.
 *   · The pace does not move. Pages scale their steps-per-frame by the step
 *     ratio, so Fine costs CPU, not patience.
 *
 * The control mounts only on pages that actually consult the setting — a
 * quality toggle on a page it cannot affect would be furniture. Pages opt in
 * by loading this script; the setting itself is shared through localStorage
 * like the theme, because "how carefully should this site simulate" is a
 * property of the reader's machine, not of one experiment.
 */
(() => {
  "use strict";

  const KEY = "quality";
  const LEVELS = ["standard", "fine"];

  let level = (() => {
    try {
      const saved = localStorage.getItem(KEY);
      return LEVELS.includes(saved) ? saved : "standard";
    } catch { return "standard"; }
  })();

  function set(next) {
    if (!LEVELS.includes(next) || next === level) return;
    level = next;
    try { localStorage.setItem(KEY, level); } catch { /* private mode */ }
    document.dispatchEvent(new CustomEvent("qualitychange", { detail: { level } }));
  }

  window.Quality = {
    get level() { return level; },
    /** The fidelity fork every consumer reads: pick(standard, fine). */
    pick(standard, fine) { return level === "fine" ? fine : standard; },
    set,
    toggle() { set(level === "fine" ? "standard" : "fine"); },
  };

  // ── The control ──────────────────────────────────────────────────────────
  // Written as literal key strings, not "quality" + level: tools/split-i18n.py
  // reads literals, and a concatenated key would need another declared rule.
  const LEVEL_KEY = { standard: "qualityStandard", fine: "qualityFine" };
  const FALLBACK = { standard: "Standard", fine: "Fine" };
  const ICON = { standard: "◇", fine: "◆" };   // ◇ / ◆

  function mount() {
    const row = document.querySelector(".chrome-row") ||
                document.querySelector(".lang-switch")?.parentNode;
    if (!row || document.querySelector(".quality-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    // The theme button's styling wholesale; its own class for the tests.
    btn.className = "theme-btn quality-btn";
    const icon = document.createElement("span");
    icon.className = "theme-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "theme-label";
    btn.append(icon, text);

    const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
    const paint = () => {
      icon.textContent = ICON[level];
      text.textContent = t(LEVEL_KEY[level], FALLBACK[level]);
      const name = t("qualityLabel", "Simulation quality");
      btn.setAttribute("aria-label", `${name}: ${text.textContent}`);
      btn.title = `${name} — ${t("qualityWhy",
        "Fine steps the simulation more finely. Same physics, sharper statistics, more CPU.")}`;
    };

    btn.addEventListener("click", () => {
      window.Quality.toggle();
      paint();
      window.SFX?.tone({ freq: 640, dur: 0.06, type: "triangle", gain: 0.09 });
    });
    document.addEventListener("qualitychange", paint);
    document.addEventListener("langchange", paint);
    paint();

    const theme = row.querySelector(".theme-btn:not(.quality-btn)");
    if (theme && theme.nextSibling) row.insertBefore(btn, theme.nextSibling);
    else row.appendChild(btn);
  }

  // Deferred scripts run BEFORE DOMContentLoaded, and theme.js only builds
  // the chrome row when that event fires — so mounting eagerly here landed
  // the button in the fallback slot at the bottom of the container. Wait for
  // the event unless it has already passed: our listener registers after
  // theme.js's, so the row exists by the time this one runs.
  if (document.readyState === "complete") {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
