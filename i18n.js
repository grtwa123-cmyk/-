(() => {
  const translations = {
    en: {
      pageTitle: "Science Lab",
      heroTitle: "Science Lab",
      heroSubtitle: "Pick a discipline to begin.",
      categoryPhysics: "Physics",
      categoryChemistry: "Chemistry",
      physicsTagline: "Motion, forces, waves.",
      chemistryTagline: "Atoms, bonds, structure.",
      physicsLandingDesc: "Throw a projectile, swing a pendulum, watch waves interfere.",
      chemistryLandingDesc: "Explore molecular structure and the regularities of matter.",
      exploreCta: "Explore",
      physicsHubTitle: "Physics",
      physicsHubSubtitle: "Hands-on simulations for motion, forces, and waves.",
      chemistryHubTitle: "Chemistry",
      chemistryHubSubtitle: "Visualize structure and discover patterns in matter.",
      backHome: "← Home",
      projectileTitle: "Projectile Motion",
      projectileDesc: "Launch a projectile with adjustable velocity, angle, and gravity. Watch the parabolic trajectory and live readouts.",
      pendulumTitle: "Pendulum",
      pendulumDesc: "Swing a pendulum with adjustable length, gravity, initial angle, and damping.",
      orbitsTitle: "Gravity & Orbits",
      orbitsDesc: "Drag a planet to set its initial velocity around a star. Coming soon.",
      waveTitle: "Wave Interference",
      waveDesc: "Two sources, adjustable frequency, visible interference pattern. Coming soon.",
      semiTitle: "Semiconductors & Battery",
      semiDesc: "Compare intrinsic, n-type, and p-type semiconductors under the same battery and flip the polarity.",
      moleculeTitle: "Molecule Viewer",
      moleculeDesc: "Browse common molecules — atoms, bonds, geometry, and the patterns they reveal across matter.",
      crystalTitle: "Crystal Lattice",
      crystalDesc: "Ionic and metallic lattices arranged in repeating units. Coming soon.",
      tagOpen: "Open",
      tagSoon: "Coming soon",

      projectilePageTitle: "Projectile Motion · Physics",
      backToHub: "← Back",
      experimentCount: "Physics · Projectile",
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

      pendulumPageTitle: "Pendulum · Physics",
      experimentCount2: "Physics · Pendulum",
      pendulumIntro: "Adjust the length, gravity, initial angle, and damping. Press Start to set it swinging.",
      lengthLabel: "Length L",
      initialAngleLabel: "Initial angle θ₀",
      dampingLabel: "Damping b",
      countLabel: "Number of pendulums N",
      startBtn: "Start",
      pauseBtn: "Pause",
      formulaPeriod: "Period (small angle)",
      formulaEom: "Equation of motion",
      outPeriod: "Period",
      outAngle: "Angle",
      outAngVel: "Angular velocity",
      outTime: "Elapsed time",

      moleculePageTitle: "Molecule Viewer · Chemistry",
      experimentCount3: "Chemistry · Molecules",
      moleculeIntro: "Pick a molecule and rotate it. Notice how molecules with the same hybridization share a geometric template.",
      selectMolecule: "Molecule",
      rotateLabel: "Auto rotate",
      rotationSpeed: "Rotation",
      showLabelsLabel: "Show element symbols",
      propertyName: "Name",
      propertyFormula: "Formula",
      propertyGeometry: "Geometry",
      propertyBondAngle: "Bond angle",
      propertyHybridization: "Hybridization",
      propertyAtomCount: "Atom count",
      molWater: "Water",
      molMethane: "Methane",
      molAmmonia: "Ammonia",
      molCO2: "Carbon dioxide",
      molEthane: "Ethane",
      molEthylene: "Ethylene",
      molBenzene: "Benzene",
      geomBent: "Bent",
      geomLinear: "Linear",
      geomTetrahedral: "Tetrahedral",
      geomTrigPyramidal: "Trigonal pyramidal",
      geomTrigPlanar: "Trigonal planar",
      geomPlanarRing: "Planar ring (aromatic)",
      patternNote: "Pattern",
      patternBodyBent: "Two bond pairs + two lone pairs around a central atom → bent. Same template as H₂S, OF₂.",
      patternBodyLinear: "Two bond pairs + no lone pairs → linear. Same template as BeCl₂, CS₂.",
      patternBodyTetrahedral: "Four bond pairs, no lone pairs → tetrahedral. Same template as CCl₄, SiH₄.",
      patternBodyTrigPyramidal: "Three bond pairs + one lone pair → trigonal pyramidal. Same template as PH₃, NF₃.",
      patternBodyTrigPlanar: "Three bond pairs, no lone pairs (sp²) → trigonal planar. Same template as BF₃, formaldehyde.",
      patternBodyPlanarRing: "Conjugated π-system over a planar ring — delocalized bonding gives 1.5-order bonds, identical to other aromatics like pyridine.",

      semiPageTitle: "Semiconductors · Physics",
      experimentCount4: "Physics · Semiconductors",
      semiIntro: "Three semiconductors share one battery. Flip the polarity and watch electrons and holes redistribute.",
      typeIntrinsic: "Intrinsic",
      typeNType: "N-type",
      typePType: "P-type",
      battery: "Battery",
      batteryOnLabel: "Battery on",
      reversePolarityBtn: "Reverse polarity",
      voltageLabel: "Voltage",
      temperatureLabel: "Temperature",
      legend: "Legend",
      legendElectron: "Electron (−)",
      legendHole: "Hole (+)",
      legendSi: "Silicon atom",
      legendDonor: "Donor (P, +5)",
      legendAcceptor: "Acceptor (B, +3)",
      currentDirection: "Conventional current",
      currentRightToLeft: "→ left",
      currentLeftToRight: "→ right",
      currentNone: "off",
      semiNotes: "Notes",
      semiNoteIntrinsic: "Equal numbers of electrons and holes from thermal pair creation. Low conductivity.",
      semiNoteNType: "Donor atoms supply free electrons (majority carriers). Conducts mainly via electrons.",
      semiNotePType: "Acceptor atoms create holes (majority carriers). Conducts mainly via holes drifting with the field.",
    },
    ko: {
      pageTitle: "과학 실험실",
      heroTitle: "과학 실험실",
      heroSubtitle: "분야를 선택해 시작하세요.",
      categoryPhysics: "물리",
      categoryChemistry: "화학",
      physicsTagline: "운동, 힘, 파동.",
      chemistryTagline: "원자, 결합, 구조.",
      physicsLandingDesc: "발사체를 쏘고, 진자를 흔들고, 파동의 간섭을 관찰합니다.",
      chemistryLandingDesc: "분자 구조와 물질의 규칙성을 탐구합니다.",
      exploreCta: "둘러보기",
      physicsHubTitle: "물리",
      physicsHubSubtitle: "운동, 힘, 파동을 직접 다루는 실험들.",
      chemistryHubTitle: "화학",
      chemistryHubSubtitle: "구조를 시각화하며 물질의 규칙성을 발견합니다.",
      backHome: "← 처음으로",
      projectileTitle: "포물선 운동",
      projectileDesc: "속도, 각도, 중력을 조절해 발사체를 쏘아 올려보세요. 포물선 궤적과 실시간 측정값을 확인할 수 있습니다.",
      pendulumTitle: "진자",
      pendulumDesc: "길이, 중력, 초기 각도, 감쇠를 조절할 수 있는 진자.",
      orbitsTitle: "중력과 궤도",
      orbitsDesc: "행성을 드래그해 항성 주위 초기 속도를 설정하세요. 준비 중입니다.",
      waveTitle: "파동 간섭",
      waveDesc: "두 개의 파원, 조절 가능한 주파수, 가시적인 간섭 무늬. 준비 중입니다.",
      semiTitle: "반도체와 전지",
      semiDesc: "고유·n형·p형 반도체에 같은 전지를 걸고 극성을 전환하며 캐리어 흐름을 비교합니다.",
      moleculeTitle: "분자 구조 뷰어",
      moleculeDesc: "여러 분자의 원자·결합·형태를 살펴보고 물질 속에 숨은 규칙성을 찾아보세요.",
      crystalTitle: "결정 격자",
      crystalDesc: "이온·금속 결정의 반복 단위 구조. 준비 중입니다.",
      tagOpen: "열기",
      tagSoon: "준비 중",

      projectilePageTitle: "포물선 운동 · 물리",
      backToHub: "← 뒤로",
      experimentCount: "물리 · 포물선 운동",
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

      pendulumPageTitle: "진자 · 물리",
      experimentCount2: "물리 · 진자",
      pendulumIntro: "길이, 중력, 초기 각도, 감쇠를 조절한 후 시작 버튼을 누르면 진자가 흔들립니다.",
      lengthLabel: "길이 L",
      initialAngleLabel: "초기 각도 θ₀",
      dampingLabel: "감쇠 b",
      countLabel: "진자 개수 N",
      startBtn: "시작",
      pauseBtn: "일시정지",
      formulaPeriod: "주기 (작은 각도)",
      formulaEom: "운동 방정식",
      outPeriod: "주기",
      outAngle: "각도",
      outAngVel: "각속도",
      outTime: "경과 시간",

      moleculePageTitle: "분자 구조 뷰어 · 화학",
      experimentCount3: "화학 · 분자 구조",
      moleculeIntro: "분자를 선택해 돌려보세요. 같은 혼성화를 가진 분자들이 공통된 기하학적 틀을 가진다는 것을 확인할 수 있습니다.",
      selectMolecule: "분자",
      rotateLabel: "자동 회전",
      rotationSpeed: "회전 속도",
      showLabelsLabel: "원소 기호 표시",
      propertyName: "이름",
      propertyFormula: "분자식",
      propertyGeometry: "구조",
      propertyBondAngle: "결합 각도",
      propertyHybridization: "혼성화",
      propertyAtomCount: "원자 수",
      molWater: "물",
      molMethane: "메테인",
      molAmmonia: "암모니아",
      molCO2: "이산화탄소",
      molEthane: "에테인",
      molEthylene: "에틸렌",
      molBenzene: "벤젠",
      geomBent: "굽은형",
      geomLinear: "선형",
      geomTetrahedral: "사면체",
      geomTrigPyramidal: "삼각뿔",
      geomTrigPlanar: "삼각평면",
      geomPlanarRing: "평면 고리 (방향족)",
      patternNote: "규칙성",
      patternBodyBent: "결합쌍 2개 + 비공유전자쌍 2개 → 굽은 형. H₂S, OF₂ 같은 분자와 동일한 틀.",
      patternBodyLinear: "결합쌍 2개 + 비공유전자쌍 0개 → 선형. BeCl₂, CS₂도 같은 형태.",
      patternBodyTetrahedral: "결합쌍 4개, 비공유전자쌍 없음 → 사면체. CCl₄, SiH₄도 같은 형태.",
      patternBodyTrigPyramidal: "결합쌍 3개 + 비공유전자쌍 1개 → 삼각뿔. PH₃, NF₃도 같은 형태.",
      patternBodyTrigPlanar: "결합쌍 3개, 비공유전자쌍 없음 (sp²) → 삼각평면. BF₃, 폼알데하이드도 동일.",
      patternBodyPlanarRing: "평면 고리에 π 전자가 비편재화되어 모든 결합이 1.5차 — 피리딘 등 다른 방향족과 동일한 패턴.",

      semiPageTitle: "반도체 · 물리",
      experimentCount4: "물리 · 반도체",
      semiIntro: "세 반도체에 같은 전지를 걸어 비교합니다. 극성을 전환하면 전자와 양공이 어떻게 재배치되는지 보세요.",
      typeIntrinsic: "고유 반도체",
      typeNType: "n형",
      typePType: "p형",
      battery: "전지",
      batteryOnLabel: "전지 켜기",
      reversePolarityBtn: "극성 전환",
      voltageLabel: "전압",
      temperatureLabel: "온도",
      legend: "범례",
      legendElectron: "전자 (−)",
      legendHole: "양공 (+)",
      legendSi: "규소 원자",
      legendDonor: "주개 (P, +5)",
      legendAcceptor: "받개 (B, +3)",
      currentDirection: "관습 전류 방향",
      currentRightToLeft: "→ 왼쪽",
      currentLeftToRight: "→ 오른쪽",
      currentNone: "꺼짐",
      semiNotes: "메모",
      semiNoteIntrinsic: "열적으로 생성된 전자–양공 쌍이 같은 수로 존재. 전도성이 낮습니다.",
      semiNoteNType: "주개 원자가 자유 전자를 공급해 다수 캐리어가 전자. 주로 전자가 전류를 만듭니다.",
      semiNotePType: "받개 원자가 양공을 만들어 다수 캐리어가 양공. 양공이 전기장 방향으로 흐릅니다.",
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
