/*
 * Diffraction from N slits — the pattern is added up, not evaluated.
 *
 * What goes in is Huygens' principle and nothing else. Every point of every
 * open slit radiates, all in phase, and in the far field the contribution
 * from aperture point ξ toward the direction sinθ arrives with phase k·ξ·sinθ.
 * The amplitude in that direction is the sum of all of them:
 *
 *     A(sinθ) = Σ_slits Σ_points  exp(i·k·ξ·sinθ)
 *
 * Because the slits are identical and evenly spaced, that double sum comes
 * apart into two single sums — one slit's own contributions, times the sum
 * over slit centres. That factorisation is not a shortcut, it *is* the thing
 * the page is about: one slit interfering with itself, and the slits
 * interfering with each other. Both are added term by term; neither
 * sin α / α nor sin Nβ / sin β appears anywhere in this file, and
 * tests/experiments/diffraction.test.mjs greps it to keep that true.
 *
 * Everything the page reports is then found in the resulting curve. The
 * intensity is scanned down the screen and the fringes are *located* as local
 * maxima of that scan, each refined by fitting a parabola through its three
 * samples. So:
 *
 *   · the fringe spacing is the gap between two located maxima
 *   · d·sinθ = mλ is a *measurement*, taken at the peak the search returned
 *   · the envelope's first zero is the first minimum of the one-slit scan
 *   · an order is missing when the measured envelope has collapsed there
 *   · the N−2 subsidiary maxima between neighbours are counted, not asserted
 *
 * Two things worth knowing about the numbers that come out.
 *
 * The grating equation is a statement about phase, and the peak you can see
 * is not exactly on it: the single-slit envelope leans on each maximum and
 * drags it toward the axis. At two slits with a/d = 0.2 the fourth order sits
 * at m = 3.900, a tenth of an order off. The pull shrinks as the peaks narrow,
 * measurably as 1/N² — which is the reason a grating is a measuring
 * instrument and a double slit is not. The readout carries it.
 *
 * And the far field is an assumption, not a fact. Summing the same aperture
 * with true path lengths instead of k·ξ·sinθ gives a different pattern once
 * the slits span enough of the screen distance, so the page measures the
 * disagreement between the two and prints it. At the defaults it is 0.003%
 * of the peak; ten slits 400 µm apart at half a metre and it is most of the
 * picture.
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
    order: document.getElementById("out-order"),
    farfield: document.getElementById("out-farfield"),
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

  /** Screen position of a given sinθ, exactly: y = L·tanθ. */
  const yOf = (s, L) => (Math.abs(s) >= 1 ? Infinity : (L * s) / Math.sqrt(1 - s * s));

  /*
   * ── The model. This, and only this, is put in. ───────────────────────
   *
   * Aperture points are sampled across each slit and summed as phasors. How
   * many points is set by the phase they have to resolve: across one slit the
   * phase runs over a·sinθ/λ cycles, and sixteen samples per cycle is ample
   * for a midpoint sum. Doubling the count moves the answer by a quarter of
   * what it moved last time — the suite checks that second-order convergence,
   * because a sum that has not converged is a formula with extra steps.
   */
  const APERTURE_SAMPLES_PER_CYCLE = 16;
  function slitSamples(p, sMax) {
    const cycles = (p.a * Math.abs(sMax)) / p.lam;
    return Math.max(24, Math.min(192, Math.ceil(APERTURE_SAMPLES_PER_CYCLE * cycles)));
  }

  /**
   * Amplitude toward sinθ, as two single sums.
   *
   * The slits are identical, so every slit contributes the same internal sum
   * of phasors, shifted by its own centre phase — which is exactly why the
   * pattern is one shape riding inside another. Both sums are taken term by
   * term over real aperture points.
   */
  function amplitude(s, p, M) {
    const k = (2 * Math.PI) / p.lam;
    const dxi = p.a / M;

    let sr = 0, si = 0;                          // one slit, with itself
    for (let j = 0; j < M; j++) {
      const ph = k * ((j + 0.5 - M / 2) * dxi) * s;
      sr += Math.cos(ph);
      si += Math.sin(ph);
    }
    let ar = 0, ai = 0;                          // the slits, with each other
    for (let i = 0; i < p.N; i++) {
      const ph = k * ((i - (p.N - 1) / 2) * p.d) * s;
      ar += Math.cos(ph);
      ai += Math.sin(ph);
    }
    return [sr * ar - si * ai, sr * ai + si * ar];
  }

  /** Intensity toward sinθ, normalised so a perfectly on-axis sum is 1. */
  function intensityAt(s, p, M) {
    const [re, im] = amplitude(s, p, M);
    return (re * re + im * im) / (M * M * p.N * p.N);
  }

  /** Intensity at screen position y. */
  function intensity(y, p, M) {
    return intensityAt(sinTheta(y, p.L), p, M ?? slitSamples(p, sinTheta(y, p.L)));
  }

  /*
   * The same aperture summed without the far-field assumption: true path
   * lengths from each point to the screen, and the 1/√r a spreading
   * cylindrical wave loses. This is not what the page draws — it costs N×M
   * per sample instead of N+M — but it is what the page is measured against,
   * so "far field" is a claim with a number attached rather than a word.
   *
   * The phase is referenced to the on-axis path: k·r is tens of millions of
   * radians and k·(r−L) is tens, and (r−L) = u²/(r+L) is the way to write
   * that difference without cancelling it away.
   */
  function exactIntensity(y, p, M) {
    const k = (2 * Math.PI) / p.lam;
    const dxi = p.a / M;
    let re = 0, im = 0;
    for (let i = 0; i < p.N; i++) {
      const c = (i - (p.N - 1) / 2) * p.d;
      for (let j = 0; j < M; j++) {
        const u = y - (c + (j + 0.5 - M / 2) * dxi);
        const r = Math.hypot(p.L, u);
        const ph = k * ((u * u) / (r + p.L));
        const w = 1 / Math.sqrt(r);
        re += w * Math.cos(ph);
        im += w * Math.sin(ph);
      }
    }
    return re * re + im * im;
  }

  // The two textbook lengths, kept for comparison only — the readouts print
  // them beside what was measured, never instead of it.
  const fringeSpacing = (p) => yOf(p.lam / p.d, p.L);
  const envelopeZero = (p) => yOf(p.lam / p.a, p.L);

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

  // ── Scanning the screen ────────────────────────────────────────────────
  const key = (p, extra) =>
    `${p.lam}|${p.N}|${p.a}|${p.d}|${p.L}|${extra}`;

  /** Intensity sampled across a span of the screen. */
  function scan(p, half, n, slits = p.N) {
    const q = slits === p.N ? p : { ...p, N: slits };
    const M = slitSamples(p, sinTheta(half, p.L));
    const ys = new Float64Array(n);
    const is = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const y = -half + (2 * half * i) / (n - 1);
      ys[i] = y;
      is[i] = intensityAt(sinTheta(y, p.L), q, M);
    }
    return { ys, is, M };
  }

  /*
   * Every local maximum, refined by fitting a parabola to its three samples.
   * Without the refinement a peak's position is quantised to the sample
   * spacing, which is coarser than the displacement being measured.
   */
  function maxima(sc) {
    const { ys, is } = sc;
    const out = [];
    for (let i = 1; i < is.length - 1; i++) {
      if (!(is[i] > is[i - 1] && is[i] >= is[i + 1])) continue;
      const a = is[i - 1], b = is[i], c = is[i + 1];
      const den = a - 2 * b + c;
      const sh = den === 0 ? 0 : (0.5 * (a - c)) / den;
      out.push({ y: ys[i] + sh * (ys[i + 1] - ys[i]), I: b });
    }
    return out;
  }

  /*
   * Which of those are principal maxima, decided without a formula: the ones
   * that are the tallest thing within half a fringe period. The subsidiary
   * maxima between them are shorter by construction, so they lose.
   */
  const principal = (all, period) =>
    all.filter((m) => all.every((q) =>
      q === m || Math.abs(q.y - m.y) > period * 0.5 || q.I <= m.I));

  // How far out the measuring scan reaches, and how finely. 400 samples per
  // fringe period puts the located peaks within 2e-7 of an order; 100 leaves
  // them 400 times worse, which is enough to swamp the effect being measured.
  const ORDERS = 7;
  const PER_PERIOD = 400;

  let measured = null;
  /** Everything the readouts show, found in a scan of the pattern. */
  function measure(p) {
    const k = key(p, "measure");
    if (measured && measured.k === k) return measured.v;

    const fr = fringeSpacing(p);
    const half = Math.min((ORDERS + 0.6) * fr, p.L * 4);
    const n = Math.min(Math.round((ORDERS + 0.6) * PER_PERIOD), 12000);
    const sc = scan(p, half, n);
    const all = maxima(sc);
    const prin = principal(all, fr).sort((x, z) => x.y - z.y);

    // Fringe spacing: the gap between the two located maxima that straddle
    // the axis. Not an average over the pattern — the fringes are not evenly
    // spaced, and the textbook Δy is about the middle.
    let pair = null;
    for (let i = 0; i + 1 < prin.length; i++) {
      const mid = Math.abs((prin[i].y + prin[i + 1].y) / 2);
      if (!pair || mid < pair.mid) pair = { mid, lo: prin[i].y, hi: prin[i + 1].y };
    }
    const spacing = pair ? pair.hi - pair.lo : NaN;

    // Matching the located peaks to the orders they belong to. An order is
    // claimed by the tallest maximum within four tenths of a fringe period of
    // where the phase condition puts it; anything further away is not that
    // order at all. That distinction matters because a suppressed order does
    // not simply vanish — the envelope splits it into two low humps either
    // side of its own null, and counting those as maxima would report the
    // grating equation as being a quarter of an order out when it is not.
    const claim = (m) => {
      const s = (m * p.lam) / p.d;
      if (s >= 1) return null;
      const want = yOf(s, p.L);
      if (Math.abs(want) > half) return null;
      let best = null;
      for (const q of prin) {
        if (Math.abs(q.y - want) > fr * 0.4) continue;
        if (!best || q.I > best.I) best = q;
      }
      return best ? { y: best.y, I: best.I, want, m: (p.d * sinTheta(best.y, p.L)) / p.lam } : null;
    };

    /*
     * The envelope, from the same aperture with the other slits covered up.
     * It gets a window of its own: a narrow slit throws its first zero far
     * outside the orders being measured, and a scan that stops short would
     * report no envelope at all. One slit costs M+1 per sample instead of
     * M+N, so the wider scan is nearly free.
     */
    const envHalf = Math.min(
      Math.max(half, 1.35 * Math.abs(envelopeZero(p) || 0)), p.L * 4);
    const envSc = scan(p, envHalf, n, 1);
    // The first minimum to the right of the axis, refined the same way the
    // maxima are. It is a true zero, so the curve there is a parabola and the
    // three-point fit is worth about four decimal places.
    let envZero = NaN;
    for (let i = Math.floor(n / 2) + 1; i < n - 1; i++) {
      if (envSc.is[i] < envSc.is[i - 1] && envSc.is[i] <= envSc.is[i + 1]) {
        const a = envSc.is[i - 1], b = envSc.is[i], c = envSc.is[i + 1];
        const den = a - 2 * b + c;
        const sh = den === 0 ? 0 : (0.5 * (a - c)) / den;
        envZero = envSc.ys[i] + sh * (envSc.ys[i + 1] - envSc.ys[i]);
        break;
      }
    }
    const envAt = (y) => {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (envSc.ys[mid] <= y) lo = mid; else hi = mid;
      }
      const t = (y - envSc.ys[lo]) / (envSc.ys[hi] - envSc.ys[lo]);
      return envSc.is[lo] + t * (envSc.is[hi] - envSc.is[lo]);
    };

    /*
     * A missing order is one the envelope has switched off. Both halves of
     * that sentence are measured: the envelope is the one-slit scan above,
     * and an order counts as gone when it is under a fiftieth of what its
     * two neighbours interpolate to. That is a weaker claim than "d/a is a
     * whole number" and a truer one — at d/a = 3.03 the third order is just
     * as absent, and the arithmetic rule does not say so.
     */
    const missing = [];
    const envStrength = [];
    for (let m = 1; m <= ORDERS; m++) {
      const s = (m * p.lam) / p.d;
      const y = yOf(s, p.L);
      envStrength.push(s >= 1 || Math.abs(y) > Math.min(half, envHalf) ? null : envAt(y));
    }
    for (let m = 1; m <= ORDERS; m++) {
      const here = envStrength[m - 1];
      if (here === null) continue;
      const lo = envStrength[m - 2] ?? null;
      const hi = envStrength[m] ?? null;
      const near = lo !== null && hi !== null ? (lo + hi) / 2 : (lo ?? hi);
      if (near !== null && here < near / 50) missing.push(m);
    }

    // The grating equation, read off the peaks the search returned — over the
    // orders the envelope has left standing.
    const orders = [];
    for (let m = 1; m <= ORDERS; m++) {
      if (missing.includes(m)) continue;
      const got = claim(m);
      if (got) orders.push(got);
    }
    const orderDev = orders.reduce(
      (w, o) => Math.max(w, Math.abs(o.m - Math.round(o.m))), 0);

    // Bright fringes inside the central lobe of the envelope: the orders the
    // search claimed inside the first measured zero, doubled for the other
    // side, plus the one on the axis.
    const inEnvelope = Number.isFinite(envZero)
      ? 1 + 2 * orders.filter((o) => Math.abs(o.y) < Math.abs(envZero) * 0.999).length
      : 1 + 2 * orders.length;

    // Subsidiary maxima between the central peak and its neighbour.
    const nextUp = prin.find((m) => m.y > fr * 0.4);
    const between = nextUp
      ? all.filter((m) => m.y > fr * 1e-6 && m.y < nextUp.y - fr * 1e-6).length
      : 0;

    // Width of the central maximum at half its height, by interpolation.
    let fwhm = NaN;
    {
      const c = Math.floor(n / 2);
      const peak = sc.is[c];
      let i = c;
      while (i < n && sc.is[i] > peak / 2) i++;
      if (i < n && i > 0) {
        const t = (peak / 2 - sc.is[i - 1]) / (sc.is[i] - sc.is[i - 1]);
        fwhm = 2 * (sc.ys[i - 1] + t * (sc.ys[i] - sc.ys[i - 1]));
      }
    }

    // What the far-field assumption costs, measured: the same aperture summed
    // with true path lengths, over the fringes nearest the axis. Both curves
    // are put on the same mean before comparing, because the exact sum is not
    // normalised to anything in particular.
    const gap = farFieldGap(p, Math.min(3 * fr, half));

    const v = { half, envHalf, n, scan: sc, envScan: envSc, all, principal: prin,
                spacing, approxSpacing: fr, orders, orderDev,
                envZero, approxEnvZero: envelopeZero(p), missing, envStrength,
                inEnvelope, between, fwhm, gap };
    measured = { k, v };
    return v;
  }

  /** Far-field sum against the same aperture summed exactly. */
  const GAP_SAMPLES = 361;
  function farFieldGap(p, half) {
    const M = Math.min(slitSamples(p, sinTheta(half, p.L)), 64);
    const ex = new Float64Array(GAP_SAMPLES);
    const ff = new Float64Array(GAP_SAMPLES);
    let se = 0, sf = 0, peak = 0;
    for (let i = 0; i < GAP_SAMPLES; i++) {
      const y = -half + (2 * half * i) / (GAP_SAMPLES - 1);
      ex[i] = exactIntensity(y, p, M);
      ff[i] = intensityAt(sinTheta(y, p.L), p, M);
      se += ex[i]; sf += ff[i];
      if (ff[i] > peak) peak = ff[i];
    }
    if (!(se > 0) || !(sf > 0) || !(peak > 0)) return NaN;
    let worst = 0;
    for (let i = 0; i < GAP_SAMPLES; i++) {
      worst = Math.max(worst, Math.abs((ex[i] / se) * sf - ff[i]));
    }
    return worst / peak;
  }

  /*
   * The render profile: the curve the reader sees, sampled once per parameter
   * change rather than every frame. With many slits the peaks are narrower
   * than a pixel, so each pixel takes the largest of SUB sub-samples — the
   * drawn line then traces the top of the oscillation instead of aliasing
   * through it.
   */
  const SUB = 3;
  let profiled = null;
  function profile(p, half, cols) {
    const k = key(p, `profile|${half}|${cols}`);
    if (profiled && profiled.k === k) return profiled.v;
    const M = slitSamples(p, sinTheta(half, p.L));
    const full = new Float64Array(cols);
    const env = new Float64Array(cols);
    const one = { ...p, N: 1 };
    for (let c = 0; c < cols; c++) {
      let best = 0;
      for (let s = 0; s < SUB; s++) {
        const y = ((c + s / SUB) / (cols - 1)) * 2 * half - half;
        const v = intensityAt(sinTheta(y, p.L), p, M);
        if (v > best) best = v;
      }
      full[c] = best;
      const y = (c / (cols - 1)) * 2 * half - half;
      env[c] = intensityAt(sinTheta(y, p.L), one, M);
    }
    const v = { full, env, half, cols };
    profiled = { k, v };
    return v;
  }

  // ── State ──────────────────────────────────────────────────────────────
  let photons = [];            // accumulated hits, screen y in metres
  let photonCount = 0;
  let acc = 0;
  const MAX_DOTS = 6000;

  /**
   * Draw one photon landing position by rejection sampling against the
   * profile that was scanned — the same numbers the curve is drawn from, so
   * the dots pile up into the curve rather than beside it.
   */
  function samplePhoton(p, half, cols) {
    const pr = profile(p, half, cols);
    for (let tries = 0; tries < 60; tries++) {
      const c = Math.floor(Math.random() * pr.cols);
      if (Math.random() <= pr.full[c]) {
        return ((c + Math.random()) / (pr.cols - 1)) * 2 * half - half;
      }
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
    //    Every value below comes out of the one scan, so the band, the curve,
    //    the envelope and the photons are all the same numbers.
    const cols = plotR - plotL + 1;
    const pr = profile(p, half, cols);
    const bandH = L.bandBot - L.bandTop;
    for (let px = plotL; px <= plotR; px++) {
      const v = pr.full[px - plotL];
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

    // The single-slit envelope, dashed — the same aperture with the other
    // slits covered up, not a curve drawn over the top.
    ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.42)`;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let px = plotL; px <= plotR; px++) {
      const yy = plotB - pr.env[px - plotL] * (plotB - plotT);
      px === plotL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // The full pattern, straight off the scan.
    ctx.strokeStyle = `rgb(${cr}, ${cg}, ${cb})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let px = plotL; px <= plotR; px++) {
      const yy = plotB - pr.full[px - plotL] * (plotB - plotT);
      px === plotL ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    ctx.stroke();

    // The peaks the search actually returned, ticked where it put them —
    // not where the grating equation says they should be. The two differ by
    // a visible amount at low N, which is the point.
    const mm = measure(p);
    ctx.fillStyle = "rgba(255, 226, 168, 0.95)";
    for (const q of mm.principal) {
      const x = X(q.y);
      if (x < plotL || x > plotR) continue;
      ctx.fillRect(x - 0.9, plotT - 7, 1.8, 5);
    }

    // Order markers, with the missing ones called out where they would be.
    const missing = mm.missing;
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
  const mm2 = (v) => (Number.isFinite(v) ? (v * 1000).toFixed(3) : "—");

  function updateReadouts(p) {
    const m = measure(p);

    // Measured first, the textbook length beside it with the gap named.
    const showGap = (got, want) => {
      if (!Number.isFinite(got)) return "—";
      if (!Number.isFinite(want)) return mm2(got);
      const e = (100 * (want - got)) / got;
      return `${mm2(got)} / ${mm2(want)} (${e > 0 ? "+" : ""}${e.toFixed(2)}%)`;
    };
    out.spacing.textContent = p.N > 1 ? showGap(m.spacing, m.approxSpacing) : "—";
    out.envelope.textContent = showGap(m.envZero, m.approxEnvZero);
    out.fringes.textContent = p.N > 1 ? String(m.inEnvelope) : "—";
    out.missing.textContent = p.N > 1
      ? (m.missing.length
          ? m.missing.map((q) => `±${q}`).join(", ")
          : i18nText("diffNone", "none"))
      : "—";

    // The grating equation as a measurement: the worst |m − round(m)| over
    // the orders the search found, and the subsidiary maxima it counted.
    out.order.textContent = p.N > 1 && m.orders.length
      ? `${m.orderDev.toExponential(1)}  ·  ${m.between} × ${i18nText("diffSub", "sub")}`
      : "—";
    out.farfield.textContent = Number.isFinite(m.gap)
      ? `${(m.gap * 100).toFixed(m.gap < 0.001 ? 4 : 2)}%`
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
      const cols = L.plotR - L.plotL + 1;
      for (let i = 0; i < n; i++) {
        const y = samplePhoton(p, half, cols);
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
    params, intensity, intensityAt, exactIntensity, amplitude, slitSamples,
    sinTheta, yOf, fringeSpacing, envelopeZero,
    scan, maxima, principal, measure, profile, farFieldGap,
    samplePhoton, viewHalf,
    ORDERS, PER_PERIOD,
    photonCount: () => photonCount,
    photonYs: () => photons.map((q) => q.y),
  };

  resizeCanvas();
  syncControls();
  updateLabels();
  start();
})();
