/*
 * Light / dark theme.
 *
 * Three states, not two: "auto" follows the operating system, and the two
 * explicit settings override it. Auto is the default, so a reader who has told
 * their machine they want light pages gets light pages without asking twice.
 *
 * This file is loaded *blocking* from <head>, before any stylesheet has
 * painted, because the alternative is a flash of the wrong theme on every
 * navigation. It is a few hundred bytes and does no layout work, so the cost
 * of blocking is smaller than the cost of the flash. Everything that needs the
 * DOM — the toggle button — waits for DOMContentLoaded.
 *
 * What it settles on is stamped as data-theme-mode on <html>, so CSS never has
 * to reason about "auto": there are exactly two cases to style. The stylesheets
 * also carry a prefers-color-scheme fallback for the case where this script
 * fails to load at all.
 *
 * The simulation canvases stay dark in both themes, on purpose: they are
 * instruments, and their colours are data — a spectral line, a pole of a
 * magnet, a species in a population — chosen against a dark field. In light
 * mode they get a frame instead, so they read as a screen set into the page
 * rather than a hole in it. `themechange` is dispatched for anything that
 * later wants to follow the theme into a canvas.
 */

(() => {
  const KEY = "theme";
  const MODES = ["auto", "light", "dark"];
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: light)");

  let mode = "auto";
  try {
    const saved = localStorage.getItem(KEY);
    if (MODES.includes(saved)) mode = saved;
  } catch { /* private mode: fall back to auto */ }

  const resolve = (m) => (m === "auto" ? (media.matches ? "light" : "dark") : m);

  function apply(next, { save = true, announce = true } = {}) {
    mode = MODES.includes(next) ? next : "auto";
    const resolved = resolve(mode);
    root.dataset.themeMode = resolved;
    root.dataset.themePref = mode;
    // Lets the browser theme scrollbars, form controls and the caret to match.
    root.style.colorScheme = resolved;
    if (save) {
      try { localStorage.setItem(KEY, mode); } catch { /* nothing to do */ }
    }
    if (announce) {
      document.dispatchEvent(new CustomEvent("themechange", {
        detail: { mode, resolved },
      }));
    }
    return resolved;
  }

  // Stamp before first paint. No event yet — nothing is listening this early.
  apply(mode, { save: false, announce: false });

  // Following the system only means anything if it keeps following it.
  const onSystemChange = () => { if (mode === "auto") apply("auto", { save: false }); };
  if (media.addEventListener) media.addEventListener("change", onSystemChange);
  else if (media.addListener) media.addListener(onSystemChange);

  const Theme = {
    get: () => mode,
    resolved: () => resolve(mode),
    isLight: () => resolve(mode) === "light",
    set: (m) => apply(m),
    /** auto → light → dark → auto. */
    cycle: () => apply(MODES[(MODES.indexOf(mode) + 1) % MODES.length]),
  };
  window.Theme = Theme;

  // ── The toggle ───────────────────────────────────────────────────────────
  // Injected next to the language switcher rather than written into all forty
  // pages by hand, so there is one definition of what the control is and no
  // page can drift from it.
  const LABEL = { auto: "Auto", light: "Light", dark: "Dark" };
  /*
   * The icon shows what the theme currently *is*, and the word shows what was
   * asked for — so in auto you can see which way it resolved, which the mode
   * name alone cannot tell you.
   *
   * Both glyphs are in the shipped Pretendard subset. The first attempt used
   * \u25D0, \u2600 and \u263E for the three modes; Pretendard has no \u25D0 or
   * \u263E at all, so two of the three silently rendered in whatever face the
   * OS substituted. tests/fonts.test.mjs now checks the glyphs the chrome
   * actually renders, not only the ones in the dictionaries.
   */
  // Written as literal glyphs, not \u escapes: tools/build-font.py decides
  // what goes in the subset by scanning this source, and an escape is six
  // ASCII characters to a scanner. The escapes in the comment above are
  // deliberately left escaped — those glyphs are absent and must not be
  // requested.
  const ICON = { light: "☀", dark: "●" };

  function label(m) {
    const t = window.i18n && window.i18n.t;
    return (t && (t("theme" + m[0].toUpperCase() + m.slice(1)))) || LABEL[m];
  }

  function mount() {
    const anchor = document.querySelector(".lang-switch");
    if (!anchor || document.querySelector(".theme-btn")) return;

    // Wrap the language group and the new button in one row rather than
    // floating the button over the top of it. Pulling an absolutely- or
    // negatively-positioned control onto someone else's line only holds until
    // the line changes height.
    const row = document.createElement("div");
    row.className = "chrome-row";
    anchor.parentNode.insertBefore(row, anchor);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-btn";
    const icon = document.createElement("span");
    icon.className = "theme-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "theme-label";
    btn.append(icon, text);

    const paint = () => {
      icon.textContent = ICON[resolve(mode)];
      text.textContent = label(mode);
      const t = window.i18n && window.i18n.t;
      const name = (t && t("themeLabel")) || "Theme";
      btn.setAttribute("aria-label", `${name}: ${label(mode)}`);
      btn.title = `${name}: ${label(mode)}`;
    };

    btn.addEventListener("click", () => {
      Theme.cycle();
      paint();
      window.SFX?.tone({ freq: 520, dur: 0.06, type: "triangle", gain: 0.09 });
    });
    // Repaint on themechange, not only on click: the preference also moves
    // when the operating system flips while we are following it, and the label
    // would otherwise sit there claiming the old setting.
    document.addEventListener("themechange", paint);
    document.addEventListener("langchange", paint);
    paint();

    row.append(btn, anchor);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
