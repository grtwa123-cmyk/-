/*
 * Two-source interference. The page is given the superposition principle and
 * nothing else: two circular waves add, each falling off as 1/√r. Everything
 * it reports is then found in the resulting field — the intensity is averaged
 * over a whole cycle, scanned down a screen, and the fringes are located as
 * extrema of that scan.
 *
 * A fringe of order q is a branch of the hyperbola r₁ − r₂ = qλ, and where
 * that branch crosses the screen is exact:
 *
 *   y(q) = (qλ/2)·√(1 + L² / ((d/2)² − (qλ/2)²))
 *
 * Δy = λL/d is what that collapses to for a narrow geometry and a far screen,
 * and it is low by exactly √(1 − (λ/d)²) ⁄ √(1 + (d² − λ²)/(4L²)). These checks
 * hold the located fringes to the exact crossing, and hold the approximation
 * to its own error term rather than pretending it is the answer.
 *
 * The first draft of this file compared against L·tan(asin(λ/d)) — the
 * far-field direction — and failed the page for being 13% off. The page was
 * right: at L = 303 px a screen 303 px away is not far away.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/wave.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

// Hold the picture still; none of the measurements depend on the phase, and a
// running animation only makes the round trips race each other.
await page.evaluate(() => window.__wave.setRunning(false));

/*
 * Preamble injected into every page.evaluate below.
 *
 * scan() and centralGap() deliberately re-implement the page's own search on
 * top of its raw field, so a check never reads a number the page computed for
 * itself unless it means to. scan() also takes L, which lets the checks stand
 * the screen somewhere the page cannot — the only way to separate the two
 * halves of the approximation's error.
 */
const E = `
  const M = window.__wave;
  const P = (o) => ({ ...M.params(), ...o });
  const L0 = M.screenX();
  const scan = (LL, p, span, N, envelope = false) => {
    const ys = new Float64Array(N), is = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const y = -span + (2 * span * i) / (N - 1);
      ys[i] = y; is[i] = M.intensity(LL, y, p, envelope);
    }
    return { ys, is };
  };
  const span0 = () => -M.scanScreen(P({}), false).ys[0];
  const peaks = (s) => M.extrema(s, +1).map((m) => m.y).sort((a, b) => a - b);
  // The gap between the two fringes straddling the axis — the one place the
  // textbook Δy actually refers to, since the fringes widen further out.
  const centralGap = (ys) => {
    let best = null;
    for (let i = 0; i + 1 < ys.length; i++) {
      const mid = Math.abs((ys[i] + ys[i + 1]) / 2);
      if (!best || mid < best.mid) best = { mid, lo: ys[i], hi: ys[i + 1] };
    }
    return best;
  };
  const dev = (list, p, LL, off) => list.reduce((w, m) => {
    const n = M.orderAt(LL, m.y, p) - off;
    return Math.max(w, Math.abs(n - Math.round(n)));
  }, 0);
  const fit = (xs, ys) => {
    const lx = xs.map(Math.log), ly = ys.map(Math.log);
    const mx = lx.reduce((a, b) => a + b) / lx.length;
    const my = ly.reduce((a, b) => a + b) / ly.length;
    let num = 0, den = 0;
    for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
    return num / den;
  };
`;

// ── The exact condition, at the fringes that were found ──────────────
{
  const r = await page.evaluate(new Function(`${E}
    const out = [];
    for (const d of [80, 140, 220, 300]) {
      for (const lam of [24, 36, 48, 72]) {
        const p = P({ d, lam, A1: 1, A2: 1, phi: 0 });
        // Envelope off: the 1/√r falloff is an amplitude effect and the
        // condition is a phase one, so switching it off isolates the claim.
        const flat = M.extrema(M.scanScreen(p, false), +1);
        if (flat.length < 3) continue;
        out.push({ d, lam, n: flat.length, worst: dev(flat, p, L0, 0) });
      }
    }
    return out;`));
  const worst = Math.max(...r.map((x) => x.worst));
  chk(`every located bright fringe sits where r₁ − r₂ is a whole number of λ — ${r.length} geometries`,
      r.length >= 12 && worst < 1e-5,
      `${r.reduce((s, x) => s + x.n, 0)} fringes, worst |δ/λ − n| = ${worst.toExponential(2)}`);

  const dark = await page.evaluate(new Function(`${E}
    const p = P({ d: 140, lam: 48, A1: 1, A2: 1, phi: 0 });
    const list = M.extrema(M.scanScreen(p, false), -1);
    return { worst: dev(list, p, L0, 0.5), n: list.length };`));
  chk('and every dark one where it is a half number',
      dark.n >= 2 && dark.worst < 1e-5,
      `${dark.n} dark fringes, worst ${dark.worst.toExponential(2)}`);

  // The residual above is the search's resolution, not the field's — which is
  // worth proving, because otherwise 1e-6 looks like a property of the physics.
  const res = await page.evaluate(new Function(`${E}
    const p = P({ d: 140, lam: 48, A1: 1, A2: 1, phi: 0 });
    const s = span0();
    return [M.SAMPLES, M.SAMPLES * 2, M.SAMPLES * 4]
      .map((N) => ({ N, worst: dev(M.extrema(scan(L0, p, s, N), +1), p, L0, 0) }));`));
  chk('and the residual is the resolution of the search, not the field — it falls with the sampling',
      res[2].worst < res[0].worst / 10,
      res.map((x) => `${x.N}: ${x.worst.toExponential(1)}`).join(' → '));
}

