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
      orbitsDesc: "Drag on the canvas to place planets and set their initial velocity around a central star.",
      waveTitle: "Wave Interference",
      waveDesc: "Two sources, adjustable frequency, visible interference pattern. Coming soon.",
      cannonTitle: "Newton's Cannon",
      cannonDesc: "Newton's classic thought experiment: fire a cannonball horizontally from a mountain and find the speed that turns falling into orbiting.",
      semiTitle: "Semiconductors & Battery",
      semiDesc: "Compare intrinsic, n-type, and p-type semiconductors under the same battery and flip the polarity.",
      diodeTitle: "PN Junction Diode",
      diodeDesc: "Watch the depletion region grow and shrink as you switch between forward and reverse bias.",
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
      currentRightToLeft: "← left",
      currentLeftToRight: "→ right",
      currentNone: "off",
      semiNotes: "Notes",
      semiNoteIntrinsic: "Equal numbers of electrons and holes from thermal pair creation. Low conductivity.",
      semiNoteNType: "Donor atoms supply free electrons (majority carriers). Conducts mainly via electrons.",
      semiNotePType: "Acceptor atoms create holes (majority carriers). Conducts mainly via holes drifting with the field.",

      diodePageTitle: "PN Junction Diode · Physics",
      experimentCount5: "Physics · PN diode",
      diodeIntro: "Forward bias lets current flow; reverse bias blocks it. The depletion region in the middle widens or shrinks accordingly.",
      biasState: "Bias state",
      biasForward: "Forward",
      biasZero: "Zero",
      biasReverse: "Reverse",
      biasOff: "Off",
      ammeter: "Current",
      nRegion: "N-region",
      pRegion: "P-region",
      depletionRegion: "Depletion region",
      builtInField: "Built-in field",
      diodeNotes: "Notes",
      diodeNoteForward: "Forward bias: external field cancels part of the built-in field, the depletion region shrinks, and majority carriers cross the junction.",
      diodeNoteReverse: "Reverse bias: external field adds to the built-in field, the depletion region grows, and almost no current flows.",
      diodeNoteZero: "No bias: diffusion balances drift inside the depletion region. The built-in field stops further crossing.",

      cannonPageTitle: "Newton's Cannon · Physics",
      experimentCount6: "Physics · Newton's cannon",
      cannonIntro: "Adjust the launch speed and fire. Below the circular-orbit speed the ball falls back; between it and escape velocity it traces an ellipse; above escape velocity it leaves the planet.",
      initialSpeedLabel: "Launch speed",
      fireBtn: "Fire",
      orbitalSpeedRef: "Circular orbit",
      escapeSpeedRef: "Escape velocity",
      outcome: "Outcome",
      outcomeIdle: "Ready",
      outcomeFalls: "Falls back",
      outcomeOrbits: "Orbits",
      outcomeEscapes: "Escapes",
      outcomeCrashed: "Crashed",
      maxAltitude: "Max altitude",
      currentSpeed: "Current speed",
      cannonNotes: "Notes",
      cannonNote1: "Gravity always pulls the ball toward the planet's center, so the ball is constantly \"falling.\"",
      cannonNote2: "If the horizontal speed is high enough, the ball falls past the curving horizon at the same rate the surface curves away — that is orbit.",
      cannonNote3: "Beyond escape velocity, gravity can no longer pull the ball back; the trajectory becomes a hyperbola.",

      orbitsPageTitle: "Gravity & Orbits · Physics",
      experimentCount7: "Physics · Gravity & orbits",
      orbitsIntro: "Drag anywhere on the canvas: the start point is where a planet appears, and the drag direction and length set its initial velocity. Release to launch.",
      starMassLabel: "Star mass",
      gravityStrengthLabel: "Gravity",
      addPlanetHint: "Drag on the canvas to launch a planet",
      clearBtn: "Clear",
      planetCount: "Planets",
      orbitsNotes: "Notes",
      orbitsNote1: "Each planet only feels the central star's pull — the planets do not attract each other.",
      orbitsNote2: "A short drag gives a slow planet that spirals in. A perpendicular drag near orbital speed makes a near-circular orbit.",
      orbitsNote3: "If a planet flies off the edge or passes through the star, it is removed automatically.",
    },
    ko: {
      pageTitle: "과학 실험실",
      heroTitle: "과학 실험실",
      heroSubtitle: "관심 있는 분야를 골라 실험을 시작해 보세요.",
      categoryPhysics: "물리",
      categoryChemistry: "화학",
      physicsTagline: "운동, 힘, 파동.",
      chemistryTagline: "원자, 결합, 구조.",
      physicsLandingDesc: "발사체를 쏘고, 진자를 흔들고, 파동의 간섭을 직접 살펴보세요.",
      chemistryLandingDesc: "분자 구조를 들여다보며 물질에 숨은 규칙성을 찾아보세요.",
      exploreCta: "둘러보기",
      physicsHubTitle: "물리",
      physicsHubSubtitle: "운동·힘·파동을 직접 다뤄 보는 시뮬레이션 모음.",
      chemistryHubTitle: "화학",
      chemistryHubSubtitle: "분자 구조를 시각화해 물질의 규칙성을 발견해 보세요.",
      backHome: "← 처음으로",
      projectileTitle: "포물선 운동",
      projectileDesc: "속도, 각도, 중력을 자유롭게 조절해 발사체를 쏘아 보세요. 포물선 궤적과 실시간 측정값을 한눈에 볼 수 있습니다.",
      pendulumTitle: "진자",
      pendulumDesc: "길이·중력·초기 각도·감쇠를 자유롭게 바꿔 보는 진자 시뮬레이션.",
      orbitsTitle: "중력과 궤도",
      orbitsDesc: "캔버스를 드래그해 행성을 놓고 중심별 주위의 초기 속도를 직접 정해 보세요.",
      waveTitle: "파동 간섭",
      waveDesc: "두 파원의 주파수를 조절하며 간섭 무늬를 관찰해 보세요. 준비 중입니다.",
      cannonTitle: "뉴턴의 대포",
      cannonDesc: "뉴턴의 고전 사고실험. 산꼭대기에서 대포를 수평으로 발사해 추락이 궤도로 바뀌는 속도를 찾아보세요.",
      semiTitle: "반도체와 전지",
      semiDesc: "고유·n형·p형 반도체에 같은 전지를 연결하고 극성을 바꿔 가며 캐리어 흐름을 비교해 보세요.",
      diodeTitle: "PN 접합 다이오드",
      diodeDesc: "순방향과 역방향 바이어스를 바꾸며 공핍 영역이 어떻게 달라지는지 관찰해 보세요.",
      moleculeTitle: "분자 구조 뷰어",
      moleculeDesc: "여러 분자의 원자·결합·형태를 살펴보고 물질 속에 숨은 규칙성을 찾아보세요.",
      crystalTitle: "결정 격자",
      crystalDesc: "이온·금속 결정이 반복되는 단위 구조를 살펴봅니다. 준비 중입니다.",
      tagOpen: "열기",
      tagSoon: "준비 중",

      projectilePageTitle: "포물선 운동 · 물리",
      backToHub: "← 뒤로",
      experimentCount: "물리 · 포물선 운동",
      projectileIntro: "발사 조건을 조절한 뒤 발사 버튼을 눌러 보세요.",
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
      pendulumIntro: "길이·중력·초기 각도·감쇠를 조절한 뒤 시작 버튼을 누르면 진자가 움직이기 시작합니다.",
      lengthLabel: "길이 L",
      initialAngleLabel: "초기 각도 θ₀",
      dampingLabel: "감쇠 b",
      countLabel: "진자 개수 N",
      startBtn: "시작",
      pauseBtn: "일시정지",
      formulaPeriod: "주기 (작은 각도 근사)",
      formulaEom: "운동 방정식",
      outPeriod: "주기",
      outAngle: "각도",
      outAngVel: "각속도",
      outTime: "경과 시간",

      moleculePageTitle: "분자 구조 뷰어 · 화학",
      experimentCount3: "화학 · 분자 구조",
      moleculeIntro: "분자를 골라 돌려 보세요. 같은 혼성화를 가진 분자끼리 공통된 기하학적 틀을 공유한다는 점을 직접 확인할 수 있습니다.",
      selectMolecule: "분자 선택",
      rotateLabel: "자동 회전",
      rotationSpeed: "회전 속도",
      showLabelsLabel: "원소 기호 표시",
      propertyName: "이름",
      propertyFormula: "분자식",
      propertyGeometry: "분자 구조",
      propertyBondAngle: "결합각",
      propertyHybridization: "혼성 오비탈",
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
      geomTetrahedral: "정사면체",
      geomTrigPyramidal: "삼각뿔",
      geomTrigPlanar: "평면 삼각형",
      geomPlanarRing: "평면 고리 (방향족)",
      patternNote: "규칙성",
      patternBodyBent: "중심 원자에 결합쌍 2개와 비공유 전자쌍 2개가 있어 굽은 형이 됩니다. H₂S, OF₂도 같은 구조를 가집니다.",
      patternBodyLinear: "결합쌍 2개만 있고 비공유 전자쌍이 없어 선형이 됩니다. BeCl₂, CS₂도 같은 구조입니다.",
      patternBodyTetrahedral: "결합쌍 4개에 비공유 전자쌍이 없어 정사면체가 됩니다. CCl₄, SiH₄도 같은 구조입니다.",
      patternBodyTrigPyramidal: "결합쌍 3개에 비공유 전자쌍이 1개여서 삼각뿔이 됩니다. PH₃, NF₃도 동일한 구조입니다.",
      patternBodyTrigPlanar: "sp² 혼성으로 결합쌍 3개만 있고 비공유 전자쌍이 없어 평면 삼각형이 됩니다. BF₃, 폼알데하이드도 같은 구조입니다.",
      patternBodyPlanarRing: "평면 고리 위에서 π 전자가 비편재화되어 모든 결합이 1.5차 결합이 됩니다. 피리딘 같은 다른 방향족 분자에서도 같은 패턴이 나타납니다.",

      semiPageTitle: "반도체 · 물리",
      experimentCount4: "물리 · 반도체",
      semiIntro: "세 반도체에 같은 전지를 연결해 비교해 보세요. 극성을 바꾸면 전자와 정공이 어떻게 재배치되는지 한눈에 보입니다.",
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
      legendHole: "정공 (+)",
      legendSi: "규소 원자 (Si)",
      legendDonor: "도너 원자 (P, 5족)",
      legendAcceptor: "억셉터 원자 (B, 3족)",
      currentDirection: "전류 방향",
      currentRightToLeft: "← 왼쪽",
      currentLeftToRight: "→ 오른쪽",
      currentNone: "꺼짐",
      semiNotes: "설명",
      semiNoteIntrinsic: "열에 의해 만들어진 전자–정공 쌍이 같은 수로 존재하며, 전도성이 낮습니다.",
      semiNoteNType: "도너 원자가 자유 전자를 공급해 전자가 다수 캐리어가 되며, 전류의 대부분을 전자가 운반합니다.",
      semiNotePType: "억셉터 원자가 정공을 만들어 정공이 다수 캐리어가 되며, 정공이 전기장 방향을 따라 흐릅니다.",

      diodePageTitle: "PN 접합 다이오드 · 물리",
      experimentCount5: "물리 · PN 다이오드",
      diodeIntro: "순방향 바이어스에서는 전류가 흐르고, 역방향에서는 거의 흐르지 않습니다. 가운데 공핍 영역이 어떻게 좁아지고 넓어지는지 관찰해 보세요.",
      biasState: "바이어스 상태",
      biasForward: "순방향",
      biasZero: "바이어스 없음",
      biasReverse: "역방향",
      biasOff: "꺼짐",
      ammeter: "전류",
      nRegion: "N 영역",
      pRegion: "P 영역",
      depletionRegion: "공핍 영역",
      builtInField: "내부 전기장",
      diodeNotes: "설명",
      diodeNoteForward: "순방향 바이어스에서는 외부 전기장이 내부 전기장을 상쇄해 공핍 영역이 좁아지고, 다수 캐리어가 접합을 넘어 전류가 흐릅니다.",
      diodeNoteReverse: "역방향 바이어스에서는 외부 전기장이 내부 전기장과 같은 방향으로 더해져 공핍 영역이 넓어지고, 전류가 거의 흐르지 않습니다.",
      diodeNoteZero: "바이어스를 걸지 않으면 확산과 드리프트가 평형을 이루고, 내부 전기장이 더 이상의 확산을 막습니다.",

      cannonPageTitle: "뉴턴의 대포 · 물리",
      experimentCount6: "물리 · 뉴턴의 대포",
      cannonIntro: "발사 속도를 조절하고 발사해 보세요. 원궤도 속도보다 느리면 다시 떨어지고, 원궤도 속도와 탈출 속도 사이에서는 타원 궤도를 그리며, 탈출 속도를 넘으면 행성을 벗어납니다.",
      initialSpeedLabel: "발사 속도",
      fireBtn: "발사",
      orbitalSpeedRef: "원궤도 속도",
      escapeSpeedRef: "탈출 속도",
      outcome: "결과",
      outcomeIdle: "대기 중",
      outcomeFalls: "다시 추락",
      outcomeOrbits: "궤도 진입",
      outcomeEscapes: "행성 탈출",
      outcomeCrashed: "지면 충돌",
      maxAltitude: "최고 고도",
      currentSpeed: "현재 속도",
      cannonNotes: "설명",
      cannonNote1: "중력은 항상 행성 중심을 향해 당기므로 포탄은 끊임없이 \"떨어지고\" 있습니다.",
      cannonNote2: "수평 속도가 충분히 크면, 휘어진 지표가 멀어지는 속도와 똑같은 속도로 포탄이 떨어집니다. 이것이 곧 궤도입니다.",
      cannonNote3: "탈출 속도를 넘으면 중력이 포탄을 다시 끌어당기지 못해 궤적이 쌍곡선이 됩니다.",

      orbitsPageTitle: "중력과 궤도 · 물리",
      experimentCount7: "물리 · 중력과 궤도",
      orbitsIntro: "캔버스 위를 드래그해 보세요. 누른 지점에 행성이 놓이고, 드래그 방향과 길이가 초기 속도가 됩니다. 손을 떼면 행성이 출발합니다.",
      starMassLabel: "별 질량",
      gravityStrengthLabel: "중력 세기",
      addPlanetHint: "캔버스를 드래그하면 행성이 발사됩니다.",
      clearBtn: "모두 지우기",
      planetCount: "행성 수",
      orbitsNotes: "설명",
      orbitsNote1: "각 행성은 중심별의 중력만 받습니다. 행성들끼리는 서로 끌어당기지 않습니다.",
      orbitsNote2: "짧게 드래그하면 천천히 출발해 별 쪽으로 빨려 들어가고, 별 근처에서 적당한 속도로 수직 방향으로 드래그하면 거의 원에 가까운 궤도를 그립니다.",
      orbitsNote3: "행성이 화면 밖으로 벗어나거나 별을 통과하면 자동으로 제거됩니다.",
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
