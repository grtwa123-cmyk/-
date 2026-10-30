/*
 * Nuclear reactor — point kinetics, feedback, decay heat, and a meltdown.
 *
 * Nothing on this page prints a textbook answer. What runs is a mechanism:
 *
 *   · point kinetics with six delayed-neutron groups (Keepin, U-235 thermal),
 *     the precursors stepped by Crank–Nicolson and the stiff prompt-neutron
 *     equation by backward Euler;
 *   · three thermal nodes — fuel, cladding, coolant — with Doppler and
 *     moderator reactivity feedback taken from their temperatures;
 *   · thirteen decay-heat groups, so the heat that keeps coming after a scram
 *     comes from the fission products' own decay rather than from a formula;
 *   · the I-135 → Xe-135 chain, burning out in the flux;
 *   · Baker–Just parabolic oxidation of the zircaloy once the cladding is hot
 *     enough, which is exothermic and makes hydrogen;
 *   · a water inventory that heats to saturation and then boils away, so the
 *     level falls, the core uncovers, and the heat has nowhere to go.
 *
 * The results a reactor physics text would state are read back out of that:
 *
 *   period       measured from the slope of ln n, then compared against the
 *                inhour equation ρ = ωΛ + Σ βᵢω/(ω+λᵢ) solved for the same ρ
 *   prompt jump  n steps to β/(β−ρ) before the delayed neutrons notice
 *   feedback     a rod step settles where ρ_rod + α_F ΔT_F + α_M ΔT_C = 0
 *   decay heat   after a scram, against Way–Wigner 0.066·t^(−0.2)
 *   xenon        the pit peaks at 1.88× equilibrium about 8.3 h after shutdown
 *   hydrogen     0.0442 kg H₂ per kg of zircaloy, from the stoichiometry
 *
 * All six were checked in node against their closed forms before a line of
 * this file existed: the inhour round-trip closes to 0.015%, the reactivity
 * balance to 0.000 pcm, the decay-heat groups sit within 3.6% of Way–Wigner
 * over 1 s to 10⁶ s (1.1% beyond 10 s), the xenon peak to 0.02%, and the first
 * law over the whole blackout to 0.002%.
 *
 * The lumping, said out loud
 * --------------------------
 * The core is two thermal zones — under water, and standing in steam — with
 * a boundary that follows the level and one temperature inside each, plus a
 * pool in the lower head for whatever has melted and fallen there. There is
 * no hot channel and no axial power profile. One zone was tried first and is
 * wrong in a way a reader can see: at a single temperature the covered half
 * cools the bare half, and half a core out of the water sat one degree above
 * saturation.
 *
 * With no cooling at all the model gives saturation at 9 min, uncovery at 50,
 * cladding burst at 83, fuel melting at 106, relocation into the lower head
 * at 111 and the head itself at 149, with 44% of the cladding oxidised and
 * 484 kg of hydrogen made — the same sequence TMI-2 went through, and about
 * the oxidation it reached (~45%). Nothing was tuned to land there: the
 * oxidation stops when the melted core pours out of the steam into the
 * lower head, where the pool has no cladding wall left to burn.
 *
 * Past relocation the model leans optimistic. Water in the vessel takes
 * whatever heat the lower head offers it, with no critical heat flux, so a
 * hot head quenches in nucleate boiling where a real one would sit in film
 * boiling. Whether in-vessel water can hold a full core's corium is still
 * argued over — it is why the AP1000 floods the outside of its vessel. The
 * page says so in its notes rather than leave a reader to find it.
 */