// ── The envelope pulls the bright fringes, not the dark ones ─────────
{
  // A real, measurable asymmetry: destructive interference is pinned by phase,
  // so an amplitude gradient cannot move it. A maximum is a balance between
  // the interference term and the envelope, so it shifts. The fringe on the
  // axis is excluded — it sits on a symmetry plane and nothing can move it,
  // which would otherwise report a drift of exactly zero.
  const r = await page.evaluate(new Function(`${E}
    return [[140, 48], [220, 36], [320, 24], [200, 30], [180, 60]].map(([d, lam]) => {
      const p = P({ d, lam, A1: 1, A2: 1, phi: 0 });
      const on = M.scanScreen(p, true);
      const offAxis = (l) => l.filter((m) => Math.abs(m.y) > 2);
      const b = offAxis(M.extrema(on, +1)), k = offAxis(M.extrema(on, -1));
      return { d, lam, nb: b.length, nk: k.length,
               bright: dev(b, p, L0, 0), dark: dev(k, p, L0, 0.5) };
    });`));
  chk('with the 1/√r envelope on, the bright fringes drift off the condition',
      r.every((x) => x.nb >= 2 && x.bright > 1e-4),
      r.map((x) => `λ${x.lam}/d${x.d}: ${x.bright.toExponential(1)} (${x.nb})`).join(', '));
  chk('and the dark ones stay pinned, being set by phase rather than amplitude',
      r.every((x) => x.nk >= 2 && x.dark < x.bright / 8),
      r.map((x) => `${(x.bright / x.dark).toFixed(0)}×`).join(', '));
}

// ── The located spacing is the exact crossing of the hyperbola ───────
{
  const r = await page.evaluate(new Function(`${E}
    return [[14, 320], [20, 220], [24, 320], [30, 200], [36, 220], [48, 240], [48, 140], [60, 180]]
      .map(([lam, d]) => {
        const p = P({ lam, d, A1: 1, A2: 1, phi: 0 });
        const g = centralGap(peaks(M.scanScreen(p, false)));
        const n0 = Math.round(M.orderAt(L0, g.lo, p));
        const exact = M.fringeY(n0 + 1, p, L0) - M.fringeY(n0, p, L0);
        const measured = g.hi - g.lo;
        return { lam, d, L: L0, ratio: lam / d, measured, exact,
                 rel: Math.abs(measured - exact) / exact,
                 approx: (lam * L0) / d };
      });`));
  const worst = Math.max(...r.map((x) => x.rel));
  chk(`the located fringe spacing is the exact crossing of r₁ − r₂ = qλ — ${r.length} geometries`,
      worst < 1e-5,
      `worst ${worst.toExponential(2)}, e.g. λ48/d140: ${r[6].measured.toFixed(6)} vs ${r[6].exact.toFixed(6)}`);

  // λL/d is not merely "close"; it is low by a known factor, and that factor
  // is the whole of the disagreement.
  const bill = r.map((x) => ({
    ...x,
    got: x.approx / x.measured,
    want: Math.sqrt(1 - (x.lam / x.d) ** 2) / Math.sqrt(1 + (x.d ** 2 - x.lam ** 2) / (4 * x.L * x.L)),
  }));
  chk('and λL/d is low by exactly √(1 − (λ/d)²) ⁄ √(1 + (d² − λ²)/4L²)',
      bill.every((x) => x.got < 1 && Math.abs(x.got - x.want) < 2e-5),
      bill.map((x) => `λ${x.lam}/d${x.d}: ${((x.got - 1) * 100).toFixed(2)}% vs ${((x.want - 1) * 100).toFixed(2)}%`).join(', '));
  chk('the shortfall is worth reporting — never under 5% anywhere on the sliders',
      bill.every((x) => x.got < 0.95),
      `${((Math.max(...bill.map((x) => x.got)) - 1) * 100).toFixed(1)}% at best, ` +
      `${((Math.min(...bill.map((x) => x.got)) - 1) * 100).toFixed(1)}% at worst`);
}

