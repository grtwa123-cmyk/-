/*
 * Hydrogen spectrum — energy levels, photon emission, and the Balmer lines.
 *
 * Everything drawn here comes out of one equation. The bound states of a
 * one-electron atom sit at
 *
 *   Eₙ = −13.6 eV / n²
 *
 * so a jump from n₂ down to n₁ releases ΔE = E(n₂) − E(n₁), carried off by a
 * single photon of wavelength λ = hc/ΔE. Written with the Rydberg constant
 * that is the familiar
 *
 *   1/λ = R_H (1/n₁² − 1/n₂²)
 *
 * R_H here is the hydrogen value, 1.0967758×10⁷ m⁻¹ — the reduced-mass
 * corrected one, not R_∞. That correction matters: using R_∞ puts Hα at
 * 656.1 nm instead of 656.5 nm. The wavelengths reported are VACUUM values,
 * which is why Hα reads 656.5 nm rather than the 656.3 nm quoted in most
 * tables — those are measured in air, where n ≈ 1.000293 shortens λ by about
 * 0.03%.
 *
 * What is left out, and what it would be worth. Eₙ = −13.6 eV/n² is the
 * Schrödinger–Coulomb answer, and every correction to it is ordered by
 * α² = 5.33×10⁻⁵. Spin–orbit coupling and the relativistic mass term split
 * each line into a multiplet: Hα is not one line but eight, spread over
 * 22 pm, and the gross-structure wavelength is not their centre — seven of
 * the eight sit below it, 19 pm at the furthest, and one sits 3 pm above.
 * That spread is 4.6× finer than the 0.1 nm this page prints, 9× finer than
 * the vacuum-to-air difference named just above, and 16× finer than the
 * reduced-mass correction that *is* applied — and those two margins only
 * widen up the series, to 19× and 35× by Hδ. The Lamb shift, 1058 MHz on a
 * 457 THz line, is 1.5 pm: another factor of 14 down again.
 *
 * So the small parameter is α², it is small here, and the reason it can be
 * dropped is the page's own resolution: every correction the model omits
 * lands below the last digit shown. Print a third decimal and that stops
 * being true — tests/experiments/spectra.test.mjs holds the two together.
 *
 * The cascade picks uniformly at random among the allowed lower levels. Real
 * atoms weight those jumps by Einstein A coefficients (Lyman-α dominates
 * heavily), so the relative line *brightness* here is schematic — the line
 * *positions*, which is what the experiment is about, are exact.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    level: document.getElementById("level"),
    speed: document.getElementById("speed"),
  };
  const inputValues = {
    level: document.getElementById("level-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    transition: document.getElementById("out-transition"),
    energy:     document.getElementById("out-energy"),
    wavelength: document.getElementById("out-wavelength"),
    frequency:  document.getElementById("out-frequency"),
    series:     document.getElementById("out-series"),
    lines:      document.getElementById("out-lines"),
  };
  const measureBtn = document.getElementById("measure-btn");
  const outRydberg = document.getElementById("out-rydberg");
  const exciteBtn = document.getElementById("excite-btn");
  const resetBtn  = document.getElementById("reset-btn");
  const clearBtn  = document.getElementById("clear-btn");
  const autoToggle = document.getElementById("auto-toggle");
  const seriesList = document.getElementById("series-list");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Physical constants ─────────────────────────────────────────────────
  const R_H = 1.0967758e7;      // m⁻¹, hydrogen (reduced-mass corrected)
  const HC = 1239.841984;       // eV·nm  (= h·c)
  // The ladder and the lines have to be the same physics. This used to be
  // typed as 13.605693 eV, which is R_∞ — the infinite-mass value — while the
  // wavelengths came from R_H. The two disagreed by 0.055%: the page drew one
  // hydrogen and emitted from another. Derived from R_H it is 13.598287 eV,
  // hydrogen's actual ionisation energy, and the ladder now reproduces the
  // Rydberg wavelengths exactly because they are the same statement.
  const E_RYD = HC * R_H * 1e-9;   // eV, −E₁
  const C_LIGHT = 299792458;    // m/s
  const N_MAX = 8;              // highest shell drawn

  const energyOf = (n) => -E_RYD / (n * n);
  // The levels are the model; everything else follows from them. A jump
  // releases the difference, and one photon carries it away. Written this way
  // round, 1/λ = R(1/n₁² − 1/n₂²) is a consequence rather than the input —
  // which is why R can be measured back out of the lines further down.
  const photonEnergy = (n1, n2) => energyOf(n2) - energyOf(n1);
  const wavelengthOf = (n1, n2) => HC / photonEnergy(n1, n2);

  /**
   * Rydberg's constant, fitted to whatever lines have actually been seen.
   * 1/λ = R·(1/n₁² − 1/n₂²) is a straight line through the origin, so the
   * slope is R — which is how Rydberg found it, from measured spectra,
   * a quarter of a century before Bohr explained where it came from.
   */
  function fitRydberg(seen) {
    let sxy = 0, sxx = 0, n = 0;
    for (const rec of seen) {
      const x = 1 / (rec.n1 * rec.n1) - 1 / (rec.n2 * rec.n2);
      const y = 1e9 / rec.nm;                       // m⁻¹
      sxy += x * y; sxx += x * x; n++;
    }
    return n >= 2 && sxx > 0 ? { R: sxy / sxx, n } : null;
  }

  const SERIES = { 1: "lyman", 2: "balmer", 3: "paschen", 4: "brackett" };
  const seriesName = (n1) => {
    const k = SERIES[n1];
    return k ? i18nText("series_" + k, k) : "n₁ = " + n1;
  };

  // ── Wavelength → visible colour ────────────────────────────────────────
  // Bruton's piecewise approximation of the CIE response, with the usual
  // intensity roll-off at the ends of the visible band.
  function wavelengthRGB(nm) {
    let r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440)      { r = -(nm - 440) / 60; b = 1; }
    else if (nm < 490)              { g = (nm - 440) / 50;  b = 1; }
    else if (nm < 510)              { g = 1; b = -(nm - 510) / 20; }
    else if (nm < 580)              { r = (nm - 510) / 70;  g = 1; }
    else if (nm < 645)              { r = 1; g = -(nm - 645) / 65; }
    else if (nm <= 780)             { r = 1; }
    let f = 1;
    if (nm >= 380 && nm < 420)      f = 0.3 + 0.7 * (nm - 380) / 40;
    else if (nm > 700 && nm <= 780) f = 0.3 + 0.7 * (780 - nm) / 80;
    else if (nm < 380 || nm > 780)  f = 0;
    const y = (v) => Math.round(255 * Math.pow(Math.max(v, 0) * f, 0.8));
    return [y(r), y(g), y(b)];
  }
  const rgbCss = (nm, a) => {
    const [r, g, b] = wavelengthRGB(nm);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  // Photons outside the visible band still have to be drawn as something.
  const invisibleTint = (nm) =>
    nm < 380 ? "rgba(170, 140, 255, " : "rgba(255, 140, 110, ";

  // ── State ──────────────────────────────────────────────────────────────
  let n = 1;                    // current shell
  let target = 1;               // shell we are falling toward
  let anim = 0;                 // 0..1 progress of the current jump
  let waiting = 0;              // dwell time before the next jump
  const photons = [];           // { x, y, vx, nm, life }
  const lines = new Map();      // "n2>n1" → { nm, n1, n2, count }
  let lastTransition = null;
  let measuredR = null;
  let highlight = "all";
  let lastTs = performance.now();
  let raf = 0;

  // ── Layout ─────────────────────────────────────────────────────────────
  // Left half: the energy ladder. Right half: the spectrometer strip.
  const SPEC_MIN = 350, SPEC_MAX = 750;   // nm shown on the strip
  let L;
  function computeLayout() {
    // The ladder keeps the left of the upper band; photons stream off to the
    // right across the rest of it. The spectrometer strip runs the full width
    // underneath, which is where it earns its space.
    const labelPad = 54;                    // room for the "−13.61 eV" column
    const ladderW = Math.min(Math.max(W * 0.30, 130), 240);
    L = {
      ladderX: 44,
      ladderW,
      top: 36,
      bottom: H - 158,
      specX: 44,
      specW: W - 88,
      specY: H - 116,
      specH: 58,
      labelPad,
    };
  }

  // Energy → y. The real 1/n² spacing is kept, which is the whole point:
  // the rungs visibly crowd together as they approach the ionisation limit.
  const CONTINUUM_BAND = 30;            // room above n=∞ for the free electron
  function yOf(E) {
    const t = (E - energyOf(1)) / (0 - energyOf(1));   // 0 at n=1, 1 at n=∞
    return L.bottom - t * (L.bottom - L.top - CONTINUUM_BAND);
  }
  const yOfN = (k) => yOf(energyOf(k));

  // ── Emission ───────────────────────────────────────────────────────────
  function emit(n2, n1) {
    const nm = wavelengthOf(n1, n2);
    const key = n2 + ">" + n1;
    const rec = lines.get(key);
    if (rec) rec.count++;
    else lines.set(key, { nm, n1, n2, count: 1 });
    lastTransition = { n1, n2, nm };

    photons.push({
      x: L.ladderX + L.ladderW + L.labelPad + 14,
      y: (yOfN(n1) + yOfN(n2)) / 2,
      vx: 190 + Math.random() * 70,
      vy: (Math.random() - 0.5) * 26,
      nm, life: 0,
    });

    // Pitch the click by the photon's energy — a bluer jump rings higher.
    const f = 240 + Math.min(photonEnergy(n1, n2), 13.6) * 90;
    window.SFX?.tone({ freq: f, dur: 0.09, type: "sine", gain: 0.11, release: 0.1 });

    updateReadouts();
  }

  function excite() {
    const to = parseInt(inputs.level.value, 10);
    n = to; target = to; anim = 0; waiting = 0.35;
    window.SFX?.sweep({ from: 200, to: 620, dur: 0.16, type: "sine", gain: 0.1 });
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt) {
    const sp = parseFloat(inputs.speed.value);
    const d = dt * sp;

    if (waiting > 0) {
      waiting -= d;
    } else if (n > 1 && anim === 0) {
      // Choose the next rung down. A real atom weights these by Einstein A
      // coefficients; uniform choice keeps every allowed line visible.
      target = 1 + Math.floor(Math.random() * (n - 1));
      anim = 0.0001;
    } else if (anim > 0) {
      anim += d * 3.2;
      if (anim >= 1) {
        emit(n, target);
        n = target;
        anim = 0;
        waiting = n > 1 ? 0.25 : 0.9;
      }
    } else if (n === 1 && autoToggle.checked) {
      waiting -= d;
      if (waiting <= -0.4) excite();
    }

    for (let i = photons.length - 1; i >= 0; i--) {
      const p = photons[i];
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.life += d;
      if (p.x > W + 40 || p.life > 6) photons.splice(i, 1);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b0a1c");
    bg.addColorStop(1, "#140b22");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawLadder() {
    const x0 = L.ladderX, x1 = L.ladderX + L.ladderW;

    // Ionisation limit (n → ∞, E = 0) and the free-electron region above it.
    const yInf = yOf(0);
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    ctx.fillRect(x0, L.top - 10, L.ladderW, yInf - L.top + 10);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, yInf); ctx.lineTo(x1, yInf); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(236, 240, 251, 0.6)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("n = ∞   0 eV", x0 + 4, yInf - 7);
    ctx.fillStyle = "rgba(200, 220, 255, 0.38)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(i18nText("spectraIonised", "ionised — electron free"), x0 + 4, yInf - 19);

    // Draw from the ground state upward and skip any label that would land on
    // the previous one — the rungs genuinely crowd as n grows, so past about
    // n = 5 there is no room left for text between them.
    let lastLabelY = Infinity;
    for (let k = 1; k <= N_MAX; k++) {
      const y = yOfN(k);
      const active = highlight === "all" || SERIES[k] === highlight;
      ctx.strokeStyle = active ? "rgba(160, 200, 255, 0.75)" : "rgba(160, 200, 255, 0.22)";
      ctx.lineWidth = k === 1 ? 2 : 1.4;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();

      if (lastLabelY - y < 13) continue;
      lastLabelY = y;
      ctx.fillStyle = active ? "rgba(236, 240, 251, 0.9)" : "rgba(236, 240, 251, 0.45)";
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText("n=" + k, x0 - 6, y + 4);
      ctx.textAlign = "left";
      ctx.fillText(energyOf(k).toFixed(2) + " eV", x1 + 8, y + 4);
    }

    // The jump in progress, drawn as an arrow in the photon's own colour.
    if (anim > 0) {
      const yFrom = yOfN(n), yTo = yOfN(target);
      const nm = wavelengthOf(target, n);
      const col = nm >= 380 && nm <= 780 ? rgbCss(nm, 0.9) : invisibleTint(nm) + "0.85)";
      const x = x0 + L.ladderW * 0.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, yFrom); ctx.lineTo(x, yTo); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, yTo);
      ctx.lineTo(x - 4, yTo + Math.sign(yFrom - yTo) * -7);
      ctx.lineTo(x + 4, yTo + Math.sign(yFrom - yTo) * -7);
      ctx.closePath(); ctx.fill();
    }

    // The electron itself.
    const yE = anim > 0
      ? yOfN(n) + (yOfN(target) - yOfN(n)) * Math.min(anim, 1)
      : yOfN(n);
    const xE = x0 + L.ladderW * 0.5;
    ctx.save();
    ctx.shadowColor = "rgba(110, 168, 255, 0.9)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#6ea8ff";
    ctx.beginPath(); ctx.arc(xE, yE, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("e⁻", xE, yE + 3);

    // The huge n=1 → n=2 gap is the single most important number on the
    // diagram, and it is otherwise just empty canvas — label it.
    const yGapMid = (yOfN(1) + yOfN(2)) / 2;
    const gapEV = energyOf(2) - energyOf(1);
    ctx.strokeStyle = "rgba(160, 200, 255, 0.20)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    const xg = x0 + L.ladderW * 0.5;
    ctx.beginPath();
    ctx.moveTo(xg, yOfN(2) + 8); ctx.lineTo(xg, yGapMid - 20);
    ctx.moveTo(xg, yGapMid + 20); ctx.lineTo(xg, yOfN(1) - 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(200, 220, 255, 0.75)";
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(gapEV.toFixed(2) + " eV", xg, yGapMid - 4);
    ctx.fillStyle = "rgba(200, 220, 255, 0.45)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(i18nText("spectraGapNote", "ground-state gap"), xg, yGapMid + 12);

    ctx.fillStyle = "rgba(236, 240, 251, 0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("spectraLabelLevels", "energy levels"), x0, L.top - 8);
  }

  function drawPhotons() {
    for (const p of photons) {
      const vis = p.nm >= 380 && p.nm <= 780;
      const a = Math.max(0, 1 - p.life / 3.2);
      ctx.strokeStyle = vis ? rgbCss(p.nm, a) : invisibleTint(p.nm) + a.toFixed(2) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const x = p.x - t * 30;
        const y = p.y + Math.sin(t * Math.PI * 4 - p.life * 12) * 4.5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawSpectrum() {
    const { specX: x, specY: y, specW: w, specH: h } = L;
    if (w < 60) return;

    // The visible band as a continuous reference, dimmed so the emission
    // lines drawn on top of it stand out.
    for (let i = 0; i < w; i++) {
      const nm = SPEC_MIN + (i / w) * (SPEC_MAX - SPEC_MIN);
      ctx.fillStyle = rgbCss(nm, 0.16);
      ctx.fillRect(x + i, y, 1, h);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Wavelength axis.
    ctx.fillStyle = "rgba(236,240,251,0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (let nm = 400; nm <= 700; nm += 100) {
      const px = x + ((nm - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * w;
      ctx.fillRect(px, y + h, 1, 4);
      ctx.fillText(nm + "", px, y + h + 16);
    }
    ctx.textAlign = "left";
    ctx.fillText(i18nText("spectraLabelSpectrum", "emission spectrum"), x, y - 8);
    ctx.textAlign = "right";
    ctx.fillText("nm", x + w, y + h + 16);

    // Every line collected so far.
    let uv = 0, ir = 0;
    for (const rec of lines.values()) {
      const dim = highlight !== "all" && SERIES[rec.n1] !== highlight;
      if (rec.nm < SPEC_MIN) { if (!dim) uv += rec.count; continue; }
      if (rec.nm > SPEC_MAX) { if (!dim) ir += rec.count; continue; }
      const px = x + ((rec.nm - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * w;
      const strength = Math.min(0.35 + rec.count * 0.09, 1);
      ctx.strokeStyle = rgbCss(rec.nm, dim ? 0.16 : strength);
      ctx.lineWidth = dim ? 1.2 : 2.2;
      ctx.beginPath(); ctx.moveTo(px, y + 1); ctx.lineTo(px, y + h - 1); ctx.stroke();
      if (!dim && rec.count >= 1) {
        ctx.save();
        ctx.translate(px, y - 12);
        ctx.rotate(-Math.PI / 2.4);
        ctx.fillStyle = rgbCss(rec.nm, 0.95);
        ctx.font = "600 10px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillText(rec.nm.toFixed(1), 0, 0);
        ctx.restore();
      }
    }

    // Lines that fall off either end still have to be accounted for.
    ctx.font = "10px ui-monospace, monospace";
    if (uv) {
      ctx.fillStyle = "rgba(180, 150, 255, 0.9)";
      ctx.textAlign = "left";
      ctx.fillText("← UV " + uv, x + 3, y + h + 30);
    }
    if (ir) {
      ctx.fillStyle = "rgba(255, 150, 120, 0.9)";
      ctx.textAlign = "right";
      ctx.fillText("IR " + ir + " →", x + w - 3, y + h + 30);
    }
  }

  function render() {
    drawBackground();
    drawLadder();
    drawPhotons();
    drawSpectrum();
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts() {
    if (!lastTransition) {
      out.transition.textContent = "—";
      out.energy.textContent = "—";
      out.wavelength.textContent = "—";
      out.frequency.textContent = "—";
      out.series.textContent = "—";
    } else {
      const { n1, n2, nm } = lastTransition;
      out.transition.textContent = `n=${n2} → n=${n1}`;
      out.energy.textContent = photonEnergy(n1, n2).toFixed(3);
      out.wavelength.textContent = nm.toFixed(1);
      out.frequency.textContent = (C_LIGHT / (nm * 1e-9) / 1e12).toFixed(0);
      out.series.textContent = seriesName(n1);
      out.wavelength.style.color =
        nm >= 380 && nm <= 780 ? rgbCss(nm, 1) : "";
    }
    let total = 0;
    for (const r of lines.values()) total += r.count;
    out.lines.textContent = String(total);
    outRydberg.textContent = measuredR
      ? measuredR.R.toExponential(6)
      : (lines.size >= 2 ? "—" : "—");
  }

  function updateLabels() {
    inputValues.level.textContent = inputs.level.value;
    inputValues.speed.textContent = parseFloat(inputs.speed.value).toFixed(1);
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    step(dt);
    render();
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) => el.addEventListener("input", updateLabels));
  exciteBtn.addEventListener("click", excite);
  clearBtn.addEventListener("click", () => {
    lines.clear();
    lastTransition = null;
    measuredR = null;
    window.SFX?.tone({ freq: 320, dur: 0.08, type: "sine", gain: 0.1 });
    updateReadouts();
  });

  // Fit Rydberg's constant to the lines this atom has actually emitted. It
  // needs two distinct ones to have a slope at all, which is the honest
  // failure mode: with a single line there is nothing to fit.
  measureBtn.addEventListener("click", () => {
    const fit = fitRydberg([...lines.values()]);
    measuredR = fit;
    updateReadouts();
    window.SFX?.tone({ freq: fit ? 540 : 200, dur: 0.12, type: "sine", gain: 0.1 });
  });
  resetBtn.addEventListener("click", () => {
    lines.clear();
    measuredR = null;
    photons.length = 0;
    lastTransition = null;
    n = 1; target = 1; anim = 0; waiting = 0;
    inputs.level.value = "6";
    inputs.speed.value = "1";
    autoToggle.checked = true;
    updateLabels();
    updateReadouts();
  });
  seriesList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      highlight = btn.dataset.key;
      window.SFX?.tone({ freq: 600, dur: 0.07, type: "triangle", gain: 0.1 });
      seriesList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.addEventListener("langchange", updateReadouts);
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
    H = 520;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed purely so the test harness can assert the Rydberg wavelengths.
  // Exposed so the harness can hold the measurement against the closed form.
  /*
   * The lines this atom has actually emitted, with how many times each was
   * seen — the list the Rydberg fit is made from, not the full table of what
   * hydrogen is capable of emitting.
   */
  if (window.CSVExport) {
    window.CSVExport.attach("csv-btn", () => {
      const ls = [...lines.values()];
      if (!ls.length) return null;
      const meta = {
        start_level_n: parseInt(inputs.level.value, 10),
        lines_seen: ls.length,
        R_reference_m1: R_H,
      };
      if (measuredR) meta.fitted_R_m1 = measuredR.R;
      return {
        name: "hydrogen-spectrum.csv",
        title: "Hydrogen Spectrum",
        columns: ["wavelength_nm", "n_lower", "n_upper", "series", "count",
                  "photon_energy_eV"],
        rows: ls.map((l) => [l.nm, l.n1, l.n2, seriesName(l.n1) || "", l.count,
                             photonEnergy(l.n1, l.n2)]),
        meta: meta,
      };
    });
  }

  window.__spectra = {
    wavelengthOf, photonEnergy, energyOf, fitRydberg, seriesName,
    R_H, E_RYD, HC, N_MAX,
    params: () => ({ level: parseInt(inputs.level.value, 10),
                     speed: parseFloat(inputs.speed.value),
                     auto: autoToggle.checked }),
    lines: () => [...lines.values()],
    measured: () => measuredR,
    state: () => ({ n, target, anim }),
    /** Run cascades headlessly and report the lines they produced. */
    cascades(from, count) {
      const seen = new Map();
      const hops = [];
      for (let c = 0; c < count; c++) {
        let k = from, steps = 0;
        while (k > 1) {
          const to = 1 + Math.floor(Math.random() * (k - 1));
          const key = k + ">" + to;
          const rec = seen.get(key);
          if (rec) rec.count++;
          else seen.set(key, { nm: wavelengthOf(to, k), n1: to, n2: k, count: 1 });
          k = to; steps++;
        }
        hops.push(steps);
      }
      return { lines: [...seen.values()], hops };
    },
  };

  resizeCanvas();
  updateLabels();
  updateReadouts();
  start();
})();
