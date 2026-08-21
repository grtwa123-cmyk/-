/*
 * The address bar as the experiment's state.
 *
 * Every page here is a set of controls and a picture that answers to them, and
 * until now there was no way to hand someone the answer. "Set the slits to six
 * and the separation to 300 and look at what happens to order five" is a worse
 * message than a link. So the query string mirrors the controls: drag a slider
 * and the URL updates, paste that URL and the page comes back the way it was.
 *
 * Nothing is listed here per page. The controls are whatever form elements the
 * page has with an id, the same way assets/reset-defaults.js finds them — a
 * hand-written list of thirty-six pages' sliders would be out of date within a
 * week.
 *
 * Three rules keep the URLs worth sharing:
 *
 *   · only values that differ from the page's own defaults are written, so a
 *     page you have not touched has a clean URL and a shared one carries only
 *     the part that matters
 *   · replaceState, never pushState — dragging a slider should not fill the
 *     back button with a hundred entries
 *   · the URL is re-derived *after* the page has reacted, so a setting the
 *     page clamps or overrides is recorded as what it actually became rather
 *     than as what was asked for
 *
 * And the query string is untrusted input like any other. Every value is
 * checked against the control it names — range and number against min, max and
 * step, select against its own options, checkbox against a fixed pair — and
 * anything that does not fit is dropped rather than forced. It is only ever
 * assigned to `.value`, never to markup.
 *
 * Load order matters: this has to come after reset-defaults.js, whose snapshot
 * must be the page's own defaults and not whatever a link happened to carry.
 * Both listen on DOMContentLoaded, which fires listeners in the order they
 * were registered, so the script tags decide it.
 */

(() => {
  const WRITE_DELAY = 120;      // sliders fire continuously; coalesce the writes
  const MAX_VALUE = 64;         // no legitimate control value is longer

  /**
   * The controls a URL may address: form elements with an id, excluding the
   * ones that are actions rather than state. A control opts out with
   * data-url="skip".
   */
  function controls() {
    return [...document.querySelectorAll("input[id], select[id]")].filter(
      (el) => !["button", "submit", "reset", "file", "hidden"].includes(el.type)
        && el.dataset.url !== "skip");
  }

  const read = (el) => (el.type === "checkbox" || el.type === "radio"
    ? (el.checked ? "1" : "0") : el.value);

  /**
   * Put a value on a control, or refuse to.
   *
   * Returns whether it took. A range whose value the browser silently corrects
   * — out of bounds, off the step grid — is a refusal, not a success: writing
   * it back would make the URL claim something the page is not doing.
   */
  function apply(el, raw) {
    if (typeof raw !== "string" || raw.length > MAX_VALUE) return false;

    if (el.type === "checkbox" || el.type === "radio") {
      if (raw !== "0" && raw !== "1") return false;
      const want = raw === "1";
      if (el.checked === want) return false;
      el.checked = want;
      return true;
    }

    if (el.tagName === "SELECT") {
      if (![...el.options].some((o) => o.value === raw)) return false;
      if (el.value === raw) return false;
      el.value = raw;
      return true;
    }

    if (el.type === "range" || el.type === "number") {
      const v = Number(raw);
      if (!Number.isFinite(v)) return false;
      const min = el.min === "" ? -Infinity : Number(el.min);
      const max = el.max === "" ? Infinity : Number(el.max);
      if (v < min || v > max) return false;
      const before = el.value;
      el.value = raw;
      // The browser snaps a range to its step. If it moved the value, the URL
      // asked for something off the grid and does not get to claim it.
      if (Number(el.value) !== v) { el.value = before; return false; }
      return el.value !== before;
    }

    // Free text. The markup already says what it will accept — the DNA
    // sequence field carries pattern="[ACGTacgt]*" and maxlength="30" — so
    // honour that rather than inventing a second, looser rule here.
    const cap = Number(el.maxLength);
    if (cap > 0 && raw.length > cap) return false;
    if (el.pattern) {
      let ok = false;
      try { ok = new RegExp(`^(?:${el.pattern})$`, "u").test(raw); } catch (e) { ok = false; }
      if (!ok) return false;
    }
    if (el.value === raw) return false;
    el.value = raw;
    return true;
  }

  const fire = (el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  function init() {
    const list = controls();
    if (!list.length) return;

    // The defaults, taken before anything from the URL touches them. This runs
    // on DOMContentLoaded, by which point every deferred script has executed,
    // so it includes any adjustment a page made to its own controls at
    // start-up — phases picks a preset, and its temperature is 0.15 here, not
    // the 0.3 in the markup. Running any earlier read the markup instead and
    // then lost the URL's value to the preset a moment later.
    const defaults = new Map(list.map((el) => [el.id, read(el)]));

    const write = () => {
      const q = new URLSearchParams();
      for (const el of list) {
        const v = read(el);
        if (v !== defaults.get(el.id)) q.set(el.id, v);
      }
      const s = q.toString();
      const next = location.pathname + (s ? "?" + s : "") + location.hash;
      if (next === location.pathname + location.search + location.hash) return;
      try {
        history.replaceState(history.state, "", next);
      } catch (e) { /* file:// and other opaque origins refuse; harmless */ }
    };

    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(write, WRITE_DELAY);
    };

    // Apply whatever the URL carried, in document order so a page that derives
    // one control from another sees them in the order it laid them out.
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      params = new URLSearchParams();
    }
    if ([...params.keys()].length) {
      const touched = [];
      for (const el of list) {
        if (!params.has(el.id)) continue;
        if (apply(el, params.get(el.id))) touched.push(el);
      }
      for (const el of touched) fire(el);
      // Re-derive from what the page settled on, which drops anything it
      // clamped, ignored or is simply not offering.
      if (touched.length) schedule(); else write();
    }

    document.addEventListener("input", schedule, true);
    document.addEventListener("change", schedule, true);

    // Exposed so the checks can drive it without racing the debounce.
    window.__urlState = { controls: () => list, defaults, write, read, apply };
  }

  // Deferred scripts execute at readyState "interactive", NOT "loading" —
  // parsing is finished and DOMContentLoaded has not fired yet. So the old
  // guard's else-branch ran init() at this script's own turn, third of five,
  // before the page's own script had touched anything. DOMContentLoaded is
  // what actually waits for the rest of them.
  if (document.readyState === "complete") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
