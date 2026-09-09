/*
 * Nuclear reactor — point kinetics, feedback, decay heat, and a meltdown.
 *
 * Nothing on this page prints a textbook answer. What runs is a mechanism:
 *
 *   · point kinetics with six delayed-neutron groups (Keepin, U-235 thermal),
 *     stepped by Crank–Nicolson;
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
 * One fuel temperature, one clad temperature, one coolant temperature. A real
 * core has a power profile, a hot channel, and an axial level that uncovers
 * from the top down; this has none of those. What it keeps is the part that
 * decides the outcome — how much heat there is, where it can go, and what the
 * temperature does to the reactivity. The blackout timeline it produces
 * (saturation at 8 min, uncovery at 49, cladding burst at 89, fuel melting at
 * 110, ~345 kg of hydrogen at ~31% cladding oxidation) is close to what
 * happened at TMI-2, which is the most that can be asked of three nodes.
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
      t: 0,
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
      z: { w: { TF: TF0, TL: TL0, W: 0, f: 0 },
           d: { TF: TF0, TL: TL0, W: 0, f: 0 } },
      cover: 1,
      TF: TF0, TL: TL0, TC: TC0,
      m: M_H2O, TS: TC0,
      I: I_EQ, X: X_EQ,
      W: 0, h2: 0, melted: 0,
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

  /** Point kinetics, Crank–Nicolson (θ = ½). Unconditionally stable. */
  function stepPK(s, rho, dt) {
    const th = 0.5, n = s.n, C = s.C;
    let sSrc = 0, sImp = 0;
    for (let i = 0; i < 6; i++) {
      const d = 1 + th * dt * LAM[i];
      sSrc += LAM[i] * (C[i] * (1 - (1 - th) * dt * LAM[i])
                        + dt * BETA[i] * (1 - th) * n / L) / d;
      sImp += LAM[i] * dt * BETA[i] * th / (L * d);
    }
    const a0 = (rho - B) / L;
    let lag = 0;
    for (let i = 0; i < 6; i++) lag += LAM[i] * C[i];
    const n1 = (n + dt * ((1 - th) * (a0 * n + lag) + th * sSrc))
             / (1 - dt * th * (a0 + sImp));
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
     * The water line, and the zone boundary that follows it. Fuel that goes
     * from wet to dry arrives at the temperature it had, so the handover
     * conserves energy exactly; the oxide and the melt fraction move with it
     * for the same reason.
     */
    const lvl = s.m / M_H2O;
    const c0 = s.cover;
    const c1 = Math.max(0, Math.min(1, (lvl - CORE_BOT) / (CORE_TOP - CORE_BOT)));
    const mixInto = (to, from, held, moved) => {
      for (const k of ["TF", "TL", "W", "f"]) {
        to[k] = (held * to[k] + moved * from[k]) / (held + moved);
      }
    };
    if (c1 < c0 - 1e-12) mixInto(s.z.d, s.z.w, 1 - c0, c0 - c1);
    else if (c1 > c0 + 1e-12) mixInto(s.z.w, s.z.d, c0, c1 - c0);
    s.cover = c1;

    /*
     * The lower head. While the core stands it is washed by the coolant;
     * once the whole core is molten it slumps in, and the head heats on
     * corium instead. This model ends when the steel reaches 1700 K.
     */
    if (!s.breach && !s.relocated && s.melted >= 1) {
      s.relocated = true; s.marks.relocate = s.t;
    }
    const qCOR = s.breach ? 0
      : s.relocated ? H_COR * (s.z.d.TF - s.TS)
      : (s.m > 0 ? H_HEAD_W * (s.TC - s.TS) : 0);
    if (!s.breach) {
      s.TS += dt * qCOR / C_S;
      if (s.TS >= T_VESSEL) { s.breach = true; s.marks.breach = s.t; }
    }

    /*
     * Each zone then evolves like a whole core with its own heat-transfer
     * coefficient: the zone fraction multiplies the heat capacity, the power
     * and the surface alike, so it cancels out of the temperature equation
     * and only reappears where the two zones are summed.
     */
    const pSpec = pFis + pDec;                 // W, as if the zone were all of it
    let pOx = 0, qCL = 0, h2New = 0;
    const zones = [[s.z.w, c1, A_CLAD * H_BOIL], [s.z.d, 1 - c1, A_CLAD * H_STEAM]];
    for (const [z, frac, hA] of zones) {
      if (frac <= 1e-9 || s.breach) continue;

      // Baker–Just on this zone's cladding, at this zone's temperature.
      let pOxZ = 0;
      if (z.TL > 1100 && z.W < W_FULL && s.m > 0) {
        let dw = Math.min(oxidationStep(z.W, z.TL, dt), W_FULL - z.W);
        z.W += dw;
        const dmZr = dw * 1e-6 * ZR_AREA;      // kg, as if the zone were all of it
        pOxZ = dmZr * H_OX / dt;
        h2New += frac * dmZr * H2_PER_ZR;
        pOx += frac * pOxZ;
      }

      const qGAP = hGAP * (z.TF - z.TL);
      const qOut = hA * (z.TL - s.TC);
      qCL += frac * qOut;

      // Melting and refreezing, at 3120 K, paid for out of the latent heat.
      // The corium's heat leaves through the head, and only the dry zone
      // has any corium in it — relocation cannot happen while any of the
      // core is still under water.
      const qDown = (s.relocated && z === s.z.d) ? qCOR : 0;
      let TFn = z.TF + dt * (pSpec - qGAP - qDown) / C_F;
      if (TFn > T_MELT && z.f < 1) {
        const spare = (TFn - T_MELT) * C_F / M_UO2;      // J per kg of fuel
        const used = Math.min(spare, (1 - z.f) * H_FUS);
        z.f += used / H_FUS;
        TFn = T_MELT + (spare - used) * M_UO2 / C_F;
      } else if (TFn < T_MELT && z.f > 0) {
        const deficit = (T_MELT - TFn) * C_F / M_UO2;
        const used = Math.min(deficit, z.f * H_FUS);
        z.f -= used / H_FUS;
        TFn = T_MELT - (deficit - used) * M_UO2 / C_F;
      }
      z.TF = TFn;
      z.TL += dt * (qGAP + pOxZ - qOut) / C_L;
    }

    s.melted = c1 * s.z.w.f + (1 - c1) * s.z.d.f;
    s.W = c1 * s.z.w.W + (1 - c1) * s.z.d.W;
    s.h2 += h2New;
    // What the reactivity sees is the core average; what fails is the peak.
    s.TF = c1 * s.z.w.TF + (1 - c1) * s.z.d.TF;
    s.TL = Math.max(c1 > 1e-9 ? s.z.w.TL : -Infinity, c1 < 1 - 1e-9 ? s.z.d.TL : -Infinity);
    s.TFpeak = Math.max(c1 > 1e-9 ? s.z.w.TF : -Infinity, c1 < 1 - 1e-9 ? s.z.d.TF : -Infinity);

    if (!s.breach) {
      /*
       * The coolant's books. Heat comes in from the cladding, leaves to the
       * steam generator, and — while the core is still standing — leaves
       * into the lower head, which is full of the same water; that last term
       * was missing at first and the head was heating on energy nothing had
       * given up, worth two percent of the whole accident.
       */
      const qIn = qCL - USG * u.feed * (s.TC - TSEC) - (s.relocated ? 0 : qCOR);
      const cap = Math.max(s.m, 1) * CP_H2O;
      if (qIn < 0 || s.TC < TSAT - 1e-9) {
        const Tn = s.TC + dt * qIn / cap;
        if (Tn <= TSAT) {
          s.TC = Tn;
        } else {
          /* Clamping to saturation threw the overshoot away. What is left
             after reaching the boiling point boils, which is where it was
             always going. */
          const toSat = (TSAT - s.TC) * cap;
          s.TC = TSAT;
          if (s.m > 0) s.m = Math.max(0, s.m - (dt * qIn - toSat) / HFG);
        }
      } else if (s.m > 0) {
        s.m = Math.max(0, s.m - dt * qIn / HFG);
      }
      if (u.eccs > 0) s.m = Math.min(M_H2O, s.m + u.eccs * dt);
    }

    s.t += dt;
    s.pFis = pFis; s.pDec = pDec; s.pOx = pOx; s.rho = rho; s.parts = parts;
    s.qCOR = qCOR; s.lvl = lvl;

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
  function recordFlux(s) {
    if (s.n <= 0) return;
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
    if (!isFinite(w) || Math.abs(w) < 1e-7) return null;
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
  const W = canvas.width, H = canvas.height;
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
    const melted = s.melted ?? 0, cov = s.cover ?? 1;

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
     * The core: eighteen fuel assemblies, shortened as the fuel melts out
     * from under them, and painted in two pieces — the part still under
     * water at the wet zone's cladding temperature, the part standing in
     * steam at the dry zone's. Those are the two temperatures the model
     * actually carries, so the picture is the state and not a gloss on it.
     */
    const rods = 18, gap = (VW - 24) / rods;
    const standing = 1 - melted;
    const yTopNow = yCoreBot - (yCoreBot - yCoreTop) * standing;
    const yWet = yTopNow + (yCoreBot - yTopNow) * (1 - cov);
    const zw = s.z ? s.z.w : { TL: TL0 }, zd = s.z ? s.z.d : { TL: TL0 };
    for (let i = 0; i < rods; i++) {
      const x = x0 + 12 + gap * (i + 0.5);
      ctx.lineWidth = gap * 0.52;
      if (cov > 1e-3 && yWet < yCoreBot) {
        ctx.strokeStyle = hot(zw.TL);
        ctx.beginPath(); ctx.moveTo(x, yCoreBot); ctx.lineTo(x, yWet); ctx.stroke();
      }
      if (cov < 1 - 1e-3 && yTopNow < yWet) {
        ctx.strokeStyle = hot(zd.TL);
        ctx.beginPath(); ctx.moveTo(x, yWet); ctx.lineTo(x, yTopNow); ctx.stroke();
      }
    }

    // What has melted collects in the lower head as a pool.
    if (melted > 0) {
      ctx.fillStyle = hot(Math.max(s.TF ?? TF0, 2600));
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, LV_BOT + 16, VW * 0.44, 8 + melted * 30,
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
      ctx.fillStyle = hot(Math.max(s.TF ?? TF0, 2600));
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
                   [C_XE, i18nText("nrLegXenon", "xenon")]]);
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
  const clock = (t) => {
    if (t < 120) return `${t.toFixed(1)} s`;
    if (t < 7200) return `${(t / 60).toFixed(1)} min`;
    return `${(t / 3600).toFixed(2)} h`;
  };

  function condition(s) {
    if (s.breach) return i18nText("nrStateBreach", "vessel breach");
    if (s.relocated) return i18nText("nrStateRelocate", "core relocated");
    if (s.melted > 0) return i18nText("nrStateMelt", "fuel melting");
    if (s.TL >= T_ZR) return i18nText("nrStateZr", "cladding melting");
    if (s.TL >= T_BURST) return i18nText("nrStateBurst", "cladding burst");
    if ((s.cover ?? 1) < 1) return i18nText("nrStateUncovered", "core uncovering");
    if (s.rho > B) return i18nText("nrStatePrompt", "prompt critical");
    if (s.rho > 1e-5) return i18nText("nrStateSuper", "supercritical");
    if (s.rho < -1e-5) return i18nText("nrStateSub", "subcritical");
    return i18nText("nrStateCritical", "critical");
  }

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

    out.rho.textContent = `${(s.rho * 1e5).toFixed(1)} pcm`;
    const p = s.parts;
    out.rhoParts.textContent =
      `${(p.rod * 1e5).toFixed(0)} / ${(p.dop * 1e5).toFixed(0)} / `
      + `${(p.mod * 1e5).toFixed(0)} / ${(p.xe * 1e5).toFixed(0)}`;
    out.tf.textContent = `${(s.TFpeak ?? s.TF).toFixed(0)} K`;
    out.tl.textContent = `${s.TL.toFixed(0)} K`;
    out.tc.textContent = `${s.TC.toFixed(1)} K`;
    out.ts.textContent = `${s.TS.toFixed(0)} K`;
    out.level.textContent = `${(100 * (s.lvl ?? 1)).toFixed(1)}%`;
    out.ox.textContent = `${(100 * s.W / W_FULL).toFixed(2)}%`;
    out.h2.textContent = `${s.h2.toFixed(1)} kg`;
    out.xe.textContent = `${(XE_WORTH * s.X / X_EQ * 1e5).toFixed(0)} pcm`;
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

  function advance(sub) {
    const u = readParams();
    for (let k = 0; k < sub; k++) {
      step(st, DT, u);
      if (k % Math.max(1, Math.round(sub / 6)) === 0) recordFlux(st);
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
    lastTs = 0;
    record(st); recordFlux(st);
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

  if (window.CSVExport) {
    window.CSVExport.attach("csv-btn", () => {
      if (!st || st.trace.length < 2) return null;
      return {
        name: "reactor.csv",
        title: "Nuclear reactor — plant trace",
        columns: ["t_s", "fission_fraction", "decay_fraction", "T_fuel_K",
                  "T_clad_K", "T_coolant_K", "level_fraction", "rho_pcm"],
        rows: st.trace.map((q) => [q.t, q.n, q.dec, q.TF, q.TL, q.TC, q.lvl, q.rho * 1e5]),
        meta: {
          rated_thermal_W: P0, beta_total: B, generation_time_s: L,
          alpha_fuel_per_K: aF, alpha_moderator_per_K: aM,
          step_dt_s: DT,
          zr_oxidised_percent: 100 * st.W / W_FULL, hydrogen_kg: st.h2,
          melted_fraction: st.melted,
          measured_period_s: measuredPeriod(st),
          inhour_period_s: inhour(st.rho),
        },
      };
    });
  }

  window.__reactor = {
    K: { BETA, LAM, B, L, DA, DL, SC, P0, PF, C_F, C_L, M_UO2, M_ZR, M_H2O,
         CP_H2O, HFG, TF0, TL0, TC0, TSAT, TSEC, aF, aM, hGAP, USG,
         A_CLAD, H_BOIL, H_STEAM, ZR_AREA, W_FULL, H_OX, H2_PER_ZR,
         BJ_A, BJ_B, RCAL, CP_ZR, CP_UO2,
         CORE_TOP, CORE_BOT, T_BURST, T_ZR, T_MELT, H_FUS,
         M_STEEL, CP_STEEL, C_S, H_COR, H_HEAD_W, T_VESSEL,
         X_EQ, I_EQ, XE_WORTH, SCRAM_RHO, PHI0, SIGF, sX, lI, lX, gI, gX },
    get DT() { return DT; },
    fresh, step, stepPK, stepXe, stepDecayHeat, oxidationStep,
    inhour, wayWigner, measuredPeriod, recordFlux,
    params: readParams,
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
                       TL: s.TL, TC: s.TC, TS: s.TS,
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
