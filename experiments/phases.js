/*
 * Molecular dynamics with one potential, in two dimensions.
 *
 *     V(r) = 4ε[(σ/r)¹² − (σ/r)⁶]
 *
 * cut and shifted at r = 2.5σ so there is no step in the energy at the
 * cutoff, integrated with velocity Verlet under periodic boundaries. Units
 * are reduced — σ = ε = m = 1 — which is why the temperature reads 0.3
 * rather than 40 K: the numbers are the physics, not one substance's.
 *
 * Nothing in here knows what a solid, a liquid or a gas is. There is a force
 * law and Newton's second law, and the phases are what those do at different
 * temperatures and densities. Everything reported is a measurement of the
 * trajectory:
 *
 *   T*    the mean kinetic energy per particle (in 2D, ⟨KE⟩/N)
 *   P     from the virial, ⟨Σ r·f⟩, not from any equation of state
 *   ψ₆    the hexagonal bond-orientational order, from the actual neighbours
 *   D     the slope of the mean square displacement, ⟨r²⟩ = 4Dt
 *   g(r)  counted pair separations, normalised by the ideal-gas expectation
 *
 * The lattice the run starts from is triangular because that is how discs
 * pack in a plane; starting from a square lattice would melt at the wrong
 * temperature and reform into triangles anyway.
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    temp: document.getElementById("temp"),
    density: document.getElementById("density"),
    count: document.getElementById("count"),
    speed: document.getElementById("speed"),
  };
  const inputValues = {
    temp: document.getElementById("temp-value"),
    density: document.getElementById("density-value"),
    count: document.getElementById("count-value"),
    speed: document.getElementById("speed-value"),
  };
  const out = {
    t: document.getElementById("out-t"),
    p: document.getElementById("out-p"),
    psi: document.getElementById("out-psi"),
    d: document.getElementById("out-d"),
    e: document.getElementById("out-e"),
    phase: document.getElementById("out-phase"),
  };
  const thermostatBox = document.getElementById("thermostat");
  const trailsBox = document.getElementById("trails");
  const presetList = document.getElementById("preset-list");
  const quenchBtn = document.getElementById("quench-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;

  // ── Constants ──────────────────────────────────────────────────────────
  const RC = 2.5, RC2 = RC * RC;
  // Shifting by V(rc) removes the discontinuity at the cutoff; without it
  // every particle crossing the cutoff radius would kick the total energy.
  const SHIFT = 4 * (Math.pow(RC, -12) - Math.pow(RC, -6));
  const DT = 0.004;
  const GR_BINS = 90, GR_MAX = 4;
  const V_BINS = 26;

  // A few presets carry a speed hint. Condensation is nucleation followed by
  // coalescence, and coalescence is slow: at the default rate the droplets have
  // formed but not yet merged when you get bored of watching.
  const PRESETS = {
    solid:   { rho: 0.80, T: 0.15 },
    melting: { rho: 0.80, T: 0.45 },
    liquid:  { rho: 0.80, T: 0.80 },
    droplet: { rho: 0.12, T: 0.35, steps: 32 },
    gas:     { rho: 0.12, T: 1.50, steps: 32 },
    hot:     { rho: 0.80, T: 3.00 },
  };

  function params() {
    const n = parseInt(inputs.count.value, 10);
    return {
      n, N: n * n,
      rho: parseFloat(inputs.density.value),
      T: parseFloat(inputs.temp.value),
      steps: parseInt(inputs.speed.value, 10),
      thermostat: thermostatBox.checked,
      trails: trailsBox.checked,
    };
  }

  // ── State ──────────────────────────────────────────────────────────────
  let S = null;
  let running = true;
  let simT = 0;
  let grAcc = new Float64Array(GR_BINS), grFrames = 0;
  let msdRef = null, msdRefT = 0;
  /*
   * Marks along ⟨r²⟩(t) since the reference, for the diffusion constant.
   * One every MSD_MARK time units, keeping the last MSD_WINDOW worth.
   */
  const MSD_WINDOW = 20, MSD_MARK = 1.25;
  let msdMarks = [];
  let psiSmoothed = NaN, dSmoothed = NaN;
  // Ring buffer of recent wrapped positions, for the optional path overlay.
  const TRAIL = 56;
  let trail = null, trailHead = 0, trailLen = 0;

  /** Build a triangular lattice at the requested density — 2D close packing. */
  function build(p) {
    const { n, N, rho } = p;
    const a = Math.sqrt(2 / (Math.sqrt(3) * rho));
    const Lx = n * a, Ly = n * a * Math.sqrt(3) / 2;
    const s = {
      N, Lx, Ly, a,
      x: new Float64Array(N), y: new Float64Array(N),
      vx: new Float64Array(N), vy: new Float64Array(N),
      fx: new Float64Array(N), fy: new Float64Array(N),
      ux: new Float64Array(N), uy: new Float64Array(N),   // unwrapped, for MSD
      pot: 0, virial: 0,
    };
    let k = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        s.x[k] = (c + (r % 2) * 0.5) * a;
        s.y[k] = r * a * Math.sqrt(3) / 2;
        s.ux[k] = s.x[k]; s.uy[k] = s.y[k];
        k++;
      }
    }
    // Every particle starts with exactly the same speed, pointed somewhere at
    // random — deliberately the wrong distribution, a spike where Maxwell and
    // Boltzmann predict a spread. Nothing here imposes the curve the histogram
    // ends up on; collisions are the only thing that puts it there.
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2;
      s.vx[i] = Math.cos(th); s.vy[i] = Math.sin(th);
    }
    let sx = 0, sy = 0;
    for (let i = 0; i < N; i++) { sx += s.vx[i]; sy += s.vy[i]; }
    for (let i = 0; i < N; i++) { s.vx[i] -= sx / N; s.vy[i] -= sy / N; }
    S = s;
    setTemperature(p.T);
    forces();
    simT = 0;
    grAcc = new Float64Array(GR_BINS); grFrames = 0;
    msdRef = null;
    psiSmoothed = NaN; dSmoothed = NaN;
    trail = null; trailHead = 0; trailLen = 0;
    return s;
  }

  /** Remember where everyone is, so the paths can be drawn a frame later. */
  function pushTrail() {
    if (!trail || trail.x.length !== S.N * TRAIL) {
      trail = { x: new Float64Array(S.N * TRAIL), y: new Float64Array(S.N * TRAIL) };
      trailHead = 0; trailLen = 0;
    }
    for (let i = 0; i < S.N; i++) {
      trail.x[i * TRAIL + trailHead] = S.x[i];
      trail.y[i * TRAIL + trailHead] = S.y[i];
    }
    trailHead = (trailHead + 1) % TRAIL;
    if (trailLen < TRAIL) trailLen++;
  }

  const kinetic = () => {
    let k = 0;
    for (let i = 0; i < S.N; i++) k += 0.5 * (S.vx[i] * S.vx[i] + S.vy[i] * S.vy[i]);
    return k;
  };
  /** In two dimensions each particle has two degrees of freedom, so T = KE/N. */
  const temperature = () => kinetic() / S.N;

  function setTemperature(T) {
    const cur = temperature();
    if (cur <= 0) return;
    const f = Math.sqrt(T / cur);
    for (let i = 0; i < S.N; i++) { S.vx[i] *= f; S.vy[i] *= f; }
  }

  function forces() {
    const { N, Lx, Ly, x, y, fx, fy } = S;
    fx.fill(0); fy.fill(0);
    let pot = 0, vir = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j];
        dx -= Lx * Math.round(dx / Lx);
        dy -= Ly * Math.round(dy / Ly);
        const r2 = dx * dx + dy * dy;
        if (r2 >= RC2 || r2 === 0) continue;
        const inv2 = 1 / r2, inv6 = inv2 * inv2 * inv2, inv12 = inv6 * inv6;
        pot += 4 * (inv12 - inv6) - SHIFT;
        const f = 24 * (2 * inv12 - inv6) * inv2;
        fx[i] += f * dx; fy[i] += f * dy;
        fx[j] -= f * dx; fy[j] -= f * dy;
        vir += f * r2;
      }
    }
    S.pot = pot; S.virial = vir;
  }

  function step() {
    const { N, x, y, vx, vy, fx, fy, ux, uy, Lx, Ly } = S;
    for (let i = 0; i < N; i++) {
      vx[i] += 0.5 * DT * fx[i]; vy[i] += 0.5 * DT * fy[i];
      const dx = DT * vx[i], dy = DT * vy[i];
      x[i] += dx; y[i] += dy;
      ux[i] += dx; uy[i] += dy;          // unwrapped copy never folds back
      x[i] -= Lx * Math.floor(x[i] / Lx);
      y[i] -= Ly * Math.floor(y[i] / Ly);
    }
    forces();
    for (let i = 0; i < N; i++) {
      vx[i] += 0.5 * DT * fx[i]; vy[i] += 0.5 * DT * fy[i];
    }
    simT += DT;
    // A mark on ⟨r²⟩(t) every MSD_MARK, keeping one window's worth plus the
    // one that just fell off its far end.
    if (msdRef) {
      const el = simT - msdRefT;
      const last = msdMarks[msdMarks.length - 1];
      if (!last || el - last.t >= MSD_MARK) {
        msdMarks.push({ t: el, m: msd() });
        while (msdMarks.length > 2 && el - msdMarks[1].t >= MSD_WINDOW) msdMarks.shift();
      }
    }
  }

  /** Virial pressure — from the forces themselves, not an equation of state. */
  const pressure = () => (S.N * temperature() + 0.5 * S.virial) / (S.Lx * S.Ly);

  /** Hexagonal bond-orientational order, over neighbours within 1.5σ. */
  function psi6() {
    const { N, x, y, Lx, Ly } = S;
    let re = 0, im = 0, cnt = 0;
    for (let i = 0; i < N; i++) {
      let sr = 0, si = 0, nb = 0;
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        let dx = x[i] - x[j], dy = y[i] - y[j];
        dx -= Lx * Math.round(dx / Lx);
        dy -= Ly * Math.round(dy / Ly);
        if (dx * dx + dy * dy < 2.25) {
          const th = Math.atan2(dy, dx);
          sr += Math.cos(6 * th); si += Math.sin(6 * th); nb++;
        }
      }
      if (nb > 0) { re += sr / nb; im += si / nb; cnt++; }
    }
    return cnt ? Math.hypot(re / cnt, im / cnt) : 0;
  }

  /** Mean square displacement against the reference frame. */
  function msd() {
    if (!msdRef) return 0;
    let m = 0;
    for (let i = 0; i < S.N; i++) {
      const dx = S.ux[i] - msdRef.x[i], dy = S.uy[i] - msdRef.y[i];
      m += dx * dx + dy * dy;
    }
    return m / S.N;
  }
  const takeMsdReference = () => {
    msdRef = { x: Float64Array.from(S.ux), y: Float64Array.from(S.uy) };
    msdRefT = simT;
    msdMarks = [{ t: 0, m: 0 }];
  };

  /**
   * D from the slope of ⟨r²⟩ over a trailing window — 4D = d⟨r²⟩/dt.
   *
   * It used to be the chord from the reference, ⟨r²⟩/4t, which is what the
   * label ⟨r²⟩ = 4Dt says and is right exactly where that law is right. In a
   * solid it is not. The particles are caged, ⟨r²⟩ plateaus, and the chord is
   * that plateau divided by however long the page has been open: measured at
   * T* = 0.15, ρ = 0.8, it reads 1.4e-2 half a time unit after the reference,
   * 5.0e-3 at t = 2, 7.4e-4 at t = 10, 1.8e-4 at t = 100 — a factor of 23,
   * with the first few readings within a factor of three of a real liquid's
   * 4e-2. A reader who opened the page a moment ago and one who left it
   * running get different numbers for the same crystal, and the page's own
   * first note says the diffusion constant "leaves zero" on melting, which
   * the chord never does.
   *
   * The slope does. Over 64 readings between t = 40 and t = 120:
   *
   *              solid T*=0.15            liquid T*=0.80
   *   chord      1.24e-4 ± 4.6e-5         4.17e-2 ± 2.6e-3   (still falling)
   *   slope     −0.07e-4 ± 0.8e-4         3.94e-2 ± 1.4e-2
   *
   * — zero in the solid to within its own noise, against a liquid four
   * hundred times larger, and neither number moves with the watch. The slope
   * is the noisier estimator of the two, which the readout's existing
   * exponential smoothing absorbs.
   *
   * It returns NaN until a full window exists, because a diffusion constant
   * is a late-time property and there is nothing honest to print before the
   * walk has had time to become one. At the default speed that is about seven
   * seconds.
   */
  function diffusion() {
    if (!msdRef || msdMarks.length < 3) return NaN;
    const oldest = msdMarks[0];
    if (simT - msdRefT - oldest.t < MSD_WINDOW * 0.9) return NaN;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const n = msdMarks.length;
    for (const q of msdMarks) { sx += q.t; sy += q.m; sxx += q.t * q.t; sxy += q.t * q.m; }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx) / 4;
  }

  /** g(r) by counting pair separations against the ideal-gas expectation. */
  function accumulateGr() {
    const { N, x, y, Lx, Ly } = S;
    const dr = GR_MAX / GR_BINS;
    const hist = new Float64Array(GR_BINS);
    for (let i = 0; i < N - 1; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j];
        dx -= Lx * Math.round(dx / Lx);
        dy -= Ly * Math.round(dy / Ly);
        const r = Math.hypot(dx, dy);
        if (r < GR_MAX) hist[Math.floor(r / dr)] += 2;
      }
    }
    const rho = N / (Lx * Ly);
    for (let b = 0; b < GR_BINS; b++) {
      const r0 = b * dr, r1 = r0 + dr;
      // The ideal-gas count in an annulus of the same width, in 2D.
      const ideal = Math.PI * (r1 * r1 - r0 * r0) * rho * N;
      grAcc[b] += ideal > 0 ? hist[b] / ideal : 0;
    }
    grFrames++;
  }
  const gr = () => (grFrames ? Array.from(grAcc, (v) => v / grFrames) : new Array(GR_BINS).fill(0));

  function speeds() {
    const v = new Float64Array(S.N);
    for (let i = 0; i < S.N; i++) v[i] = Math.hypot(S.vx[i], S.vy[i]);
    return v;
  }

  /**
   * Which phase, read off the two order parameters.
   *
   * A label for the reader; nothing in the simulation consults it.
   */
  function phase() {
    const psi = Number.isFinite(psiSmoothed) ? psiSmoothed : psi6();
    const D = Number.isFinite(dSmoothed) ? dSmoothed : 0;
    const p = params();
    // Lindemann, not the diffusion constant. A solid vibrates about fixed
    // sites, so its mean-square displacement plateaus and rms/a settles near
    // 0.18 at T* = 0.15. A liquid's runs away: past 1 within a few time units
    // at T* = 0.45. The ratio msd/t does the same job eventually but decays as
    // 1/t on the way, so a freshly built lattice reads as melting for the
    // first few seconds.
    //
    // "Plateaus" is the typical run, not every run. Across 40 solid-preset
    // runs the median was 0.180 at both t = 12 and t = 30 — flat, as the
    // vibration picture says — but the tail was not: the largest went 0.332 to
    // 0.462, and 4 of 40 had crossed 0.35 by t = 30 with ψ₆ still above 0.79.
    // Those are hops, not melting. A hundred particles under periodic
    // boundaries nucleate a dislocation now and then, it glides, and a row of
    // atoms lands one lattice vector over: local order survives, displacement
    // from the original sites does not. Lindemann cannot tell that from
    // melting, so the badge will occasionally say melting for a crystal that
    // is merely defective. Left as it is — the alternative is a criterion that
    // quietly forgives real melting too — and tests/experiments/phases.test.mjs
    // asserts only what the readout can actually deliver.
    if (psi > 0.5 && (!msdRef || Math.sqrt(msd()) < 0.35 * S.a)) {
      // Before the reference is taken there is no displacement evidence at
      // all, and falling through to "melting" would be asserting something
      // unmeasured — on a slow machine, for several seconds. Order alone is
      // the evidence there is, and a lattice that has not moved yet is a
      // solid. Once the reference exists, displacement decides.
      return ["mdPhaseSolid", "solid"];
    }
    if (p.rho < 0.35) {
      // At low density the question is whether it has pulled itself together.
      // Asking for one big blob would be asking the wrong question: nucleation
      // routinely leaves two or three droplets that have not met yet, and those
      // are condensed all the same.
      return condensedFraction() > 0.4
        ? ["mdPhaseDroplet", "liquid droplet + vapour"]
        : ["mdPhaseGas", "gas"];
    }
    if (D < 2e-2) return ["mdPhaseSoft", "melting"];
    return ["mdPhaseLiquid", "liquid"];
  }

  /** Fraction of particles in the biggest connected blob, by flood fill. */
  function largestCluster() {
    const { N, x, y, Lx, Ly } = S;
    const seen = new Uint8Array(N);
    let best = 0;
    for (let i = 0; i < N; i++) {
      if (seen[i]) continue;
      const stack = [i]; seen[i] = 1; let c = 0;
      while (stack.length) {
        const k = stack.pop(); c++;
        for (let j = 0; j < N; j++) {
          if (seen[j]) continue;
          let dx = x[k] - x[j], dy = y[k] - y[j];
          dx -= Lx * Math.round(dx / Lx);
          dy -= Ly * Math.round(dy / Ly);
          if (dx * dx + dy * dy < 2.56) { seen[j] = 1; stack.push(j); }
        }
      }
      best = Math.max(best, c);
    }
    return best / N;
  }

  /**
   * Fraction of particles in condensed surroundings — three or more neighbours
   * inside 1.6σ. This asks the thermodynamic question (has it condensed?)
   * rather than the kinetic one (have the droplets finished merging?), so it
   * does not swing when a run happens to nucleate two drops instead of one.
   */
  function condensedFraction() {
    const { N, x, y, Lx, Ly } = S;
    let bound = 0;
    for (let i = 0; i < N; i++) {
      let nb = 0;
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        let dx = x[i] - x[j], dy = y[i] - y[j];
        dx -= Lx * Math.round(dx / Lx);
        dy -= Ly * Math.round(dy / Ly);
        if (dx * dx + dy * dy < 2.56) nb++;
      }
      if (nb >= 3) bound++;
    }
    return bound / N;
  }

  // ── Layout ─────────────────────────────────────────────────────────────
  let L;
  function computeLayout() {
    const narrow = W < 560;
    const padL = narrow ? 38 : 50;
    const padR = narrow ? 12 : 18;
    const top = 24;                    // room for the label above the box
    const boxH = narrow ? 250 : 320;
    const gap = narrow ? 34 : 38;
    const rest = H - top - boxH - gap * 2 - (narrow ? 28 : 32);
    L = {
      narrow,
      fs: narrow ? 10 : 11, fsv: narrow ? 9 : 10,
      x0: padL, x1: W - padR,
      bTop: top, bBot: top + boxH,
      pTop: top + boxH + gap,
      pBot: top + boxH + gap + (narrow ? rest / 2 - gap / 2 : rest),
      // Side by side when there is room, stacked when there is not.
      split: !narrow,
      sTop: narrow ? top + boxH + gap + rest / 2 + gap / 2 : top + boxH + gap,
      sBot: narrow ? top + boxH + gap * 2 + rest : top + boxH + gap + rest,
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
    bg.addColorStop(0, "#120d06");
    bg.addColorStop(1, "#0b1018");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── The box. Periodic, so the walls are drawn dashed: nothing bounces
    //    off them, particles simply reappear on the other side.
    {
      const top = L.bTop, bot = L.bBot;
      const h = bot - top;
      const scale = h / S.Ly;
      const bw = S.Lx * scale;
      const bx = (L.x0 + L.x1) / 2 - bw / 2;

      // Discs shrink when the paths are on: at ρ* = 0.8 they nearly touch, and
      // a path drawn between them would be almost entirely hidden.
      const r = Math.max(2, (scale * 0.5) * 0.92) * (p.trails ? 0.5 : 1);
      const vMax = Math.max(0.6, Math.sqrt(6 * Math.max(temperature(), 0.02)));
      // Clip to the box and draw the wrapped copies, so a particle leaving one
      // edge is visibly the same particle arriving at the other. Without this a
      // half-circle hangs outside the frame and the opposite edge looks empty,
      // which is exactly the wrong impression of a periodic boundary.
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, top, bw, h);
      ctx.clip();

      // Paths. A step longer than half the box is a wrap, not a jump, so the
      // line is broken there rather than drawn straight across the picture.
      if (p.trails && trail && trailLen > 1) {
        ctx.strokeStyle = "rgba(240,176,96,0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < S.N; i++) {
          const base = i * TRAIL;
          let px = 0, py = 0, have = false;
          for (let k = 0; k < trailLen; k++) {
            const s = (trailHead - trailLen + k + TRAIL * 2) % TRAIL;
            const qx = trail.x[base + s], qy = trail.y[base + s];
            if (have && Math.abs(qx - px) < S.Lx / 2 && Math.abs(qy - py) < S.Ly / 2) {
              ctx.lineTo(bx + qx * scale, top + qy * scale);
            } else {
              ctx.moveTo(bx + qx * scale, top + qy * scale);
            }
            px = qx; py = qy; have = true;
          }
        }
        ctx.stroke();
      }

      for (let i = 0; i < S.N; i++) {
        const v = Math.hypot(S.vx[i], S.vy[i]) / vMax;
        const hue = 32 + 200 * Math.min(v, 1);        // slow amber → fast blue
        ctx.fillStyle = `hsl(${hue}, 78%, ${52 + 12 * Math.min(v, 1)}%)`;
        const px = bx + S.x[i] * scale, py = top + S.y[i] * scale;
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const cx = px + ox * bw, cy = py + oy * h;   // bw = Lx·scale, h = Ly·scale
            if (cx < bx - r || cx > bx + bw + r || cy < top - r || cy > top + h + r) continue;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();

      // Drawn last so the wall stays legible over a box packed to the edges.
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.34)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, top + 0.5, bw - 1, h - 1);
      ctx.setLineDash([]);

      text(i18nText("mdBoxLabel", "periodic box · colour is speed"), L.x0, top - 4,
        "rgba(226,234,248,0.6)", L.fsv, "left");
      text(`${S.N} · ρ* ${p.rho.toFixed(2)}`, L.x1, bot + 15,
        "rgba(226,234,248,0.5)", L.fsv, "right");
    }

    // ── g(r): the structural fingerprint of the phase.
    {
      const top = L.pTop, bot = L.pBot;
      const x0 = L.x0;
      const x1 = L.split ? (L.x0 + L.x1) / 2 - (L.narrow ? 0 : 24) : L.x1;
      const g = gr();
      const hi = Math.max(3, Math.ceil(Math.max(...g)));
      const X = (r) => x0 + (r / GR_MAX) * (x1 - x0);
      const Y = (v) => bot - (v / hi) * (bot - top);

      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      // A droplet pushes g(r) past 13; one gridline per integer would be a
      // ladder, so the step opens up to keep about six of them.
      const gStep = Math.max(1, Math.ceil(hi / 6));
      for (let k = 0; k <= hi; k += gStep) {
        ctx.beginPath(); ctx.moveTo(x0, Y(k)); ctx.lineTo(x1, Y(k)); ctx.stroke();
        text(String(k), x0 - 5, Y(k) + 3.5, "rgba(226,234,248,0.42)", L.fsv, "right");
      }
      // g = 1 is the ideal gas: a flat line here means no structure at all.
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(226,234,248,0.3)";
      ctx.beginPath(); ctx.moveTo(x0, Y(1)); ctx.lineTo(x1, Y(1)); ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "rgba(240,176,96,0.98)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      g.forEach((v, b) => {
        const rr = (b + 0.5) * (GR_MAX / GR_BINS);
        const xx = X(rr), yy = Y(v);
        b === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      });
      ctx.stroke();

      for (let rr = 1; rr <= 4; rr++) {
        text(String(rr), X(rr), bot + 13, "rgba(226,234,248,0.42)", L.fsv, "center");
      }
      text(i18nText("mdAxisGr", "g(r) — pair distribution"), x0, top - 6,
        "rgba(226,234,248,0.6)", L.fsv, "left");
      text("r/σ", x1, bot + (L.narrow ? 24 : 26), "rgba(226,234,248,0.5)", L.fsv, "right");
    }

    // ── Speeds against Maxwell-Boltzmann.
    {
      const top = L.sTop, bot = L.sBot;
      const x0 = L.split ? (L.x0 + L.x1) / 2 + 24 : L.x0;
      const x1 = L.x1;
      const v = speeds();
      const T = Math.max(temperature(), 1e-6);
      const vMax = Math.max(3 * Math.sqrt(T), 0.4);
      const hist = new Float64Array(V_BINS);
      for (const s of v) {
        const b = Math.floor((s / vMax) * V_BINS);
        if (b >= 0 && b < V_BINS) hist[b]++;
      }
      const bw = (x1 - x0) / V_BINS;
      const peak = Math.max(1, ...hist);

      ctx.fillStyle = "rgba(122,217,238,0.55)";
      hist.forEach((c, b) => {
        const h = (c / peak) * (bot - top);
        ctx.fillRect(x0 + bw * b + bw * 0.12, bot - h, bw * 0.76, h);
      });

      // 2D Maxwell-Boltzmann: P(v) ∝ v·exp(−v²/2T), scaled to the same peak.
      const mb = (s) => (s / T) * Math.exp(-(s * s) / (2 * T));
      const mbPeak = mb(Math.sqrt(T));
      ctx.strokeStyle = "rgba(255,209,102,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 0; px <= 120; px++) {
        const s = (px / 120) * vMax;
        const xx = x0 + (s / vMax) * (x1 - x0);
        const yy = bot - (mb(s) / mbPeak) * (bot - top) * (Math.max(...hist) / peak);
        px === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.stroke();

      text(i18nText("mdAxisSpeeds", "speeds vs Maxwell–Boltzmann"), x0, top - 6,
        "rgba(226,234,248,0.6)", L.fsv, "left");
      text("v", x1, bot + (L.narrow ? 24 : 26), "rgba(226,234,248,0.5)", L.fsv, "right");
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, bot); ctx.lineTo(x1, bot); ctx.stroke();
    }
  }

  // ── Readouts ───────────────────────────────────────────────────────────
  function updateReadouts(p) {
    out.t.textContent = temperature().toFixed(3);
    out.p.textContent = pressure().toFixed(3);
    out.psi.textContent = Number.isFinite(psiSmoothed) ? psiSmoothed.toFixed(3) : "—";
    const D = Number.isFinite(dSmoothed) ? dSmoothed : NaN;
    out.d.textContent = Number.isFinite(D) ? (D < 1e-3 ? "≈ 0" : D.toFixed(4))
      : i18nText("mdMeasuring", "measuring…");
    out.e.textContent = ((kinetic() + S.pot) / S.N).toFixed(3);
    const [key, fallback] = phase();
    out.phase.textContent = i18nText(key, fallback);
  }

  function updateLabels() {
    const p = params();
    inputValues.temp.textContent = p.T.toFixed(2);
    inputValues.density.textContent = p.rho.toFixed(2);
    inputValues.count.textContent = String(p.N);
    inputValues.speed.textContent = String(p.steps);
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let raf = 0;
  let frameCount = 0;
  let lastTs = -1;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const p = params();

    // Step only while the clock advances. This page runs from the moment it
    // loads, and its loop used to ignore the timestamp entirely — so under
    // prefers-reduced-motion, where the gate freezes the timestamp it hands
    // out, the crystal kept dancing behind a notice that said "paused". A
    // repeated timestamp means a frozen clock; real frames never repeat one.
    const moved = ts !== lastTs;
    lastTs = ts;
    if (running && moved) {
      for (let k = 0; k < p.steps; k++) {
        step();
        // A velocity rescale is a crude thermostat, so it is applied sparingly
        // and can be switched off entirely — with it off the run is pure NVE
        // and the total energy is conserved, which is the honest check.
        if (p.thermostat && (k % 10 === 0)) setTemperature(p.T);
      }
      frameCount++;
      pushTrail();
      if (frameCount % 3 === 0) accumulateGr();
      if (!msdRef && simT > 0.4) takeMsdReference();
      if (frameCount % 6 === 0) {
        const psi = psi6();
        psiSmoothed = Number.isFinite(psiSmoothed) ? psiSmoothed * 0.9 + psi * 0.1 : psi;
        const D = diffusion();
        if (Number.isFinite(D)) {
          dSmoothed = Number.isFinite(dSmoothed) ? dSmoothed * 0.85 + D * 0.15 : D;
        }
      }
    }

    render(p);
    updateReadouts(p);
  }
  function start() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function setPreset(key) {
    const q = PRESETS[key];
    if (!q) return;
    inputs.density.value = String(q.rho);
    inputs.temp.value = String(q.T);
    if (q.steps) inputs.speed.value = String(q.steps);
    presetList.querySelectorAll(".mol-btn").forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    updateLabels();
    build(params());
  }

  inputs.density.addEventListener("input", () => { updateLabels(); build(params()); });
  inputs.count.addEventListener("input", () => { updateLabels(); build(params()); });
  inputs.speed.addEventListener("input", updateLabels);
  // Temperature does not rebuild: heating and cooling the *same* configuration
  // is the experiment.
  inputs.temp.addEventListener("input", () => {
    updateLabels();
    grAcc = new Float64Array(GR_BINS); grFrames = 0;
    takeMsdReference();
  });
  thermostatBox.addEventListener("change", () => window.SFX?.click({ gain: 0.18 }));
  trailsBox.addEventListener("change", () => window.SFX?.click({ gain: 0.18 }));
  presetList.querySelectorAll(".mol-btn").forEach((b) => {
    b.addEventListener("click", () => {
      setPreset(b.dataset.key);
      window.SFX?.tone({ freq: 480, dur: 0.08, type: "triangle", gain: 0.1 });
    });
  });
  quenchBtn.addEventListener("click", () => {
    // Drain the kinetic energy in one go and let the potential sort the rest out.
    for (let i = 0; i < S.N; i++) { S.vx[i] *= 0.1; S.vy[i] *= 0.1; }
    grAcc = new Float64Array(GR_BINS); grFrames = 0;
    takeMsdReference();
    window.SFX?.tone({ freq: 220, dur: 0.16, type: "sine", gain: 0.12 });
  });
  pauseBtn.addEventListener("click", () => {
    running = !running;
    pauseBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause") : i18nText("waveResumeBtn", "Resume");
    window.SFX?.click({ gain: 0.2 });
  });
  resetBtn.addEventListener("click", () => {
    running = true;
    pauseBtn.textContent = i18nText("wavePauseBtn", "Pause");
    updateLabels();
    build(params());
    window.SFX?.click({ gain: 0.22 });
  });

  document.addEventListener("langchange", () => {
    pauseBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause") : i18nText("waveResumeBtn", "Resume");
    updateReadouts(params());
  });
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
    H = W < 560 ? 700 : 680;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout();
  }
  window.addEventListener("resize", resizeCanvas);

  // Exposed so the harness can check that the phases are results.
  window.__md = {
    RC, SHIFT, DT, PRESETS, GR_BINS, GR_MAX,
    params, build, step, forces, setTemperature,
    kinetic, temperature, pressure, psi6, msd, diffusion, gr, speeds,
    largestCluster, condensedFraction, phase, takeMsdReference,
    system: () => S,
    totalEnergy: () => kinetic() + S.pot,
    time: () => simT,
    setRunning: (v) => { running = v; },
    /** Equilibrate at T, then run free and report the order parameters. */
    measure(p, { equil = 6000, sample = 8000 } = {}) {
      build(p);
      for (let i = 0; i < equil; i++) { step(); if (i % 10 === 0) setTemperature(p.T); }
      takeMsdReference();
      // T and P are averaged over the whole window, not read off the last
      // step. With a hundred particles the instantaneous temperature swings
      // by about 1/√N — ten per cent — and the thermostat only rescales every
      // tenth step, so a single reading says as much about when you looked as
      // about what the thermostat delivered. Sampling every step covers the
      // rescale cycle evenly, so the mean is unbiased.
      let psi = 0, n = 0, tSum = 0, pSum = 0, m = 0;
      for (let i = 0; i < sample; i++) {
        step();
        if (p.thermostat && i % 10 === 0) setTemperature(p.T);
        tSum += temperature(); pSum += pressure(); m++;
        if (i % 400 === 0) { psi += psi6(); n++; }
      }
      return {
        T: tSum / m, P: pSum / m, Tinstant: temperature(),
        psi: psi / n, D: diffusion(),
        // Displacement in units of the lattice spacing. In a solid this
        // plateaus and D = msd/4t therefore decays as 1/t — a number that
        // says more about the window than the physics. rms/a is the honest
        // measure of "has it stopped sitting still", and it is what the
        // phase readout classifies on.
        msd: msd(), rmsOverA: Math.sqrt(msd()) / S.a,
        cluster: largestCluster(), condensed: condensedFraction(),
        energy: (kinetic() + S.pot) / S.N,
      };
    },
  };

  resizeCanvas();
  updateLabels();
  build(params());
  setPreset("solid");
  start();
})();
