/*
 * Refraction. The page is given two facts — light goes at c/n, and the incoming
 * wavefront strikes the interface point x at time x·sinθ₁/v₁ — and is never
 * given Snell's law. It grows a Huygens wavelet from every point struck and
 * then *searches* for the single straight line tangent to all of them. θ₂ is
 * the answer to that search.
 *
 * So these checks do two things. They hold the measured θ₂ against the closed
 * form the page is not allowed to use, over the whole plane of indices and
 * angles. And they check that the mechanism is really a mechanism: that the
 * answer does not depend on how finely the wavelets were sampled or when they
 * were looked at, that reversing the ray retraces it, that the same geometry
 * falls out of Fermat's least-time path, and that total internal reflection is
 * the envelope failing to exist rather than a branch in the code.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/refraction.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const txt = (id) => page.evaluate((i) => document.getElementById(i)?.textContent.trim(), id);

const E = 'const M = window.__refr; const D = (r) => r * 180 / Math.PI; const R = (d) => d * Math.PI / 180;';

// ── The law the page is not allowed to know ──────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    let wSin = 0, sinAt = '', wAng = 0, angAt = '', wGraze = 0;
    let n = 0, unclosed = 0, falseClose = 0;
    for (const n1 of [1.0, 1.2, 1.33, 1.52, 2.0, 2.42]) {
      for (const n2 of [1.0, 1.2, 1.33, 1.52, 2.0, 2.42]) {
        for (let deg = 0; deg <= 89; deg++) {
          const m = M.measure(n1, n2, R(deg));
          const s2 = (n1 / n2) * Math.sin(R(deg));
          if (s2 > 1) { if (!m.tir) falseClose++; continue; }
          if (m.tir) { unclosed++; continue; }
          n++;
          const dS = Math.abs(Math.sin(m.theta2) - s2);
          if (dS > wSin) { wSin = dS; sinAt = n1 + '→' + n2 + ' @ ' + deg + '°'; }
          const dA = Math.abs(m.theta2 - Math.asin(s2));
          if (Math.asin(s2) < R(89)) {
            if (dA > wAng) { wAng = dA; angAt = n1 + '→' + n2 + ' @ ' + deg + '°'; }
          } else if (dA > wGraze) { wGraze = dA; }
        }
      }
    }
    return { wSin, sinAt, wAng, angAt, wGraze, n, unclosed, falseClose };`));

  chk('sin θ₂ off the wavelet envelope is Snell’s sin θ₂ to machine precision',
      r.wSin < 1e-14 && r.n > 2500,
      `${r.n} geometries, worst |Δ sin θ₂| = ${r.wSin.toExponential(2)} at ${r.sinAt}`);
  // sin θ₂ is the well-conditioned reading here, and the angle follows it
  // everywhere except at grazing: as θ₂ → 90° the tangency condition flattens
  // quadratically, so the angle is only resolvable to about √ε. That is the
  // arithmetic running out, not the construction disagreeing — the invariant
  // above is still exact there.
  chk('and θ₂ itself to 1e-13 rad, up to the point where the envelope goes flat',
      r.wAng < 1e-13,
      `worst |Δθ₂| = ${r.wAng.toExponential(2)} rad at ${r.angAt} (θ₂ < 89°)`);
  chk('at grazing the angle softens to the √ε floor, and no further',
      r.wGraze > 1e-12 && r.wGraze < 1e-7,
      `worst |Δθ₂| = ${r.wGraze.toExponential(2)} rad, √ε ≈ 1.5e-8`);
  chk('the envelope closes exactly when a refracted ray should exist',
      r.unclosed === 0 && r.falseClose === 0,
      `${r.unclosed} failed to close below critical, ${r.falseClose} closed above it`);
}

// ── n₁ sinθ₁ = n₂ sinθ₂, both sides obtained separately ──────────────
{
  const r = await page.evaluate(new Function(`${E}
    return [[1, 1.52, 35], [1.33, 1, 30], [1, 1.33, 60], [2.42, 1, 20], [1.52, 2.42, 75]]
      .map(([n1, n2, deg]) => { const m = M.measure(n1, n2, R(deg));
        return { n1, n2, deg, a: m.snell1, b: m.snell2, t2: D(m.theta2) }; });`));
  const worst = Math.max(...r.map((x) => Math.abs(x.a - x.b)));
  chk('n₁·sin θ₁ and n₂·sin θ₂ agree to machine precision',
      worst < 1e-12,
      r.map((x) => `${x.n1}→${x.n2}@${x.deg}°: ${x.a.toFixed(9)} vs ${x.b.toFixed(9)}`).join(' | '));
}

// ── It has to be a construction, not a lookup ────────────────────────
{
  // If θ₂ were being read off a formula, changing how many wavelets are grown
  // and how long they are left to grow could not possibly matter. It doesn't —
  // but only because the tangent search really is finding the same line.
  const r = await page.evaluate(new Function(`${E}
    const out = [];
    for (const [n1, n2, deg] of [[1, 1.52, 40], [1.33, 1, 35], [1, 2.42, 80], [2.0, 1.33, 15]]) {
      const vals = [];
      for (const k of [4, 8, 24, 96]) for (const lead of [0.05, 0.35, 3.0]) {
        const w = M.wavelets(n1, n2, R(deg), k, lead);
        vals.push(M.envelope(w.xs, w.rs).theta2);
      }
      out.push({ n1, n2, deg, spread: Math.max(...vals) - Math.min(...vals), count: vals.length });
    }
    return out;`));
  chk('θ₂ does not depend on how many wavelets are grown, or for how long',
      r.every((x) => x.spread < 1e-12 && x.count === 12),
      r.map((x) => `${x.n1}→${x.n2}@${x.deg}°: ${x.spread.toExponential(1)}`).join(', '));

  const rev = await page.evaluate(new Function(`${E}
    return [[1, 1.52, 55], [1.33, 1, 30], [1, 2.42, 70], [1.52, 1.33, 20]].map(([n1, n2, deg]) => {
      const fwd = M.measure(n1, n2, R(deg)).theta2;
      const back = M.measure(n2, n1, fwd).theta2;
      return { n1, n2, deg, err: Math.abs(D(back) - deg) };
    });`));
  chk('send the ray back the other way and it retraces its own path',
      rev.every((x) => x.err < 1e-9),
      rev.map((x) => `${x.n1}→${x.n2}@${x.deg}°: ${x.err.toExponential(1)}°`).join(', '));
}

// ── Fermat: the same law down a different road ───────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    return [[1, 1.52, -4, 3, 5, 2], [1.33, 1, -6, 4, 3, 5],
            [1, 1.33, -2, 5, 8, 3], [1.5, 2.42, -7, 2, 2, 6]]
      .map(([n1, n2, ax, ay, bx, by]) => {
        const f = M.fermat(n1, n2, ax, ay, bx, by);
        const h = M.measure(n1, n2, f.theta1);
        return { n1, n2, dTheta: Math.abs(D(f.theta2) - D(h.theta2)),
                 snell: Math.abs(n1 * Math.sin(f.theta1) - n2 * Math.sin(f.theta2)),
                 t1: D(f.theta1), t2: D(f.theta2) };
      });`));
  chk('the least-time path bends by exactly the angle the wavelets picked',
      r.every((x) => x.dTheta < 1e-4),
      r.map((x) => `${x.n1}→${x.n2}: Δ=${x.dTheta.toExponential(1)}°`).join(', '));
  chk('and Fermat obeys Snell without having been told it either',
      r.every((x) => x.snell < 1e-6),
      r.map((x) => x.snell.toExponential(1)).join(', '));

  // Least time means least: perturbing the crossing point can only cost more.
  const worse = await page.evaluate(new Function(`${E}
    const n1 = 1, n2 = 1.52, ax = -4, ay = 3, bx = 5, by = 2;
    const f = M.fermat(n1, n2, ax, ay, bx, by);
    const T = (x) => n1 * Math.hypot(x - ax, ay) + n2 * Math.hypot(bx - x, by);
    const t0 = T(f.x);
    return [-1, -0.3, -0.05, 0.05, 0.3, 1].map((d) => T(f.x + d) - t0);`));
  chk('nudging the crossing point either way makes the trip take longer',
      worse.every((d) => d > 0), worse.map((d) => d.toExponential(1)).join(', '));
}

// ── Total internal reflection is the envelope failing ────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const crit = [[1.33, 1], [1.52, 1], [2.42, 1], [1.52, 1.33], [2.0, 1.5]].map(([n1, n2]) => {
      const meas = M.criticalMeasured(n1, n2);
      return { n1, n2, meas, truth: D(Math.asin(n2 / n1)) };
    });
    const none = [[1, 1.52], [1, 1.33], [1.33, 2.42]].map(([n1, n2]) =>
      ({ n1, n2, meas: M.criticalMeasured(n1, n2) }));
    // Past critical the leftover disagreement is exactly how far past you are.
    const res = [45, 60, 80].map((deg) => {
      const m = M.measure(1.52, 1, R(deg));
      return { deg, residual: m.residual, excess: (1.52 / 1) * Math.sin(R(deg)) - 1 };
    });
    return { crit, none, res };`));

  chk('the critical angle, bisected on "does the envelope still close?"',
      r.crit.every((x) => Math.abs(x.meas - x.truth) < 1e-3),
      r.crit.map((x) => `${x.n1}→${x.n2}: ${x.meas.toFixed(4)}° vs ${x.truth.toFixed(4)}°`).join(', '));
  chk('going into a denser medium there is no critical angle to find',
      r.none.every((x) => x.meas === null), JSON.stringify(r.none.map((x) => x.meas)));
  chk('past it, the leftover disagreement is (n₁/n₂)·sin θ₁ − 1',
      r.res.every((x) => Math.abs(x.residual - x.excess) < 1e-9),
      r.res.map((x) => `${x.deg}°: ${x.residual.toFixed(6)} vs ${x.excess.toFixed(6)}`).join(', '));

  // Either side of the critical angle, by one hundredth of a degree.
  const edge = await page.evaluate(new Function(`${E}
    const tc = M.criticalMeasured(1.52, 1);
    return { below: M.measure(1.52, 1, R(tc - 0.01)).tir, above: M.measure(1.52, 1, R(tc + 0.01)).tir,
             aboveR: M.measure(1.52, 1, R(tc + 0.01)).R, tc,
             // Reflectance on the run-up, at shrinking distances from critical.
             ramp: [2, 1, 0.5, 0.1, 0.01, 1e-3, 1e-4, 1e-5]
               .map((d) => M.measure(1.52, 1, R(tc - d)).R) };`));
  chk('a hundredth of a degree either side of critical flips it',
      edge.below === false && edge.above === true,
      `${edge.tc.toFixed(4)}°: below tir=${edge.below}, above tir=${edge.above}`);
  // R does not jump to 1 at the critical angle — it climbs to it through a
  // square-root cusp, so it is still only 89% a hundredth of a degree short and
  // needs another three decades to reach 99.6%.
  chk('reflectance climbs to 100% through a cusp, not a step',
      edge.ramp.every((v, i) => i === 0 || v > edge.ramp[i - 1])
      && edge.ramp[0] < 0.3 && edge.ramp[4] > 0.85 && edge.ramp[7] > 0.99
      && edge.ramp[7] < 1 && edge.aboveR === 1,
      edge.ramp.map((v) => (v * 100).toFixed(2) + '%').join(' → ') + ' → 100%');
}

// ── Physics you can state without the construction ───────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const denser = [10, 30, 50, 70, 89].map((deg) => {
      const m = M.measure(1, 1.52, R(deg)); return D(m.theta2) < deg; });
    const rarer = [5, 15, 25, 35].map((deg) => {
      const m = M.measure(1.52, 1, R(deg)); return D(m.theta2) > deg; });
    const straight = M.measure(1, 1.52, 0);
    const same = [10, 40, 75].map((deg) => Math.abs(D(M.measure(1.4, 1.4, R(deg)).theta2) - deg));
    const mono = [];
    let prev = -1, ok = true;
    for (let deg = 0; deg <= 89; deg++) { const t = M.measure(1, 1.33, R(deg)).theta2;
      if (t <= prev) ok = false; prev = t; }
    mono.push(ok);
    return { denser, rarer, straight: D(straight.theta2), same, mono: mono[0] };`));

  chk('into a denser medium the ray bends toward the normal', r.denser.every(Boolean));
  chk('into a rarer one it bends away', r.rarer.every(Boolean));
  chk('straight in, straight through', Math.abs(r.straight) < 1e-9, `${r.straight.toExponential(1)}°`);
  chk('matched indices do not bend it at all', r.same.every((d) => d < 1e-9),
      r.same.map((d) => d.toExponential(1)).join(', '));
  chk('θ₂ rises monotonically with θ₁, all the way to grazing', r.mono);

  const energy = await page.evaluate(new Function(`${E}
    return [[1, 1.52], [1.33, 1], [2.42, 1], [1, 1.33]].flatMap(([n1, n2]) =>
      [0, 20, 45, 70, 89].map((deg) => { const m = M.measure(n1, n2, R(deg));
        return m.R >= 0 && m.R <= 1; }));`));
  chk('reflectance stays a fraction everywhere on the plane', energy.every(Boolean));
}

// ── The live page ────────────────────────────────────────────────────
{
  await setV('angle', 35); await setV('n1', 1.0); await setV('n2', 1.52);
  await page.waitForTimeout(250);
  const live = await page.evaluate(() => {
    const m = window.__refr.read();
    return { t2: (m.theta2 * 180) / Math.PI, a: m.snell1, b: m.snell2 };
  });
  const shownT2 = await txt('out-theta2');
  chk('the readout shows the angle the search returned',
      Math.abs(parseFloat(shownT2) - live.t2) < 0.06, `${shownT2} vs ${live.t2.toFixed(3)}°`);
  const snell = await txt('out-snell');
  chk('and puts both measured sides of Snell’s law on screen side by side',
      /^0\.574 = 0\.574$/.test(snell), snell);

  await setV('n1', 1.52); await setV('n2', 1.0); await setV('angle', 60);
  await page.waitForTimeout(250);
  chk('past critical the refraction readout goes blank, because there is no ray',
      (await txt('out-theta2')) === '—' && (await txt('out-snell')) === '—');
  chk('and the reflected fraction reads 100%', (await txt('out-reflect')).startsWith('100'),
      await txt('out-reflect'));
  const tc = await txt('out-critical');
  chk('the measured critical angle is on screen', Math.abs(parseFloat(tc) - 41.1) < 0.15, tc);

  await setV('angle', 30);
  await page.waitForTimeout(250);
  chk('back below it, the ray returns', (await txt('out-theta2')) !== '—', await txt('out-theta2'));
}

// ── The wavelets are actually drawn ──────────────────────────────────
{
  await page.evaluate(() => window.__refr.setRunning(false));
  await setV('angle', 35); await setV('n1', 1.0); await setV('n2', 1.52);
  await page.waitForTimeout(200);

  const ink = () => page.evaluate(() => {
    const c = document.getElementById('stage');
    const g = c.getContext('2d');
    const d = g.getImageData(0, Math.floor(c.height * 0.52), c.width, Math.floor(c.height * 0.4)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) n++;
    return n;
  });
  const withWavelets = await ink();
  await page.$eval('#huygens', (el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const without = await ink();
  chk('turning the wavelets off visibly empties medium 2',
      withWavelets > without * 1.25 && without > 0, `${withWavelets} → ${without} lit pixels`);
  await page.$eval('#huygens', (el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  chk('and turning them back on restores them',
      Math.abs((await ink()) - withWavelets) < withWavelets * 0.05);
  await page.evaluate(() => window.__refr.setRunning(true));
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.evaluate(() => window.__refr.setRunning(false));
  // The signature deliberately leaves out the raw control values that a
  // control sets on itself — reading `huygens` back off `params()` would make
  // that entry pass whether or not the toggle does anything. What goes in is
  // what the reader would notice: the measured geometry, and the pixels.
  const sig = async () => {
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const M = window.__refr, m = M.read();
      const c = document.getElementById('stage');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4 * 97) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
      return JSON.stringify([m.tir, m.tir ? null : m.theta2.toFixed(9), m.R.toFixed(9),
        m.snell1.toFixed(9), h,
        document.getElementById('angle-value').textContent,
        document.getElementById('n1-value').textContent,
        document.getElementById('n2-value').textContent]);
    });
  };
  const dead = [];
  const acts = [
    ['angle', () => setV('angle', 42)],
    ['n1', () => setV('n1', 1.2)],
    ['n2', () => setV('n2', 1.9)],
    ['huygens', () => page.$eval('#huygens', (el) => {
      el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); })],
    ['preset waterAir', () => page.click('.mol-btn[data-key="waterAir"]')],
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

  const afterReset = await page.evaluate(() => window.__refr.params());
  chk('Reset really does restore the defaults',
      afterReset.theta1Deg === 35 && afterReset.n1 === 1 && afterReset.n2 === 1.52
      && afterReset.huygens === true, JSON.stringify(afterReset));

  // Choosing a preset must move the sliders, not just light up a button.
  await page.click('.mol-btn[data-key="diamond"]');
  await page.waitForTimeout(150);
  const dia = await page.evaluate(() => window.__refr.params());
  chk('a preset sets the indices it names', dia.n1 === 2.42 && dia.n2 === 1,
      `n₁=${dia.n1} n₂=${dia.n2}`);
  await page.click('#reset-btn');
  await page.evaluate(() => window.__refr.setRunning(true));
}

// ── Dragging the ray ─────────────────────────────────────────────────
{
  await page.waitForTimeout(150);
  const box = await page.$eval('#stage', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // A point up and to the left of the origin: about 45° from the normal.
  await page.mouse.move(box.x + box.w / 2 - 120, box.y + box.h / 2 - 120);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w / 2 - 120, box.y + box.h / 2 - 120, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await page.evaluate(() => window.__refr.params().theta1Deg);
  chk('dragging on the canvas sets the incidence angle to where you pointed',
      Math.abs(dragged - 45) < 2, `${dragged}°`);
  await page.click('#reset-btn');
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await lang(page, 'ko');
  const ko = await h1();
  await lang(page, 'zh');
  const zh = await h1();
  await lang(page, 'en');
  chk('title translates en/ko/zh and returns', en !== ko && ko !== zh && (await h1()) === en,
      `${en} / ${ko} / ${zh}`);

  const unresolved = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', unresolved.length === 0, unresolved.slice(0, 4).join(', '));

  chk('the page badges itself as measured and verified',
      await page.$('.method-tag[data-method="measured"]') !== null
      && await page.$('.method-verified') !== null);

  // The claim in the notes is a claim about this file. Hold it to it.
  const src = await page.evaluate(async (u) => (await fetch(u)).text(), url('experiments/refraction.js'));
  chk('the source really does not contain the closed form it disowns',
      !/asin\s*\(\s*\(?\s*(p\.)?n1\s*\/\s*(p\.)?n2/.test(src)
      && !/asin\s*\(\s*(p\.)?n2\s*\/\s*(p\.)?n1\s*\)/.test(src),
      'searched for asin(n1/n2·…) and asin(n2/n1)');

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(420);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('refraction');
