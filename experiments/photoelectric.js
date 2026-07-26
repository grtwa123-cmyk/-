/*
 * Photoelectric effect — Einstein's equation, measured.
 *
 * Light of wavelength λ carries photons of energy E = hc/λ. One photon is
 * absorbed by one electron, and the electron has to pay the work function φ
 * to escape the metal at all, so the most energetic escapee leaves with
 *
 *   KE_max = hf − φ            (Einstein, 1905)
 *
 * Three consequences drive everything on screen, and all three are the
 * things a wave picture of light cannot explain:
 *
 *   1. Below f₀ = φ/h nothing is emitted, no matter how bright the beam.
 *   2. Intensity sets how MANY electrons leave, never how fast.
 *   3. Making the collector negative pushes back; the voltage that just
 *      stops the fastest electron measures KE_max directly, since eV_s = KE_max.
 *
 * The graph at the bottom is the actual experiment: KE_max against frequency
 * is a straight line whose slope is Planck's constant and whose x-intercept
 * is the threshold frequency. Sweeping the wavelength slider plots real
 * points on it — that is the measurement Millikan did to pin down h.
 *
 * One simplification, stated plainly: emitted electrons are given kinetic
 * energies spread uniformly over [0, KE_max]. A real metal's distribution is
 * not uniform, so the SHAPE of the current-vs-voltage curve here is
 * schematic. The cutoff is not — current reaches exactly zero at V = −V_s,
 * which is the quantity the experiment actually measures.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    wavelength: document.getElementById("wavelength"),
    intensity:  document.getElementById("intensity"),
    voltage:    document.getElementById("voltage"),
  };
  const inputValues = {
    wavelength: document.getElementById("wavelength-value"),
    intensity:  document.getElementById("intensity-value"),
    voltage:    document.getElementById("voltage-value"),
  };
  const out = {
    photon:    document.getElementById("out-photon"),
    work:      document.getElementById("out-work"),
    ke:        document.getElementById("out-ke"),
    stopping:  document.getElementById("out-stopping"),
    threshold: document.getElementById("out-threshold"),
    current:   document.getElementById("out-current"),
  };
  const metalList = document.getElementById("metal-list");
  const clearBtn  = document.getElementById("clear-btn");
  const resetBtn  = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Constants ──────────────────────────────────────────────────────────
  const HC = 1239.841984;         // eV·nm  (= h·c, exactly consistent with H_PLANCK)
  const H_PLANCK = 4.135667696e-15; // eV·s
  const C_LIGHT = 299792458;      // m/s

  // Work functions in eV (polycrystalline values).
  const METALS = {
    Na: { phi: 2.28, key: "metalNa" },
    Ag: { phi: 4.26, key: "metalAg" },
    Zn: { phi: 4.33, key: "metalZn" },
    Cu: { phi: 4.65, key: "metalCu" },
    Pt: { phi: 6.35, key: "metalPt" },
  };
  let metal = "Na";

  const photonEnergy = (nm) => HC / nm;                  // eV
  const freqOf = (nm) => C_LIGHT / (nm * 1e-9);          // Hz
  const thresholdNm = (phi) => HC / phi;                 // nm
  const keMax = (nm, phi) => Math.max(0, photonEnergy(nm) - phi);

  // ── Wavelength → visible colour (Bruton's approximation) ───────────────
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
  // Ultraviolet has no colour of its own; render it as a dim violet haze so
  // the beam is still visible when it is doing the most interesting work.
  function beamCss(nm, a) {
    if (nm < 380) return `rgba(150, 120, 235, ${a * 0.75})`;
    const [r, g, b] = wavelengthRGB(nm);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // ── State ──────────────────────────────────────────────────────────────
  const electrons = [];     // { x, y, ke0, ke, dir, dead }
  const photonDots = [];    // { t, y }
  const points = new Map(); // "metal|nm" → { f, ke, metal }
  let emitAcc = 0;
  let lastTs = performance.now();
  let raf = 0;

  const params = () => ({
    nm: parseFloat(inputs.wavelength.value),
    I: parseFloat(inputs.intensity.value) / 100,
    V: parseFloat(inputs.voltage.value),
    phi: METALS[metal].phi,
  });

  // Fraction of emitted electrons that actually reach the collector.
  // Retarding voltage blocks any electron whose kinetic energy is below e|V|;
  // with the uniform spread that leaves (KE_max − |V|)/KE_max of them.
  function collectedFraction(p) {
    const km = keMax(p.nm, p.phi);
    if (km <= 0) return 0;
    if (p.V >= 0) return 1;
    return Math.max(0, Math.min(1, (km + p.V) / km));
  }
  const current = (p) => collectedFraction(p) * p.I;

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    L = {
      lampX: 46,
      plateX: Math.max(W * 0.34, 150),
      collX: W - 62,
      midY: 132,
      tubeTop: 52,
      tubeBot: 212,
      gx0: 66, gx1: W - 26, gy0: H - 188, gy1: H - 44,
    };
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt) {
    const p = params();
    const km = keMax(p.nm, p.phi);
    const span = L.collX - L.plateX;

    // Photons streaming down the beam — rate tracks intensity only.
    emitAcc += dt * (2 + p.I * 26);
    while (emitAcc > 1) {
      emitAcc -= 1;
      if (p.I > 0.01) photonDots.push({ t: 0, y: L.midY + (Math.random() - 0.5) * 54 });
      // Every photon that lands can free one electron, but only if it is
      // carrying more than the work function.
      if (p.I > 0.01 && km > 0 && electrons.length < 90) {
        electrons.push({
          x: L.plateX + 3,
          y: L.midY + (Math.random() - 0.5) * 60,
          ke0: Math.random() * km,          // uniform spread up to KE_max
          dir: 1,
        });
      }
    }
    for (let i = photonDots.length - 1; i >= 0; i--) {
      photonDots[i].t += dt * 1.7;
      if (photonDots[i].t > 1) photonDots.splice(i, 1);
    }

    // Electrons: constant field between plate and collector, so kinetic
    // energy falls linearly with distance when the collector repels them.
    for (let i = electrons.length - 1; i >= 0; i--) {
      const e = electrons[i];
      const frac = (e.x - L.plateX) / span;
      const ke = e.ke0 + p.V * frac;               // eV remaining
      if (ke <= 0 && e.dir > 0) e.dir = -1;        // turned back by the field
      const v = 210 * Math.sqrt(Math.max(ke, 0.02)) / Math.sqrt(Math.max(km, 0.5) + 1);
      e.x += e.dir * v * dt * 3.2;
      e.ke = ke;
      if (e.x >= L.collX - 2 || e.x < L.plateX - 4) electrons.splice(i, 1);
    }

    // Record the measurement for the graph.
    if (km > 0) {
      const key = metal + "|" + Math.round(p.nm);
      if (!points.has(key)) points.set(key, { f: freqOf(p.nm), ke: km, metal });
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080d1c");
    bg.addColorStop(1, "#0d1226");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawApparatus(p) {
    const km = keMax(p.nm, p.phi);
    const emitting = km > 0 && p.I > 0.01;

    // Evacuated tube
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(L.plateX - 26, L.tubeTop, L.collX - L.plateX + 52, L.tubeBot - L.tubeTop);

    // Lamp
    ctx.fillStyle = p.I > 0.01 ? beamCss(p.nm, 0.9) : "rgba(120,130,160,0.5)";
    ctx.beginPath(); ctx.arc(L.lampX, L.midY, 15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5; ctx.stroke();

    // Beam — brightness follows intensity, colour follows wavelength.
    if (p.I > 0.01) {
      const g = ctx.createLinearGradient(L.lampX, 0, L.plateX, 0);
      g.addColorStop(0, beamCss(p.nm, 0.05 + 0.5 * p.I));
      g.addColorStop(1, beamCss(p.nm, 0.05 + 0.28 * p.I));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(L.lampX + 10, L.midY - 10);
      ctx.lineTo(L.plateX - 2, L.midY - 34);
      ctx.lineTo(L.plateX - 2, L.midY + 34);
      ctx.lineTo(L.lampX + 10, L.midY + 10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = beamCss(p.nm, 0.95);
      for (const d of photonDots) {
        ctx.beginPath();
        ctx.arc(L.lampX + 12 + d.t * (L.plateX - L.lampX - 14), d.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cathode (target metal) and collector
    ctx.fillStyle = "#8d97b6";
    ctx.fillRect(L.plateX - 6, L.midY - 62, 8, 124);
    ctx.fillRect(L.collX - 2, L.midY - 46, 8, 92);
    ctx.fillStyle = "rgba(236,240,251,0.8)";
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(metal + "  φ=" + p.phi.toFixed(2) + " eV", L.plateX + 6, L.midY + 78);
    ctx.fillText(i18nText("peCollector", "collector"), L.collX, L.midY + 62);
    ctx.fillText((p.V >= 0 ? "+" : "") + p.V.toFixed(1) + " V", L.collX, L.midY + 76);

    // Electrons in flight
    for (const e of electrons) {
      ctx.fillStyle = e.dir > 0 ? "rgba(110,168,255,0.95)" : "rgba(255,140,120,0.9)";
      ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Ammeter
    const I = current(p);
    const ax = (L.plateX + L.collX) / 2, ay = L.tubeBot + 40;
    ctx.strokeStyle = "rgba(200,210,230,0.6)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(L.plateX + 2, L.tubeBot); ctx.lineTo(L.plateX + 2, ay); ctx.lineTo(ax - 24, ay);
    ctx.moveTo(L.collX + 2, L.tubeBot); ctx.lineTo(L.collX + 2, ay); ctx.lineTo(ax + 24, ay);
    ctx.stroke();
    ctx.fillStyle = "rgba(20,26,44,0.9)";
    ctx.beginPath(); ctx.arc(ax, ay, 24, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.stroke();
    const ang = (-0.9 + 1.8 * Math.min(I, 1)) ;
    ctx.strokeStyle = I > 0.001 ? "#6effc6" : "rgba(200,210,230,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay + 6);
    ctx.lineTo(ax + Math.sin(ang) * 17, ay + 6 - Math.cos(ang) * 17);
    ctx.stroke();
    ctx.fillStyle = "rgba(236,240,251,0.75)";
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.fillText("A", ax, ay + 19);

    // The headline result, stated on the canvas.
    ctx.font = "700 13px ui-monospace, monospace";
    ctx.textAlign = "left";
    if (!emitting && p.I > 0.01) {
      ctx.fillStyle = "rgba(255,120,140,0.95)";
      ctx.fillText(i18nText("peNoEmission", "no emission — photon below φ"), L.plateX + 16, L.tubeTop - 14);
    } else if (emitting) {
      ctx.fillStyle = "rgba(110,255,198,0.9)";
      ctx.fillText(i18nText("peEmitting", "emitting"), L.plateX + 16, L.tubeTop - 14);
    }
  }

  function drawGraph(p) {
    const { gx0, gx1, gy0, gy1 } = L;
    if (gx1 - gx0 < 120) return;
    const fMin = 3e14, fMax = 1.75e15;
    const keTop = 5.2;
    const X = (f) => gx0 + ((f - fMin) / (fMax - fMin)) * (gx1 - gx0);
    const Y = (ke) => gy1 - (ke / keTop) * (gy1 - gy0);

    // Frame + grid
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
    ctx.fillStyle = "rgba(236,240,251,0.5)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (let f = 4e14; f <= fMax; f += 2e14) {
      const x = X(f);
      if (x < gx0 || x > gx1) continue;
      ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); ctx.stroke();
      ctx.fillText((f / 1e14).toFixed(0), x, gy1 + 14);
    }
    ctx.textAlign = "right";
    for (let ke = 1; ke <= 5; ke++) {
      const y = Y(ke);
      ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
      ctx.fillText(ke + "", gx0 - 6, y + 3);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(236,240,251,0.62)";
    ctx.fillText("KE" + "ₘₐₓ" + " (eV)", gx0 - 44, gy0 - 8);
    ctx.textAlign = "right";
    ctx.fillText("f  (10¹⁴ Hz)", gx1, gy1 + 28);

    // Einstein's line for the selected metal: KE = hf − φ, drawn only where
    // it is positive. Its slope is h and it crosses zero at f₀ = φ/h.
    const f0 = p.phi / H_PLANCK;
    ctx.strokeStyle = "rgba(110, 168, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(Math.max(f0, fMin)), Y(Math.max(0, H_PLANCK * Math.max(f0, fMin) - p.phi)));
    ctx.lineTo(X(fMax), Y(H_PLANCK * fMax - p.phi));
    ctx.stroke();
    if (f0 >= fMin && f0 <= fMax) {
      ctx.strokeStyle = "rgba(255,180,110,0.55)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(X(f0), gy0); ctx.lineTo(X(f0), gy1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,180,110,0.9)";
      ctx.textAlign = "center";
      ctx.fillText("f₀", X(f0), gy0 - 4);
    }

    // Points actually measured by sweeping the wavelength.
    for (const pt of points.values()) {
      if (pt.metal !== metal) continue;
      const x = X(pt.f), y = Y(pt.ke);
      if (x < gx0 || x > gx1 || y < gy0) continue;
      ctx.fillStyle = "rgba(255, 225, 120, 0.95)";
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // Where we are right now.
    const kmNow = keMax(p.nm, p.phi);
    if (kmNow > 0) {
      const x = X(freqOf(p.nm)), y = Y(kmNow);
      if (x >= gx0 && x <= gx1 && y >= gy0) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.fillStyle = "rgba(236,240,251,0.55)";
    ctx.textAlign = "left";
    ctx.fillText(i18nText("peSlopeNote", "slope = h = 4.14×10⁻¹⁵ eV·s"), gx0 + 8, gy0 + 14);
  }

  function render() {
    const p = params();
    drawBackground();
    drawApparatus(p);
    drawGraph(p);
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts() {
    const p = params();
    const E = photonEnergy(p.nm);
    const km = keMax(p.nm, p.phi);
    out.photon.textContent = E.toFixed(3);
    out.work.textContent = p.phi.toFixed(2);
    out.ke.textContent = km > 0 ? km.toFixed(3) : "0";
    out.ke.style.color = km > 0 ? "#6effc6" : "#ff6b8a";
    out.stopping.textContent = km > 0 ? km.toFixed(3) : "0";
    out.threshold.textContent = thresholdNm(p.phi).toFixed(0);
    const I = current(p);
    out.current.textContent = km > 0
      ? Math.round(I * 100) + " %"
      : i18nText("peNone", "none");
    out.current.style.color = km > 0 && I > 0 ? "" : "#ff6b8a";
  }

  function updateLabels() {
    const p = params();
    inputValues.wavelength.textContent = String(Math.round(p.nm));
    inputValues.intensity.textContent = String(Math.round(p.I * 100));
    inputValues.voltage.textContent = p.V.toFixed(1);
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    step(dt);
    render();
    updateReadouts();
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) => el.addEventListener("input", updateLabels));
  inputs.wavelength.addEventListener("change", () => {
    const p = params();
    // A short blip pitched by the photon energy; silent below threshold.
    if (keMax(p.nm, p.phi) > 0) {
      window.SFX?.tone({ freq: 260 + photonEnergy(p.nm) * 90, dur: 0.08, type: "sine", gain: 0.1 });
    }
  });
  metalList.querySelectorAll(".mol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      metal = btn.dataset.key;
      window.SFX?.tone({ freq: 560, dur: 0.07, type: "triangle", gain: 0.1 });
      metalList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b === btn));
      updateReadouts();
    });
  });
  clearBtn.addEventListener("click", () => {
    points.clear();
    window.SFX?.tone({ freq: 320, dur: 0.08, type: "sine", gain: 0.1 });
  });
  resetBtn.addEventListener("click", () => {
    inputs.wavelength.value = "400";
    inputs.intensity.value = "60";
    inputs.voltage.value = "0";
    metal = "Na";
    metalList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === "Na"));
    points.clear();
    electrons.length = 0;
    photonDots.length = 0;
    updateLabels();
    updateReadouts();
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
    H = 540;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the test harness can assert Einstein's equation directly.
  window.__pe = { photonEnergy, keMax, thresholdNm, freqOf, H_PLANCK, METALS,
                  setMetal: (m) => { metal = m; } };

  resizeCanvas();
  updateLabels();
  updateReadouts();
  start();
})();
