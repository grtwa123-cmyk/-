/*
 * Generator. The page is given a field and a shape and no waveform: the bore
 * field points along the magnet and fades away from the axis, the flux through
 * a turn is a surface integral over the coil's face on a polar grid, and the
 * EMF is that flux differenced in time with Faraday's minus sign.
 *
 * So the sine wave has to be an output. These checks take it apart: that the
 * integral really is an integral (it converges at the order a midpoint rule
 * should), that the waveform carries no harmonic but the first, that it lags
 * the flux by exactly a quarter turn, that its sign always opposes the change
 * in flux, and that the peak scales the way the geometry — not the textbook
 * idealisation — says it should.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/generator.html');
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
const txt = (id) => page.evaluate((i) => document.getElementById(i)?.textContent.trim(), id);

const E = `const M = window.__gen;
  const P = (o) => ({ N: 4, B: 1, A: 1, flow: 0.6, ...o });
  const closed = (th, p) => { const a = Math.sqrt(p.A / Math.PI);
    const U = 1 + (a / M.RHO0) ** 2;
    return p.N * p.B * Math.cos(th) * 2 * Math.PI * M.RHO0 ** 2 * (1 - 1 / Math.sqrt(U)); };`;

// Keep the machine still while its internals are interrogated.
await page.evaluate(() => window.__gen.setRunning(false));

// ── The flux really is a surface integral ────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    let worst = 0, at = '';
    for (const N of [1, 4, 8]) for (const B of [0.3, 1, 1.8]) for (const A of [0.5, 1.0, 1.6])
      for (let d = 0; d < 360; d += 15) {
        const th = d * Math.PI / 180, p = P({ N, B, A });
        const rel = Math.abs(M.flux(th, p) - closed(th, p)) / Math.abs(closed(0, p));
        if (rel > worst) { worst = rel; at = 'N=' + N + ' B=' + B + ' A=' + A + ' @' + d + '°'; }
      }
    return { worst, at };`));
  chk('the summed flux lands on the integral it is approximating',
      r.worst < 2e-3, `worst relative error ${r.worst.toExponential(2)} at ${r.at}`);

  const conv = await page.evaluate(new Function(`${E}
    const p = P({ A: 1.4 }), th = 0.7, ref = closed(th, p);
    return [6, 12, 24, 48, 96].map((n) =>
      Math.abs(p.N * M.fluxTurn(th, p.B, p.A, n, 2 * n) - ref) / Math.abs(ref));`));
  const ratios = conv.slice(0, -1).map((e, i) => e / conv[i + 1]);
  chk('and halving the cell quarters the error — it is a real midpoint rule',
      ratios.every((x) => x > 3.7 && x < 4.3) && conv[conv.length - 1] < 1e-4,
      ratios.map((x) => x.toFixed(2)).join(', ') + ` (finest ${conv[conv.length - 1].toExponential(1)})`);
}

// ── The waveform ─────────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const p = P({ N: 4, B: 1.3, A: 0.8 }), w = 7.3, M2 = 512;
    const e = [], f = [];
    for (let k = 0; k < M2; k++) { const th = 2 * Math.PI * k / M2;
      e.push(M.emfAt(th, w, p)); f.push(M.flux(th, p)); }
    const comp = (sig, n) => { let re = 0, im = 0;
      for (let k = 0; k < M2; k++) { const a = 2 * Math.PI * n * k / M2;
        re += sig[k] * Math.cos(a); im += sig[k] * Math.sin(a); }
      return 2 / M2 * Math.hypot(re, im); };
    const h1 = comp(e, 1);
    const peak = Math.max(...e.map(Math.abs));
    const rms = Math.sqrt(e.reduce((s, v) => s + v * v, 0) / M2);
    const argmax = (s) => s.indexOf(Math.max(...s));
    return { harmonics: [0, 2, 3, 4, 5].map((n) => comp(e, n) / h1),
             peak, rms, mean: e.reduce((s, v) => s + v, 0) / M2,
             lag: ((argmax(e) - argmax(f) + M2) % M2) / M2 * 360,
             predicted: Math.abs(closed(0, p)) * w * M.VOLT_SCALE };`));

  chk('the induced EMF is a pure sinusoid — no harmonic but the first',
      Math.max(...r.harmonics) < 1e-9,
      'harmonics 0,2,3,4,5 at ' + r.harmonics.map((h) => h.toExponential(1)).join(', '));
  chk('its peak is ω times the peak flux, which is what differentiating a cosine gives',
      Math.abs(r.peak - r.predicted) / r.peak < 2e-3,
      `${r.peak.toFixed(6)} vs ${r.predicted.toFixed(6)}`);
  chk('rms is peak/√2, to nine figures',
      Math.abs(r.rms / r.peak - 1 / Math.SQRT2) < 1e-9,
      `${(r.rms / r.peak).toFixed(9)} vs ${(1 / Math.SQRT2).toFixed(9)}`);
  chk('and it averages to nothing over a whole turn — the output is alternating',
      Math.abs(r.mean) / r.peak < 1e-12, r.mean.toExponential(2));
  chk('the EMF lags the flux by exactly a quarter turn',
      Math.abs(r.lag - 90) < 1e-9, `${r.lag.toFixed(6)}°`);
}

// ── Lenz's sign ──────────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const p = P({ N: 3, B: 0.7, A: 1.5 }), w = 5.1, h = 1e-3;
    let same = 0, n = 0, minRatio = Infinity;
    for (let d = 0; d < 360; d += 3) {
      const th = d * Math.PI / 180;
      const dPhi = (M.flux(th + w * h, p) - M.flux(th - w * h, p)) / (2 * h);
      const e = M.emfAt(th, w, p);
      if (Math.abs(dPhi) < 1e-9) continue;
      n++; if (e * dPhi > 0) same++;
      minRatio = Math.min(minRatio, -e / (dPhi * M.VOLT_SCALE));
    }
    return { same, n, minRatio };`));
  chk('the EMF always opposes the change in flux — Lenz, in every sample',
      r.same === 0 && r.n > 100, `${r.n} samples, ${r.same} with the wrong sign`);
  chk('and it is exactly minus that rate, not merely the other way round',
      Math.abs(r.minRatio - 1) < 1e-5, `−EMF/(dΦ/dt) ≥ ${r.minRatio.toFixed(9)}`);
}

// ── The scalings, measured by sweeping ───────────────────────────────
{
  const r = await page.evaluate(new Function(`${E}
    const fit = (xs, ys) => { const lx = xs.map(Math.log), ly = ys.map(Math.log);
      const mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
      let num = 0, den = 0;
      for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
      return num / den; };
    const Ns = [1, 2, 3, 4, 5, 6, 7, 8];
    const Bs = [0.3, 0.6, 1, 1.4, 1.8];
    const ws = [1, 2, 4, 8, 12];
    const As = [0.5, 0.7, 0.9, 1.1, 1.35, 1.6];
    const pkA = As.map((A) => M.peakOf(6, P({ A })));
    return { n: fit(Ns, Ns.map((N) => M.peakOf(6, P({ N })))),
             b: fit(Bs, Bs.map((B) => M.peakOf(6, P({ B })))),
             w: fit(ws, ws.map((w) => M.peakOf(w, P({})))),
             a: fit(As, pkA),
             wide: M.peakOf(6, P({ A: 1.6 })) / M.peakOf(6, P({ A: 0.5 })),
             areaRatio: 1.6 / 0.5 };`));

  chk('peak EMF is exactly linear in the number of turns', Math.abs(r.n - 1) < 1e-9, `N^${r.n.toFixed(9)}`);
  chk('exactly linear in the magnet strength', Math.abs(r.b - 1) < 1e-9, `B^${r.b.toFixed(9)}`);
  chk('exactly linear in the spin rate', Math.abs(r.w - 1) < 1e-6, `ω^${r.w.toFixed(9)}`);
  // The textbook Phi = NBA cos(th) would make this 1 as well. It is not 1,
  // because a wider loop reaches into field that has already fallen off — and
  // the page says the measured number rather than the idealised one.
  chk('but sub-linear in the area, because a wider loop reaches into weaker field',
      r.a > 0.45 && r.a < 0.7, `A^${r.a.toFixed(4)} — not the 1.0 that a uniform field would give`);
  chk('so 3.2× the area buys well under 3.2× the EMF',
      r.wide < r.areaRatio * 0.75 && r.wide > 1,
      `${r.areaRatio.toFixed(2)}× area → ${r.wide.toFixed(3)}× EMF`);
}

// ── A still magnet induces nothing ───────────────────────────────────
{
  const worst = await page.evaluate(new Function(`${E}
    let w = 0;
    for (const N of [1, 8]) for (const B of [0.3, 1.8]) for (const A of [0.5, 1.6])
      for (let d = 0; d < 360; d += 11)
        w = Math.max(w, Math.abs(M.emfAt(d * Math.PI / 180, 0, P({ N, B, A }))));
    return w;`));
  chk('with the wheel stopped the EMF is exactly zero, at every angle',
      worst === 0, worst.toExponential(2));
}

// ── Flipping the poles ───────────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const M = window.__gen, p = M.params();
    const before = { phi: M.flux(0.8, p), e: M.emfAt(0.8, 5, p) };
    document.getElementById('flip-btn').click();
    const after = { phi: M.flux(0.8, p), e: M.emfAt(0.8, 5, p) };
    document.getElementById('flip-btn').click();
    const back = { phi: M.flux(0.8, p), e: M.emfAt(0.8, 5, p) };
    return { before, after, back };
  });
  chk('flipping the poles turns the flux and the EMF over, exactly',
      Math.abs(r.after.phi + r.before.phi) < 1e-12 && Math.abs(r.after.e + r.before.e) < 1e-12
      && Math.abs(r.back.phi - r.before.phi) < 1e-12,
      `Φ ${r.before.phi.toFixed(4)} → ${r.after.phi.toFixed(4)} → ${r.back.phi.toFixed(4)}`);
}

// ── The wheel is an ODE, not a lookup ────────────────────────────────
{
  await page.evaluate(() => { document.getElementById('reset-btn').click(); });
  const r = await page.evaluate(new Function(`${E}
    const out = [];
    for (const flowPct of [20, 60, 100]) {
      document.getElementById('reset-btn').click();
      const el = document.getElementById('flow');
      el.value = String(flowPct); el.dispatchEvent(new Event('input', { bubbles: true }));
      const s = M.run(30, 1 / 480);
      out.push({ flowPct, omega: s.omega,
                 steady: M.WHEEL_TORQUE * (flowPct / 100) / M.WHEEL_DAMP });
    }
    return out;`));
  chk('the wheel spins up to the speed the faucet sets — τ/b, never written down',
      r.every((x) => Math.abs(x.omega - x.steady) / Math.max(x.steady, 1e-9) < 1e-6),
      r.map((x) => `${x.flowPct}%: ${x.omega.toFixed(6)} vs ${x.steady.toFixed(6)}`).join(', '));

  const spin = await page.evaluate(new Function(`${E}
    document.getElementById('reset-btn').click();
    const el = document.getElementById('flow');
    el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const steady = M.WHEEL_TORQUE / M.WHEEL_DAMP;
    const tau = M.WHEEL_INERTIA / M.WHEEL_DAMP;      // the time constant
    const at = [];
    for (const mult of [1, 2, 3]) {
      document.getElementById('reset-btn').click();
      el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true }));
      at.push(M.run(tau * mult, 1 / 4000).omega / steady);
    }
    return { at, want: [1, 2, 3].map((m) => 1 - Math.exp(-m)) };`));
  chk('and it gets there exponentially, 1 − e^−t/τ at one, two and three τ',
      spin.at.every((v, i) => Math.abs(v - spin.want[i]) < 2e-3),
      spin.at.map((v, i) => `${v.toFixed(5)} vs ${spin.want[i].toFixed(5)}`).join(', '));
}

// ── Faraday's law off the machine's own record ───────────────────────
{
  await page.evaluate(() => {
    document.getElementById('reset-btn').click();
    window.__gen.setRunning(false);
  });
  const r = await page.evaluate(new Function(`${E}
    M.run(6, 1 / 400);                       // let it reach a steady spin
    const tr = M.trace();
    // Differentiate the logged flux and hold it against the logged EMF.
    let worst = 0, n = 0;
    for (let i = 1; i < tr.length - 1; i++) {
      const dt = tr[i + 1].t - tr[i - 1].t;
      const dPhi = (tr[i + 1].phi - tr[i - 1].phi) / dt;
      const fromTrace = -dPhi * M.VOLT_SCALE;
      const scale = Math.max(...tr.map((s) => Math.abs(s.e)));
      worst = Math.max(worst, Math.abs(fromTrace - tr[i].e) / scale);
      n++;
    }
    return { worst, n, samples: tr.length };`));
  chk('differentiating the logged flux reproduces the logged EMF',
      r.worst < 5e-4 && r.n > 100,
      `${r.n} samples, worst disagreement ${(r.worst * 100).toFixed(4)}% of peak`);
}

// ── The live page ────────────────────────────────────────────────────
{
  await page.evaluate(() => {
    document.getElementById('reset-btn').click();
    window.__gen.setRunning(true);
  });
  // Wait for the wheel to reach its steady spin, and then for a whole further
  // turn, so the window the peak is measured over is not part spin-up. The
  // recorded peak is the largest of ~55 samples per turn, so it sits a hair
  // under the true crest — the gap is the sampling, not a disagreement.
  await page.waitForFunction(() => {
    const M = window.__gen;
    return M.state().omega > 0.9999 * (M.WHEEL_TORQUE * M.params().flow) / M.WHEEL_DAMP;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const live = await page.evaluate(() => {
    const M = window.__gen, s = M.state(), p = M.params();
    return { s, predicted: M.peakOf(s.omega, p) };
  });
  chk('the peak the machine reports is the peak it actually produced',
      live.s.peak <= live.predicted
      && (live.predicted - live.s.peak) / live.predicted < 0.01,
      `${live.s.peak.toFixed(4)} recorded vs ${live.predicted.toFixed(4)} scanned ` +
      `(${((1 - live.s.peak / live.predicted) * 100).toFixed(3)}% low, the sampling gap)`);

  const shownPeak = parseFloat(await txt('out-peak'));
  chk('and that is the number on screen', Math.abs(shownPeak - live.s.peak) < 0.02,
      `${shownPeak} V`);

  // Both readouts in one round trip — the machine is still turning, and two
  // separate reads would be two different instants. The trace figure belongs
  // to half a frame ago, so the two can differ by at most about half a frame's
  // worth of slew; that bound is computed from the run's own frame spacing
  // rather than picked.
  const pair = await page.evaluate(() => {
    const M = window.__gen, tr = M.trace(), n = tr.length;
    return {
      shown: parseFloat(document.getElementById('out-faraday').textContent),
      live: parseFloat(document.getElementById('out-emf').textContent),
      fromTrace: M.state().faradayFromTrace,
      peak: M.state().peak,
      omega: M.state().omega,
      dt: tr[n - 1].t - tr[n - 2].t,
    };
  });
  const slew = pair.peak * pair.omega * (pair.dt / 2) * 1.6 + 0.02;
  chk('−dΦ/dt taken off the trace agrees with the EMF beside it',
      Math.abs(pair.shown - pair.live) < slew,
      `${pair.shown} V from the trace vs ${pair.live} V live ` +
      `(half a frame of slew is ${slew.toFixed(3)} V at ${(pair.dt * 1000).toFixed(1)} ms/frame)`);
  chk('and the readout is showing what the trace derivative actually says',
      Math.abs(pair.shown - pair.fromTrace) < 0.005,
      `${pair.shown} vs ${pair.fromTrace.toFixed(4)}`);

  const rpm = parseFloat(await txt('out-rpm'));
  chk('the rotation readout is the wheel speed in rpm',
      Math.abs(rpm - (live.s.omega * 60) / (2 * Math.PI)) < 2,
      `${rpm} rpm at ω = ${live.s.omega.toFixed(3)}`);

  // Close the faucet and the machine must coast down and go quiet.
  await setV('flow', 0);
  await page.waitForFunction(() => window.__gen.state().omega < 0.05, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  chk('closing the faucet stops the wheel and the voltage with it',
      Math.abs(parseFloat(await txt('out-emf'))) < 0.02, await txt('out-emf'));
  await setV('flow', 60);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.evaluate(() => {
    document.getElementById('reset-btn').click();
    window.__gen.setRunning(false);
    window.__gen.setOmega(6);
  });
  // The signature is what a reader would notice: the physics at a fixed angle,
  // and the pixels. Reading a control's own value back would make its entry
  // pass whether or not anything downstream moved.
  const sig = async () => {
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const M = window.__gen, p = M.params();
      const c = document.getElementById('stage'), g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4 * 101) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
      return JSON.stringify([M.flux(0.7, p).toFixed(9), M.emfAt(0.7, 6, p).toFixed(9), h,
        document.getElementById('flow-value').textContent,
        document.getElementById('loops-value').textContent,
        document.getElementById('area-value').textContent,
        document.getElementById('strength-value').textContent]);
    });
  };
  const dead = [];
  const acts = [
    ['flow', () => setV('flow', 35)],
    ['loops', () => setV('loops', 7)],
    ['area', () => setV('area', 1.5)],
    ['strength', () => setV('strength', 1.7)],
    ['flip', () => page.click('#flip-btn')],
    ['meter voltmeter', () => page.click('.mol-btn[data-key="volt"]')],
    ['field toggle', () => page.$eval('#field-toggle', (el) => {
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

  const afterReset = await page.evaluate(() => ({ ...window.__gen.params(), ...window.__gen.state() }));
  chk('Reset restores every default, including the meter and the field',
      afterReset.flow === 0.6 && afterReset.N === 4 && afterReset.A === 1
      && afterReset.B === 1 && afterReset.pole === 1 && afterReset.meter === 'bulb'
      && afterReset.showField === true && afterReset.omega === 0,
      JSON.stringify({ flow: afterReset.flow, N: afterReset.N, meter: afterReset.meter,
                       omega: afterReset.omega }));
  await page.evaluate(() => window.__gen.setRunning(true));
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

  // The page claims the waveform is an output. Hold it to that. A sine does
  // appear in the file — the field direction is (cos θ, sin θ), and that is an
  // input — but it must not appear anywhere on the path that produces the
  // voltage. Slice out the flux and Faraday functions and check.
  const src = await page.evaluate(async (u) => (await fetch(u)).text(), url('experiments/generator.js'));
  const a = src.indexOf('function fluxTurn');
  const b = src.indexOf('const fluxNow');
  const path = src.slice(a, b);
  chk('the flux and Faraday functions were found in the source',
      a > 0 && b > a && /emfAt/.test(path) && /flux/.test(path), `${b - a} chars`);
  chk('and nothing on the path from field to voltage evaluates a sine',
      !/Math\.sin/.test(path),
      'fluxTurn → flux → emfAt contains no Math.sin');
  chk('nor does anything in the file multiply the spin rate by one',
      !/\b(omega|w)\s*\*[^\n;]*Math\.sin/.test(src) && !/Math\.sin[^\n;]*\*\s*\b(omega|w)\b/.test(src),
      'searched for ω·sin(…) and sin(…)·ω');

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(420);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('generator');
