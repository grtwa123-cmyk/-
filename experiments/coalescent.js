/*
 * The coalescent — where a family tree comes from.
 * The simulation behind experiments/coalescent.html.
 *
 * A population of N, and one rule: every individual picks a parent at random
 * from the generation before it. Nothing is selected for, nobody has more
 * children on purpose, and the population never changes size. Take a sample
 * of n from the present day and follow their parents back. Sooner or later
 * two of them pick the same parent — not because anything drew them together
 * but because there are only N parents to pick from — and from then on there
 * is one lineage where there were two. Keep going and the sample's ancestry
 * closes down to a single individual: the most recent common ancestor.
 *
 * The pedigree is generated backwards from the present because that is the
 * only end we have a sample at, but the model is the forward one: each
 * individual of generation t draws its parent uniformly from generation
 * t − 1, independently of everyone else. Every individual gets a parent, not
 * only the ancestral ones, so the picture is the whole pedigree with the
 * sample's ancestry picked out of it.
 *
 * WHAT COMES OUT OF IT
 * --------------------
 * None of the following is written down anywhere in this file's mechanism.
 * The genealogy is measured off the pedigree the population produced.
 *
 *   E[T_k]     = 2N / (k(k−1))     time spent with exactly k lineages
 *   E[T_MRCA]  = 2N (1 − 1/n)      how far back the whole tree reaches
 *   E[L_total] = 2N · H(n−1)       total branch length, H the harmonic number
 *   theta-hat  = S / H(n−1)        Watterson: mutations counted on the tree
 *                                  give back 2Nmu, the thing that made them
 *
 * The first of those says something startling: the last two lineages take
 * 2N/2 = N generations to find each other on their own, which is more than
 * half of E[T_MRCA] = 2N(1 − 1/n) however large the sample. Sampling a
 * thousand people instead of ten barely deepens the tree. Most of a
 * genealogy is two lineages waiting.
 *
 * AND THEY ARE A LIMIT, NOT AN IDENTITY
 * -------------------------------------
 * Those four hold as N → ∞ with k²/N → 0. This population is finite and the
 * page says so. Exactly, the chance that k lineages all pick different
 * parents in one generation is
 *
 *   q_k = (N/N)((N−1)/N)···((N−k+1)/N)
 *
 * so the time spent with k lineages, once k is reached, is geometric with
 * mean 1/(1 − q_k). Expand q_k for k² ≪ N and 1 − q_k → k(k−1)/2N, which is
 * where 2N/(k(k−1)) comes from. With ten lineages in a population of sixteen
 * the textbook value is 0.36 generations and the truth is 1.03 — off by a
 * factor of three, because ten lineages in sixteen slots cannot avoid each
 * other for even one generation. The panel carries both numbers, and the
 * gap between them is the size of the approximation.
 *
 * The totals need the whole chain rather than one level: k lineages leave
 * exactly j distinct parents with probability S(k,j)·N(N−1)···(N−j+1)/N^k,
 * with S the Stirling numbers of the second kind, and h_k and l_k below
 * solve that chain exactly. Measured against it the simulation lands within
 * a quarter of a per cent; measured against the textbook limit it is out by
 * up to 1.7% at these population sizes, which is small, systematic, and
 * worth showing rather than rounding away.
 */
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const el = (id) => document.getElementById(id);
  const popIn = el('pop'), sampleIn = el('sample'), muIn = el('mu'), speedIn = el('speed');
  const pauseBtn = el('pause-btn'), resetBtn = el('reset-btn');

  const i18nText = (k, f) => (window.i18n && window.i18n.t(k)) || f;

  /* Fixed colours on a ground this canvas paints itself — see CLAUDE.md. */
  const INK = '#ecf0fb';
  const DIM = '#97a0bf';
  const LINE = 'rgba(236, 240, 251, 0.20)';
  const PEDIGREE = 'rgba(236, 240, 251, 0.10)';
  const LIVE = '#7be0d0';
  const MERGE = '#ffd166';
  const MUT = '#ff6b8a';
  const BAR = '#7be0d0';
  const PRED = '#ff9f6e';

  /*
   * The pedigree gets a narrow column on purpose. A lineage's parent is a
   * uniform draw over the whole population, so across 716 px the jumps are
   * four times longer than a generation is tall and the picture reads as
   * horizontal stripes. At 372 px it reads as lineages descending.
   */
  const TREE = { x: 42, y: 48, w: 372, h: 300 };
  const SPEC = { x: 470, y: 48, w: 288, h: 300 };
  const HIST = { x: 42, y: 400, w: 716, h: 104 };
  const NBIN = 28;

  let paused = false, state = null, animId = null, lastTs = 0, acc = 0;

  const readControls = () => {
    const N = parseInt(popIn.value, 10);
    return {
      N,
      n: Math.min(parseInt(sampleIn.value, 10), N),
      mu: parseFloat(muIn.value),
      speed: parseFloat(speedIn.value),
    };
  };

  // ── the closed forms, for the panel only ────────────────────────────────
  /*
   * Nothing below is consulted by the pedigree. It is here so the reader can
   * see the measurement land on it, and so the page can show how far the
   * textbook limit is from the finite population it is being used on.
   */
  const harmonic = (m) => { let s = 0; for (let i = 1; i <= m; i++) s += 1 / i; return s; };

  /** q_k: k lineages all pick different parents. */
  function noMerge(N, k) {
    let q = 1;
    for (let i = 0; i < k; i++) q *= (N - i) / N;
    return q;
  }

  /** Stirling numbers of the second kind up to kmax. */
  function stirling(kmax) {
    const S = Array.from({ length: kmax + 1 }, () => new Array(kmax + 1).fill(0));
    S[0][0] = 1;
    for (let k = 1; k <= kmax; k++)
      for (let j = 1; j <= k; j++) S[k][j] = j * S[k - 1][j] + S[k - 1][j - 1];
    return S;
  }

  /** The exact finite-N chain: generations to the MRCA, and branch length. */
  function exactChain(N, n) {
    if (n < 2) return { T: 0, L: 0 };
    const S = stirling(n);
    const h = new Array(n + 1).fill(0), l = new Array(n + 1).fill(0);
    for (let k = 2; k <= n; k++) {
      let sh = 1, sl = k, stay = 0;
      for (let j = 1; j <= k; j++) {
        let p = S[k][j];
        for (let i = 0; i < j; i++) p *= (N - i) / N;
        for (let i = 0; i < k - j; i++) p /= N;
        if (j === k) stay = p;
        else if (j >= 2) { sh += p * h[j]; sl += p * l[j]; }
      }
      h[k] = sh / (1 - stay);
      l[k] = sl / (1 - stay);
    }
    return { T: h[n], L: l[n] };
  }

  const exactTk = (N, k) => 1 / (1 - noMerge(N, k));
  const limitTk = (N, k) => 2 * N / (k * (k - 1));
  const limitT = (N, n) => 2 * N * (1 - 1 / n);
  const limitL = (N, n) => 2 * N * harmonic(n - 1);

  // ── the pedigree ────────────────────────────────────────────────────────
  /*
   * Always a fresh tally. Every control that reaches here — the population,
   * the sample size, the mutation rate — changes what a tree *is*, so trees
   * counted before it are trees of something else. There is deliberately no
   * "keep the tally if nothing important changed" branch: a second mechanism
   * for the same rule is a mechanism that hides a bug in the first, and this
   * page had exactly that until a planted defect walked straight past both.
   */
  function build() {
    const c = readControls();
    const st = { ...c, tally: freshTally(c.n) };
    startTree(st);
    return st;
  }

  const freshTally = (n) => ({
    trees: 0, T: 0, L: 0, S: 0, hist: [],
    tk: new Array(n + 1).fill(0), hits: new Array(n + 1).fill(0),
  });

  /** A new sample in the present generation, nothing behind it yet. */
  function startTree(st) {
    st.rows = [];                       // rows[g][i] = parent index of individual i
    st.anc = [];                        // anc[a] = where sampled individual a's line is now
    st.paths = [];                      // paths[a][g] = the same, generation by generation
    st.merges = [];                     // {g, i} where two lines met
    st.muts = [];                       // {g, i} a mutation on a branch
    st.gen = 0;
    st.branch = 0;
    st.sites = 0;
    st.done = false;
    const pick = new Set();
    while (pick.size < st.n) pick.add(Math.floor(Math.random() * st.N));
    /*
     * One entry per sampled individual, kept for the whole run rather than
     * one per surviving lineage. Two samples whose lines have met simply hold
     * the same ancestor from then on, and since the parent is looked up by
     * individual they cannot come apart again. Indexing by surviving lineage
     * instead looks equivalent and is not: the list shortens under a merge
     * and every entry after it then belongs to somebody else.
     */
    for (const i of pick) { st.anc.push(i); st.paths.push([i]); }
    st.lineages = new Set(st.anc).size;
  }

  /**
   * One generation further back. Every individual of the current generation
   * draws a parent uniformly and independently — that is the whole model —
   * and the sample's lineages are carried through the same draw.
   */
  function stepBack(st, draw) {
    if (st.done) return;
    const before = [...new Set(st.anc)];
    const k = before.length;
    // Mutations fall on the branches that exist during this generation — one
    // branch per distinct lineage, not one per sampled individual.
    for (const i of before) {
      if (Math.random() < st.mu) { st.sites++; st.muts.push({ g: st.gen, i }); }
    }
    st.branch += k;
    st.gen++;

    const row = new Array(st.N);
    for (let i = 0; i < st.N; i++) row[i] = Math.floor(Math.random() * st.N);
    if (draw) st.rows.push(row); else st.rows = [];

    // Every sampled individual's line moves to the parent of whoever it is
    // currently sitting on. Two lines already together stay together because
    // they are looking up the same individual.
    for (let a = 0; a < st.anc.length; a++) st.anc[a] = row[st.anc[a]];
    for (let a = 0; a < st.paths.length; a++) st.paths[a].push(st.anc[a]);

    // A merge is a parent that two distinct lines both arrived at.
    const arrivals = new Map();
    for (const b of before) arrivals.set(row[b], (arrivals.get(row[b]) || 0) + 1);
    for (const [i, c] of arrivals) if (c > 1) st.merges.push({ g: st.gen, i });

    const after = new Set(st.anc);
    st.lineages = after.size;
    if (after.size === 1) {
      st.done = true;
      st.mrca = { g: st.gen, i: st.anc[0] };
      record(st);
    }
  }

  function record(st) {
    const t = st.tally;
    t.trees++; t.T += st.gen; t.L += st.branch; t.S += st.sites;
    t.hist.push(st.gen);
    if (t.hist.length > 20000) t.hist.shift();
    // Time spent at each number of lineages, read back off the paths.
    const seenK = new Set();
    for (let g = 0; g < st.gen; g++) {
      const at = new Set();
      for (const p of st.paths) at.add(p[g]);
      t.tk[at.size]++; seenK.add(at.size);
    }
    for (const kk of seenK) t.hits[kk]++;
  }

  /** Run a whole tree to its MRCA without drawing anything. */
  function runTree(st) {
    let guard = 0;
    while (!st.done && guard++ < 400 * st.N) stepBack(st, false);
    return st.done;
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  const CW = () => canvas.width / (window.devicePixelRatio || 1);
  const CH = () => canvas.height / (window.devicePixelRatio || 1);

  function draw() {
    const st = state, w = CW(), h = CH();
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(0, 0, w, h);

    // The frame the pedigree lives in. The present is the bottom edge.
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TREE.x, TREE.y + TREE.h); ctx.lineTo(TREE.x + TREE.w, TREE.y + TREE.h);
    ctx.stroke();

    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillStyle = DIM;
    ctx.textAlign = 'left';
    ctx.fillText(i18nText('clPastCap', 'the past'), TREE.x, TREE.y - 8);
    ctx.textAlign = 'right';
    ctx.textAlign = 'right';
    ctx.fillText(i18nText('clNowCap', 'today'), TREE.x + TREE.w, TREE.y + TREE.h + 15);

    // How many generations the vertical axis holds. Anchored to what a tree
    // of this size is expected to need, so a shallow tree looks shallow
    // instead of being stretched to fill the panel; a deeper one pushes the
    // axis out rather than running off the top of it.
    const span = Math.max(12, st.rows.length + 3,
                          Math.round(1.15 * exactChain(st.N, st.n).T));
    const gx = (i) => TREE.x + (st.N === 1 ? TREE.w / 2 : (i + 0.5) * TREE.w / st.N);
    const gy = (g) => TREE.y + TREE.h - g * TREE.h / span;

    // A rung every ten generations, so the vertical is a scale and not a mood.
    const rung = span > 120 ? 50 : span > 60 ? 20 : 10;
    ctx.strokeStyle = 'rgba(236, 240, 251, 0.07)';
    ctx.lineWidth = 1;
    ctx.font = '500 9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(151, 160, 191, 0.75)';
    for (let g = rung; g <= span; g += rung) {
      const y = gy(g);
      ctx.beginPath(); ctx.moveTo(TREE.x, y); ctx.lineTo(TREE.x + TREE.w, y); ctx.stroke();
      ctx.fillText(String(g), TREE.x - 5, y + 3);
    }
    ctx.font = '500 11px system-ui, sans-serif';

    // Everybody's parent, faintly: this is the pedigree the sample is a
    // thread through, and without it a coalescence looks arranged.
    if (st.rows.length) {
      ctx.strokeStyle = PEDIGREE;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      const stride = st.N * st.rows.length > 3000 ? 2 : 1;
      for (let g = 0; g < st.rows.length; g++) {
        for (let i = 0; i < st.N; i += stride) {
          ctx.moveTo(gx(i), gy(g));
          ctx.lineTo(gx(st.rows[g][i]), gy(g + 1));
        }
      }
      ctx.stroke();
    }

    // The present generation, with the sampled individuals filled in.
    const sampled = new Set(st.paths.map((p) => p[0]));
    for (let i = 0; i < st.N; i++) {
      ctx.fillStyle = sampled.has(i) ? LIVE : 'rgba(236, 240, 251, 0.30)';
      ctx.beginPath();
      ctx.arc(gx(i), gy(0), sampled.has(i) ? 3 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // The sample's ancestry.
    ctx.strokeStyle = LIVE;
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.9;
    for (const p of st.paths) {
      ctx.beginPath();
      for (let g = 0; g < p.length; g++) {
        const px = gx(p[g]), py = gy(g);
        if (g === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Where two lineages happened to pick the same parent.
    ctx.fillStyle = MERGE;
    for (const m of st.merges) {
      ctx.beginPath();
      ctx.arc(gx(m.i), gy(m.g), 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mutations, as ticks across the branch they fell on.
    ctx.strokeStyle = MUT;
    ctx.lineWidth = 1.6;
    for (const m of st.muts) {
      const y = gy(m.g + 0.5), x = gx(m.i);
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y); ctx.lineTo(x + 3.5, y);
      ctx.stroke();
    }

    if (st.done && st.mrca) {
      ctx.strokeStyle = MERGE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx(st.mrca.i), gy(st.mrca.g), 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = MERGE;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(i18nText('clMrcaCap', 'common ancestor'),
                   Math.min(Math.max(gx(st.mrca.i), TREE.x + 50), TREE.x + TREE.w - 50),
                   Math.max(gy(st.mrca.g) - 11, TREE.y + 10));
    }

    drawSpectrum(st);
    drawHist(st);
  }

  /**
   * How long each level lasted, measured, with both predictions beside it.
   * This is where the textbook limit visibly parts company with the finite
   * population: the bars are the truth and the two ticks disagree.
   */
  function drawSpectrum(st) {
    const t = st.tally;
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('clSpecCap', 'generations spent with k lineages'), SPEC.x, SPEC.y - 8);
    const rows = [];
    for (let k = st.n; k >= 2; k--) rows.push(k);
    const rh = SPEC.h / Math.max(rows.length, 1);
    let peak = 0;
    for (const k of rows) {
      peak = Math.max(peak, exactTk(st.N, k),
                      t.hits[k] ? t.tk[k] / t.hits[k] : 0);
    }
    if (peak <= 0) return;
    const bx = SPEC.x + 26, bw = SPEC.w - 26;
    rows.forEach((k, i) => {
      const y = SPEC.y + i * rh + 2, hgt = Math.max(3, rh - 6);
      const meas = t.hits[k] ? t.tk[k] / t.hits[k] : 0;
      ctx.fillStyle = DIM;
      ctx.font = '500 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(k), SPEC.x + 18, y + hgt - 1);
      ctx.fillStyle = BAR;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(bx, y, Math.max(1, meas / peak * bw), hgt);
      ctx.globalAlpha = 1;
      const tick = (v, col, w) => {
        const x = bx + Math.min(v / peak, 1) * bw;
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x, y + hgt + 1); ctx.stroke();
      };
      tick(limitTk(st.N, k), MUT, 1);
      tick(exactTk(st.N, k), PRED, 1.6);
    });
    ctx.textAlign = 'left';
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.fillStyle = PRED;
    ctx.fillText(i18nText('clSpecExact', '1/(1−q_k)'), SPEC.x, SPEC.y + SPEC.h + 14);
    ctx.fillStyle = MUT;
    ctx.fillText(i18nText('clSpecLimit', '2N/k(k−1)'), SPEC.x + 72, SPEC.y + SPEC.h + 14);
  }

  function drawHist(st) {
    const t = st.tally, y1 = HIST.y + HIST.h;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(HIST.x, y1); ctx.lineTo(HIST.x + HIST.w, y1); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(i18nText('clHistCap', 'how deep each tree turned out to be'), HIST.x, HIST.y - 5);
    if (!t.trees) return;

    // A fixed axis in units of the exact prediction, so the spread is
    // legible rather than rescaling every time an outlier lands.
    const scale = Math.max(1, exactChain(st.N, st.n).T);
    const top = 3.5 * scale;
    const bins = new Array(NBIN).fill(0);
    for (const v of t.hist) bins[Math.min(NBIN - 1, Math.floor(v / top * NBIN))]++;
    let peak = 1;
    for (const b of bins) peak = Math.max(peak, b);
    const bw = HIST.w / NBIN;
    for (let i = 0; i < NBIN; i++) {
      const v = bins[i] / peak;
      ctx.fillStyle = BAR;
      ctx.globalAlpha = 0.25 + 0.5 * v;
      ctx.fillRect(HIST.x + i * bw + 1, y1 - v * HIST.h, bw - 2, v * HIST.h);
    }
    ctx.globalAlpha = 1;

    const mark = (gen, col, label, dash, row) => {
      const x = HIST.x + Math.min(gen / top, 1) * HIST.w;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x, HIST.y); ctx.lineTo(x, y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.font = '500 10px system-ui, sans-serif';
      ctx.textAlign = x > HIST.x + HIST.w - 70 ? 'right' : 'left';
      // The two marks sit almost on top of each other when the measurement
      // has converged, which is the good case, so they get their own lines.
      ctx.fillText(label, x + (x > HIST.x + HIST.w - 70 ? -4 : 4), HIST.y + row);
    };
    mark(exactChain(st.N, st.n).T, PRED, i18nText('clHistExact', 'exact mean'), [4, 3], 11);
    mark(t.T / t.trees, INK, i18nText('clHistMeasured', 'measured mean'), [], 25);
  }

  // ── readouts ────────────────────────────────────────────────────────────
  function updateReadouts() {
    const st = state, t = st.tally;
    const set = (id, v) => { const node = el(id); if (node) node.textContent = v; };
    const ex = exactChain(st.N, st.n);
    const Hn = harmonic(st.n - 1);
    set('out-live', String(st.lineages));
    set('out-gen', String(st.gen));
    set('out-trees', String(t.trees));
    set('out-tmrca', t.trees ? (t.T / t.trees).toFixed(1) : '—');
    set('out-tmrca-exact', ex.T.toFixed(1));
    set('out-tmrca-limit', limitT(st.N, st.n).toFixed(1));
    set('out-branch', t.trees ? (t.L / t.trees).toFixed(1) : '—');
    set('out-branch-exact', ex.L.toFixed(1));
    set('out-sites', t.trees ? (t.S / t.trees).toFixed(2) : '—');
    set('out-theta', t.trees ? (t.S / t.trees / Hn).toFixed(3) : '—');
    set('out-theta-true', (2 * st.N * st.mu).toFixed(3));
    set('out-state', st.done
      ? i18nText('clStateFound', 'Found the common ancestor')
      : st.lineages === st.n
        ? i18nText('clStateStart', 'Nobody has met yet')
        : i18nText('clStateMerging', 'Merging'));
  }

  // ── loop ────────────────────────────────────────────────────────────────
  function step(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (!paused && dt > 0) {
      acc += dt * state.speed;
      let guard = 0;
      while (acc >= 1 && guard < 200) {
        acc -= 1; guard++;
        if (state.done) { startTree(state); break; }
        stepBack(state, true);
      }
    }
    draw();
    updateReadouts();
    animId = requestAnimationFrame(step);
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  function syncLabels() {
    el('pop-value').textContent = popIn.value;
    el('sample-value').textContent = String(Math.min(parseInt(sampleIn.value, 10),
                                                     parseInt(popIn.value, 10)));
    el('mu-value').textContent = parseFloat(muIn.value).toFixed(3);
    el('speed-value').textContent = speedIn.value;
  }

  function restart() {
    state = build();
    acc = 0;
    syncLabels();
    draw();
    updateReadouts();
  }

  for (const node of [popIn, sampleIn, muIn]) {
    node.addEventListener('input', restart);
    node.addEventListener('change', restart);
  }
  speedIn.addEventListener('input', () => { state.speed = readControls().speed; syncLabels(); });

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? i18nText('waveResumeBtn', 'Resume') : i18nText('wavePauseBtn', 'Pause');
    window.SFX?.tone({ freq: paused ? 300 : 520, dur: 0.07, type: 'triangle', gain: 0.1 });
  });
  resetBtn.addEventListener('click', () => {
    paused = false;
    pauseBtn.textContent = i18nText('wavePauseBtn', 'Pause');
    restart();
  });

  document.addEventListener('langchange', () => { syncLabels(); updateReadouts(); draw(); });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(800 * dpr);
    canvas.height = Math.round(540 * dpr);
    canvas.style.height = '540px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state) draw();
  }
  window.addEventListener('resize', resize);

  if (window.CSVExport) {
    window.CSVExport.attach('csv-btn', () => {
      if (!state || !state.tally.trees) return null;
      const st = state, t = st.tally;
      return {
        name: 'coalescent-trees.csv',
        title: 'The coalescent — how deep each tree turned out to be',
        columns: ['tree', 'generations_to_mrca'],
        rows: t.hist.map((v, i) => [i + 1, v]),
        meta: {
          population: st.N, sample: st.n, mutation_rate: st.mu, trees: t.trees,
          mean_tmrca: t.T / t.trees, mean_branch_length: t.L / t.trees,
          mean_segregating_sites: t.S / t.trees,
          watterson_theta: t.S / t.trees / harmonic(st.n - 1),
          exact_tmrca: exactChain(st.N, st.n).T,
          exact_branch_length: exactChain(st.N, st.n).L,
          limit_tmrca: limitT(st.N, st.n), limit_branch_length: limitL(st.N, st.n),
        },
      };
    });
  }

  resize();
  restart();
  animId = requestAnimationFrame(step);

  /*
   * The handle tests/experiments/coalescent.test.mjs measures the population
   * through. It sets the same controls a reader sets, runs the same pedigree
   * the animation runs, and every quantity it checks it works out itself —
   * including the exact chain, which it solves independently.
   */
  window.__coal = {
    constants: () => ({ TREE, HIST, NBIN }),
    set(cfg) {
      if (cfg.N !== undefined) popIn.value = String(cfg.N);
      if (cfg.n !== undefined) sampleIn.value = String(cfg.n);
      if (cfg.mu !== undefined) muIn.value = String(cfg.mu);
      restart();
      return this.read();
    },
    /** Run `count` complete trees to their MRCA, tallying every one. */
    runTrees(count) {
      for (let i = 0; i < count; i++) {
        startTree(state);
        if (!runTree(state)) return { failed: true, ...this.read() };
      }
      return this.read();
    },
    /** Step the live tree one generation back, as the animation does. */
    stepBack() { stepBack(state, true); return this.read(); },
    clear() { state.tally = freshTally(state.n); startTree(state); return this.read(); },
    read: () => {
      const st = state, t = st.tally;
      return {
        N: st.N, n: st.n, mu: st.mu,
        gen: st.gen, lineages: st.lineages, done: st.done,
        branch: st.branch, sites: st.sites, rows: st.rows.length,
        paths: st.paths.map((p) => p.slice()), merges: st.merges.length,
        trees: t.trees, sumT: t.T, sumL: t.L, sumS: t.S,
        meanT: t.trees ? t.T / t.trees : null,
        meanL: t.trees ? t.L / t.trees : null,
        meanS: t.trees ? t.S / t.trees : null,
        hist: t.hist.slice(-20000),
        tk: t.tk.slice(), hits: t.hits.slice(),
        shownState: el('out-state').textContent,
      };
    },
  };
})();
