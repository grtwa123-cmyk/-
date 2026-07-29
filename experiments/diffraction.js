/*
 * Fraunhofer diffraction from N slits.
 *
 * One formula produces everything on screen — the fringes, the envelope they
 * ride in, the missing orders, and the places a photon is allowed to land:
 *
 *     I(θ) = I₀ · (sin α / α)² · (sin Nβ / sin β)²
 *     α = πa·sinθ/λ        (one slit of width a)
 *     β = πd·sinθ/λ        (N slits spaced d apart)
 *
 * The first factor is a single slit interfering with itself; the second is
 * the slits interfering with each other. Nothing is drawn by hand and nothing
 * counts fringes: the interference maxima appear at d·sinθ = mλ because the
 * second factor peaks at N² there, and an order goes missing when that lands
 * on a zero of the first, which happens exactly when d/a is a whole number.
 *
 * sinθ is taken from the geometry, sinθ = y/√(y²+L²), rather than the usual
 * small-angle y/L — the difference is real at the edge of a wide screen and
 * costs nothing to keep.
 *
 * Two singular points need care and both are removable:
 *   α → 0   sin α / α → 1
 *   β → mπ  sin Nβ / sin β → ±N   (so the squared factor → N², the peak)
 *
 * With the photon counter on, each dot is drawn from that same I(y) by
 * rejection sampling, so the picture that accumulates is the curve — not a
 * sprite scattered along a path chosen to look right.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    wavelength: document.getElementById("wavelength"),
    slits: document.getElementById("slits"),
    width: document.getElementById("width"),
    sep: document.getElementById("sep"),
    dist: document.getElementById("dist"),
    rate: document.getElementById("rate"),
  };
  const inputValues = {
    wavelength: document.getElementById("wavelength-value"),
    slits: document.getElementById("slits-value"),
    width: document.getElementById("width-value"),
    sep: document.getElementById("sep-value"),
    dist: document.getElementById("dist-value"),
    rate: document.getElementById("rate-value"),
  };
  const out = {
    spacing: document.getElementById("out-spacing"),
    envelope: document.getElementById("out-envelope"),
    fringes: document.getElementById("out-fringes"),
    missing: document.getElementById("out-missing"),
    angle: document.getElementById("out-angle"),
    photons: document.getElementById("out-photons"),
  };
  const photonsToggle = document.getElementById("photons-on");
  const sepControl = document.getElementById("sep-control");
  const rateControl = document.getElementById("rate-control");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  const NM = 1e-9;
  const UM = 1e-6;

  // ── Optics ─────────────────────────────────────────────────────────────
  function params() {
    const a = parseFloat(inputs.width.value) * UM;
    // Slits cannot overlap. The separation slider is clamped against the
    // width rather than silently producing a mask that could not be cut.
    const d = Math.max(parseFloat(inputs.sep.value) * UM, a + 5 * UM);
    return {
      lam: parseFloat(inputs.wavelength.value) * NM,
      N: parseInt(inputs.slits.value, 10),
      a,
      d,
      L: parseFloat(inputs.dist.value),
    };
  }

  const sinTheta = (y, L) => y / Math.hypot(y, L);

  /** Intensity at screen position y, normalised so the centre is 1. */
  function intensity(y, p) {
    const s = sinTheta(y, p.L);
    const alpha = (Math.PI * p.a * s) / p.lam;
    const beta = (Math.PI * p.d * s) / p.lam;
    const sinc = alpha === 0 ? 1 : Math.sin(alpha) / alpha;
    let grating = 1;
    if (p.N > 1) {
      const sb = Math.sin(beta);
      // At β = mπ both numerator and denominator vanish; the limit is ±N.
      grating = Math.abs(sb) < 1e-12 ? p.N : Math.sin(p.N * beta) / sb;
    }
    return (sinc * sinc * grating * grating) / (p.N * p.N);
  }

  /** Screen position of a given sinθ, exactly: y = L·tanθ. */
  const yOf = (s, L) => (Math.abs(s) >= 1 ? Infinity : (L * s) / Math.sqrt(1 - s * s));

  const fringeSpacing = (p) => yOf(p.lam / p.d, p.L);
  const envelopeZero = (p) => yOf(p.lam / p.a, p.L);

  /**
   * Orders that fall on a zero of the single-slit envelope and so never
   * appear. Derived, not tabulated: an order m is missing when m·a/d is a
   * whole number.
   *
   * `maxM` bounds the search. The readout passes the highest order actually
   * on screen so it names the same orders the canvas marks; without it the
   * list runs off into orders the reader has no way to look at.
   */
  function missingOrders(p, maxM = Infinity) {
    const list = [];
    for (let m = 1; m <= Math.min(maxM, 500); m++) {
      const s = (m * p.lam) / p.d;
      if (s >= 1) break;
      const k = (m * p.a) / p.d;
      if (Math.abs(k - Math.round(k)) < 1e-9 && Math.round(k) >= 1) list.push(m);
    }
    return list;
  }

  /** Highest interference order that lands inside the shown screen. */
  function maxVisibleOrder(p, half) {
    let m = 0;
    while (m < 500) {
      const s = ((m + 1) * p.lam) / p.d;
      if (s >= 1 || Math.abs(yOf(s, p.L)) > half) break;
      m++;
    }
    return m;
  }

  /** Bright fringes inside the central envelope: the orders below d/a. */
  function fringesInEnvelope(p) {
    const ratio = p.d / p.a;
    let n = 0;
    for (let m = 1; m < ratio - 1e-9; m++) if ((m * p.lam) / p.d < 1) n++;
    return 2 * n + 1;
  }

  // ── Colour ─────────────────────────────────────────────────────────────
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
    const y = (v) => Math.round(255 * Math.pow(Math.max(v, 0) * f, 0.8));
    return [y(r), y(g), y(b)];
  }

  // ── State ──────────────────────────────────────────────────────────────
  let photons = [];            // accumulated hits, screen y in metres
  let photonCount = 0;
  let acc = 0;
  const MAX_DOTS = 6000;

  /**
   * Draw one photon landing position from I(y) by rejection sampling. The
   * proposal is uniform across the visible screen and the test is against
   * the true intensity, so the dots are distributed as the curve is — no
   * shortcut, no shaped noise.
   */
  function samplePhoton(p, half) {
    for (let tries = 0; tries < 60; tries++) {
      const y = (Math.random() * 2 - 1) * half;
      if (Math.random() <= intensity(y, p)) return y;
    }
    return null;                 // vanishingly rare; drop rather than fake it
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    L = {
      narrow,
      fs: narrow ? 10 : 11,
      fsv: narrow ? 9 : 10,
      maskTop: 10,
      maskBot: narrow ? 74 : 88,
      bandTop: narrow ? 88 : 104,
      bandBot: narrow ? 132 : 156,
      plotL: narrow ? 34 : 46,
      plotR: W - (narrow ? 12 : 18),
      plotT: narrow ? 158 : 190,
      plotB: H - (narrow ? 26 : 30),
    };
  }

  /** Half-width of screen shown, chosen so envelope and fringes both fit. */
  function viewHalf(p) {
    const env = envelopeZero(p);
    const fr = fringeSpacing(p);
    const want = Math.max(
      Number.isFinite(env) ? env * 2.2 : 0,
      Number.isFinite(fr) ? fr * 3.5 : 0
    );
    return Math.min(Math.max(want, 1e-4), p.L * 4);
  }

  const text = (str, x, y, colour, size, align, bold) => {
    ctx.fillStyle = colour;
    ctx.font = `${bold ? "600 " : ""}${size}px ui-monospace, monospace`;
    ctx.textAlign = align || "left";
    ctx.fillText(str, x, y);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  function render(p) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#080c18");
    bg.addColorStop(1, "#0c1124");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const { plotL, plotR, plotT, plotB, fs, fsv, narrow } = L;
    const half = viewHalf(p);
    const [cr, cg, cb] = wavelengthRGB(parseFloat(inputs.wavelength.value));
    const X = (y) => plotL + ((y + half) / (2 * half)) * (plotR - plotL);

    // ── The mask. Across the slits it is drawn to scale, so a and d keep
    //    their true proportion; along the beam nothing could be, since the
    //    slits are microns and the screen is metres away.
    const maskH = L.maskBot - L.maskTop;
    const span = p.N > 1 ? (p.N - 1) * p.d + p.a : p.a;
    const mmScale = Math.min(maskH / (span * 1.35), maskH / (p.a * 3));
    const mx = plotL + 54;
    const mcy = (L.maskTop + L.maskBot) / 2;
    ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.5)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const x = mx - 46 + i * 11;
      ctx.beginPath(); ctx.moveTo(x, L.maskTop + 4); ctx.lineTo(x, L.maskBot - 4); ctx.stroke();
    }
    ctx.fillStyle = "rgba(150, 170, 210, 0.9)";
    ctx.fillRect(mx - 3, L.maskTop + 2, 6, maskH - 4);
    ctx.fillStyle = "#080c18";
    for (let i = 0; i < p.N; i++) {
      const off = (i - (p.N - 1) / 2) * p.d;
      const h = Math.max(p.a * mmScale, 1.2);
      ctx.fillRect(mx - 3, mcy + off * mmScale - h / 2, 6, h);
    }
    ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.35)`;
    for (let i = 0; i < p.N; i++) {
      const off = (i - (p.N - 1) / 2) * p.d;
      const y0 = mcy + off * mmScale;
      for (const t of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.moveTo(mx + 3, y0);
        ctx.lineTo(plotR - 6, mcy + t * (maskH * 0.42));
        ctx.stroke();
      }
    }
    text(`N = ${p.N}   a = ${(p.a / UM).toFixed(0)} µm   d = ${(p.d / UM).toFixed(0)} µm`,
      plotR, L.maskTop + 12, "rgba(226,234,248,0.6)", fsv, "right");
    text(i18nText("diffMaskNote", "mask to scale across the slits"),
      plotR, L.maskBot - 2, "rgba(226,234,248,0.38)", fsv, "right");

    // ── The screen: brightness is the intensity, hue is the wavelength.
    const bandH = L.bandBot - L.bandTop;
    for (let px = plotL; px <= plotR; px++) {
      const y = ((px - plotL) / (plotR - plotL)) * 2 * half - half;
      const v = intensity(y, p);
      ctx.fillStyle = `rgb(${Math.round(cr * v)}, ${Math.round(cg * v)}, ${Math.round(cb * v)})`;
      ctx.fillRect(px, L.bandTop, 1, bandH);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(plotL + 0.5, L.bandTop + 0.5, plotR - plotL - 1, bandH - 1);

    // Accumulated photons, scattered across the band at their landing points.
    if (photons.length) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const ph of photons) {
        const x = X(ph.y);
        if (x < plotL || x > plotR) continue;
        ctx.fillRect(x, L.bandTop + 3 + ph.j * (bandH - 6), 1.4, 1.4);
      }
    }

    // ── The curve.
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const yy = plotB - v * (plotB - plotT);
      ctx.beginPath(); ctx.moveTo(plotL, yy + 0.5); ctx.lineTo(plotR, yy + 0.5); ctx.stroke();
      text(v.toFixed(2), plotL - 6, yy + 3.5, "rgba(226,234,248,0.45)", fsv, "right");
    }

    // The single-slit envelope, dashed — the shape the fringes must live in.
    ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.42)`;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let px = plotL; px <= plotR; px++) {
      const y = ((px - plotL) / (plotR - plotL)) * 2 * half - half;
      const s = sinTheta(y, p.L);
      const al = (Math.PI * p.a * s) / p.lam;
      const e = al === 0 ? 1 : (Math.sin(al) / al) ** 2;
      const yy = plotB - e * (plotB - plotT);
      px === plotL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // The full pattern. Sub-sampled per pixel because with many slits the
    // peaks are narrower than a pixel and would otherwise flicker as they
    // slide past the sample points.
    ctx.strokeStyle = `rgb(${cr}, ${cg}, ${cb})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    const SUB = 4;
    for (let px = plotL; px <= plotR; px++) {
      let peak = 0;
      for (let k = 0; k < SUB; k++) {
        const y = ((px - plotL + k / SUB) / (plotR - plotL)) * 2 * half - half;
        const v = intensity(y, p);
        if (v > peak) peak = v;
      }
      const yy = plotB - peak * (plotB - plotT);
      px === plotL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    ctx.stroke();

    // Order markers, with the missing ones called out where they would be.
    const missing = missingOrders(p);
    ctx.textAlign = "center";
    for (let m = -12; m <= 12; m++) {
      if (m === 0) continue;
      const s = (m * p.lam) / p.d;
      if (Math.abs(s) >= 1) continue;
      const x = X(yOf(s, p.L));
      if (x < plotL + 4 || x > plotR - 4) continue;
      const gone = missing.includes(Math.abs(m));
      ctx.strokeStyle = gone ? "rgba(255,120,140,0.5)" : "rgba(226,234,248,0.18)";
      ctx.lineWidth = 1;
      ctx.setLineDash(gone ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(x, plotT); ctx.lineTo(x, plotB); ctx.stroke();
      ctx.setLineDash([]);
      if (!narrow || Math.abs(m) <= 4) {
        text(String(m), x, plotB + 14,
          gone ? "rgba(255,120,140,0.85)" : "rgba(226,234,248,0.45)", fsv, "center");
      }
    }
    text(i18nText("diffScreenAxis", "position on screen (mm)"), plotR, plotB + (narrow ? 25 : 27),
      "rgba(226,234,248,0.45)", fsv, "right");
    text(`${i18nText("diffHalfWidth", "screen half-width")} ±${(half * 1000).toFixed(0)} mm`,
      plotL, plotB + (narrow ? 25 : 27), "rgba(226,234,248,0.45)", fsv, "left");
    text(i18nText("diffIntensityAxis", "relative intensity"), plotL - 6, plotT - 10,
      "rgba(226,234,248,0.6)", fsv, "left");
    if (missing.length) {
      text(i18nText("diffMissingNote", "dashed = order missing, envelope is zero there"),
        plotR, plotT - 10, "rgba(255,120,140,0.8)", fsv, "right");
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    const fr = fringeSpacing(p);
    const env = envelopeZero(p);
    out.spacing.textContent = p.N > 1 && Number.isFinite(fr) ? (fr * 1000).toFixed(2) : "—";
    out.envelope.textContent = Number.isFinite(env) ? (env * 1000).toFixed(2) : "—";
    out.fringes.textContent = p.N > 1 ? String(fringesInEnvelope(p)) : "—";
    // Only the orders on screen, so the readout and the canvas agree; a
    // trailing ellipsis when the sequence carries on past the edge.
    const vis = maxVisibleOrder(p, viewHalf(p));
    const miss = missingOrders(p, vis);
    const more = missingOrders(p, vis + 200).length > miss.length;
    out.missing.textContent = p.N > 1
      ? (miss.length
          ? miss.map((m) => `±${m}`).join(", ") + (more ? " …" : "")
          : i18nText("diffNone", "none"))
      : "—";
    const s1 = p.lam / p.d;
    out.angle.textContent = p.N > 1 && s1 < 1
      ? ((Math.asin(s1) * 180) / Math.PI).toFixed(3)
      : "—";
    out.photons.textContent = photonCount.toLocaleString();
  }

  function updateLabels() {
    inputValues.wavelength.textContent = inputs.wavelength.value;
    inputValues.slits.textContent = inputs.slits.value;
    inputValues.width.textContent = inputs.width.value;
    inputValues.sep.textContent = inputs.sep.value;
    inputValues.dist.textContent = parseFloat(inputs.dist.value).toFixed(1);
    inputValues.rate.textContent = inputs.rate.value;
  }

  function syncControls() {
    const single = parseInt(inputs.slits.value, 10) === 1;
    sepControl.hidden = single;
    rateControl.hidden = !photonsToggle.checked;
    // The mask has to be cuttable: neighbouring slits cannot overlap.
    const a = parseFloat(inputs.width.value);
    if (parseFloat(inputs.sep.value) < a + 5) {
      inputs.sep.value = String(Math.min(a + 5, parseFloat(inputs.sep.max)));
      inputValues.sep.textContent = inputs.sep.value;
    }
  }

  function clearPhotons() {
    photons = [];
    photonCount = 0;
    acc = 0;
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastTs = performance.now();
  let raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    const p = params();

    if (photonsToggle.checked) {
      acc += dt * parseFloat(inputs.rate.value);
      const n = Math.min(Math.floor(acc), 400);
      acc -= n;
      const half = viewHalf(p);
      for (let i = 0; i < n; i++) {
        const y = samplePhoton(p, half);
        if (y === null) continue;
        photons.push({ y, j: Math.random() });
        photonCount++;
      }
      if (photons.length > MAX_DOTS) photons.splice(0, photons.length - MAX_DOTS);
    }

    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  Object.values(inputs).forEach((el) => {
    el.addEventListener("input", () => {
      syncControls();
      updateLabels();
      // Any optical change invalidates the dots already counted — they were
      // drawn from a different distribution.
      if (el !== inputs.rate) clearPhotons();
    });
  });
  inputs.wavelength.addEventListener("change", () => {
    // Pitch follows colour: longer wavelength, lower note.
    const nm = parseFloat(inputs.wavelength.value);
    window.SFX?.tone({ freq: 1200 - (nm - 380) * 1.6, dur: 0.09, type: "sine", gain: 0.08 });
  });
  photonsToggle.addEventListener("change", () => {
    syncControls();
    clearPhotons();
    window.SFX?.click({ gain: 0.22 });
  });
  resetBtn.addEventListener("click", () => {
    clearPhotons();
    syncControls();
    updateLabels();
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
    H = W < 560 ? 470 : 560;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check the optics against the closed forms.
  window.__diff = {
    params, intensity, sinTheta, yOf,
    fringeSpacing, envelopeZero, missingOrders, fringesInEnvelope, maxVisibleOrder,
    samplePhoton, viewHalf,
    photonCount: () => photonCount,
    photonYs: () => photons.map((q) => q.y),
  };

  resizeCanvas();
  syncControls();
  updateLabels();
  start();
})();
