/*
 * Translation runtime — loader plus the binding it drives.
 *
 * The dictionaries used to live in this file: three languages, every key in
 * all of them, shipped to every page so that any one reader could use a third
 * of it. They now sit in i18n/<lang>.js and only the active language is
 * fetched — a little over 27 KB gzipped rather than three times that.
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

  const translations = Object.create(null);
  const pending = Object.create(null);

  // Called by each i18n/<lang>.js as it executes.
  window.i18nRegister = (lang, dict) => { translations[lang] = dict; };

  /** Fetch a dictionary once; callers queue up behind an in-flight load. */
  function loadLang(lang, done) {
    if (translations[lang]) { done(true); return; }
    if (pending[lang]) { pending[lang].push(done); return; }
    pending[lang] = [done];

    const finish = (ok) => {
      const queue = pending[lang] || [];
      delete pending[lang];
      for (const cb of queue) cb(ok);
    };

    const el = document.createElement("script");
    el.src = `${BASE}i18n/${lang}.js`;
    el.async = false;
    el.onload = () => finish(Boolean(translations[lang]));
    // A dictionary that fails to load leaves the markup's English in place
    // rather than blanking the page.
    el.onerror = () => finish(false);
    document.head.appendChild(el);
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
    return dict ? dict[key] : undefined;
  }

  /** Paint the active dictionary onto the document. */
  function paint(lang) {
    const dict = translations[lang];
    document.documentElement.lang = lang;

    if (dict) {
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const val = dict[el.dataset.i18n];
        if (val === undefined) return;      // keep the English in the markup
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
