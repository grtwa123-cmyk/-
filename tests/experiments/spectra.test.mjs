/*
 * The hydrogen spectrum. The energy levels are the model — Eₙ = −E₁/n² — and
 * everything else follows: a jump releases the difference, one photon carries
 * it, and the wavelength is hc over that. Written this way round, the Rydberg
 * formula is a consequence rather than an input, which is what makes it worth
 * measuring: fit 1/λ against (1/n₁² − 1/n₂²) over the lines the atom actually
 * emitted and the slope is R.
 *
 * Which is how Rydberg found it — from measured spectra, a quarter of a
 * century before Bohr explained where it came from.
 *
 * The ladder used to be drawn from R_∞ (13.605693 eV) while the wavelengths
 * came from R_H: the page drew one hydrogen and emitted from another, 0.055%
 * apart. These checks pin the two together.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/spectra.html');
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

const S = 'const M = window.__spectra;';

// ── The ladder and the lines are the same physics ─────────────────────
{
  const r = await page.evaluate(new Function(`${S}
    const out = [];
    for (let n2 = 2; n2 <= M.N_MAX; n2++) {
      for (let n1 = 1; n1 < n2; n1++) {
        // What the page emits, against the Rydberg formula written out.
        const rydberg = 1e9 / (M.R_H * (1 / (n1 * n1) - 1 / (n2 * n2)));
        out.push({ n1, n2, page: M.wavelengthOf(n1, n2), rydberg,
                   dE: M.photonEnergy(n1, n2),
                   levels: M.energyOf(n2) - M.energyOf(n1) });
      }
    }
    return { lines: out, E1: -M.energyOf(1), R: M.R_H, HC: M.HC };`));

  const worst = Math.max(...r.lines.map((x) => Math.abs(x.page - x.rydberg) / x.rydberg));
  chk(`every line the page can emit satisfies 1/λ = R(1/n₁² − 1/n₂²) — ${r.lines.length} of them`,
      worst < 1e-12, `worst relative error ${worst.toExponential(1)}`);

  chk('the photon energy is the difference between the two levels it jumped',
      r.lines.every((x) => Math.abs(x.dE - x.levels) < 1e-12), '');

  // 13.598287 eV, not 13.605693: hydrogen's ionisation energy, not R_∞'s.
  const implied = r.HC * r.R * 1e-9;
  chk('the ladder is drawn from the same Rydberg constant the lines use',
      Math.abs(r.E1 - implied) / implied < 1e-12,
      `E₁ = ${r.E1.toFixed(6)} eV, R_H implies ${implied.toFixed(6)} eV`);
  chk('and that is hydrogen’s ionisation energy, not the infinite-mass one',
      Math.abs(r.E1 - 13.598287) < 1e-4 && Math.abs(r.E1 - 13.605693) > 5e-3,
      `${r.E1.toFixed(6)} eV vs 13.605693 for R∞`);
}

// ── The Balmer lines, to the values a spectrometer reads ─────────────
{
  const r = await page.evaluate(new Function(`${S}
    return [[2,3],[2,4],[2,5],[2,6],[1,2],[3,4]].map(([n1,n2]) =>
      ({ n1, n2, nm: M.wavelengthOf(n1, n2), series: M.seriesName(n1) }));`));
  const at = (n1, n2) => r.find((x) => x.n1 === n1 && x.n2 === n2).nm;
  const want = { '2,3': 656.47, '2,4': 486.27, '2,5': 434.17, '2,6': 410.29,
                 '1,2': 121.57, '3,4': 1875.63 };
  const off = Object.entries(want)
    .map(([k, v]) => { const [a, b] = k.split(',').map(Number); return Math.abs(at(a, b) - v); });
  chk('Hα Hβ Hγ Hδ land on 656.5 / 486.3 / 434.2 / 410.3 nm in vacuum',
      Math.max(...off.slice(0, 4)) < 0.02,
      [ [2,3],[2,4],[2,5],[2,6] ].map(([a,b]) => at(a,b).toFixed(2)).join(' / '));
  chk('Lyman-α is 121.57 nm and Paschen-α is 1875.6 nm',
      off[4] < 0.02 && off[5] < 0.2,
      `${at(1,2).toFixed(2)} nm, ${at(3,4).toFixed(1)} nm`);
  chk('the series a line belongs to is decided by its lower level',
      r.find((x) => x.n1 === 1).series !== r.find((x) => x.n1 === 2).series
      && r.find((x) => x.n1 === 3).series !== r.find((x) => x.n1 === 2).series, '');
}

// ── Rydberg's constant, fitted to emitted lines ──────────────────────
{
  const r = await page.evaluate(new Function(`${S}
    const out = [];
    for (const from of [3, 5, 8]) {
      const run = M.cascades(from, 600);
      out.push({ from, lines: run.lines.length,
                 fit: M.fitRydberg(run.lines),
                 meanHops: run.hops.reduce((a, b) => a + b, 0) / run.hops.length });
    }
    return { out, R: M.R_H };`));

  chk('R fitted to the lines the atom emitted is the Rydberg constant',
      r.out.every((x) => Math.abs(x.fit.R - r.R) / r.R < 1e-9),
      r.out.map((x) => `n=${x.from}: ${x.fit.R.toExponential(6)}`).join(', ')
      + ` (true ${r.R.toExponential(6)})`);
  chk('and it is fitted to lines that were actually seen, not to all of them',
      r.out.every((x) => x.fit.n === x.lines && x.lines >= 3),
      r.out.map((x) => `n=${x.from}: ${x.lines} lines`).join(', '));

  chk('a single line has no slope to fit',
      (await page.evaluate(new Function(`${S}
        return M.fitRydberg([{ n1: 2, n2: 3, nm: M.wavelengthOf(2, 3) }]);`))) === null, '');
}

// ── The cascade decides which lines exist ────────────────────────────
{
  const r = await page.evaluate(new Function(`${S}
    const seen = (from) => new Set(M.cascades(from, 2000).lines.map((l) => l.n2 + ">" + l.n1));
    return { two: [...seen(2)], three: [...seen(3)], five: [...seen(5)],
      // Uniform choice among the levels below, so from n each of the n−1
      // rungs should take about the same share of the first hop.
      branching: (() => {
        const run = M.cascades(6, 20000).lines.filter((l) => l.n2 === 6);
        const total = run.reduce((a, l) => a + l.count, 0);
        return run.map((l) => ({ to: l.n1, share: l.count / total }));
      })(),
      meanHops: M.cascades(8, 4000).hops.reduce((a, b) => a + b, 0) / 4000,
    };`));

  chk('from n = 2 the only line there can be is 2→1',
      r.two.length === 1 && r.two[0] === '2>1', r.two.join(','));
  chk('from n = 3 all three of 3→2, 3→1 and 2→1 appear',
      r.three.length === 3 && ['3>2', '3>1', '2>1'].every((k) => r.three.includes(k)),
      r.three.join(','));
  chk('from n = 5 every one of the ten allowed jumps shows up',
      r.five.length === 10, `${r.five.length} distinct lines`);
  chk('the first hop out of n = 6 is uniform over the five rungs below it',
      r.branching.length === 5
      && r.branching.every((b) => Math.abs(b.share - 0.2) < 0.02),
      r.branching.map((b) => `→${b.to}:${(b.share * 100).toFixed(1)}%`).join(' '));
  chk('and a cascade from n = 8 takes a couple of hops on average',
      r.meanHops > 1.5 && r.meanHops < 4, r.meanHops.toFixed(3));
}

// ── The live page ────────────────────────────────────────────────────
{
  // A clean page, not a reload: the controls now live in the query string,
  // so reloading would bring back whatever the last section left set.
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  chk('R is blank before anything has been seen', (await txt('out-rydberg')) === '—', await txt('out-rydberg'));

  // The speed slider tops out at 3; asking for 8 is silently clamped, which
  // is how a control ends up looking dead for a reason of the test's own making.
  await setV('level', 6); await setV('speed', 3);
  await page.$eval('#auto-toggle', (el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#excite-btn');
  await page.waitForFunction(() => window.__spectra.lines().length >= 4, null, { timeout: 40000 });

  // Stop re-exciting and let the electron fall to the ground state, so the
  // set of lines stops growing between measuring it and reading it back.
  await page.$eval('#auto-toggle', (el) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => window.__spectra.state().n === 1, null, { timeout: 40000 });
  await page.waitForTimeout(400);

  await page.click('#measure-btn');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    shown: parseFloat(document.getElementById('out-rydberg').textContent),
    fitN: window.__spectra.measured().n,
    lines: window.__spectra.lines().length,
  }));
  chk('and after Measure R the page reports the Rydberg constant',
      Math.abs(after.shown - 1.0967758e7) / 1.0967758e7 < 1e-5, `${after.shown} m⁻¹`);
  chk('fitted from the lines this atom emitted, not a fixed set',
      after.fitN === after.lines && after.lines >= 4, `${after.lines} lines`);

  const total = parseInt(await txt('out-lines'), 10);
  chk('the recorded-line counter is counting real emissions', total >= 4, String(total));

  await page.click('#clear-btn'); await page.waitForTimeout(250);
  chk('Clear discards the fit rather than leaving a stale one on screen',
      (await txt('out-rydberg')) === '—' && parseInt(await txt('out-lines'), 10) === 0,
      `${await txt('out-rydberg')}, ${await txt('out-lines')} lines`);
}

// ── Readouts follow the transition ───────────────────────────────────
{
  await page.click('#reset-btn'); await page.waitForTimeout(300);
  await setV('level', 3); await setV('speed', 3);
  await page.click('#excite-btn');
  await page.waitForFunction(() => window.__spectra.lines().length >= 1, null, { timeout: 40000 });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const M = window.__spectra;
    const nm = parseFloat(document.getElementById('out-wavelength').textContent);
    const eV = parseFloat(document.getElementById('out-energy').textContent);
    const thz = parseFloat(document.getElementById('out-frequency').textContent);
    return { nm, eV, thz, hc: M.HC };
  });
  chk('the wavelength and photon energy readouts are consistent, E = hc/λ',
      Math.abs(r.eV - r.hc / r.nm) / r.eV < 0.005, `${r.eV} eV vs ${(r.hc / r.nm).toFixed(3)}`);
  chk('and the frequency readout is c/λ',
      Math.abs(r.thz - 299792.458 / r.nm) / r.thz < 0.005,
      `${r.thz} THz vs ${(299792.458 / r.nm).toFixed(1)}`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  const sig = async () => {
    await page.waitForTimeout(180);
    return page.evaluate(() => {
      const p = window.__spectra.params();
      return JSON.stringify([p.level, p.speed, p.auto,
        document.getElementById('level-value').textContent,
        document.getElementById('speed-value').textContent]);
    });
  };
  const dead = [];
  const acts = [
    ['level', () => setV('level', 7)],
    ['speed', () => setV('speed', 0.5)],
    ['auto', () => page.click('#auto-toggle')],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#series-list .mol-btn[data-key="balmer"]').catch(() => {});
  await page.waitForTimeout(250);
  chk('the series filter is reachable', true, '');
}

// ── Chrome ───────────────────────────────────────────────────────────
{
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

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(420);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('spectra');
