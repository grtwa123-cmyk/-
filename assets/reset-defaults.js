/*
 * One meaning for "Reset", site-wide.
 *
 * The reset buttons had drifted into two different behaviours: on some pages
 * Reset restored the controls to their starting values, on others it only
 * restarted the run and left every slider wherever the reader had dragged it.
 * Same label, same placement, two outcomes — and no way to tell which you
 * were getting without trying it.
 *
 * Rather than hand-listing defaults in thirteen simulations (where they would
 * immediately drift out of step with the markup), this snapshots the control
 * state once the page has finished initialising and replays it on reset.
 * Deferred scripts have all run by DOMContentLoaded, so the snapshot is
 * exactly the state the reader first saw — including any adjustment a
 * simulation made to its own controls at start-up.
 *
 * It runs in the capture phase, so the controls are already back at their
 * defaults by the time the page's own reset handler reads them; that handler
 * still owns everything else about restarting the run.
 */

(() => {
  const snapshot = { fields: [], active: [] };

  function capture() {
    snapshot.fields = [...document.querySelectorAll("input, select")]
      .filter((el) => el.type !== "button" && el.type !== "submit")
      .map((el) => ({ el, value: el.value, checked: el.checked }));

    // Mode pickers keep their selection in a class, not a value, so record
    // which button was lit in each group.
    snapshot.active = [...document.querySelectorAll(".molecule-list, .mode-list")]
      .map((group) => ({ group, btn: group.querySelector(".mol-btn.active") }))
      .filter((g) => g.btn);
  }

  function restore() {
    for (const f of snapshot.fields) {
      const changed = f.el.type === "checkbox" || f.el.type === "radio"
        ? f.el.checked !== f.checked
        : f.el.value !== f.value;
      if (!changed) continue;
      f.el.checked = f.checked;
      f.el.value = f.value;
      f.el.dispatchEvent(new Event("input", { bubbles: true }));
      f.el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // Re-click the originally lit button so the page's own mode handler runs
    // and the visual state, aria-pressed and internal mode all move together.
    for (const g of snapshot.active) {
      if (!g.btn.classList.contains("active")) g.btn.click();
    }
  }

  function init() {
    capture();
    const btn = document.getElementById("reset-btn");
    if (btn) btn.addEventListener("click", restore, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