// ── Moving the screen back pays off one debt and not the other ───────
{
  // The page's screen is fixed at L ≈ 303 px, but its field is not: standing a
  // scan ten times further out separates the near-screen term, which fades,
  // from the obliquity term, which does not.
  const r = await page.evaluate(new Function(`${E}
    return [[24, 320], [48, 140], [80, 140]].map(([lam, d]) => {
      const p = P({ lam, d, A1: 1, A2: 1, phi: 0 });
      const shortfall = (LL) => {
        const want = M.fringeY(1, p, LL);
        const ys = peaks(scan(LL, p, want * 1.35, 4000)).filter((y) => y > 1e-6);
        return ys.length ? 1 - (lam * LL) / d / ys[0] : NaN;
      };
      return { lam, d, near: shortfall(L0), far: shortfall(L0 * 10),
               floor: 1 - Math.sqrt(1 - (lam / d) ** 2) };
    });`));
  chk('standing the screen ten times further back shrinks the shortfall',
      r.every((x) => x.far < x.near - 0.001),
      r.map((x) => `λ${x.lam}/d${x.d}: ${(x.near * 100).toFixed(1)}% → ${(x.far * 100).toFixed(1)}%`).join(', '));
  chk('but it stops at 1 − √(1 − (λ/d)²), which distance cannot buy back',
      r.every((x) => x.far > x.floor && x.far - x.floor < 0.0025),
      r.map((x) => `${(x.far * 100).toFixed(2)}% vs floor ${(x.floor * 100).toFixed(2)}%`).join(', '));
}

// ── How the spacing scales ───────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const spacing = (o) => {
      const p = P({ ...o, A1: 1, A2: 1, phi: 0 });
      const g = centralGap(peaks(M.scanScreen(p, false)));
      return g ? g.hi - g.lo : NaN;
    };
    const exact = (o) => {
      const p = P({ ...o, A1: 1, A2: 1, phi: 0 });
      return M.fringeY(1, p, L0);
    };
    const lams = [14, 18, 24, 30], ds = [220, 260, 300, 320];
    return { lam: fit(lams, lams.map((lam) => spacing({ lam, d: 320 }))),
             d: fit(ds, ds.map((d) => spacing({ lam: 20, d }))),
             dExact: fit(ds, ds.map((d) => exact({ lam: 20, d }))) };`));
  chk('fringe spacing is proportional to λ', Math.abs(r.lam - 1) < 0.05, `Δy ∝ λ^${r.lam.toFixed(4)}`);
  // Δy ∝ 1/d is part of the same approximation, and it is off by a sixth of a
  // power here. The measured exponent is not "wrong" — the exact crossing has
  // the same one, because √(L² + d²/4) grows with d.
  chk('Δy falls with d, but not as 1/d — and the exact crossing agrees on the exponent',
      Math.abs(r.d - r.dExact) < 0.005 && Math.abs(r.d + 1) > 0.1,
      `measured d^${r.d.toFixed(4)}, exact d^${r.dExact.toFixed(4)}, textbook d^-1`);
}

// ── Visibility ───────────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    return [[1, 1], [1, 0.75], [1, 0.5], [1, 0.25], [1, 0.1]].map(([A1, A2]) => {
      const p = P({ d: 140, lam: 48, A1, A2, phi: 0 });
      const s = M.scanScreen(p, false);
      const g = centralGap(peaks(s));
      const win = g ? Math.abs(g.hi - g.lo) * 1.05 : 200;
      let hi = -Infinity, lo = Infinity;
      for (let i = 0; i < s.ys.length; i++) {
        if (Math.abs(s.ys[i]) > win) continue;
        if (s.is[i] > hi) hi = s.is[i];
        if (s.is[i] < lo) lo = s.is[i];
      }
      return { A2, V: (hi - lo) / (hi + lo), want: (2 * A1 * A2) / (A1 * A1 + A2 * A2) };
    });`));
  chk('measured fringe visibility is 2A₁A₂/(A₁²+A₂²)',
      r.every((x) => Math.abs(x.V - x.want) < 1e-4),
      r.map((x) => `A₂=${x.A2}: ${x.V.toFixed(5)} vs ${x.want.toFixed(5)}`).join(', '));
  chk('only equal arms give a perfect null', r[0].V > 0.999 && r[4].V < 0.25,
      `${r[0].V.toFixed(4)} at equal, ${r[4].V.toFixed(4)} at 1:10`);
}

