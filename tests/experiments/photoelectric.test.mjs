/*
 * The photoelectric effect. Nothing on the page is handed KE_max: each photon
 * frees one electron, which pays the work function and gives up a random share
 * of the rest on the way out, so the population fills [0, hf − φ] without that
 * ceiling ever being written down. The current is counted, so the stopping
 * voltage — the voltage at which the count first reads zero — is a measurement
 * of the ceiling.
 *
 * Which makes the headline claim checkable rather than decorative. Measure the
 * stopping voltage across a spread of wavelengths, fit the line, and the slope
 * has to come out as Planck's constant. These checks hold it to that, and to
 * the three things a wave picture of light cannot produce.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';

const B = url('experiments/photoelectric.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
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

const P = 'const M = window.__pe;';

// ── No electron ever carries more than hf − φ ─────────────────────────
{
  const r = await page.evaluate(new Function(`${P}
    const out = [];
    for (const [m, { phi }] of Object.entries(M.METALS)) {
      for (const nm of [200, 300, 450]) {
        const ceiling = M.photonEnergy(nm) - phi;
        if (ceiling <= 0) continue;
        let hi = -Infinity, lo = Infinity, n = 0;
        for (let i = 0; i < 40000; i++) {
          const ke = M.emitOne(nm, phi);
          if (ke < 0) continue;
          hi = Math.max(hi, ke); lo = Math.min(lo, ke); n++;
        }
        out.push({ m, nm, ceiling, hi, lo, n });
      }
    }
    return out;`));
  chk('no electron ever leaves with more than hf − φ',
      r.every((x) => x.hi <= x.ceiling + 1e-12),
      `worst overshoot ${Math.max(...r.map((x) => x.hi - x.ceiling)).toExponential(1)} eV`);
  chk('and the fastest of forty thousand gets within 0.1% of it',
      r.every((x) => x.hi > x.ceiling * 0.999),
      `worst shortfall ${(Math.max(...r.map((x) => 1 - x.hi / x.ceiling)) * 100).toFixed(4)}%`);
  chk('the distribution reaches down to zero as well',
      r.every((x) => x.lo < x.ceiling * 0.01), `worst floor ${Math.max(...r.map((x) => x.lo / x.ceiling)).toExponential(1)}`);
}

// ── The stopping voltage is measured, and it measures the ceiling ─────
{
  const r = await page.evaluate(new Function(`${P}
    const out = [];
    for (const [m, { phi }] of Object.entries(M.METALS)) {
      for (const nm of [220, 300, 400]) {
        const ceiling = M.photonEnergy(nm) - phi;
        if (ceiling <= 0.05) continue;
        out.push({ m, nm, ceiling, vs: M.stoppingVoltage(nm, phi) });
      }
    }
    return out;`));
  const err = r.map((x) => Math.abs(x.vs - x.ceiling) / x.ceiling);
  chk(`the counted stopping voltage lands on hf − φ — ${r.length} metal/wavelength pairs`,
      Math.max(...err) < 0.002,
      `worst ${(Math.max(...err) * 100).toFixed(4)}%`);
  chk('every one of them is positive and finite',
      r.every((x) => x.vs > 0 && Number.isFinite(x.vs)), '');
}

// ── Millikan: h out of counted electrons ─────────────────────────────
{
  const r = await page.evaluate(new Function(`${P}
    return Object.entries(M.METALS).map(([m, { phi }]) => {
      const run = M.measurePlanck(phi);
      return { m, phi, h: run.fit.h, phiFit: run.fit.phi, f0: run.fit.f0, n: run.pts.length };
    });`));
  const H = await page.evaluate(() => window.__pe.H_PLANCK);

  chk(`the slope fitted to the measured points is Planck's constant — ${r.length} metals`,
      r.every((x) => Math.abs(x.h - H) / H < 0.002),
      r.map((x) => `${x.m} ${x.h.toExponential(4)}`).join(', ')
      + ` (true ${H.toExponential(4)})`);
  chk('and the intercept is the work function that was put in',
      r.every((x) => Math.abs(x.phiFit - x.phi) < 0.01),
      r.map((x) => `${x.m} ${x.phiFit.toFixed(3)}/${x.phi}`).join(', '));
  chk('the threshold frequency follows from the same fit, f₀ = φ/h',
      r.every((x) => Math.abs(x.f0 - x.phi / H) / (x.phi / H) < 0.005),
      r.map((x) => `${x.m} ${(x.f0 / 1e14).toFixed(2)}e14`).join(', '));
  chk('each fit used at least eight measured points',
      r.every((x) => x.n >= 8), r.map((x) => x.n).join(','));
}

// ── The three things a wave picture cannot do ────────────────────────
{
  const r = await page.evaluate(new Function(`${P}
    const phi = M.METALS.Pt.phi;             // 6.35 eV → threshold near 195 nm
    const lam0 = M.thresholdNm(phi);
    const below = [lam0 * 1.5, lam0 * 1.1, lam0 * 1.001];
    const above = [lam0 * 0.999, lam0 * 0.9, lam0 * 0.6];
    return {
      lam0,
      below: below.map((nm) => ({ nm, arrivals: M.arrivals(nm, phi, 0, 20000), vs: M.stoppingVoltage(nm, phi) })),
      above: above.map((nm) => ({ nm, arrivals: M.arrivals(nm, phi, 0, 20000), vs: M.stoppingVoltage(nm, phi) })),
      // Intensity is a separate multiplier on the count, so the ceiling
      // cannot depend on it. Measure it at three intensities to be sure.
      ceilings: [0.1, 0.5, 1].map(() => M.stoppingVoltage(300, M.METALS.Na.phi)),
      counts: [0.1, 0.5, 1].map((I) => M.arrivals(300, M.METALS.Na.phi, -0.5, 40000) * I),
    };`));

  chk('below the threshold nothing is emitted, however long you look',
      r.below.every((x) => x.arrivals === 0 && x.vs === 0),
      r.below.map((x) => `${x.nm.toFixed(0)}nm:${x.arrivals}`).join(' '));
  chk('a hair above it, electrons appear at once',
      r.above.every((x) => x.arrivals > 0.99 && x.vs > 0),
      r.above.map((x) => `${x.nm.toFixed(0)}nm:${x.vs.toFixed(3)}V`).join(' '));
  chk('brightness changes how many arrive, never how fast',
      Math.max(...r.ceilings) - Math.min(...r.ceilings) < 1e-3
      && r.counts[2] > r.counts[0] * 5,
      `ceilings ${r.ceilings.map((v) => v.toFixed(4)).join('/')}, `
      + `counts ${r.counts.map((v) => v.toFixed(3)).join('/')}`);
}

// ── The retarding voltage does what it claims ────────────────────────
{
  const r = await page.evaluate(new Function(`${P}
    const phi = M.METALS.Na.phi, nm = 300;
    const vs = M.stoppingVoltage(nm, phi);
    return {
      vs,
      curve: [0, -0.25, -0.5, -0.75, -1].map((frac) =>
        ({ V: frac * vs, f: M.arrivals(nm, phi, frac * vs, 40000) })),
      justPast: M.arrivals(nm, phi, -vs * 1.001, 40000),
      forward: M.arrivals(nm, phi, 2, 40000),
    };`));
  chk('the counted current falls monotonically as the collector is made negative',
      r.curve.every((x, i, a) => i === 0 || x.f <= a[i - 1].f),
      r.curve.map((x) => x.f.toFixed(3)).join(' → '));
  chk('it is zero at the stopping voltage and nothing gets past it',
      r.justPast === 0, String(r.justPast));
  chk('a positive collector collects everything',
      r.forward === 1, String(r.forward));
  // Uniform losses put the count halfway at half the stopping voltage; the
  // shape is schematic, but it has to be the shape the model actually has.
  chk('and halfway back, half of them are still getting through',
      Math.abs(r.curve[2].f - 0.5) < 0.02, r.curve[2].f.toFixed(4));
}

// ── The live page ────────────────────────────────────────────────────
{
  // A clean page, not a reload: the controls now live in the query string,
  // so reloading would bring back whatever the last section left set.
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  await setV('wavelength', 300); await setV('intensity', 60); await setV('voltage', 0);
  await page.waitForTimeout(400);

  const shown = parseFloat(await txt('out-stopping'));
  const truth = await page.evaluate(() => {
    const M = window.__pe, p = M.params();
    return M.photonEnergy(p.nm) - p.phi;
  });
  chk('the stopping-voltage readout is the measured one, and it matches hf − φ',
      Math.abs(shown - truth) / truth < 0.01, `${shown} V vs ${truth.toFixed(3)} eV`);

  chk('h is blank until it has been measured', (await txt('out-planck')) === '—', await txt('out-planck'));
  await page.click('#measure-btn');
  await page.waitForFunction(() => document.getElementById('out-planck').textContent.trim() !== '—',
    null, { timeout: 40000 });

  const hShown = parseFloat(await txt('out-planck'));
  const phiShown = parseFloat(await txt('out-phi-fit'));
  chk('and after Measure h the page reports Planck’s constant',
      Math.abs(hShown - 4.135667696e-15) / 4.135667696e-15 < 0.002, `${hShown} eV·s`);
  chk('and the work function it fitted alongside it',
      Math.abs(phiShown - 2.28) < 0.02, `${phiShown} eV vs 2.28 for sodium`);

  const pts = await page.evaluate(() => window.__pe.points().length);
  chk('the measured points are on the graph', pts >= 8, String(pts));

  // Choosing a metal leaves the previous fit on screen, so something has to be
  // waited for. It must not be "the text is no longer 2.280": the sodium fit
  // is a measurement and lands on 2.279 or 2.281 about as often, in which case
  // that condition is already true and nothing is waited for at all — the
  // check then reads sodium's answer and calls it platinum's. Clear the fit
  // and wait for a new one to appear instead.
  await page.click('#metal-list .mol-btn[data-key="Pt"]');
  await page.waitForTimeout(300);
  await page.click('#clear-btn');
  await page.waitForFunction(() => document.getElementById('out-phi-fit').textContent.trim() === '—',
    null, { timeout: 10000 });
  await page.click('#measure-btn');
  await page.waitForFunction(() => document.getElementById('out-phi-fit').textContent.trim() !== '—',
    null, { timeout: 40000 });
  chk('changing the metal and measuring again recovers its work function',
      Math.abs(parseFloat(await txt('out-phi-fit')) - 6.35) < 0.02, await txt('out-phi-fit'));

  await page.click('#clear-btn'); await page.waitForTimeout(250);
  chk('Clear discards the fit rather than leaving a stale one on screen',
      (await txt('out-planck')) === '—', await txt('out-planck'));
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.click('#reset-btn'); await page.waitForTimeout(300);
  const sig = async () => {
    await page.waitForTimeout(160);
    return page.evaluate(() => {
      const M = window.__pe, p = M.params();
      return JSON.stringify([p.nm, p.I, p.V, p.phi,
        document.getElementById('out-photon').textContent,
        document.getElementById('out-threshold').textContent]);
    });
  };
  const dead = [];
  const acts = [
    ['wavelength', () => setV('wavelength', 260)],
    ['intensity', () => setV('intensity', 20)],
    ['voltage', () => setV('voltage', -1.2)],
    ['metal', () => page.click('#metal-list .mol-btn[data-key="Zn"]')],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));
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

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(420);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('photoelectric');
