(() => {
  const translations = {
    en: {
      pageTitle: "Science Experiments",
      heroTitle: "Science Experiments",
      heroSubtitle: "Interactive physics simulations you can poke at in the browser.",
      projectileTitle: "Projectile Motion",
      projectileDesc: "Launch a projectile with adjustable velocity, angle, and gravity. Watch the parabolic trajectory and live readouts.",
      pendulumTitle: "Pendulum",
      pendulumDesc: "Swing a pendulum with adjustable length, gravity, initial angle, and damping.",
      orbitsTitle: "Gravity & Orbits",
      orbitsDesc: "Drag a planet to set its initial velocity around a star. Coming soon.",
      waveTitle: "Wave Interference",
      waveDesc: "Two sources, adjustable frequency, visible interference pattern. Coming soon.",
      tagOpen: "Open",
      tagSoon: "Coming soon",

      projectilePageTitle: "Projectile Motion · Science Experiments",
      backToHub: "← Back to hub",
      experimentCount: "Experiment 1 of 4",
      projectileIntro: "Adjust the launch parameters and click Launch to fire the projectile.",
      controls: "Controls",
      velocityLabel: "Initial velocity v₀",
      angleLabel: "Launch angle θ",
      gravityLabel: "Gravity g",
      launchBtn: "Launch",
      launchingBtn: "Launching…",
      resetBtn: "Reset",
      formulas: "Formulas",
      formulaRange: "Range",
      formulaMaxHeight: "Max height",
      formulaTime: "Time of flight",
      formulaPosition: "Position",
      outRange: "Range",
      outHeight: "Max height",
      outTime: "Time of flight",
      outT: "Current t",
      outX: "Current x",
      outY: "Current y",
      outSpeed: "Speed",

      pendulumPageTitle: "Pendulum · Science Experiments",
      experimentCount2: "Experiment 2 of 4",
      pendulumIntro: "Adjust the length, gravity, initial angle, and damping. Press Start to set it swinging.",
      lengthLabel: "Length L",
      initialAngleLabel: "Initial angle θ₀",
      dampingLabel: "Damping b",
      startBtn: "Start",
      pauseBtn: "Pause",
      formulaPeriod: "Period (small angle)",
      formulaEom: "Equation of motion",
      outPeriod: "Period",
      outAngle: "Angle",
      outAngVel: "Angular velocity",
      outTime: "Elapsed time",
    },
    ko: {
      pageTitle: "과학 실험",
      heroTitle: "과학 실험",
      heroSubtitle: "브라우저에서 직접 조작해볼 수 있는 물리 시뮬레이션 모음.",
      projectileTitle: "포물선 운동",
      projectileDesc: "속도, 각도, 중력을 조절해 발사체를 쏘아 올려보세요. 포물선 궤적과 실시간 측정값을 확인할 수 있습니다.",
      pendulumTitle: "진자",
      pendulumDesc: "길이, 중력, 초기 각도, 감쇠를 조절할 수 있는 진자.",
      orbitsTitle: "중력과 궤도",
      orbitsDesc: "행성을 드래그해 항성 주위 초기 속도를 설정하세요. 준비 중입니다.",
      waveTitle: "파동 간섭",
      waveDesc: "두 개의 파원, 조절 가능한 주파수, 가시적인 간섭 무늬. 준비 중입니다.",
      tagOpen: "열기",
      tagSoon: "준비 중",

      projectilePageTitle: "포물선 운동 · 과학 실험",
      backToHub: "← 메인으로",
      experimentCount: "실험 1 / 4",
      projectileIntro: "발사 매개변수를 조정하고 발사 버튼을 눌러 발사체를 쏘아 올리세요.",
      controls: "조작",
      velocityLabel: "초기 속도 v₀",
      angleLabel: "발사 각도 θ",
      gravityLabel: "중력 g",
      launchBtn: "발사",
      launchingBtn: "발사 중…",
      resetBtn: "초기화",
      formulas: "공식",
      formulaRange: "도달 거리",
      formulaMaxHeight: "최대 높이",
      formulaTime: "체공 시간",
      formulaPosition: "위치",
      outRange: "도달 거리",
      outHeight: "최대 높이",
      outTime: "체공 시간",
      outT: "현재 t",
      outX: "현재 x",
      outY: "현재 y",
      outSpeed: "속력",

      pendulumPageTitle: "진자 · 과학 실험",
      experimentCount2: "실험 2 / 4",
      pendulumIntro: "길이, 중력, 초기 각도, 감쇠를 조절한 후 시작 버튼을 누르면 진자가 흔들립니다.",
      lengthLabel: "길이 L",
      initialAngleLabel: "초기 각도 θ₀",
      dampingLabel: "감쇠 b",
      startBtn: "시작",
      pauseBtn: "일시정지",
      formulaPeriod: "주기 (작은 각도)",
      formulaEom: "운동 방정식",
      outPeriod: "주기",
      outAngle: "각도",
      outAngVel: "각속도",
      outTime: "경과 시간",
    },
  };

  function getStoredLang() {
    try { return localStorage.getItem("lang"); } catch (_) { return null; }
  }

  function setStoredLang(lang) {
    try { localStorage.setItem("lang", lang); } catch (_) {}
  }

  function detectLang() {
    const saved = getStoredLang();
    if (saved && translations[saved]) return saved;
    if (navigator.language && navigator.language.toLowerCase().startsWith("ko")) return "ko";
    return "en";
  }

  let current = detectLang();

  function t(key) {
    const dict = translations[current] || translations.en;
    if (dict[key] !== undefined) return dict[key];
    if (translations.en[key] !== undefined) return translations.en[key];
    return key;
  }

  function applyLang(lang) {
    if (!translations[lang]) lang = "en";
    current = lang;
    setStoredLang(lang);
    document.documentElement.lang = lang;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      const val = translations[lang][key];
      if (val === undefined) return;
      if (el.tagName === "TITLE") {
        document.title = val;
        return;
      }
      el.textContent = val;
    });

    document.querySelectorAll(".lang-btn").forEach((btn) => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  window.i18n = {
    t,
    applyLang,
    getLang: () => current,
  };

  function init() {
    applyLang(current);
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.dataset.lang;
        if (translations[lang]) {
          applyLang(lang);
        } else {
          alert("장광타이");
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
