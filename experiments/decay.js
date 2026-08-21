/*
 * Radioactive decay — stochastic nuclei, exponential ensemble.
 *
 * Each undecayed nucleus decays independently. In a sub-step of length Δt
 * (in half-lives) its survival probability is exactly 2^(−Δt/T½), so the
 * per-step decay probability is p = 1 − 2^(−Δt/T½). Nothing enforces the
 * exponential curve N(t) = N₀·2^(−t/T½) — it emerges from thousands of
 * independent coin flips, and the live count is drawn against the smooth
 * theoretical curve so the match (and the √N statistical scatter) is
 * visible.
 *
 * Derived quantities are the real ones:
 *   decay constant  λ = ln2 / T½
 *   activity        A = λ·N            (decays per unit time)
 *   mean lifetime   τ = 1 / λ = T½/ln2
 *
 * Time is measured in half-lives so the curve is preset-independent; the
 * readout also shows elapsed time and the count crossing each T½ where the
 * population should halve (N₀ → N₀/2 → N₀/4 → …).
 */

(() => {
  const stage = document.getElementById("stage");
  const ctx = stage.getContext("2d");
  let W = stage.width;
  let H = stage.height;

  const inputs = {
    count:    document.getElementById("count"),
    halflife: document.getElementById("halflife"),
    rate:     document.getElementById("rate"),
  };
  const inputValues = {
    count:    document.getElementById("count-value"),
    halflife: document.getElementById("halflife-value"),
    rate:     document.getElementById("rate-value"),
  };
  const out = {
    remaining: document.getElementById("out-remaining"),
    decayed:   document.getElementById("out-decayed"),
    activity:  document.getElementById("out-activity"),
    elapsed:   document.getElementById("out-elapsed"),
    halves:    document.getElementById("out-halves"),
    fraction:  document.getElementById("out-fraction"),
  };
  const startBtn = document.getElementById("start-btn");
  const resetBtn = document.getElementById("reset-btn");

  const i18nText = (key, fallback) =>
    (window.i18n && window.i18n.t(key)) || fallback;
  const LN2 = Math.log(2);

  // ── State ──────────────────────────────────────────────────────────────
  let nuclei = [];          // { alive, decayT } laid out on a grid
  let N0 = 200;
  let halfLife = 4;         // seconds of sim time per half-life
  let t = 0;                // elapsed sim time (same units as halfLife)
  let running = false;
  let lastTs = performance.now();
  let raf = 0;
  const history = [];       // { t, n } samples for the live curve
  const flashes = [];       // { i, ts } — grid index + wall-clock of each decay

  function readParams() {
    return {
      N0: parseInt(inputs.count.value, 10),
      T: parseFloat(inputs.halflife.value),
      rate: parseFloat(inputs.rate.value),
    };
  }

  function buildNuclei(n) {
    nuclei = [];
    for (let i = 0; i < n; i++) nuclei.push({ alive: true });
  }

  function reset() {
    const p = readParams();
    N0 = p.N0;
    halfLife = p.T;
    buildNuclei(N0);
    t = 0;
    history.length = 0;
    history.push({ t: 0, n: N0 });
    flashes.length = 0;
    running = false;
    syncStartBtn();
  }

  function aliveCount() {
    let c = 0;
    for (const nu of nuclei) if (nu.alive) c++;
    return c;
  }

  // ── Step ───────────────────────────────────────────────────────────────
  function step(dt) {
    const simDt = dt * readParams().rate;
    // Sub-step so that a single step never decays too large a fraction —
    // keeps the stochastic result matching the continuous exponential even
    // at high playback rates.
    // The sub-step cap is an instrument setting: 5% of a half-life keeps a
    // phone smooth, and the site-wide quality toggle tightens it to 2% —
    // read live, so flipping it mid-run refines the roll from the next step.
    const maxStep = halfLife * (window.Quality ? window.Quality.pick(0.05, 0.02) : 0.05);
    const sub = Math.max(1, Math.ceil(simDt / maxStep));
    const h = simDt / sub;
    let decayedThisFrame = 0;
    for (let s = 0; s < sub; s++) {
      const pDecay = 1 - Math.pow(2, -h / halfLife);
      const nowS = performance.now() / 1000;
      for (let i = 0; i < nuclei.length; i++) {
        const nu = nuclei[i];
        if (nu.alive && Math.random() < pDecay) {
          nu.alive = false;
          flashes.push({ i, ts: nowS });
          decayedThisFrame++;
        }
      }
      t += h;
    }
    // Geiger-counter crackle: one click per decay, capped per frame so a
    // burst of decays stays a crackle rather than a wall of noise. The rate
    // of clicks you hear tracks the activity.
    if (decayedThisFrame > 0) {
      const clicks = Math.min(5, decayedThisFrame);
      for (let c = 0; c < clicks; c++) {
        window.SFX?.click({ freq: 1700 + Math.random() * 1500, gain: 0.13 });
      }
    }
    const n = aliveCount();
    const last = history[history.length - 1];
    if (!last || t - last.t > halfLife * 0.02) history.push({ t, n });
    if (n === 0) { running = false; syncStartBtn(); }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  const GRID = { x: 20, y: 20, w: 300, h: H - 40 };

  function layout() {
    GRID.h = H - 40;
    const n = nuclei.length;
    const cols = Math.ceil(Math.sqrt(n * GRID.w / GRID.h));
    const rows = Math.ceil(n / cols);
    return { cols, rows, cw: GRID.w / cols, ch: GRID.h / rows };
  }

  function drawGrid() {
    const { cols, cw, ch } = layout();
    const r = Math.max(1.6, Math.min(cw, ch) * 0.32);
    for (let i = 0; i < nuclei.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = GRID.x + col * cw + cw / 2;
      const cy = GRID.y + row * ch + ch / 2;
      if (nuclei[i].alive) {
        ctx.fillStyle = "#6effc6";
        ctx.shadowColor = "rgba(110, 255, 198, 0.6)";
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = "rgba(150, 120, 90, 0.55)";  // stable daughter
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Decay flashes: a brief amber burst where a nucleus just popped.
    const nowS = performance.now() / 1000;
    for (let f = flashes.length - 1; f >= 0; f--) {
      const age = nowS - flashes[f].ts;
      if (age > 0.6) { flashes.splice(f, 1); continue; }
      const k = age / 0.6;
      const i = flashes[f].i;
      const col = i % cols, row = Math.floor(i / cols);
      const cx = GRID.x + col * cw + cw / 2;
      const cy = GRID.y + row * ch + ch / 2;
      ctx.strokeStyle = `rgba(255, 200, 110, ${0.9 * (1 - k)})`;
      ctx.lineWidth = 1.6 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1 + k * 14, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawGraph() {
    const g = { x0: 360, y0: 30, x1: W - 24, y1: H - 46 };
    if (g.x1 <= g.x0) return;
    const tMax = Math.max(halfLife * 7, t * 1.05);
    const vToX = (tt) => g.x0 + (tt / tMax) * (g.x1 - g.x0);
    const nToY = (n) => g.y1 - (n / N0) * (g.y1 - g.y0);

    // Grid: horizontal at N0·2^-k, vertical at k·T½
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(236,240,251,0.5)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const n = N0 / Math.pow(2, k);
      const y = nToY(n);
      ctx.beginPath(); ctx.moveTo(g.x0, y); ctx.lineTo(g.x1, y); ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(k === 0 ? "N₀" : "N₀/" + Math.pow(2, k), g.x0 - 6, y + 3);
    }
    for (let k = 0; k * halfLife <= tMax; k++) {
      const x = vToX(k * halfLife);
      ctx.strokeStyle = k === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,184,107,0.25)";
      ctx.beginPath(); ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y1); ctx.stroke();
      ctx.fillStyle = "rgba(255,184,107,0.7)";
      ctx.textAlign = "center";
      if (k > 0) ctx.fillText(k + "·T½", x, g.y1 + 14);
    }
    ctx.fillStyle = "rgba(236,240,251,0.6)";
    ctx.textAlign = "left";
    ctx.fillText("N", g.x0 - 20, g.y0 - 6);
    ctx.textAlign = "right";
    ctx.fillText(i18nText("decayAxisTime", "time"), g.x1, g.y1 + 26);

    // Theoretical exponential
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const tt = (tMax * i) / 120;
      const n = N0 * Math.pow(2, -tt / halfLife);
      const x = vToX(tt), y = nToY(n);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Live stochastic count
    ctx.strokeStyle = "#6effc6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = vToX(history[i].t), y = nToY(history[i].n);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current point
    const cur = history[history.length - 1];
    if (cur) {
      ctx.fillStyle = "#f2f5ff";
      ctx.beginPath();
      ctx.arc(vToX(cur.t), nToY(cur.n), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legend
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(i18nText("decayTheory", "N₀·2^(−t/T½)"), g.x0 + 8, g.y0 + 12);
    ctx.fillStyle = "#6effc6";
    ctx.fillText(i18nText("decayMeasured", "measured"), g.x0 + 8, g.y0 + 28);
  }

  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1810");
    bg.addColorStop(1, "#0e1220");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    drawBackground();
    drawGrid();
    drawGraph();
  }

  function updateReadouts() {
    const n = aliveCount();
    const lambda = LN2 / halfLife;
    const activity = lambda * n;              // decays per sim-time unit
    out.remaining.textContent = String(n);
    out.decayed.textContent = String(N0 - n);
    out.activity.textContent = activity.toFixed(1);
    out.elapsed.textContent = t.toFixed(1);
    out.halves.textContent = (t / halfLife).toFixed(2);
    out.fraction.textContent = (100 * n / N0).toFixed(1) + "%";
  }

  function updateLabels(p) {
    inputValues.count.textContent = String(p.N0);
    inputValues.halflife.textContent = p.T.toFixed(1);
    inputValues.rate.textContent = p.rate.toFixed(1);
  }

  function syncStartBtn() {
    startBtn.textContent = running
      ? i18nText("wavePauseBtn", "Pause")
      : i18nText("startBtn", "Start");
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // Clamp below at 0 too — a first rAF timestamp can precede the
    // performance.now() captured in start(), and a negative dt would
    // run accumulators (charge, time, volume) backwards.
    const dt = Math.max(0, Math.min((ts - lastTs) / 1000, 0.05));
    lastTs = ts;
    if (running) step(dt);
    render();
    updateReadouts();
  }
  function start() {
    cancelAnimationFrame(raf);
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  inputs.count.addEventListener("input", () => { updateLabels(readParams()); reset(); });
  inputs.halflife.addEventListener("input", () => {
    // Changing T½ mid-run rescales future decay; keep the current
    // population but adopt the new constant. Reset the curve so the
    // theoretical overlay matches the new T½.
    updateLabels(readParams());
    halfLife = readParams().T;
    if (!running) reset();
  });
  inputs.rate.addEventListener("input", () => updateLabels(readParams()));

  startBtn.addEventListener("click", () => {
    if (!running && aliveCount() === 0) reset();
    running = !running;
    syncStartBtn();
  });
  resetBtn.addEventListener("click", reset);

  document.addEventListener("langchange", syncStartBtn);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  function resizeCanvas() {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = Math.max(Math.round(rect.width), 520);
    H = 460;
    stage.width = Math.round(W * dpr);
    stage.height = Math.round(H * dpr);
    stage.style.setProperty("width", W + "px", "important");
    stage.style.setProperty("height", H + "px", "important");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    GRID.w = Math.min(300, W * 0.4);
  }
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  updateLabels(readParams());
  reset();
  start();

  // Exposed so a harness can read the measurement out. Nothing here enforces
  // N(t) = N₀·2^(−t/T½); it comes out of independent per-nucleus coin flips,
  // and this is how that can be checked against the closed form.
  window.__decay = {
    params: readParams,
    /** Nuclei still undecayed — counted, never read off the curve. */
    alive: () => nuclei.reduce((n, q) => n + (q.alive ? 1 : 0), 0),
    total: () => nuclei.length,
    time: () => t,
    halfLife: () => halfLife,
    /** N₀·2^(−t/T½), for comparison only. */
    predicted: () => N0 * Math.pow(2, -t / halfLife),
    setRunning: (v) => { running = v; },
    reset,
  };
})();
