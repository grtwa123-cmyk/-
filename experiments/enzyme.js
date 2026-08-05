/*
 * Michaelis–Menten kinetics, from the molecules up.
 *
 * Nothing in here evaluates the rate law to decide what happens. Every enzyme
 * molecule is an independent continuous-time Markov chain over four states,
 * jumping with the rate constants of the mechanism itself:
 *
 *     FREE --k₁[S]--> ES        ES --k₋₁--> FREE
 *                               ES --kcat--> FREE + product
 *     FREE <--> EI              ES <--> ESI          (inhibitor, fast)
 *
 * Waiting times are drawn from the exponential distribution for each
 * molecule's total exit rate, so this is exact Gillespie per molecule rather
 * than a time-sliced approximation. The rate v is then *counted*: products
 * divided by elapsed time, nothing else.
 *
 * The hyperbola appears because at steady state the fraction of enzyme
 * carrying substrate is [S]/(Kₘ+[S]), so
 *
 *     v = kcat·[E]ᴛ·[S]/(Kₘ+[S]) = Vmax[S]/(Kₘ+[S]),   Kₘ = (k₋₁+kcat)/k₁
 *
 * and the same is true of the inhibitors: each is a real binding equilibrium
 * in the state machine, not a factor applied to the answer. Which constant
 * each one moves — Kₘ, Vmax, or both — is therefore a result rather than an
 * assumption, and that is exactly what the Lineweaver–Burk view is for.
 *
 * k₁ is fixed and k₋₁ derived from the Kₘ you ask for, since Kₘ is the thing
 * an experimentalist actually measures and k₋₁ is not.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    substrate: document.getElementById("substrate"),
    km: document.getElementById("km"),
    kcat: document.getElementById("kcat"),
    enzymes: document.getElementById("enzymes"),
    iratio: document.getElementById("iratio"),
  };
  const inputValues = {
    substrate: document.getElementById("substrate-value"),
    km: document.getElementById("km-value"),
    kcat: document.getElementById("kcat-value"),
    enzymes: document.getElementById("enzymes-value"),
    iratio: document.getElementById("iratio-value"),
  };
  const out = {
    rate: document.getElementById("out-rate"),
    predicted: document.getElementById("out-predicted"),
    turnovers: document.getElementById("out-turnovers"),
    vmax: document.getElementById("out-vmax"),
    km: document.getElementById("out-km"),
    fit: document.getElementById("out-fit"),
  };
  const inhList = document.getElementById("inhibitor-list");
  const ratioControl = document.getElementById("ratio-control");
  const lbToggle = document.getElementById("lb-on");
  const sweepBtn = document.getElementById("sweep-btn");
  const recordBtn = document.getElementById("record-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // Molecules per µM — the volume of the notional reaction vessel, chosen so a
  // couple of dozen enzymes is a sensible concentration and the counts stay
  // drawable.
  const OMEGA = 10;
  const K1 = 8;          // µM⁻¹s⁻¹, association rate — fixed, so Kₘ sets k₋₁
  const KI = 10;         // µM, inhibitor dissociation constant
  // EI and ESI are dead ends — the only way out is back the way you came — so
  // at steady state their occupancy is exactly [I]/Kᵢ times the parent's, at any
  // binding speed. KI_ON only has to beat catalysis so the transient is short.
  const KI_ON = 20;      // µM⁻¹s⁻¹ (off rate KI_ON·Kᵢ = 200 s⁻¹, vs kcat ≤ 40)

  const FREE = 0, ES = 1, EI = 2, ESI = 3;

  let inhibitor = "none";

  function params() {
    const kcat = parseFloat(inputs.kcat.value);
    const Km = parseFloat(inputs.km.value);
    const nE = parseInt(inputs.enzymes.value, 10);
    return {
      S: parseFloat(inputs.substrate.value),
      Km, kcat, nE,
      kOff: K1 * Km - kcat,            // from Kₘ = (k₋₁ + kcat)/k₁
      Et: nE / OMEGA,                  // µM
      Vmax: (kcat * nE) / OMEGA,       // µM/s
      i: parseFloat(inputs.iratio.value),
      type: inhibitor,
    };
  }

  // ── Closed form, for comparison only — never used to drive the sim ─────
  const alpha = (p) => (p.type === "none" ? 1 : 1 + p.i);
  function apparent(p) {
    const a = alpha(p);
    switch (p.type) {
      case "competitive":     return { Km: p.Km * a, Vmax: p.Vmax };
      case "noncompetitive":  return { Km: p.Km, Vmax: p.Vmax / a };
      case "uncompetitive":   return { Km: p.Km / a, Vmax: p.Vmax / a };
      default:                return { Km: p.Km, Vmax: p.Vmax };
    }
  }
  const mmRate = (S, Km, Vmax) => (Vmax * S) / (Km + S);
  const predicted = (p) => { const a = apparent(p); return mmRate(p.S, a.Km, a.Vmax); };

  // ── The molecules ──────────────────────────────────────────────────────
  const expRand = (rate) => -Math.log(1 - Math.random()) / rate;

  let mols = [];
  let simT = 0, turnovers = 0;
  let products = [];          // little drifting dots, purely a depiction

  /** Exit transitions available to a molecule, as [rate, targetState] pairs. */
  function transitions(state, p) {
    const iConc = p.type === "none" ? 0 : p.i * KI;
    const bindsFree = p.type === "competitive" || p.type === "noncompetitive";
    const bindsES = p.type === "noncompetitive" || p.type === "uncompetitive";
    switch (state) {
      case FREE: {
        const t = [[K1 * p.S, ES]];
        if (bindsFree && iConc > 0) t.push([KI_ON * iConc, EI]);
        return t;
      }
      case ES: {
        const t = [[p.kOff, FREE], [p.kcat, -1]];      // −1 marks a turnover
        if (bindsES && iConc > 0) t.push([KI_ON * iConc, ESI]);
        return t;
      }
      case EI:  return [[KI_ON * KI, FREE]];
      case ESI: return [[KI_ON * KI, ES]];
      default:  return [];
    }
  }

  function schedule(m, p) {
    const t = transitions(m.state, p);
    const total = t.reduce((a, x) => a + x[0], 0);
    m.total = total;
    m.nextT = total > 0 ? simT + expRand(total) : Infinity;
  }

  function rebuild(p) {
    // The clock has to be rewound *before* the first events are drawn, or every
    // molecule is scheduled off the old simT and nothing fires until the sim
    // catches up to it.
    simT = 0;
    turnovers = 0;
    products = [];
    mols = [];
    for (let k = 0; k < p.nE; k++) {
      mols.push({
        state: FREE, nextT: 0, total: 0,
        x: 0.12 + 0.76 * Math.random(),
        y: 0.15 + 0.7 * Math.random(),
        vx: (Math.random() - 0.5) * 0.05,
        vy: (Math.random() - 0.5) * 0.05,
        flash: 0,
      });
      schedule(mols[k], p);
    }
  }

  /** Advance every molecule to tEnd by drawing exponential waiting times. */
  function step(tEnd, p) {
    for (const m of mols) {
      // The runaway guard is per molecule: a shared budget would let a busy one
      // starve the rest, and a molecule left unstepped is a molecule that never
      // turns over, which would bias the very number we are counting.
      let guard = 0;
      while (m.nextT <= tEnd && guard++ < 500000) {
        const t = transitions(m.state, p);
        let r = Math.random() * m.total;
        let target = m.state;
        for (const [rate, to] of t) { r -= rate; if (r <= 0) { target = to; break; } }
        if (target === -1) {
          turnovers++;
          m.state = FREE;
          m.flash = 1;
          // A sparse, short-lived sprinkle: products are a sign that turnovers
          // are happening, not a standing population, and a cloud of them would
          // read as more product than there is substrate to have made it from.
          if (products.length < 70) {
            products.push({ x: m.x, y: m.y, vx: (Math.random() - 0.5) * 0.3,
                            vy: (Math.random() - 0.5) * 0.3, life: 1 });
          }
        } else {
          m.state = target;
        }
        simT = m.nextT;                 // events are processed in molecule order
        schedule(m, p);
      }
    }
    simT = tEnd;
  }

  const measuredRate = () => (simT > 0 ? turnovers / (OMEGA * simT) : NaN);

  // ── Recorded assay points ──────────────────────────────────────────────
  let points = [];             // { S, v, n }
  let sweep = null;            // { list, index, tLeft }
  const ASSAY = 6;             // simulated seconds per point in a series
  const SWEEP_SPEED = 40;      // times real time while a series runs

  function startSweep(p) {
    const list = [];
    for (let k = 0; k < 12; k++) {
      // Spread the series geometrically so the low-[S] end, where the curve
      // actually bends, is not just one crowded point.
      list.push(Math.round(4 * Math.pow(250 / 4, k / 11)));
    }
    points = [];
    sweep = { list, index: 0, tLeft: ASSAY };
    inputs.substrate.value = String(list[0]);
    updateLabels();
    rebuild(params());
  }

  /** Least squares on the Lineweaver–Burk points: recovers Kₘ and Vmax. */
  function fitFromPoints() {
    const pts = points.filter((q) => q.v > 1e-9);
    if (pts.length < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const q of pts) {
      const x = 1 / q.S, y = 1 / q.v;
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const n = pts.length;
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    const slope = (n * sxy - sx * sy) / denom;
    const inter = (sy - slope * sx) / n;
    if (inter <= 0 || slope <= 0) return null;
    return { Vmax: 1 / inter, Km: slope / inter, n };
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    const boxBot = Math.round(H * (narrow ? 0.34 : 0.36));
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      boxTop: 10, boxBot,
      plotL: narrow ? 40 : 54,
      plotR: W - (narrow ? 14 : 20),
      // The gap has to clear both the legend row and the axis label under it.
      plotT: boxBot + (narrow ? 44 : 48),
      plotB: H - (narrow ? 26 : 32),
    };
  }

  const text = (str, x, y, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
  };

  /** Knock a hole in whatever is behind a label so it stays readable. */
  const plate = (str, x, y, size, align) => {
    ctx.font = `${size}px ui-monospace, monospace`;
    const w = ctx.measureText(str).width;
    const px = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    ctx.fillStyle = "rgba(10,16,22,0.8)";
    ctx.fillRect(px - 3, y - size - 1, w + 6, size + 6);
  };

  /** Everything data-driven is drawn inside the axes and nowhere else. */
  const clipped = (fn) => {
    const { plotL, plotR, plotT, plotB } = L;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotL, plotT - 2, plotR - plotL, plotB - plotT + 4);
    ctx.clip();
    fn();
    ctx.restore();
  };

  const STATE_COLOUR = {
    [FREE]: "#5fe0c8",
    [ES]:   "#ffd166",
    [EI]:   "#8891a8",
    [ESI]:  "#b07fa8",
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1016");
    bg.addColorStop(1, "#0c1222");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const { fs, fsv, plotL, plotR, plotT, plotB, narrow } = L;

    // ── The vessel. Substrate dots are a depiction of the concentration —
    //    the kinetics is well mixed, as solution kinetics is, so there is no
    //    position in the model for them to have.
    {
      const top = L.boxTop, bot = L.boxBot;
      const bx = plotL, bw = plotR - plotL, bh = bot - top;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, top + 0.5, bw - 1, bh - 1);

      const nDots = Math.min(Math.round(p.S * 0.7), 150);
      ctx.fillStyle = "rgba(140, 200, 255, 0.45)";
      for (let k = 0; k < nDots; k++) {
        // A fixed hash keeps the cloud steady instead of boiling every frame.
        const a = Math.sin(k * 12.9898) * 43758.5453;
        const b = Math.sin(k * 78.233) * 12345.6789;
        const x = bx + 6 + ((a - Math.floor(a)) * (bw - 12));
        const y = top + 6 + ((b - Math.floor(b)) * (bh - 12));
        ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
      }

      for (const q of products) {
        ctx.fillStyle = `rgba(229, 143, 255, ${0.75 * q.life})`;
        ctx.beginPath();
        ctx.arc(bx + q.x * bw, top + q.y * bh, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const m of mols) {
        const cx = bx + m.x * bw, cy = top + m.y * bh;
        const r = narrow ? 7 : 9;
        if (m.flash > 0) {
          // A brief pulse, not a permanent halo — at 20 turnovers a second a
          // slow one would never go out and the state colour would be lost.
          ctx.fillStyle = `rgba(229,143,255,${0.3 * m.flash})`;
          ctx.beginPath(); ctx.arc(cx, cy, r + 5 * m.flash, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = STATE_COLOUR[m.state];
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1.2;
        // A notch in the side is the active site; it is filled when occupied.
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0.55, Math.PI * 2 - 0.55);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        if (m.state === ES || m.state === ESI) {
          ctx.fillStyle = "rgba(140, 200, 255, 0.95)";
          ctx.beginPath(); ctx.arc(cx + r - 1, cy, 2.6, 0, Math.PI * 2); ctx.fill();
        }
        if (m.state === EI || m.state === ESI) {
          ctx.fillStyle = "rgba(255,120,140,0.95)";
          ctx.beginPath(); ctx.arc(cx - r + 2, cy - r + 4, 3, 0, Math.PI * 2); ctx.fill();
        }
      }

      // The concentration belongs on the vessel it describes; the row below is
      // needed in full for the legend.
      const sLbl = `[S] = ${p.S} µM`;
      plate(sLbl, plotR - 8, top + 17, fsv, "right");
      text(sLbl, plotR - 8, top + 17, "rgba(140,200,255,0.9)", fsv, "right");

      // Legend: the four enzyme states plus the two loose species, which is the
      // whole model in one row.
      let lx = plotL;
      const legend = [
        [STATE_COLOUR[FREE], "E", 4], [STATE_COLOUR[ES], "ES", 4],
        [STATE_COLOUR[EI], "EI", 4], [STATE_COLOUR[ESI], "ESI", 4],
        ["rgba(140,200,255,0.75)", "S", 2.6], ["rgba(229,143,255,0.8)", "P", 2.6],
      ];
      for (const [colour, lbl, rad] of legend) {
        if ((lbl === "EI" || lbl === "ESI") && p.type === "none") continue;
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(lx + 4, bot + 12, rad, 0, Math.PI * 2); ctx.fill();
        text(lbl, lx + 12, bot + 15.5, "rgba(226,234,248,0.7)", fsv, "left");
        lx += 20 + lbl.length * 7;
      }
    }

    // ── The plot: rate against substrate, or its double reciprocal.
    const a = apparent(p);
    if (!lbToggle.checked) {
      const S_MAX = 260;
      const vMax = Math.max(a.Vmax, p.Vmax) * 1.12;
      const X = (S) => plotL + (S / S_MAX) * (plotR - plotL);
      const Y = (v) => plotB - (v / vMax) * (plotB - plotT);

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (let s = 0; s <= S_MAX; s += 50) {
        ctx.beginPath(); ctx.moveTo(X(s), plotT); ctx.lineTo(X(s), plotB); ctx.stroke();
        text(String(s), X(s), plotB + 14, "rgba(226,234,248,0.45)", fsv, "center");
      }
      for (let k = 0; k <= 4; k++) {
        const v = (vMax * k) / 4;
        ctx.beginPath(); ctx.moveTo(plotL, Y(v)); ctx.lineTo(plotR, Y(v)); ctx.stroke();
        text(v.toFixed(1), plotL - 6, Y(v) + 3.5, "rgba(226,234,248,0.45)", fsv, "right");
      }

      // Vmax and the half-max point that defines Kₘ.
      ctx.strokeStyle = "rgba(255,225,74,0.35)";
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(plotL, Y(a.Vmax)); ctx.lineTo(plotR, Y(a.Vmax)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(a.Km), plotB); ctx.lineTo(X(a.Km), Y(a.Vmax / 2)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(plotL, Y(a.Vmax / 2)); ctx.lineTo(X(a.Km), Y(a.Vmax / 2)); ctx.stroke();
      ctx.setLineDash([]);
      text("Vₘₐₓ", plotR - 4, Y(a.Vmax) - 5, "rgba(255,225,74,0.8)", fsv, "right");
      text("Kₘ", X(a.Km), plotB - 4, "rgba(255,225,74,0.8)", fsv, "center");

      clipped(() => {
        // The curve with no inhibitor, for comparison, then the current one.
        if (p.type !== "none" && p.i > 0) {
          ctx.strokeStyle = "rgba(226,234,248,0.28)";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          for (let px = plotL; px <= plotR; px++) {
            const S = ((px - plotL) / (plotR - plotL)) * S_MAX;
            const yy = Y(mmRate(S, p.Km, p.Vmax));
            px === plotL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = "rgba(123, 224, 208, 0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let px = plotL; px <= plotR; px++) {
          const S = ((px - plotL) / (plotR - plotL)) * S_MAX;
          const yy = Y(mmRate(S, a.Km, a.Vmax));
          px === plotL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
        }
        ctx.stroke();

        for (const q of points) {
          ctx.fillStyle = "rgba(229,143,255,0.95)";
          ctx.beginPath(); ctx.arc(X(q.S), Y(q.v), 3.4, 0, Math.PI * 2); ctx.fill();
        }
        const live = measuredRate();
        if (Number.isFinite(live)) {
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(X(p.S), Y(live), 5.2, 0, Math.PI * 2); ctx.stroke();
        }
      });
      text(i18nText("mmRateAxis", "rate v (µM/s)"), plotL - 6, plotT - 10,
        "rgba(123,224,208,0.75)", fsv, "left");
      text(i18nText("mmConcAxis", "[S] (µM)"), plotR, plotB + (narrow ? 25 : 27),
        "rgba(226,234,248,0.5)", fsv, "right");
    } else {
      // Double reciprocal: a straight line whose intercepts are the constants.
      const xMax = 1 / 4;
      const yMax = Math.max(1 / mmRate(4, a.Km, a.Vmax), 1 / mmRate(4, p.Km, p.Vmax)) * 1.1;
      const X = (x) => plotL + ((x + xMax * 0.35) / (xMax * 1.35)) * (plotR - plotL);
      const Y = (y) => plotB - (y / yMax) * (plotB - plotT);

      // A double-reciprocal plot is only readable with a scale on it: without
      // one you cannot tell an intercept from a shrug.
      const dec = yMax < 0.02 ? 4 : yMax < 0.2 ? 3 : yMax < 2 ? 2 : 1;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (const x of (narrow ? [-0.05, 0, 0.1, 0.2] : [-0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.25])) {
        ctx.beginPath(); ctx.moveTo(X(x), plotT); ctx.lineTo(X(x), plotB); ctx.stroke();
        text(x === 0 ? "0" : x.toFixed(2), X(x), plotB + 14,
          "rgba(226,234,248,0.45)", fsv, "center");
      }
      for (let k = 0; k <= 4; k++) {
        const y = (yMax * k) / 4;
        ctx.beginPath(); ctx.moveTo(plotL, Y(y)); ctx.lineTo(plotR, Y(y)); ctx.stroke();
        text(y.toFixed(dec), plotL - 6, Y(y) + 3.5, "rgba(226,234,248,0.45)", fsv, "right");
      }
      // The two axes themselves, brighter, since the intercepts live on them.
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      ctx.beginPath(); ctx.moveTo(plotL, Y(0)); ctx.lineTo(plotR, Y(0)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(0), plotT); ctx.lineTo(X(0), plotB); ctx.stroke();

      const lbLine = (Km, Vmax, colour, dash, width) => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(X(-1 / Km), Y(0));
        ctx.lineTo(X(xMax), Y((Km / Vmax) * xMax + 1 / Vmax));
        ctx.stroke();
        ctx.setLineDash([]);
      };
      const fit = fitFromPoints();
      clipped(() => {
        if (p.type !== "none" && p.i > 0) lbLine(p.Km, p.Vmax, "rgba(226,234,248,0.3)", [4, 4], 1.2);
        lbLine(a.Km, a.Vmax, "rgba(123,224,208,0.95)", [], 2);

        for (const q of points) {
          if (q.v <= 1e-9) continue;
          ctx.fillStyle = "rgba(229,143,255,0.95)";
          ctx.beginPath(); ctx.arc(X(1 / q.S), Y(1 / q.v), 3.4, 0, Math.PI * 2); ctx.fill();
        }
        if (fit) lbLine(fit.Km, fit.Vmax, "rgba(255,180,120,0.9)", [6, 4], 1.5);

        // Ring the two intercepts so the labels have something to point at.
        ctx.strokeStyle = "rgba(255,225,74,0.85)";
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(X(0), Y(1 / a.Vmax), 3.6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(X(-1 / a.Km), Y(0), 3.6, 0, Math.PI * 2); ctx.stroke();
      });

      // The intercept is the number being read off, so it gets its own
      // precision rather than the coarser one the gridlines are labelled with.
      const yLbl = `1/Vₘₐₓ = ${(1 / a.Vmax).toPrecision(3)}`;
      plate(yLbl, X(0) + 8, Y(1 / a.Vmax) - 7, fsv, "left");
      text(yLbl, X(0) + 8, Y(1 / a.Vmax) - 7, "rgba(255,225,74,0.9)", fsv, "left");
      plate("−1/Kₘ", X(-1 / a.Km), plotB - 14, fsv, "center");
      text("−1/Kₘ", X(-1 / a.Km), plotB - 14, "rgba(255,225,74,0.9)", fsv, "center");

      text(i18nText("mmLbY", "1/v"), plotL - 6, plotT - 10, "rgba(123,224,208,0.75)", fsv, "left");
      text(i18nText("mmLbX", "1/[S]"), plotR, plotB + (narrow ? 25 : 27),
        "rgba(226,234,248,0.5)", fsv, "right");
    }

    if (sweep) {
      text(`${i18nText("mmSweeping", "running the series")} ${sweep.index + 1}/${sweep.list.length}`,
        plotR, plotT - 10, "rgba(255,225,74,0.9)", fsv, "right");
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const a = apparent(p);
    const live = measuredRate();
    out.rate.textContent = Number.isFinite(live) ? live.toFixed(3) : "—";
    out.predicted.textContent = predicted(p).toFixed(3);
    out.turnovers.textContent = turnovers.toLocaleString();
    out.vmax.textContent = a.Vmax.toFixed(2);
    out.km.textContent = a.Km.toFixed(1);
    const fit = fitFromPoints();
    out.fit.textContent = fit
      ? `Kₘ ${fit.Km.toFixed(1)} · Vₘₐₓ ${fit.Vmax.toFixed(2)}`
      : i18nText("mmNeedPoints", "record 3+ points");
  }

  function updateLabels() {
    inputValues.substrate.textContent = inputs.substrate.value;
    inputValues.km.textContent = inputs.km.value;
    inputValues.kcat.textContent = inputs.kcat.value;
    inputValues.enzymes.textContent = inputs.enzymes.value;
    inputValues.iratio.textContent = parseFloat(inputs.iratio.value).toFixed(1);
    ratioControl.hidden = inhibitor === "none";
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  let running = true;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = params();

    const speed = sweep ? SWEEP_SPEED : 1;
    if (running) step(simT + dt * speed, p);

    if (sweep) {
      sweep.tLeft -= dt * speed;
      if (sweep.tLeft <= 0) {
        points.push({ S: p.S, v: measuredRate(), n: turnovers });
        sweep.index++;
        if (sweep.index >= sweep.list.length) {
          sweep = null;
          window.SFX?.tone({ freq: 720, dur: 0.16, type: "sine", gain: 0.12 });
        } else {
          inputs.substrate.value = String(sweep.list[sweep.index]);
          updateLabels();
          sweep.tLeft = ASSAY;
          rebuild(params());
        }
      }
    }

    for (const m of mols) {
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < 0.06 || m.x > 0.94) m.vx *= -1;
      if (m.y < 0.08 || m.y > 0.92) m.vy *= -1;
      m.x = Math.min(Math.max(m.x, 0.06), 0.94);
      m.y = Math.min(Math.max(m.y, 0.08), 0.92);
      if (m.flash > 0) m.flash = Math.max(0, m.flash - dt * 3.5);
    }
    for (const q of products) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * 1.6;
    }
    // Drop them at the wall — a product drawn outside the vessel is a product
    // that is not in the reaction it is meant to depict.
    products = products.filter((q) =>
      q.life > 0 && q.x > 0.01 && q.x < 0.99 && q.y > 0.01 && q.y < 0.99);

    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function setInhibitor(next) {
    inhibitor = next;
    inhList.querySelectorAll(".mol-btn").forEach((b) => {
      const on = b.dataset.key === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  // Any change to the chemistry invalidates the count so far — it was taken
  // under different conditions.
  Object.values(inputs).forEach((el) => {
    el.addEventListener("input", () => { updateLabels(); sweep = null; rebuild(params()); });
  });
  inhList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setInhibitor(btn.dataset.key);
      updateLabels();
      sweep = null;
      points = [];               // the recorded series belonged to the old enzyme
      rebuild(params());
      window.SFX?.tone({ freq: 520, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });
  lbToggle.addEventListener("change", () => window.SFX?.click({ gain: 0.2 }));
  sweepBtn.addEventListener("click", () => {
    startSweep(params());
    window.SFX?.click({ gain: 0.22 });
  });
  recordBtn.addEventListener("click", () => {
    const v = measuredRate();
    if (Number.isFinite(v) && turnovers > 0) {
      points.push({ S: params().S, v, n: turnovers });
      window.SFX?.click({ gain: 0.2, freq: 1800 });
    }
  });
  // reset-defaults.js has already put the controls and the inhibitor picker
  // back by the time this runs; what is left is the run itself.
  resetBtn.addEventListener("click", () => {
    sweep = null;
    points = [];
    updateLabels();
    rebuild(params());
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => updateReadouts(params()));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 260);
    H = W < 560 ? 480 : 560;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check the counted rate against the rate law.
  window.__mm = {
    params, apparent, mmRate, predicted, alpha,
    // Freezing the molecules without freezing the canvas is what lets a
    // purely visual control — the Lineweaver–Burk toggle — be held to
    // something. Every other page here exposes the same hook.
    setRunning: (v) => { running = v; },
    rebuild, step, measuredRate, fitFromPoints,
    setInhibitor, OMEGA, K1, KI,
    stats: () => ({ simT, turnovers, states: mols.map((m) => m.state) }),
    setPoints: (pts) => { points = pts; },
    getPoints: () => points.slice(),
  };

  resizeCanvas();
  updateLabels();
  rebuild(params());
  start();
})();