(() => {
  /*
   * Fixed ink. This stage paints its own dark ground in both themes, so a
   * colour read from --text or --muted would be dark-on-dark for a
   * light-theme reader. These are the dark theme's own values.
   */
  const INK = "#ecf0fb", INK_MUTED = "#97a0bf", GRID = "#242c47";
  const C_FIS = "#ffd166", C_DEC = "#ff9b6b", C_RHO = "#7be0d0";
  const C_TF = "#ff6b8a", C_TL = "#ffb457", C_TC = "#6ea8ff";
  const C_XE = "#c79bff", C_WATER = "#1d4f7c", C_STEAM = "#3d4a68";
  const C_VESSEL = "#8794b5", C_ROD = "#b8c2da", C_WARN = "#ff6b8a";

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Constants ─────────────────────────────────────────────────────────
  // Delayed neutrons: Keepin's six groups for thermal fission of U-235.
  const BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
  const LAM = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
  const B = BETA.reduce((a, b) => a + b, 0);   // 0.006502
  const L = 2e-5;                              // s, prompt generation time

  /*
   * Decay heat as thirteen exponentials. The amplitudes were fitted offline
   * to Way–Wigner's 0.066·t^(−0.2) over 1 s … 10⁷ s by a non-negative least
   * squares on a fixed logarithmic ladder of decay constants; the worst error
   * over that range is 3.6%, at t = 1 s, and 1.1% beyond 10 s. What matters
   * here is that the page then *integrates* them — the heat after a scram is
   * what the groups have left in them, not the formula re-evaluated.
   */
  const DL = [1.000000e-8, 4.216965e-8, 1.778279e-7, 7.498942e-7, 3.162278e-6,
              1.333521e-5, 5.623413e-5, 2.371374e-4, 1.000000e-3, 4.216965e-3,
              1.778279e-2, 7.498942e-2, 3.162278e-1];
  const DA = [2.644169e-3, 1.127458e-4, 9.299543e-4, 1.243108e-3, 1.641710e-3,
              2.184990e-3, 2.945218e-3, 3.834561e-3, 5.361211e-3, 6.504103e-3,
              1.034161e-2, 9.501034e-3, 2.368311e-2];
  const SC = DA.reduce((a, b) => a + b, 0);    // decay share at saturation

  const P0 = 3.0e9;               // W, rated thermal power (fission + decay)
  const PF = P0 * (1 - SC);       // W, fission power when n = 1

  // Thermal nodes. Masses and heat capacities of a four-loop PWR core.
  const M_UO2 = 101000, CP_UO2 = 300;      // kg, J/kg/K
  const M_ZR = 25000, CP_ZR = 330;
  const C_F = M_UO2 * CP_UO2, C_L = M_ZR * CP_ZR;
  const M_H2O = 250000, CP_H2O = 5500, HFG = 1.0e6;   // primary inventory
  const TF0 = 900, TL0 = 620, TC0 = 583, TSEC = 558, TSAT = 618;
  const A_CLAD = 560;                       // m², clad surface in the core
  const H_BOIL = P0 / (TL0 - TC0) / A_CLAD; // W/m²/K, nucleate boiling
  const H_STEAM = 30;                       // W/m²/K, bare rods in steam
  const hGAP = P0 / (TF0 - TL0);            // W/K, fuel → clad
  const USG = P0 / (TC0 - TSEC);            // W/K, coolant → steam generator
  const aF = -2.8e-5, aM = -25e-5;          // per K: Doppler, moderator

  // Baker–Just: w² = A·exp(−B/RT)·t, w in mg of zirconium per cm².
  const BJ_A = 33.3e6, BJ_B = 45500, RCAL = 1.987;
  const ZR_AREA = 5.6e6;                    // cm² of cladding
  const H_OX = 6.42e6;                      // J per kg Zr (586 kJ/mol)
  const H2_PER_ZR = 0.0442;                 // 2·M(H₂)/M(Zr), kg per kg
  const STEAM_PER_ZR = 0.395;               // 2·M(H₂O)/M(Zr), kg per kg
  const W_FULL = M_ZR * 1e6 / ZR_AREA;      // mg/cm² for the whole wall

  // Level: the core sits between these two fractions of the inventory.
  const CORE_TOP = 0.55, CORE_BOT = 0.35;
  const T_BURST = 1473, T_ZR = 2098, T_MELT = 3120;
  const H_FUS = 259e3;                      // J/kg, UO₂ heat of fusion

  /*
   * The lower head. Once the whole core is molten it slumps into it, and the
   * accident ends the only way it can: the steel reaches 1700 K and gives
   * way. That is where this model stops — what happens to the debris outside
   * the vessel is a different problem, and the page says so rather than
   * carrying a temperature that means nothing into the next hour.
   */
  const M_STEEL = 120000, CP_STEEL = 500;   // kg, J/kg/K
  const C_S = M_STEEL * CP_STEEL;
  const H_COR = 3.0e4;                      // W/K, corium pool → wall
  const H_HEAD_W = 4.0e6;                   // W/K, wall → coolant
  const T_VESSEL = 1700;                    // K, the steel gives way

  // Xe-135 / I-135.
  const gI = 0.0639, gX = 0.00237;
  const lI = Math.LN2 / (6.57 * 3600), lX = Math.LN2 / (9.14 * 3600);
  const sX = 2.6e-18;                       // cm², Xe-135 absorption
  const PHI0 = 3e13, SIGF = 0.0446;         // n/cm²/s at n = 1; Σ_f in 1/cm
  const I_EQ = gI * SIGF * PHI0 / lI;
  const X_EQ = (gI + gX) * SIGF * PHI0 / (lX + sX * PHI0);
  // The rod bank has already bought out the equilibrium xenon, so what moves
  // the reactivity is the departure from it. Full worth is the usual PWR
  // figure and sets the scale.
  const XE_WORTH = -0.0275;
  const SCRAM_RHO = -0.06;                  // pcm worth of the trip

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");

  const inputs = {
    rod: document.getElementById("rod"),
    feed: document.getElementById("feed"),
    eccs: document.getElementById("eccs"),
    speed: document.getElementById("speed"),
  };
  const vals = {
    rod: document.getElementById("rod-value"),
    feed: document.getElementById("feed-value"),
    eccs: document.getElementById("eccs-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    power: document.getElementById("out-power"),
    decay: document.getElementById("out-decay"),
    decayWW: document.getElementById("out-decay-ww"),
    period: document.getElementById("out-period"),
    periodTheory: document.getElementById("out-period-theory"),
    rho: document.getElementById("out-rho"),
    rhoParts: document.getElementById("out-rho-parts"),
    tf: document.getElementById("out-tf"),
    tl: document.getElementById("out-tl"),
    tc: document.getElementById("out-tc"),
    ts: document.getElementById("out-ts"),
    level: document.getElementById("out-level"),
    ox: document.getElementById("out-ox"),
    h2: document.getElementById("out-h2"),
    xe: document.getElementById("out-xe"),
    state: document.getElementById("out-state"),
    clock: document.getElementById("out-clock"),
  };
  const startBtn = document.getElementById("start-btn");
  const scramBtn = document.getElementById("scram-btn");
  const sboBtn = document.getElementById("sbo-btn");
  const resetBtn = document.getElementById("reset-btn");

  /*
   * The integration step. Fine enough that the prompt jump is resolved and
   * the blackout timeline is converged: halving it moves the time to fuel
   * melting by under a tenth of a percent. The site's quality toggle refines
   * it, and the substeps per frame scale by the same ratio so Fine costs CPU
   * rather than plant time.
   */
  const DT_STD = 0.05;
  let DT = window.Quality ? window.Quality.pick(DT_STD, 0.02) : DT_STD;

  let st = null, running = false, raf = 0, lastTs = 0;

  const readParams = () => ({
    rod: parseFloat(inputs.rod.value),        // pcm
    feed: parseFloat(inputs.feed.value) / 100,
    eccs: parseFloat(inputs.eccs.value),      // kg/s
    speed: parseInt(inputs.speed.value, 10),  // substeps per frame
  });

  /** A core at rated power, xenon at equilibrium, decay groups saturated. */
  function fresh() {
    return {
      t: 0, k: 0,
      n: 1, C: BETA.map((b, i) => b / (L * LAM[i])),
      D: DA.slice(),
      /*
       * Two thermal zones, not one. The part of the core still under water
       * and the part standing in steam are cooled five thousand times
       * differently, and a single node at one temperature lets the covered
       * half cool the bare half — half the core out of the water and the
       * cladding a degree above saturation, which is not what happens.
       * Each zone carries its own fuel and clad temperature, its own oxide
       * thickness and its own melt fraction, and the boundary between them
       * moves with the water level.
       */
      z: { w: { TF: TF0, TL: TL0, W: 0, f: 0, g: 0 },
           d: { TF: TF0, TL: TL0, W: 0, f: 0, g: 0 } },
      cover: 1,
      /*
       * The rods still standing, as a fraction of the fuel, and the pool in
       * the lower head that the rest has become. f is the latent-heat
       * bookkeeping and goes both ways; g, slumped, only goes up — refrozen
       * debris is a lump, and it gets back neither its surface nor its place
       * in the picture.
       */
      fuelIn: 1,
      cor: { mass: 0, T: TC0, f: 0 },
      slumped: 0,
      TF: TF0, TL: TL0, TC: TC0,
      m: M_H2O, TS: TC0,
      I: I_EQ, X: X_EQ,
      W: 0, zr: 0, h2: 0, melted: 0, steam: 0,
      relocated: false, breach: false,
      scram: false, tScram: -1,
      // Everything the readouts show is derived from these, never assumed.
      pFis: PF, pDec: P0 * SC, pOx: 0, rho: 0,
      parts: { rod: 0, dop: 0, mod: 0, xe: 0 },
      trace: [],          // { t, n, dec, TF, TL, TC, lvl, rho }
      lnHist: [],         // { t, ln } — the period is measured off this
      marks: {},          // event → plant time, filled in as they happen
    };
  }

  /*
   * Point kinetics. The six precursor groups are stepped by Crank–Nicolson;
   * the prompt neutrons by backward Euler.
   *
   * Both used to be Crank–Nicolson, which is A-stable but not L-stable: for
   * a stiff mode its amplification factor tends to −1 rather than to 0, and
   * the prompt-neutron mode after a scram is very stiff — dt(β − ρ)/Λ is 166
   * at the page's 0.05 s step. So the fission power rang: 0, 0.19, 0.001,
   * 0.18 … on alternate steps for about ten seconds after every trip, around
   * a true prompt drop to 0.096. Averages came out right, which is why
   * nothing noticed until the plant's log began recording every step and
   * printed the sawtooth. Backward Euler damps that mode instead of flipping
   * it; the precursors, which are not stiff (dt·λ ≤ 0.15), keep the second
   * order. Measured against the same kinetics at a step a thousand times
   * finer: CN was up to 100% wrong with 349 sign flips in the twenty seconds
   * after a scram, this is 6.5% on the first step — a 0.05 s step cannot
   * resolve a drop that takes 0.3 ms — under 1% from the second, and never
   * reverses. The inhour round trip and the prompt jump at fine steps are
   * unchanged to every digit the suite reads.
   */
  function stepPK(s, rho, dt) {
    const th = 0.5, n = s.n, C = s.C;           // th: the precursors' θ
    let sSrc = 0, sImp = 0;
    for (let i = 0; i < 6; i++) {
      const d = 1 + th * dt * LAM[i];
      sSrc += LAM[i] * (C[i] * (1 - (1 - th) * dt * LAM[i])
                        + dt * BETA[i] * (1 - th) * n / L) / d;
      sImp += LAM[i] * dt * BETA[i] * th / (L * d);
    }
    const a0 = (rho - B) / L;
    // Fully implicit in n: n1 = n + dt·(a0·n1 + Σ λᵢ Cᵢ(n1)).
    const n1 = (n + dt * sSrc) / (1 - dt * (a0 + sImp));
    for (let i = 0; i < 6; i++) {
      C[i] = (C[i] * (1 - (1 - th) * dt * LAM[i])
              + dt * BETA[i] * (th * n1 + (1 - th) * n) / L)
             / (1 + th * dt * LAM[i]);
    }
    s.n = Math.max(n1, 0);
  }

  /** Iodine and xenon, implicit in xenon so the burnout term cannot blow up. */
  function stepXe(s, dt) {
    const phi = PHI0 * s.n;
    const I = s.I + dt * (gI * SIGF * phi - lI * s.I);
    s.X = (s.X + dt * (gX * SIGF * phi + lI * I)) / (1 + dt * (lX + sX * phi));
    s.I = I;
  }

  /*
   * Baker–Just: the zirconium consumed per unit area grows parabolically,
   * w² = A·e^(−B/RT)·t with w in mg/cm², so the rate at any moment depends on
   * the oxide already there. The first increment out of bare metal is the
   * closed form itself, because kp/(2w) is unbounded at w = 0.
   */
  function oxidationStep(W, TL, dt) {
    const kp = BJ_A * Math.exp(-BJ_B / (RCAL * TL));
    return W > 1e-9 ? kp / (2 * W) * dt : Math.sqrt(kp * dt);
  }

  /*
   * The decay-heat groups, on their own. Thirteen first-order lags driven by
   * the fission rate — a linear system, so twice the power history is twice
   * the heat, and a core that has only run for an hour holds less than one
   * that has run for a year. Neither of those is a property 0.066·t^(−0.2)
   * has, which is what makes them worth checking.
   *
   * Explicit, so the step has to stay under 2/λ for the fastest group —
   * 6.3 s. The page runs at 0.05 s.
   */
  function stepDecayHeat(s, dt) {
    for (let j = 0; j < DL.length; j++) s.D[j] += dt * DL[j] * (DA[j] * s.n - s.D[j]);
  }

  /** One step of the whole plant. `u` is the control panel. */
  function step(s, dt, u) {
    /*
     * The clock counts steps and divides; it does not add 0.05 s a million
     * times. Adding drifted — fourteen days in, the plant time read
     * 1165762.150511252 s for a step that ends at exactly 1165762.15 — and
     * multiplying by 0.05, which has no exact binary form, still printed
     * 2996.7000000000003. Dividing the step count by the whole number of
     * steps per second is correctly rounded, so it prints 2996.7. Every
     * event is stamped with the end of the step it happened in, so the
     * file's event rows and its timeline agree to the digit.
     */
    const rate = 1 / dt, whole = Math.round(rate);
    const tEnd = Math.abs(rate - whole) < 1e-9 * whole ? (s.k + 1) / whole : (s.k + 1) * dt;
    const rodRho = (s.scram ? SCRAM_RHO : 0) + u.rod / 1e5;
    const parts = {
      rod: rodRho,
      dop: aF * (s.TF - TF0),
      mod: aM * (s.TC - TC0),
      xe: XE_WORTH * (s.X - X_EQ) / X_EQ,
    };
    const rho = parts.rod + parts.dop + parts.mod + parts.xe;
    stepPK(s, rho, dt);
    stepXe(s, dt);

    stepDecayHeat(s, dt);
    const pFis = PF * s.n;
    let pDec = 0;
    for (let j = 0; j < DL.length; j++) pDec += s.D[j];
    pDec *= P0;

    /*
     * The water line, and the zone boundary that follows it. The zones
     * describe only the rods still standing, which occupy the bottom fuelIn
     * of the core band, so the cover is measured against that height. Fuel
     * that goes from wet to dry arrives at the temperature it had, so the
     * handover conserves energy exactly; the oxide, the melt fraction and
     * the slumped fraction move with it for the same reason.
     */
    const lvl = s.m / M_H2O;
    const span = s.fuelIn * (CORE_TOP - CORE_BOT);
    const c0 = s.cover;
    const c1 = span > 1e-12 ? Math.max(0, Math.min(1, (lvl - CORE_BOT) / span)) : 0;
    const mixInto = (to, from, held, moved) => {
      for (const k of ["TF", "TL", "W", "f", "g"]) {
        to[k] = (held * to[k] + moved * from[k]) / (held + moved);
      }
    };
    if (c1 < c0 - 1e-12) mixInto(s.z.d, s.z.w, 1 - c0, c0 - c1);
    else if (c1 > c0 + 1e-12) mixInto(s.z.w, s.z.d, c0, c1 - c0);
    s.cover = c1;

    /*
     * The lower head, and the pool on it. The head is washed by whatever
     * water is in the vessel — before relocation and after it — and heated
     * by whatever corium has landed on it. It only fails once the water has
     * gone: at TMI-2 the upper core melted and poured into a lower head that
     * still held water, and the vessel held. Here the head used to stop
     * talking to the water the moment corium arrived, so turning injection
     * back on at 105 minutes failed the vessel at the same minute as not
     * turning it on at all.
     */
    const C_COR = C_F + C_L;                   // fuel and the cladding it took with it

    /*
     * Each zone then evolves like a whole core with its own heat-transfer
     * coefficient: the zone fraction multiplies the heat capacity, the power
     * and the surface alike, so it cancels out of the temperature equation
     * and only reappears where the zones are summed.
     */
    const pSpec = pFis + pDec;                 // W, as if the zone were all of it
    let pOx = 0;
    const zones = [[s.z.w, s.fuelIn * c1, A_CLAD * H_BOIL],
                   [s.z.d, s.fuelIn * (1 - c1), A_CLAD * H_STEAM]];

    /*
     * Baker–Just, and the two things it takes for granted.
     *
     * It is a rate law for a metal wall with steam on it. The wall has to be
     * standing: fuel that has slumped has taken its cladding with it, so the
     * oxidising surface is A·(1 − g), and the pool in the lower head has none
     * at all. (The pool used to be the same zone it came from, and burned on
     * over all 560 m² of a wall that no longer existed until it reached
     * 4800 K. The factor itself matters most in a reflood, where steam keeps
     * rising past the slumping top: without it the reaction ran at 65% of
     * its peak with 98% of the fuel already slumped.) And the steam has to be
     * there: two molecules of water per atom of zirconium, 0.395 kg per kg,
     * and the only steam rising through bare rods is what boils off below
     * them. Without that, restoring the heat sink left the water subcooled
     * and nothing boiling, and 24 tonnes of zirconium oxidised anyway. It
     * replaces a `water left > 0` gate rather than sitting beside it — no
     * water, no boiling, no steam.
     */
    const ox = [];
    let zrWant = 0;
    for (const [z, frac] of zones) {
      /* No separate "fully slumped" skip: (1 − g) is already zero there, and
         with both in place the factor could be deleted without anything
         noticing — the skip quietly did its job at g = 1 and nothing
         checked the range in between. */
      if (frac <= 1e-9 || s.breach || z.TL <= 1100 || z.W >= W_FULL) continue;
      const dw = Math.min(oxidationStep(z.W, z.TL, dt), W_FULL - z.W);
      const kg = frac * (1 - z.g) * dw * 1e-6 * ZR_AREA;   // this zone's share, really
      ox.push({ z, frac, dw, kg });
      zrWant += kg;
    }
    const zrSteam = s.steam * dt / STEAM_PER_ZR;      // what last step's boil-off can burn
    const starve = zrWant > zrSteam ? zrSteam / zrWant : 1;
    const pOxSpec = new Map();
    for (const o of ox) {
      o.z.W += o.dw * starve;
      const kg = o.kg * starve;
      s.zr += kg;
      s.h2 += kg * H2_PER_ZR;
      pOx += kg * H_OX / dt;
      pOxSpec.set(o.z, kg * H_OX / dt / o.frac);     // as if the zone were all of it
    }

    /*
     * Every heat flux at the start of the step. The surface rule applies to
     * heat as it does to oxidation: slumped fuel is a lump with a crust, not
     * rods in a steam flow, and it cannot convect over the area of a wall it
     * no longer has. Applied to the oxidation alone, the bare core stalled
     * on the melting plateau — losing 42 MW to steam across 560 m² of rods
     * that had already slumped, against 33 MW of decay heat — and never
     * reached the vessel.
     */
    const flux = zones.map(([z, frac, hA]) => ({
      z, frac,
      qGAP: hGAP * (z.TF - z.TL),
      qOut: frac > 1e-9 ? hA * (1 - z.g) * (z.TL - s.TC) : 0,
    }));
    let qCLraw = 0;
    for (const f of flux) qCLraw += f.frac * f.qOut;
    const qCorHead = s.breach || s.cor.mass <= 0 ? 0
      : H_COR * s.cor.mass * (s.cor.T - s.TS);

    /*
     * The coolant, solved before anything is allowed to dump heat into it.
     *
     * Implicit in T_C for the two linear couplings — the steam generator
     * and the lower head — because explicit, they go unstable below about
     * 545 kg of water: restore the feed to a nearly dry vessel and the
     * coolant temperature swung to −10⁵ K. And limited by what the water can
     * take. When there is not enough of it left to absorb the heat on offer,
     * all of it boils and the rest of the heat stays in the rods and the
     * head that produced it. Clamping the boil-off at zero instead threw
     * that heat away — invisibly, until a dry vessel was leaking 3 MW out of
     * the first law and a 20 kg/s trickle of injection 20 MW.
     */
    let lam = 1, qHeadW = 0, qSG = 0, TCn = s.TC, boil = 0;
    if (s.breach || s.m <= 0) {
      lam = 0;                                 // no fluid, no convection
    } else {
      const kSG = USG * u.feed, kH = H_HEAD_W, cap = s.m * CP_H2O;
      TCn = (cap * s.TC + dt * (qCLraw + kH * s.TS + kSG * TSEC)) / (cap + dt * (kH + kSG));
      if (TCn > TSAT) {
        TCn = TSAT;
        const qH = kH * (s.TS - TSAT), qS = kSG * (TSAT - TSEC);
        const eBoil = dt * (qCLraw + qH - qS) - cap * (TSAT - s.TC);
        if (eBoil <= s.m * HFG) {
          boil = Math.max(0, eBoil / HFG);
        } else {
          boil = s.m;
          const inflow = Math.max(0, qCLraw) + Math.max(0, qH);
          const room = (s.m * HFG + cap * (TSAT - s.TC)) / dt
                     + qS + Math.max(0, -qCLraw) + Math.max(0, -qH);
          lam = inflow > 0 ? Math.max(0, Math.min(1, room / inflow)) : 1;
        }
      }
      const qH = kH * (s.TS - TCn);
      qHeadW = qH > 0 ? qH * lam : qH;
      qSG = kSG * (TCn - TSEC);
    }

    // The lower head: corium in, water out.
    if (!s.breach) {
      s.TS += dt * (qCorHead - qHeadW) / C_S;
      if (s.TS >= T_VESSEL) { s.breach = true; s.marks.breach = tEnd; }
    }

    /* Melting at 3120 K and refreezing from it, paid for out of the latent
       heat, for a node of capacity C per unit. Returns the new temperature
       and moves the melt fraction. */
    const latent = (node, Tn, C) => {
      if (Tn > T_MELT && node.f < 1) {
        const spare = (Tn - T_MELT) * C / M_UO2;           // J per kg of fuel
        const used = Math.min(spare, (1 - node.f) * H_FUS);
        node.f += used / H_FUS;
        return T_MELT + (spare - used) * M_UO2 / C;
      }
      if (Tn < T_MELT && node.f > 0) {
        const deficit = (T_MELT - Tn) * C / M_UO2;
        const used = Math.min(deficit, node.f * H_FUS);
        node.f -= used / H_FUS;
        return T_MELT - (deficit - used) * M_UO2 / C;
      }
      return Tn;
    };

    let qCL = 0;
    for (const f of flux) {
      if (f.frac <= 1e-9 || s.breach) continue;
      const z = f.z;
      const qOut = f.qOut > 0 ? f.qOut * lam : f.qOut;
      qCL += f.frac * qOut;
      z.TF = latent(z, z.TF + dt * (pSpec - f.qGAP) / C_F, C_F);
      z.g = Math.max(z.g, z.f);
      z.TL += dt * (f.qGAP + (pOxSpec.get(z) || 0) - qOut) / C_L;
    }

    // The pool: decay heat in, heat out through the head and nowhere else.
    if (s.cor.mass > 0 && !s.breach) {
      s.cor.T = latent(s.cor,
        s.cor.T + dt * (pSpec - H_COR * (s.cor.T - s.TS)) / C_COR, C_COR);
    }

    /*
     * Relocation. Molten fuel cannot hang above a water pool: once every
     * rod above the water line has slumped, that fuel — and the cladding
     * that went with it — pours into the lower head. The pool's temperature
     * is the capacity-weighted mean of the two, the only choice that carries
     * the energy across unchanged, because the zones reference fuel to 900 K
     * and cladding to 620 K. A bare core relocates whole; a core being
     * reflooded loses only its top, and the rest stays standing in the water.
     * The rule used to be "the whole core is molten", which left a melted
     * top above a rising water line with no heat path at all — it reached
     * 6500 K before the water got to it.
     */
    const zd = s.z.d, dryMass = s.fuelIn * (1 - c1);
    if (!s.breach && dryMass > 1e-9 && zd.g >= 1 - 1e-9) {
      const Tnew = (C_F * zd.TF + C_L * zd.TL) / C_COR;
      const m0c = s.cor.mass, m1c = m0c + dryMass;
      s.cor.T = (m0c * s.cor.T + dryMass * Tnew) / m1c;
      s.cor.f = (m0c * s.cor.f + dryMass * zd.f) / m1c;
      s.cor.mass = m1c;
      s.fuelIn -= dryMass;
      s.cover = 1;                             // what is left is what was under water
      if (!s.relocated) { s.relocated = true; s.marks.relocate = tEnd; }
    }

    const cNow = s.cover, wIn = s.fuelIn * cNow, dIn = s.fuelIn * (1 - cNow);
    s.melted = wIn * s.z.w.f + dIn * s.z.d.f + s.cor.mass * s.cor.f;
    s.slumped = wIn * s.z.w.g + dIn * s.z.d.g + s.cor.mass;
    s.W = s.fuelIn > 1e-9 ? (wIn * s.z.w.W + dIn * s.z.d.W) / s.fuelIn : s.W;
    // What the reactivity sees is the fuel average; what fails is the peak.
    s.TF = wIn * s.z.w.TF + dIn * s.z.d.TF + s.cor.mass * s.cor.T;
    const live = [];
    if (wIn > 1e-9) live.push([s.z.w.TF, s.z.w.TL]);
    if (dIn > 1e-9) live.push([s.z.d.TF, s.z.d.TL]);
    if (s.cor.mass > 1e-9) live.push([s.cor.T, s.cor.T]);
    s.TFpeak = Math.max(...live.map((q) => q[0]));
    s.TL = Math.max(...live.map((q) => q[1]));

    // The coolant's new state, from the solve above.
    if (!s.breach && s.m > 0) {
      s.TC = TCn;
      s.m = Math.max(0, s.m - boil);
      s.steam = boil / dt;                         // kg/s rising through the core
    } else {
      s.steam = 0;
    }
    if (!s.breach && u.eccs > 0) s.m = Math.min(M_H2O, s.m + u.eccs * dt);
    s.qSG = qSG;

    s.k += 1;
    s.t = tEnd;
    s.pFis = pFis; s.pDec = pDec; s.pOx = pOx; s.rho = rho; s.parts = parts;
    s.qCOR = qCorHead; s.qHeadW = qHeadW; s.lvl = lvl;

    const M = s.marks;
    if (M.sat === undefined && s.TC >= TSAT - 0.05) M.sat = s.t;
    if (M.uncover === undefined && c1 < 1) M.uncover = s.t;
    if (M.bare === undefined && c1 <= 0) M.bare = s.t;
    if (M.burst === undefined && s.TL >= T_BURST) M.burst = s.t;
    if (M.zr === undefined && s.TL >= T_ZR) M.zr = s.t;
    if (M.melt === undefined && s.melted > 0) M.melt = s.t;
    return s;
  }

  /*
   * The period is measured, not computed. A window of ln n against plant time
   * is kept and a least-squares slope taken through it; the period is the
   * reciprocal. Nothing here consults the inhour equation — that is solved
   * separately, from the reactivity, so the two can be put side by side.
   */
  const LN_WINDOW = 30;      // s of plant time
  const LN_EVERY = LN_WINDOW / 40;
  function recordFlux(s) {
    if (s.n <= 0) return;
    /* At a fixed interval of PLANT time, not of frames. Sampling once per
       n substeps gave forty points in the window at the default speed and
       two at the top of the slider, where the fit then refused to report —
       the period would quietly stop existing as you sped the plant up. */
    const last = s.lnHist.length ? s.lnHist[s.lnHist.length - 1].t : -Infinity;
    if (s.t - last < LN_EVERY && s.lnHist.length) return;
    s.lnHist.push({ t: s.t, ln: Math.log(s.n) });
    while (s.lnHist.length > 1 && s.t - s.lnHist[0].t > LN_WINDOW) s.lnHist.shift();
  }
  function measuredPeriod(s) {
    const h = s.lnHist;
    if (h.length < 8 || h[h.length - 1].t - h[0].t < LN_WINDOW * 0.4) return null;
    let n = 0, st_ = 0, sl = 0, stt = 0, stl = 0;
    for (const q of h) { n++; st_ += q.t; sl += q.ln; stt += q.t * q.t; stl += q.t * q.ln; }
    const den = n * stt - st_ * st_;
    if (den <= 0) return null;
    const w = (n * stl - st_ * sl) / den;
    if (!isFinite(w)) return null;
    /* Flat is a measurement, not an absence of one. Returning null here
       printed "—" beside the inhour side's "∞" for a reactor that had been
       holding perfectly steady for a minute — as if the page had no data. */
    if (Math.abs(w) < 1e-7) return Infinity;
    return 1 / w;
  }

  /**
   * The inhour equation solved for ω, by bisection.
   *   ρ = ωΛ + Σᵢ βᵢ ω / (ω + λᵢ)
   * Above prompt critical there is no root below the first pole, so this
   * returns the prompt branch instead; below, the root lies in (−λ₁, 0).
   */
  function inhour(rho) {
    if (Math.abs(rho) < 1e-12) return Infinity;
    const f = (w) => w * L + BETA.reduce((a, b, i) => a + b * w / (w + LAM[i]), 0);
    let lo, hi;
    if (rho > 0) {
      if (rho >= B) return 1 / ((rho - B) / L);       // prompt branch
      lo = 1e-9; hi = 1;
      while (f(hi) < rho && hi < 1e7) hi *= 2;
    } else {
      hi = -1e-9; lo = -LAM[0] * (1 - 1e-9);
    }
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < rho) lo = mid; else hi = mid;
    }
    const w = (lo + hi) / 2;
    return Math.abs(w) < 1e-9 ? Infinity : 1 / w;
  }

  /** Way–Wigner, infinite irradiation: the fraction of rated power at t. */
  const wayWigner = (t) => 0.066 * Math.pow(Math.max(t, 1e-6), -0.2);

  // ── Drawing ───────────────────────────────────────────────────────────
  /*
   * The drawing's own coordinate space, fixed; the backing store is this
   * times the display's pixel ratio. Every stage on the site does the same,
   * and a canvas left at its markup size hands the compositor 860 px to
   * stretch over 1316 on a 2× display — soft, and the sweep says so.
   */
  const W = 860, H = 440;
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const VX = 24, VW = 250;                     // vessel panel
  const CX = VX + VW + 34, CW = W - CX - 18;   // chart panel

  /*
   * Hot-metal ramp, from cold steel through dull red and amber to white.
   * The cold end has to be a colour the water is not: at #1d4f7c a steel
   * blue for the cladding made the whole core invisible until it glowed.
   */
  function hot(T) {
    const stops = [[550, 132, 150, 188], [900, 152, 132, 122], [1200, 196, 96, 64],
                   [1500, 232, 132, 50], [1900, 255, 178, 60],
                   [2400, 255, 224, 120], [3000, 255, 246, 210], [3400, 255, 255, 255]];
    if (T <= stops[0][0]) return `rgb(${stops[0][1]},${stops[0][2]},${stops[0][3]})`;
    for (let i = 1; i < stops.length; i++) {
      if (T <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const u = (T - a[0]) / (b[0] - a[0]);
        return `rgb(${Math.round(a[1] + u * (b[1] - a[1]))},`
             + `${Math.round(a[2] + u * (b[2] - a[2]))},`
             + `${Math.round(a[3] + u * (b[3] - a[3]))})`;
      }
    }
    return "rgb(255,255,255)";
  }

  const LV_TOP = 52, LV_BOT = 360;                       // level 1.0 → 0.0
  const yLevel = (f) => LV_BOT - Math.max(0, Math.min(1, f)) * (LV_BOT - LV_TOP);

  function drawVessel(s) {
    const x0 = VX, x1 = VX + VW;
    const yCoreTop = yLevel(CORE_TOP), yCoreBot = yLevel(CORE_BOT);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0, 30, VW, 366, 26);
    ctx.clip();

    // Steam fills what the water has left.
    ctx.fillStyle = C_STEAM;
    ctx.fillRect(x0, 30, VW, 366);
    const yw = yLevel(s.lvl ?? 1);
    ctx.fillStyle = C_WATER;
    ctx.fillRect(x0, yw, VW, LV_BOT - yw + 20);

    // The lower head, at its own temperature — this is what fails.
    ctx.fillStyle = hot(s.TS ?? TC0);
    ctx.fillRect(x0, LV_BOT + 4, VW, 396 - LV_BOT);

    /*
     * The core: eighteen fuel assemblies. Their height is the fuel still
     * standing — what has relocated is gone from the core, and what has
     * slumped stays slumped even if it refreezes — and they are painted in
     * two pieces at the real water line: below it at the wet zone's
     * cladding temperature, above it at the dry zone's. Those are the
     * temperatures the model carries, so the picture is the state and not
     * a gloss on it. Drawing the height from the melt fraction instead let
     * the rods grow back as relocated corium refroze in the lower head.
     */
    const rods = 18, gap = (VW - 24) / rods;
    const standing = s.fuelIn === undefined ? 1
      : Math.max(0, s.fuelIn - (s.slumped - (s.cor ? s.cor.mass : 0)));
    const yTopNow = yCoreBot - (yCoreBot - yCoreTop) * standing;
    const yWater = Math.max(yTopNow, Math.min(yCoreBot, yLevel(s.lvl ?? 1)));
    const zw = s.z ? s.z.w : { TL: TL0 }, zd = s.z ? s.z.d : { TL: TL0 };
    for (let i = 0; i < rods; i++) {
      const x = x0 + 12 + gap * (i + 0.5);
      ctx.lineWidth = gap * 0.52;
      if (yWater < yCoreBot - 0.5) {
        ctx.strokeStyle = hot(zw.TL);
        ctx.beginPath(); ctx.moveTo(x, yCoreBot); ctx.lineTo(x, yWater); ctx.stroke();
      }
      if (yTopNow < yWater - 0.5) {
        ctx.strokeStyle = hot(zd.TL);
        ctx.beginPath(); ctx.moveTo(x, yWater); ctx.lineTo(x, yTopNow); ctx.stroke();
      }
    }

    // What has relocated lies in the lower head as a pool.
    const pool = s.cor ? s.cor.mass : 0;
    if (pool > 1e-3) {
      ctx.fillStyle = hot(s.cor.T);
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, LV_BOT + 16, VW * 0.44 * Math.sqrt(pool), 8 + pool * 30,
                  0, Math.PI, 0, true);
      ctx.fill();
    }

    // Control rods, dropped from the head by however much worth is in.
    const rodPcm = s.parts ? s.parts.rod * 1e5 : 0;
    const ins = Math.max(0, Math.min(1, -rodPcm / 800));
    ctx.strokeStyle = C_ROD;
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const x = x0 + 30 + (VW - 60) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(x, 36);
      ctx.lineTo(x, yCoreTop - 12 + ins * (yCoreBot - yCoreTop + 12));
      ctx.stroke();
    }

    // Hydrogen gathering under the head once the cladding is reacting.
    if (s.h2 > 1) {
      ctx.fillStyle = "#b9c8ea";
      const nb = Math.min(26, Math.round(s.h2 / 20) + 2);
      for (let i = 0; i < nb; i++) {
        const a = i * 2.399963;
        const bx = x0 + 20 + ((Math.cos(a) * 0.5 + 0.5) * (VW - 40));
        const by = 40 + (i % 6) * 8 + Math.sin(a * 3) * 4;
        ctx.beginPath(); ctx.arc(bx, by, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // Vessel wall — broken open once the lower head has gone.
    ctx.strokeStyle = s.breach ? C_WARN : C_VESSEL;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x0, 30, VW, 366, 26); ctx.stroke();
    if (s.breach) {
      ctx.fillStyle = hot(Math.max(s.cor ? s.cor.T : TF0, 2600));
      ctx.beginPath();
      ctx.moveTo((x0 + x1) / 2 - 18, 392);
      ctx.lineTo((x0 + x1) / 2 + 18, 392);
      ctx.lineTo((x0 + x1) / 2 + 6, 424);
      ctx.lineTo((x0 + x1) / 2 - 6, 424);
      ctx.closePath(); ctx.fill();
    }

    ctx.strokeStyle = INK_MUTED; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const y of [yCoreTop, yCoreBot]) {
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = "#8fc4ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, yw); ctx.lineTo(x1, yw); ctx.stroke();

    ctx.fillStyle = INK_MUTED;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("nrCoreLabel", "core"), x0 + 6, (yCoreTop + yCoreBot) / 2 + 4);
    ctx.textAlign = "right";
    ctx.fillText(`${((s.lvl ?? 1) * 100).toFixed(0)}%`, x1 - 6, yw - 5);
    ctx.textAlign = "left";
  }

  const CH = [
    { y: 34, h: 104 },     // power
    { y: 162, h: 104 },    // temperatures
    { y: 290, h: 104 },    // reactivity
  ];

  function chartFrame(box, title) {
    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    ctx.strokeRect(CX + 0.5, box.y + 0.5, CW - 1, box.h);
    ctx.fillStyle = INK_MUTED;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(title, CX + 4, box.y - 5);
  }

  function drawCharts(s) {
    const tr = s.trace;
    const t1 = tr.length ? tr[tr.length - 1].t : 1;
    const t0 = tr.length ? tr[0].t : 0;
    const span = Math.max(t1 - t0, 1);
    const X = (t) => CX + ((t - t0) / span) * (CW - 1);

    // ── power, on a log scale ──
    {
      const box = CH[0];
      chartFrame(box, i18nText("nrChartPower", "Power (fraction of rated, log)"));
      const lo = -4, hi = Math.log10(2);
      const Y = (v) => box.y + box.h - ((Math.log10(Math.max(v, 1e-5)) - lo) / (hi - lo)) * box.h;
      ctx.strokeStyle = GRID;
      for (const d of [1, 0.1, 0.01, 1e-3]) {
        const y = Y(d);
        ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX + CW - 1, y); ctx.stroke();
      }
      for (const [key, col] of [["n", C_FIS], ["dec", C_DEC]]) {
        ctx.strokeStyle = col; ctx.lineWidth = 1.6;
        ctx.beginPath();
        tr.forEach((q, i) => { const y = Y(q[key]); i ? ctx.lineTo(X(q.t), y) : ctx.moveTo(X(q.t), y); });
        ctx.stroke();
      }
      legend(box, [[C_FIS, i18nText("nrLegFission", "fission")],
                   [C_DEC, i18nText("nrLegDecay", "decay heat")]]);
    }

    // ── temperatures ──
    {
      const box = CH[1];
      chartFrame(box, i18nText("nrChartTemp", "Temperature (K)"));
      let top = 1000;
      for (const q of tr) top = Math.max(top, q.TF, q.TL);
      top = Math.min(3400, Math.ceil(top / 200) * 200 + 100);
      const Y = (v) => box.y + box.h - ((v - 500) / (top - 500)) * box.h;
      ctx.setLineDash([3, 3]);
      for (const [T, lab] of [[T_BURST, "1473 K"], [T_MELT, "3120 K"]]) {
        if (T > top) continue;
        ctx.strokeStyle = C_WARN;
        const y = Y(T);
        ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX + CW - 1, y); ctx.stroke();
        ctx.fillStyle = C_WARN; ctx.font = "10px system-ui, sans-serif";
        ctx.textAlign = "right"; ctx.fillText(lab, CX + CW - 4, y - 3); ctx.textAlign = "left";
      }
      ctx.setLineDash([]);
      for (const [key, col] of [["TF", C_TF], ["TL", C_TL], ["TC", C_TC]]) {
        ctx.strokeStyle = col; ctx.lineWidth = 1.6;
        ctx.beginPath();
        tr.forEach((q, i) => { const y = Y(q[key]); i ? ctx.lineTo(X(q.t), y) : ctx.moveTo(X(q.t), y); });
        ctx.stroke();
      }
      legend(box, [[C_TF, i18nText("nrLegFuel", "fuel")],
                   [C_TL, i18nText("nrLegClad", "clad")],
                   [C_TC, i18nText("nrLegCoolant", "coolant")]]);
    }

    // ── reactivity ──
    {
      const box = CH[2];
      chartFrame(box, i18nText("nrChartRho", "Reactivity (pcm)"));
      /* Autoscaled, with no ceiling: a scram is −6000 pcm and a melting
         core drives the Doppler term past −10000, and a capped axis would
         quietly draw those off the edge of the box. */
      let mag = 200;
      for (const q of tr) mag = Math.max(mag, Math.abs(q.rho) * 1e5, Math.abs(q.xe) * 1e5);
      mag *= 1.15;
      const Y = (v) => box.y + box.h / 2 - (v / mag) * (box.h / 2);
      ctx.strokeStyle = GRID;
      ctx.beginPath(); ctx.moveTo(CX, Y(0)); ctx.lineTo(CX + CW - 1, Y(0)); ctx.stroke();
      for (const [key, col] of [["rho", C_RHO], ["xe", C_XE]]) {
        ctx.strokeStyle = col; ctx.lineWidth = 1.6;
        ctx.beginPath();
        tr.forEach((q, i) => { const y = Y(q[key] * 1e5); i ? ctx.lineTo(X(q.t), y) : ctx.moveTo(X(q.t), y); });
        ctx.stroke();
      }
      legend(box, [[C_RHO, i18nText("nrLegTotal", "total ρ")],
                   [C_XE, i18nText("nrLegXenon", "Δxenon")]]);
    }
  }

  function legend(box, items) {
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";
    let x = CX + 6;
    for (const [col, label] of items) {
      ctx.fillStyle = col;
      ctx.fillRect(x, box.y + box.h - 11, 8, 3);
      ctx.fillStyle = INK_MUTED;
      ctx.fillText(label, x + 12, box.y + box.h - 6);
      x += 18 + ctx.measureText(label).width;
    }
  }

  function draw() {
    fitCanvas();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a0f1e");
    g.addColorStop(1, "#120e1c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (!st) return;
    drawVessel(st);
    drawCharts(st);

    ctx.fillStyle = INK;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("nrVesselLabel", "Reactor vessel"), VX, 20);
  }

  // ── Readouts ──────────────────────────────────────────────────────────
  /* toFixed keeps the sign of a value that rounds to zero, so a reactor
     sitting exactly critical read "-0.0 pcm". */
  const fx = (x, d) => {
    const r = Number(x.toFixed(d));
    return (r === 0 ? 0 : r).toFixed(d);
  };
  const clock = (t) => {
    if (t < 120) return `${t.toFixed(1)} s`;
    if (t < 7200) return `${(t / 60).toFixed(1)} min`;
    return `${(t / 3600).toFixed(2)} h`;
  };

  /*
   * The condition, as a key. The panel translates it; the CSV writes the
   * key itself, because a column that changed with the reader's language
   * would break every script that reads it.
   */
  const CONDITION = {
    vessel_breach: ["nrStateBreach", "vessel breach"],
    core_relocated: ["nrStateRelocate", "core relocated"],
    fuel_melting: ["nrStateMelt", "fuel melting"],
    cladding_melting: ["nrStateZr", "cladding melting"],
    cladding_burst: ["nrStateBurst", "cladding burst"],
    core_uncovering: ["nrStateUncovered", "core uncovering"],
    core_damaged_cooled: ["nrStateDamaged", "core damaged, cooled"],
    prompt_critical: ["nrStatePrompt", "prompt critical"],
    supercritical: ["nrStateSuper", "supercritical"],
    subcritical: ["nrStateSub", "subcritical"],
    critical: ["nrStateCritical", "critical"],
  };
  function conditionKey(s) {
    if (s.breach) return "vessel_breach";
    if (s.relocated) return "core_relocated";
    if (s.melted > 0) return "fuel_melting";
    if (s.TL >= T_ZR) return "cladding_melting";
    if (s.TL >= T_BURST) return "cladding_burst";
    if ((s.cover ?? 1) < 1) return "core_uncovering";
    /* Damage does not heal. A core whose cladding has burst and been cooled
       again is subcritical, and saying only that described the reactor at
       Three Mile Island the morning after as if nothing had happened. */
    if (s.marks && s.marks.burst !== undefined) return "core_damaged_cooled";
    if (s.rho > B) return "prompt_critical";
    if (s.rho > 1e-5) return "supercritical";
    if (s.rho < -1e-5) return "subcritical";
    return "critical";
  }
  const condition = (s) => i18nText(...CONDITION[conditionKey(s)]);

  function updateReadouts() {
    if (!st) return;
    const s = st;
    out.power.textContent = `${(s.pFis / 1e6).toFixed(1)} MW (${(100 * s.n).toFixed(2)}%)`;
    const decFrac = s.pDec / P0;
    out.decay.textContent = `${(100 * decFrac).toFixed(3)}%`;
    out.decayWW.textContent = s.tScram >= 0 && s.t > s.tScram + 1
      ? `${(100 * wayWigner(s.t - s.tScram)).toFixed(3)}%` : "—";

    const T = measuredPeriod(s);
    out.period.textContent = T === null ? "—"
      : Math.abs(T) > 9999 ? "∞" : `${T.toFixed(1)} s`;
    const Ti = inhour(s.rho);
    out.periodTheory.textContent = !isFinite(Ti) ? "∞"
      : Math.abs(Ti) > 9999 ? "∞" : `${Ti.toFixed(1)} s`;

    out.rho.textContent = `${fx(s.rho * 1e5, 1)} pcm`;
    const p = s.parts;
    out.rhoParts.textContent =
      `${fx(p.rod * 1e5, 0)} / ${fx(p.dop * 1e5, 0)} / `
      + `${fx(p.mod * 1e5, 0)} / ${fx(p.xe * 1e5, 0)}`;
    out.tf.textContent = `${(s.TFpeak ?? s.TF).toFixed(0)} K`;
    out.tl.textContent = `${s.TL.toFixed(0)} K`;
    out.tc.textContent = `${s.TC.toFixed(1)} K`;
    out.ts.textContent = `${s.TS.toFixed(0)} K`;
    out.level.textContent = `${(100 * (s.lvl ?? 1)).toFixed(1)}%`;
    out.ox.textContent = `${(100 * s.zr / M_ZR).toFixed(2)}%`;
    out.h2.textContent = `${s.h2.toFixed(1)} kg`;
    out.xe.textContent = `${fx(XE_WORTH * s.X / X_EQ * 1e5, 0)} pcm`;
    out.state.textContent = condition(s);
    out.clock.textContent = clock(s.t);
  }

  // ── Loop ──────────────────────────────────────────────────────────────
  const TRACE_MAX = 460;
  function record(s) {
    let dec = 0;
    for (let j = 0; j < DL.length; j++) dec += s.D[j];
    s.trace.push({ t: s.t, n: s.n, dec, TF: s.TFpeak ?? s.TF, TL: s.TL, TC: s.TC,
                   lvl: s.lvl ?? 1, rho: s.rho, xe: s.parts.xe });
    if (s.trace.length > TRACE_MAX) s.trace.shift();
  }

  // ── The historian ─────────────────────────────────────────────────────
  /*
   * The plant's record of itself, which is what Export CSV hands over.
   *
   * It used to hand over the chart's trace instead: one row per frame, the
   * last 460 frames. So the file's time step was whatever the speed slider
   * happened to be — 0.05 s at one end, 100 s at the other — and a run left
   * going for a fortnight exported its last 12.8 hours of cold, flat
   * shutdown, with the accident that had oxidised 40% of the cladding long
   * gone off the front. The header said 445 kg of hydrogen; not one row
   * showed it being made.
   *
   * This is exception logging, the way a plant's data historian works. It
   * runs on every step, not every frame, and writes a row when something
   * has moved further than its deadband since the last row written — so it
   * is dense through a cladding burst and sparse through a week of cold
   * shutdown — plus a row for every event and every change of the controls,
   * and at least one an hour so a quiet stretch still says it was quiet.
   * Nothing about it depends on how fast the reader ran the plant: the same
   * run at any speed writes the same file.
   *
   * Each row is the whole state at that step, at full precision, and says
   * why it was written. A blackout to breach is about 2500 rows; a
   * fortnight with a meltdown in it about 2900. Past LOG_CAP the log thins
   * itself — every other ordinary row goes and the deadbands double, so what
   * is left is still a consistent record at the coarser resolution — and it
   * never drops the first row or an event.
   */
  const LOG_COLUMNS = [
    "t_s", "logged_for", "condition",
    "fission_fraction", "fission_MW", "decay_fraction", "decay_heat_MW", "oxidation_MW",
    "rho_pcm", "rod_pcm", "doppler_pcm", "moderator_pcm", "xenon_change_pcm", "xe135_worth_pcm",
    "omega_measured_per_s", "omega_inhour_per_s",
    "T_fuel_peak_K", "T_fuel_mean_K", "T_clad_peak_K", "T_coolant_K", "T_lower_head_K",
    "water_kg", "level_fraction", "fuel_standing_fraction", "standing_fuel_covered_fraction",
    "steam_kg_s", "zr_oxidised_fraction", "hydrogen_kg",
    "melted_fraction", "slumped_fraction", "relocated_fraction",
    "rod_setting_pcm", "feed_fraction", "eccs_kg_s", "scram",
  ];
  const COL = Object.fromEntries(LOG_COLUMNS.map((c, i) => [c, i]));
  const DEADBAND = {
    temperature: 0.002,     // relative: 1.2 K at the coolant, 6 K at the melting point
    fissionMW: 3,           // 0.1% of rated
    fissionLog10: 0.1,      // and a quarter of a decade once it is that small
    decayHeat: 0.005,       // relative: log-spaced along Way–Wigner's power law
    rhoPcm: 10,
    level: 0.0025,          // 625 kg of water
    zr: 0.0025,             // of the zircaloy
    core: 0.005,            // melted, slumped, relocated
    heartbeat: 3600,        // s of plant time
  };
  const LOG_CAP = 10000;
  const EVENTS = { sat: "saturation", uncover: "uncovery", burst: "cladding_burst",
                   bare: "core_bare", zr: "cladding_melt", melt: "fuel_melt",
                   relocate: "relocation", breach: "vessel_breach" };

  const EVENT_KEYS = Object.keys(EVENTS);
  const markMask = (s) => {
    let m = 0;
    for (let i = 0; i < EVENT_KEYS.length; i++) if (s.marks[EVENT_KEYS[i]] !== undefined) m |= 1 << i;
    return m;
  };

  function newLog() {
    return { rows: [], scale: 1, thinned: 0, marks: 0, rod: NaN, feed: NaN, eccs: NaN, scram: false,
             peak: { TL: -Infinity, TLat: 0, TF: -Infinity, TFat: 0, TS: -Infinity, TSat: 0,
                     lvl: Infinity, lvlAt: 0 },
             cap: LOG_CAP };
  }

  /** The whole state as one row, in LOG_COLUMNS order. */
  function rowOf(s, u, why) {
    const T = measuredPeriod(s), Ti = inhour(s.rho);
    const standingSlumped = s.slumped - s.cor.mass;
    return [
      s.t, why, conditionKey(s),
      s.n, s.pFis / 1e6, s.pDec / P0, s.pDec / 1e6, s.pOx / 1e6,
      s.rho * 1e5, s.parts.rod * 1e5, s.parts.dop * 1e5, s.parts.mod * 1e5, s.parts.xe * 1e5,
      XE_WORTH * s.X / X_EQ * 1e5,
      T === null ? null : (Number.isFinite(T) ? 1 / T : 0),
      Number.isFinite(Ti) ? 1 / Ti : 0,
      s.TFpeak ?? s.TF, s.TF, s.TL, s.TC, s.TS,
      s.m, s.m / M_H2O, Math.max(0, s.fuelIn - standingSlumped), s.cover,
      s.steam, s.zr / M_ZR, s.h2,
      s.melted, s.slumped, s.cor.mass,
      u.rod, u.feed, u.eccs, s.scram ? 1 : 0,
    ];
  }

  /*
   * Why this step deserves a row, or null. Deadbands are measured against
   * the last row written, not the last step, so a slow drift is caught
   * when it adds up rather than missed one small step at a time.
   */
  function whyLog(log, s, u) {
    const last = log.rows[log.rows.length - 1];
    const mask = markMask(s);
    if (mask !== log.marks) {
      return EVENT_KEYS.filter((k, i) => (mask & ~log.marks) & (1 << i))
        .map((k) => EVENTS[k]).join("+");
    }
    if (s.scram !== log.scram) return "scram";
    if (u.rod !== log.rod || u.feed !== log.feed || u.eccs !== log.eccs) return "control";
    const k = log.scale, d = DEADBAND;
    const rel = (a, b, band) => Math.abs(Math.log(a / b)) >= band * k;
    if (rel(s.TFpeak ?? s.TF, last[COL.T_fuel_peak_K], d.temperature)
        || rel(s.TF, last[COL.T_fuel_mean_K], d.temperature)
        || rel(s.TL, last[COL.T_clad_peak_K], d.temperature)
        || rel(s.TC, last[COL.T_coolant_K], d.temperature)
        || rel(s.TS, last[COL.T_lower_head_K], d.temperature)) return "change";
    const n0 = last[COL.fission_fraction];
    if (Math.abs(s.n - n0) * PF / 1e6 >= d.fissionMW * k
        || (s.n > 1e-12 && n0 > 1e-12 && Math.abs(Math.log10(s.n / n0)) >= d.fissionLog10 * k)
        || (s.n > 1e-12) !== (n0 > 1e-12)) return "change";
    if (rel(s.pDec, last[COL.decay_heat_MW] * 1e6, d.decayHeat)) return "change";
    if (Math.abs(s.rho * 1e5 - last[COL.rho_pcm]) >= d.rhoPcm * k) return "change";
    if (Math.abs(s.m / M_H2O - last[COL.level_fraction]) >= d.level * k
        || Math.abs(s.zr / M_ZR - last[COL.zr_oxidised_fraction]) >= d.zr * k
        || Math.abs(s.melted - last[COL.melted_fraction]) >= d.core * k
        || Math.abs(s.slumped - last[COL.slumped_fraction]) >= d.core * k
        || Math.abs(s.cor.mass - last[COL.relocated_fraction]) >= d.core * k) return "change";
    if (s.t - last[COL.t_s] >= d.heartbeat * k) return "heartbeat";
    return null;
  }

  function writeRow(log, s, u, why) {
    log.rows.push(rowOf(s, u, why));
    log.marks = markMask(s);
    log.scram = s.scram;
    log.rod = u.rod; log.feed = u.feed; log.eccs = u.eccs;
    if (log.rows.length > log.cap) thin(log);
  }

  /* Halve the ordinary rows and double the deadbands. The first row, every
     event and every scram survive; so does the last row, which the next
     deadband is measured from. */
  function thin(log) {
    const keep = [];
    let alt = 0;
    const lastI = log.rows.length - 1;
    log.rows.forEach((r, i) => {
      const why = r[COL.logged_for];
      const ordinary = why === "change" || why === "heartbeat" || why === "control";
      if (!ordinary || i === 0 || i === lastI || (alt++ & 1) === 0) keep.push(r);
    });
    log.rows = keep;
    log.scale *= 2;
    log.thinned += 1;
  }

  /** Called after every step the reader's plant takes. */
  function logStep(s, u) {
    const log = s.log;
    const pk = log.peak;
    if (s.TL > pk.TL) { pk.TL = s.TL; pk.TLat = s.t; }
    const tf = s.TFpeak ?? s.TF;
    if (tf > pk.TF) { pk.TF = tf; pk.TFat = s.t; }
    if (s.TS > pk.TS) { pk.TS = s.TS; pk.TSat = s.t; }
    const lv = s.m / M_H2O;
    if (lv < pk.lvl) { pk.lvl = lv; pk.lvlAt = s.t; }
    const why = whyLog(log, s, u);
    if (why) writeRow(log, s, u, why);
  }

  function advance(sub) {
    const u = readParams();
    for (let k = 0; k < sub; k++) {
      step(st, DT, u);
      recordFlux(st);
      logStep(st, u);
    }
    record(st);
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    /*
     * dt from the timestamp we are handed, and nothing else. Reduced motion
     * freezes it, so this is zero and the plant holds still — a loop that
     * stepped a fixed count per callback would keep running right through it.
     */
    const dtWall = lastTs ? ts - lastTs : 0;
    lastTs = ts;
    if (running && dtWall > 0) advance(readParams().speed);
    draw();
    updateReadouts();
  }

  function reset() {
    st = fresh();
    st.log = newLog();
    lastTs = 0;
    record(st); recordFlux(st);
    writeRow(st.log, st, readParams(), "start");
    draw(); updateReadouts();
  }

  function syncStart() {
    startBtn.textContent = running
      ? i18nText("pauseBtn", "Pause") : i18nText("startBtn", "Start");
  }

  function applyLabels() {
    const q = readParams();
    vals.rod.textContent = q.rod.toFixed(0);
    vals.feed.textContent = (q.feed * 100).toFixed(0);
    vals.eccs.textContent = q.eccs.toFixed(0);
    vals.speed.textContent = q.speed.toFixed(0);
  }

  for (const el of Object.values(inputs)) {
    el.addEventListener("input", () => { applyLabels(); updateReadouts(); });
  }

  startBtn.addEventListener("click", () => {
    running = !running;
    if (running) lastTs = 0;
    syncStart();
    window.SFX?.click({ gain: 0.18 });
  });
  scramBtn.addEventListener("click", () => {
    if (st) { st.scram = true; if (st.tScram < 0) st.tScram = st.t; }
    updateReadouts();
    window.SFX?.click({ gain: 0.3 });
  });
  sboBtn.addEventListener("click", () => {
    /* Station blackout: the turbine trips, the reactor scrams on it, and
       every pump — feedwater and emergency injection alike — stops. */
    if (st) { st.scram = true; if (st.tScram < 0) st.tScram = st.t; }
    inputs.feed.value = "0";
    inputs.eccs.value = "0";
    inputs.speed.value = String(Math.max(400, readParams().speed));
    for (const el of [inputs.feed, inputs.eccs, inputs.speed]) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    applyLabels();
    if (!running) { running = true; lastTs = 0; syncStart(); }
    window.SFX?.click({ gain: 0.3 });
  });
  resetBtn.addEventListener("click", () => {
    running = false; syncStart(); reset();
    window.SFX?.click({ gain: 0.18 });
  });
  document.addEventListener("langchange", () => { syncStart(); updateReadouts(); draw(); });
  document.addEventListener("qualitychange", () => {
    DT = window.Quality.pick(DT_STD, 0.02);
    running = false; syncStart(); reset();
  });

  /** The file: the whole log, then the plant as it stands right now. */
  function csvDataset() {
    if (!st || !st.log) return null;
    const log = st.log, u = readParams();
    const rows = log.rows.slice();
    if (st.t > rows[rows.length - 1][COL.t_s]) rows.push(rowOf(st, u, "end"));
    const meta = {
      page_version: (document.querySelector(".version-tag")?.textContent || "").trim(),
      plant_time_s: st.t, steps: st.k, step_dt_s: DT,
      rated_thermal_W: P0, beta_total: B, generation_time_s: L,
      alpha_fuel_per_K: aF, alpha_moderator_per_K: aM,
      rod_setting_pcm: u.rod, feed_fraction: u.feed, eccs_kg_s: u.eccs,
      steps_per_frame: u.speed,
      scram_at_s: st.tScram >= 0 ? st.tScram : "none",
    };
    for (const [k, name] of Object.entries(EVENTS)) {
      if (st.marks[k] !== undefined) meta[`event_${name}_s`] = st.marks[k];
    }
    const pk = log.peak;
    Object.assign(meta, {
      peak_T_clad_K: pk.TL, peak_T_clad_at_s: pk.TLat,
      peak_T_fuel_K: pk.TF, peak_T_fuel_at_s: pk.TFat,
      peak_T_lower_head_K: pk.TS, peak_T_lower_head_at_s: pk.TSat,
      lowest_level_fraction: pk.lvl, lowest_level_at_s: pk.lvlAt,
      zr_oxidised_fraction: st.zr / M_ZR, hydrogen_kg: st.h2,
      relocated_fraction: st.cor.mass, vessel_breached: st.breach ? 1 : 0,
      sampling: "a row at the start; on every event, scram and control change; "
        + "whenever a quantity moves past its deadband since the last row; "
        + "and at least once per heartbeat of plant time",
      deadband_temperature_relative: DEADBAND.temperature * log.scale,
      deadband_fission_MW: DEADBAND.fissionMW * log.scale,
      deadband_fission_log10: DEADBAND.fissionLog10 * log.scale,
      deadband_decay_heat_relative: DEADBAND.decayHeat * log.scale,
      deadband_rho_pcm: DEADBAND.rhoPcm * log.scale,
      deadband_level_fraction: DEADBAND.level * log.scale,
      deadband_zr_fraction: DEADBAND.zr * log.scale,
      deadband_core_fraction: DEADBAND.core * log.scale,
      heartbeat_s: DEADBAND.heartbeat * log.scale,
      thinned: log.thinned,
      omega_definition: "1 / period; 0 when flat, empty while there is not yet a window to fit",
    });
    return {
      name: `reactor-${(st.t / 3600).toFixed(1)}h.csv`,
      title: "Nuclear reactor — plant historian",
      columns: LOG_COLUMNS, rows, meta,
    };
  }
  if (window.CSVExport) window.CSVExport.attach("csv-btn", csvDataset);

  window.__reactor = {
    K: { BETA, LAM, B, L, DA, DL, SC, P0, PF, C_F, C_L, M_UO2, M_ZR, M_H2O,
         CP_H2O, HFG, TF0, TL0, TC0, TSAT, TSEC, aF, aM, hGAP, USG,
         A_CLAD, H_BOIL, H_STEAM, ZR_AREA, W_FULL, H_OX, H2_PER_ZR, STEAM_PER_ZR,
         BJ_A, BJ_B, RCAL, CP_ZR, CP_UO2,
         CORE_TOP, CORE_BOT, T_BURST, T_ZR, T_MELT, H_FUS,
         M_STEEL, CP_STEEL, C_S, H_COR, H_HEAD_W, T_VESSEL,
         X_EQ, I_EQ, XE_WORTH, SCRAM_RHO, PHI0, SIGF, sX, lI, lX, gI, gX },
    get DT() { return DT; },
    fresh, step, stepPK, stepXe, stepDecayHeat, oxidationStep,
    inhour, wayWigner, measuredPeriod, recordFlux,
    params: readParams,
    /** The historian: its rows, its deadbands, the dataset Export CSV builds. */
    historian: {
      columns: LOG_COLUMNS, deadband: DEADBAND, events: EVENTS,
      log: () => st && st.log,
      dataset: csvDataset,
    },
    state: () => st,
    reset,
    scram: () => { if (st) { st.scram = true; if (st.tScram < 0) st.tScram = st.t; } },
    setRunning: (v) => { running = v; if (v) lastTs = 0; syncStart(); },
    isRunning: () => running,
    /** Step the live state without the animation loop, for testing. */
    advance,
    /** Run a fresh plant headlessly and hand back the whole trace. */
    run(opts = {}) {
      const dt = opts.dt ?? DT;
      const u = { rod: opts.rod ?? 0, feed: opts.feed ?? 1, eccs: opts.eccs ?? 0 };
      const s = fresh();
      if (opts.scram) { s.scram = true; s.tScram = 0; }
      if (opts.n0 !== undefined) s.n = opts.n0;
      const every = opts.sample ?? 0;
      const trace = [];
      const steps = Math.round((opts.T ?? 100) / dt);
      for (let k = 0; k < steps; k++) {
        step(s, dt, typeof opts.control === "function" ? opts.control(s.t, u) : u);
        if (every && k % every === 0) {
          let dec = 0; for (let j = 0; j < DL.length; j++) dec += s.D[j];
          trace.push({ t: s.t, n: s.n, dec, TF: s.TFpeak ?? s.TF, TFavg: s.TF,
                       TL: s.TL, TC: s.TC, TS: s.TS, zr: s.zr, steam: s.steam,
                       slumped: s.slumped, fuelIn: s.fuelIn, cor: s.cor.mass,
                       m: s.m, rho: s.rho, W: s.W, h2: s.h2, melted: s.melted,
                       pFis: s.pFis, pDec: s.pDec, pOx: s.pOx, qCOR: s.qCOR ?? 0,
                       breach: s.breach, relocated: s.relocated });
        }
      }
      let dec = 0; for (let j = 0; j < DL.length; j++) dec += s.D[j];
      return { s, trace, dec };
    },
  };

  applyLabels();
  reset();
  raf = requestAnimationFrame(frame);
})();