// ── Δφ slides the pattern rigidly ────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const shot = (deg) => {
      const p = P({ d: 140, lam: 48, A1: 1, A2: 1, phi: (deg * Math.PI) / 180 });
      const ys = peaks(M.scanScreen(p, false));
      // Every fringe should have moved to the crossing for order n + Δφ/2π.
      let worst = 0;
      for (const y of ys) {
        const n = Math.round(M.orderAt(L0, y, p));
        worst = Math.max(worst, Math.abs(y - M.fringeY(n + deg / 360, p, L0)));
      }
      const near = ys.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
      return { deg, ys, worst, delta: M.pathDiff(L0, near, p),
               want: (deg / 360) * p.lam };
    };
    const sweep = [-150, -90, -45, 0, 45, 90, 150].map(shot);
    const zero = shot(0), turn = shot(360);
    return { sweep, drift: Math.max(...zero.ys.map((y, i) => Math.abs(y - turn.ys[i]))),
             sameCount: zero.ys.length === turn.ys.length };`));

  const worst = Math.max(...r.sweep.map((x) => x.worst));
  chk('Δφ moves every fringe to the crossing for order n + Δφ/2π',
      worst < 1e-3,
      `worst ${worst.toExponential(2)} px over ${r.sweep.reduce((s, x) => s + x.ys.length, 0)} fringes`);
  chk('so the central fringe lands where the path difference cancels Δφ',
      r.sweep.every((x) => Math.abs(x.delta - x.want) < 1e-3),
      r.sweep.map((x) => `${x.deg}°: ${x.delta.toFixed(5)}`).join(', '));
  chk('and a full turn puts the pattern back exactly where it started',
      r.sameCount && r.drift < 1e-9, `${r.drift.toExponential(1)} px after 360°`);
}

// ── The live page ────────────────────────────────────────────────────
{
  await setV('spacing', 140); await setV('wavelength', 48);
  await setV('amp1', 1); await setV('amp2', 1); await setV('phase', 0);
  await page.waitForTimeout(250);

  const live = await page.evaluate(() => {
    const M = window.__wave, m = M.measure(M.params());
    // Re-find the peaks in the page's own stored scan, with a parabola fitted
    // here rather than there: if the readout were the formula, this would not
    // reproduce it.
    const { ys, is } = m.scan;
    const found = [];
    for (let i = 1; i < is.length - 1; i++) {
      if (!(is[i] > is[i - 1] && is[i] >= is[i + 1])) continue;
      const a = is[i - 1], b = is[i], c = is[i + 1], den = a - 2 * b + c;
      found.push(ys[i] + (den === 0 ? 0 : (0.5 * (a - c)) / den) * (ys[i + 1] - ys[i]));
    }
    found.sort((p, q) => p - q);
    let best = null;
    for (let i = 0; i + 1 < found.length; i++) {
      const mid = Math.abs((found[i] + found[i + 1]) / 2);
      if (!best || mid < best.mid) best = { mid, gap: found[i + 1] - found[i] };
    }
    return { spacing: m.spacing, exact: m.exact, approx: m.approx, bright: m.bright.length,
             refound: best ? best.gap : NaN, nfound: found.length,
             vis: m.visibility, visIdeal: m.visIdeal,
             orderFlat: m.orderFlat, orderBright: m.orderBright,
             shownFringe: document.getElementById('out-fringe').textContent.trim(),
             shownExact: document.getElementById('out-exact').textContent.trim(),
             shownApprox: document.getElementById('out-approx').textContent.trim(),
             shownCount: document.getElementById('out-count').textContent.trim(),
             shownVis: document.getElementById('out-visibility').textContent.trim() };
  });
  chk('the fringe-spacing readout is the gap between two peaks in the scan beside it',
      Math.abs(live.refound - live.spacing) < 1e-9 && live.nfound === live.bright,
      `${live.shownFringe} px, re-found ${live.refound.toFixed(6)} from ${live.nfound} peaks`);
  chk('the exact crossing is shown beside it, and the measurement is inside a percent of it',
      /^\d+\.\d{2} \([-+]\d+\.\d+%\)$/.test(live.shownExact)
      && Math.abs(parseFloat(live.shownExact) - live.exact) < 0.01
      && Math.abs(live.exact - live.spacing) / live.spacing < 0.01,
      live.shownExact);
  chk('and λL/d is shown too, an order of magnitude further off and on the low side',
      /^\d+\.\d{2} \(-\d+\.\d%\)$/.test(live.shownApprox)
      && Math.abs(parseFloat(live.shownApprox) - live.approx) < 0.01
      && live.spacing - live.approx > 10 * Math.abs(live.exact - live.spacing),
      `${live.shownExact}  vs  ${live.shownApprox}`);
  chk('the fringes counted on screen are the ones that were found',
      parseInt(live.shownCount, 10) === live.bright && live.bright >= 3,
      `${live.shownCount} shown, ${live.bright} located`);
  chk('and the visibility readout carries both the measurement and the target',
      /^\d\.\d{3} \/ \d\.\d{3}$/.test(live.shownVis)
      && Math.abs(live.vis - live.visIdeal) < 0.01, live.shownVis);
  chk('the measurement is far better without the envelope than with it',
      live.orderFlat < live.orderBright / 100,
      `${live.orderFlat.toExponential(1)} vs ${live.orderBright.toExponential(1)}`);
}

// ── The screen is actually drawn ─────────────────────────────────────
{
  const ink = () => page.evaluate(() => {
    const c = document.getElementById('stage');
    const g = c.getContext('2d');
    const w = Math.floor(c.width * 0.13);
    const d = g.getImageData(c.width - w, 0, w, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 170) n++;
    return n;
  });
  const on = await ink();
  await page.$eval('#show-screen', (el) => {
    el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const offInk = await ink();
  chk('turning the screen off removes the profile and its ticks',
      on > offInk * 1.3 && on > 200, `${on} → ${offInk} lit pixels`);
  await page.$eval('#show-screen', (el) => {
    el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  chk('and turning it back on restores them',
      Math.abs((await ink()) - on) < on * 0.08);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  const sig = async () => {
    await page.waitForTimeout(140);
    return page.evaluate(() => {
      const M = window.__wave, p = M.params(), m = M.measure(p);
      const c = document.getElementById('stage'), g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4 * 103) h = (h * 31 + d[i] + d[i + 1] * 3) | 0;
      return JSON.stringify([
        (m.spacing || 0).toFixed(6), m.bright.length, m.visibility.toFixed(6), h,
        document.getElementById('spacing-value').textContent,
        document.getElementById('wavelength-value').textContent,
        document.getElementById('amp2-value').textContent,
        document.getElementById('phase-value').textContent,
        document.getElementById('speed-value').textContent]);
    });
  };
  const dead = [];
  const acts = [
    ['spacing', () => setV('spacing', 220)],
    ['wavelength', () => setV('wavelength', 30)],
    ['amp2', () => setV('amp2', 0.4)],
    ['phase', () => setV('phase', 90)],
    // Speed only moves the clock, so it is judged on the picture, which is
    // why the signature carries a hash of the canvas.
    ['speed', async () => { await setV('speed', 2);
      await page.evaluate(() => window.__wave.setRunning(true));
      await page.waitForTimeout(220);
      await page.evaluate(() => window.__wave.setRunning(false)); }],
    ['show screen', () => page.$eval('#show-screen', (el) => {
      el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); })],
    ['reset', () => page.click('#reset-btn')],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  const after = await page.evaluate(() => window.__wave.params());
  chk('Reset restores the defaults',
      after.d === 140 && after.lam === 48 && after.A1 === 1 && after.A2 === 1
      && after.phi === 0 && after.screen === true, JSON.stringify(after));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  await page.evaluate(() => window.__wave.setRunning(true));
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns', en !== ko && ko !== zh && (await h1()) === en,
      `${en} / ${ko} / ${zh}`);

  const unresolved = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', unresolved.length === 0, unresolved.slice(0, 4).join(', '));

  chk('the page badges itself as measured and verified',
      await page.$('.method-tag[data-method="measured"]') !== null
      && await page.$('.method-verified') !== null);

  const src = await page.evaluate(async (u) => (await fetch(u)).text(), url('experiments/wave.js'));
  chk('the fringe positions are not computed from λL/d anywhere in the source',
      !/(spacing|fringe|y1|yPos)\s*=\s*[^;\n]*lam\s*\*\s*L/i.test(src.replace(/approx\s*=[^;]*;/g, '')),
      'the only λ·L/d in the file is the approximation it is compared against');

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(450);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('wave');
