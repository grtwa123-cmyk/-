/*
 * Translation runtime — loader plus the binding it drives.
 *
 * The dictionaries used to live in this file: three languages, every key in
 * all of them, shipped to every page so that any one reader could use a third
 * of it. They now sit in i18n/<lang>.js and only the active language is
 * fetched — a little over 27 KB gzipped rather than three times that.
 *
 * Only the active language, and now only the active page. A page displays
 * between 5 and 115 of the 1333 keys, so it loads i18n/pages/<lang>/<page>.js
 * — a few kilobytes instead of 98 — cut by tools/split-i18n.py from the same
 * dictionaries, which stay in the repo as the fallback below.
 *
 * That fallback is what makes the split safe to get wrong. The chunks are cut
 * by reading source, and source can be read imperfectly: a key assembled at
 * runtime is invisible to a literal scan. So a key that misses its chunk
 * fetches the whole dictionary and repaints, and the page is merely slower
 * rather than showing a reader a raw key name. tests/i18n.test.mjs asserts the
 * net never fires — every experiment suite drives its page's controls, which
 * is what reaches the keys a passive page load never asks for — so a chunk
 * that is short is a test failure, not a silent tax on the reader.
 *
 * The dictionary is pulled in with an injected classic <script> rather than
 * import() or fetch(), because both of those are blocked under file:// and the
 * README promises that opening index.html directly works.
 *
 * Nothing here falls back from one language to another any more. It used to,
 * because the dictionaries could drift; now `npm test` fails if the three key
 * sets are not identical, so the fallback would be dead code hiding a bug that
 * is already caught. Where a key really is missing the element keeps the
 * English already in the markup, which beats a raw key name on screen.
 */

(() => {
  const LANGS = ["en", "ko", "zh"];

  // Resolve dictionaries against this script, not the page: the experiment
  // pages live a directory down and load us as "../i18n.js".
  const BASE = (() => {
    const src = document.currentScript && document.currentScript.src;
    return src ? src.replace(/[^/]*$/, "") : "";
  })();

  /*
   * Which chunk this page wants. The name is the file's own, so /index.html,
   * /experiments/wave.html and a directory URL ending in / all land on the
   * chunk tools/split-i18n.py wrote for them. Basenames are unique across the
   * site, so the directory does not need to be part of it.
   */
  const PAGE = (() => {
    const last = location.pathname.split("/").pop();
    return last && last.endsWith(".html") ? last.slice(0, -5) : "index";
  })();

  const translations = Object.create(null);
  const pending = Object.create(null);
  // Which languages have the whole dictionary rather than just this page's
  // slice, so the fallback is attempted once and never loops.
  const complete = Object.create(null);

  /*
   * Called by every i18n file as it executes. Merged rather than assigned: a
   * language can arrive in two pieces, the page's chunk first and the full
   * dictionary afterwards if something asked for a key the chunk lacked.
   */
  window.i18nRegister = (lang, dict) => {
    translations[lang] = Object.assign(translations[lang] || Object.create(null), dict);
  };

  function inject(src, done) {
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.onload = () => done(true);
    // A dictionary that fails to load leaves the markup's English in place
    // rather than blanking the page.
    el.onerror = () => done(false);
    document.head.appendChild(el);
  }

  /** Fetch a language once; callers queue up behind an in-flight load. */
  function loadLang(lang, done) {
    if (translations[lang]) { done(true); return; }
    if (pending[lang]) { pending[lang].push(done); return; }
    pending[lang] = [done];

    const finish = (ok) => {
      const queue = pending[lang] || [];
      delete pending[lang];
      for (const cb of queue) cb(ok);
    };

    inject(`${BASE}i18n/pages/${lang}/${PAGE}.js`, (ok) => {
      if (ok && translations[lang]) { finish(true); return; }
      // No chunk for this page — a new page whose chunk has not been
      // generated yet. The whole dictionary is always there.
      loadFull(lang, () => finish(Boolean(translations[lang])));
    });
  }

  /** Pull in the whole dictionary for a language, at most once. */
  function loadFull(lang, done) {
    if (complete[lang]) { if (done) done(); return; }
    complete[lang] = true;
    inject(`${BASE}i18n/${lang}.js`, () => { if (done) done(); });
  }

  /*
   * Keys the page asked for that its chunk did not have. Kept for
   * tests/i18n.test.mjs, which fails if any page fills this in: every entry
   * is a reader waiting on a second request for a string that should have
   * shipped with the first.
   */
  const misses = [];
  window.__i18nMisses = misses;

  function noteMiss(key) {
    if (misses.indexOf(key) === -1) misses.push(key);
    if (complete[current]) return;
    loadFull(current, () => paint(current));
  }

  function getStoredLang() {
    try { return localStorage.getItem("lang"); } catch (_) { return null; }
  }

  function setStoredLang(lang) {
    try { localStorage.setItem("lang", lang); } catch (_) {}
  }

  function detectLang() {
    const saved = getStoredLang();
    if (saved && LANGS.includes(saved)) return saved;
    const prefs = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language];
    for (const tag of prefs) {
      if (!tag) continue;
      const lower = tag.toLowerCase();
      if (lower.startsWith("ko")) return "ko";
      if (lower.startsWith("zh")) return "zh";
      if (lower.startsWith("en")) return "en";
    }
    return "en";
  }

  let current = detectLang();

  /**
   * Undefined, not the key, when there is no translation — every caller is
   * written as `t(key) || fallback`, and the dictionary is now loaded
   * asynchronously, so returning the key would paint "mmRateAxis" onto a
   * canvas during the moment before it arrives.
   */
  function t(key) {
    const dict = translations[current];
    if (!dict) return undefined;            // not loaded yet, not a miss
    if (key in dict) return dict[key];
    noteMiss(key);
    return undefined;
  }

  /** Paint the active dictionary onto the document. */
  function paint(lang) {
    const dict = translations[lang];
    document.documentElement.lang = lang;

    if (dict) {
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.dataset.i18n;
        const val = dict[key];
        // Keep the English in the markup, and say so: a data-i18n key the
        // chunk does not carry is the same defect as one t() could not find.
        if (val === undefined) { noteMiss(key); return; }
        if (el.tagName === "TITLE") document.title = val;
        else el.textContent = val;
      });
      // An aria-label is text a screen reader speaks, so it needs translating
      // too. Sliders and icon buttons carry one where no visible label fits.
      document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
        const val = dict[el.dataset.i18nAria];
        if (val !== undefined) el.setAttribute("aria-label", val);
      });
      // Likewise a title: the method badges put their whole explanation there.
      document.querySelectorAll("[data-i18n-title]").forEach((el) => {
        const val = dict[el.dataset.i18nTitle];
        if (val !== undefined) el.setAttribute("title", val);
      });
    }

    document.querySelectorAll(".lang-btn").forEach((btn) => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  function applyLang(lang, done) {
    if (!LANGS.includes(lang)) lang = "en";
    current = lang;
    setStoredLang(lang);
    loadLang(lang, () => { paint(lang); if (done) done(); });
  }

  window.i18n = {
    t,
    applyLang,
    getLang: () => current,
    /** Languages that have a dictionary — useful for building UI. */
    languages: () => LANGS.slice(),
    /** Resolves once the active dictionary is in place. */
    ready: () => new Promise((res) => loadLang(current, res)),
  };

  function init() {
    applyLang(current);
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.dataset.lang;
        // Silently ignore unknown languages — buttons for them shouldn't
        // have been rendered in the first place.
        if (LANGS.includes(lang)) applyLang(lang);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
