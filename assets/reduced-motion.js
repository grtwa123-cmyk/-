/*
 * Honour prefers-reduced-motion on the canvas simulations.
 *
 * styles.css already flattens CSS animations and transitions, which is easy to
 * mistake for coverage — but every simulation here paints from a
 * requestAnimationFrame loop, and CSS cannot touch that. Twenty-seven of the
 * thirty experiments therefore kept animating at full tilt for a reader who
 * had asked the whole system to stop moving things.
 *
 * The gate is at requestAnimationFrame rather than inside each simulation, for
 * two reasons: the thirty loops compute time three different ways (the rAF
 * timestamp, performance.now(), and not at all), and a per-file edit thirty
 * times over is thirty chances to get one wrong.
 *
 * While gated:
 *
 *   - callbacks receive a frozen timestamp, so every loop that derives dt from
 *     it advances by zero and the simulation holds still;
 *   - the callback is always invoked, never skipped. These loops reschedule
 *     themselves from inside the callback, so skipping one does not pause the
 *     loop, it ends it — and then there is nothing left for Play to restart.
 *     Freezing the clock stops the motion; withholding the call breaks it.
 *   - the canvas is therefore painted and stays responsive to the controls.
 *
 * Pressing Play lifts the gate completely and the page behaves exactly as it
 * did before. For a reader who has not set the preference this file does
 * nothing at all — it returns before touching anything.
 */

(() => {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  if (!query.matches) return;

  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);

  let gated = true;
  // Every gated callback sees this same timestamp, so dt is exactly zero.
  const frozenTs = performance.now();

  window.requestAnimationFrame = function (cb) {
    if (!gated) return nativeRaf(cb);
    // Re-check on the way out: Play may have been pressed since scheduling.
    return nativeRaf(() => cb(gated ? frozenTs : performance.now()));
  };
  window.cancelAnimationFrame = nativeCancel;

  // A couple of simulations read the wall clock inside their frame instead of
  // taking the timestamp they are handed, so they cannot be stopped by
  // freezing it. They ask here instead.
  window.ReducedMotion = {
    get active() { return gated; },
    /** Seconds to use as an animation clock — frozen while gated. */
    clock: () => (gated ? 0 : performance.now() / 1000),
  };

  // ── The control ─────────────────────────────────────────────────────────
  function mount() {
    const stage = document.querySelector(".stage");
    const bar = document.createElement("div");
    bar.className = "motion-notice";
    bar.setAttribute("role", "status");

    const text = document.createElement("span");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "motion-notice-btn";

    const label = () => {
      const t = window.i18n && window.i18n.t;
      text.textContent = t
        ? (t(gated ? "motionPaused" : "motionPlaying") || fallbackText())
        : fallbackText();
      btn.textContent = t
        ? (t(gated ? "motionPlay" : "motionPause") || (gated ? "Play" : "Pause"))
        : (gated ? "Play" : "Pause");
      btn.setAttribute("aria-pressed", String(!gated));
    };
    const fallbackText = () => gated
      ? "Animation paused — your system asks for reduced motion."
      : "Animation running.";

    btn.addEventListener("click", () => {
      gated = !gated;
      label();
    });

    label();
    document.addEventListener("langchange", label);
    bar.append(text, btn);

    if (stage) {
      stage.prepend(bar);
    } else {
      /*
       * The two full-bleed 3D pages have no .stage, and body is not a column
       * that can absorb an extra row: their canvas is sized in script to
       * exactly window.innerHeight, and html and body are overflow:hidden.
       * Prepending the bar to body therefore pushed the whole scene down by
       * the bar's height and put its bottom edge off a screen that will not
       * scroll — twenty-one pixels of black hole that no reader could ever
       * reach. It also hung the catalogue sweep, whose screenshot waited out
       * its timeout trying to scroll a canvas into view on a page that
       * cannot scroll.
       *
       * So on those pages it floats instead of displacing. It is deliberately
       * over the scene rather than beside it: both pages have their own
       * controls along the top and the bottom, and there is no free corner
       * on both. A bar sitting over the picture can be read and dismissed;
       * a picture with its bottom cut off cannot be fixed by the reader.
       */
      bar.style.position = "fixed";
      bar.style.zIndex = "300";
      bar.style.left = "50%";
      bar.style.bottom = "calc(50% + 120px)";
      bar.style.transform = "translateX(-50%)";
      bar.style.margin = "0";
      document.body.prepend(bar);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
