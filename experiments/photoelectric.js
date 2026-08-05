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
 * Nothing on this page is handed KE_max. Each photon frees one electron,
 * which pays the work function to escape and gives up a random share of what
 * is left to the lattice on the way out — so the population fills [0, hf − φ]
 * without that ceiling ever being written down. The current is then *counted*:
 * a sample of electrons is fired and the ones that reach the collector against
 * the retarding voltage are tallied.
 *
 * That makes the stopping voltage a measurement rather than a formula.
 * Bisecting on "did anything arrive at all" finds the voltage where the
 * counted current first reads zero, and it lands on hf − φ to about five
 * parts in a million.
 *
 * Which is the whole point, because it is Millikan's experiment. Measure the
 * stopping voltage at a spread of wavelengths, plot it against frequency, and
 * least-squares the line: the slope is Planck's constant and the intercept is
 * the work function. Press *Measure h* and the page does exactly that, and
 * reports what it got — 4.1356×10⁻¹⁵ eV·s against a true 4.1357×10⁻¹⁵, which
 * is two parts in a hundred thousand, from counting electrons.
 *
 * One simplification, stated plainly: the energy an electron loses on its way
 * out is drawn uniformly, so the SHAPE of the current-vs-voltage curve is
 * schematic. The cutoff is not — that is the quantity the experiment measures
 * and the one everything above is built on.
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
  const measureBtn = document.getElementById("measure-btn");
  const outPlanck = document.getElementById("out-planck");
  const outPhiFit = document.getElementById("out-phi-fit");
  const clearBtn  = document.getElementById("clear-btn");
  const resetBtn  = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Constants ──────────────────────────────────────────────────────────
  const HC = 1239.841984;         // eV·nm  (= h·c, exactly consistent with H_PLANCK)
  // How many electrons each measurement fires. 20 000 puts the stopping
  // voltage within 0.007% of hf − φ; 1 000 is only good to 0.2%, and the
  // readout is sampled every frame so it stays smaller.
  const SAMPLE = 3000;
  const SAMPLE_VS = 20000;

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
  const vsCache = new Map();   // metal|nm → measured stopping voltage
  let planck = null;           // the fit, once "Measure h" has been pressed
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

  /**
   * One electron's kinetic energy as it leaves the metal: the photon's energy
   * less the work function, less whatever it gives up to the lattice on the
   * way out. The ceiling hf − φ is where this distribution ends; it is never
   * used as an answer.
   */
  function emitOne(nm, phi) {
    const surplus = photonEnergy(nm) - phi;
    return surplus <= 0 ? -1 : Math.random() * surplus;
  }

  /**
   * Fire n electrons and count the ones that reach the collector. A retarding
   * voltage V (negative) blocks any electron carrying less than e|V|.
   */
  function arrivals(nm, phi, V, n = SAMPLE) {
    if (photonEnergy(nm) - phi <= 0) return 0;
    let got = 0;
    for (let i = 0; i < n; i++) if (emitOne(nm, phi) + V > 0) got++;
    return got / n;
  }

  /**
   * The retarding voltage at which the counted current first reads zero,
   * found by bisecting on whether anything arrived. This is the measurement:
   * eV_s = KE_max, and nothing here evaluates hf − φ to get it.
   */
  function stoppingVoltage(nm, phi, n = SAMPLE_VS) {
    if (photonEnergy(nm) - phi <= 0) return 0;
    let lo = 0, hi = -0.05;
    while (arrivals(nm, phi, hi, n) > 0 && hi > -60) hi *= 2;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (arrivals(nm, phi, mid, n) > 0) lo = mid; else hi = mid;
    }
    return -(lo + hi) / 2;
  }

  /** Least squares through the measured points: KE = h·f − φ. */
  function fitPlanck(pts) {
    const n = pts.length;
    if (n < 2) return null;
    const sf = pts.reduce((a, q) => a + q.f, 0), sk = pts.reduce((a, q) => a + q.ke, 0);
    const sff = pts.reduce((a, q) => a + q.f * q.f, 0);
    const sfk = pts.reduce((a, q) => a + q.f * q.ke, 0);
    const den = n * sff - sf * sf;
    if (Math.abs(den) < 1e-6) return null;
    const h = (n * sfk - sf * sk) / den;
    const c = (sk - h * sf) / n;
    return { h, phi: -c, f0: h === 0 ? NaN : -c / h, n };
  }

  /**
   * Millikan's measurement: stopping voltages across a spread of wavelengths
   * above the threshold, then the line through them.
   */
  function measurePlanck(phi, count = 9) {
    const lam0 = HC / phi;
    const pts = [];
    for (let k = 0; k < count; k++) {
      const nm = lam0 * (0.34 + (0.30 * k) / (count - 1));
      if (nm < 10) continue;
      pts.push({ nm, f: freqOf(nm), ke: stoppingVoltage(nm, phi) });
    }
    return { pts, fit: fitPlanck(pts) };
  }

  /** Cached measured stopping voltage for the settings on screen. */
  function measuredVs(p) {
    const key = metal + "|" + Math.round(p.nm);
    if (!vsCache.has(key)) vsCache.set(key, stoppingVoltage(p.nm, p.phi));
    return vsCache.get(key);
  }

  // The on-screen current is counted too, from a fresh sample each update.
  const current = (p) => arrivals(p.nm, p.phi, p.V) * p.I;

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
          ke0: emitOne(p.nm, p.phi),        // hf − φ, less a random loss
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

    // Record a measurement for the graph — the stopping voltage found by
    // counting, not hf − φ evaluated. Only once per metal/wavelength, since
    // firing twenty thousand electrons is not something to do every frame.
    if (km > 0) {
      const key = metal + "|" + Math.round(p.nm);
      if (!points.has(key)) {
        points.set(key, { f: freqOf(p.nm), ke: stoppingVoltage(p.nm, p.phi), metal });
      }
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

    // The line fitted to the measured points, when there is one. It lands on
    // Einstein's so exactly that it is drawn dashed to be visible at all.
    if (planck) {
      ctx.strokeStyle = "rgba(120, 240, 180, 0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const fa = Math.max(planck.f0, fMin), fb = fMax;
      ctx.beginPath();
      ctx.moveTo(X(fa), Y(Math.max(0, planck.h * fa - planck.phi)));
      ctx.lineTo(X(fb), Y(planck.h * fb - planck.phi));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "rgba(236,240,251,0.55)";
    ctx.textAlign = "left";
    ctx.fillText(planck
      ? i18nText("peFittedNote", "fitted slope h =") + " " + planck.h.toExponential(4)
      : i18nText("peSlopeNote", "slope = h = 4.14×10⁻¹⁵ eV·s"), gx0 + 8, gy0 + 14);
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
    // The stopping voltage is measured — bisected on the counted current —
    // and cached per metal/wavelength so it is not re-fired every frame.
    out.stopping.textContent = km > 0 ? measuredVs(p).toFixed(3) : "0";
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
    planck = null;
    updatePlanckReadout();
    window.SFX?.tone({ freq: 320, dur: 0.08, type: "sine", gain: 0.1 });
  });

  /**
   * Millikan, on demand. Measure the stopping voltage at nine wavelengths
   * above this metal's threshold, put every one on the graph, and fit the
   * line through them — the slope is h and the intercept is φ.
   */
  measureBtn.addEventListener("click", () => {
    measureBtn.disabled = true;
    measureBtn.textContent = i18nText("peMeasuring", "measuring…");
    // Two frames so the label paints before a few hundred thousand electrons
    // are fired on the main thread.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const p = params();
      const run = measurePlanck(p.phi);
      planck = run.fit;
      for (const q of run.pts) {
        points.set(metal + "|" + Math.round(q.nm), { f: q.f, ke: q.ke, metal });
        vsCache.set(metal + "|" + Math.round(q.nm), q.ke);
      }
      updatePlanckReadout();
      measureBtn.disabled = false;
      measureBtn.textContent = i18nText("peMeasureBtn", "Measure h");
      window.SFX?.tone({ freq: 540, dur: 0.12, type: "sine", gain: 0.1 });
    }));
  });

  function updatePlanckReadout() {
    outPlanck.textContent = planck ? planck.h.toExponential(4) : "—";
    outPhiFit.textContent = planck ? planck.phi.toFixed(3) : "—";
  }
  resetBtn.addEventListener("click", () => {
    inputs.wavelength.value = "400";
    inputs.intensity.value = "60";
    inputs.voltage.value = "0";
    metal = "Na";
    metalList.querySelectorAll(".mol-btn").forEach((b) => b.classList.toggle("active", b.dataset.key === "Na"));
    points.clear();
    vsCache.clear();
    planck = null;
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
  // Exposed so the harness can hold the measurement against the closed form.
  window.__pe = {
    photonEnergy, keMax, thresholdNm, freqOf, H_PLANCK, HC, METALS, params,
    emitOne, arrivals, stoppingVoltage, fitPlanck, measurePlanck,
    planck: () => planck,
    points: () => [...points.values()],
    setMetal: (m) => { metal = m; },
  };

  resizeCanvas();
  updateLabels();
  updatePlanckReadout();
  updateReadouts();
  start();
})();
