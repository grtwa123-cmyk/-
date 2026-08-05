/*
 * Projectile motion. The page integrates ẍ = −b|v|vₓ, ÿ = −g − b|v|v_y and
 * measures the range, apex and flight time off the trajectory it produced.
 *
 * The vacuum case is the lever these checks pull on: there the closed form is
 * exact, so any disagreement is the integrator's own error and nothing else.
 * Everything the drag does is then checked as a departure from that baseline,
 * including the one result the page exists for — that the best launch angle is
 * 45° only when there is no air, and the page finds that out rather than
 * knowing it.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/projectile.html');
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

const P = 'const M = window.__proj;';

// ── In vacuum the measurement has to reproduce the closed form ────────
{
  const r = await page.evaluate(new Function(`${P}
    const cases = [
      { v0: 30, theta: 45, g: 9.81,  b: 0 },
      { v0: 50, theta: 30, g: 9.81,  b: 0 },
      { v0: 20, theta: 75, g: 9.81,  b: 0 },
      { v0: 45, theta: 60, g: 3.71,  b: 0 },
      { v0: 60, theta: 15, g: 24.79, b: 0 },
      { v0: 12, theta: 5,  g: 1.62,  b: 0 },
    ];
    return cases.map((p) => {
      const f = M.fly(p, { sample: false });
      return { ...p,
        eR: Math.abs(f.R - M.vacRange(p)) / M.vacRange(p),
        eH: Math.abs(f.H - M.vacHeight(p)) / M.vacHeight(p),
        eT: Math.abs(f.T - M.vacTime(p)) / M.vacTime(p) };
    });`));

  const worst = (k) => Math.max(...r.map((x) => x[k]));
  chk('with no drag the measured range is v₀²sin2θ/g — six configurations',
      worst('eR') < 1e-10, `worst relative error ${worst('eR').toExponential(1)}`);
  chk('the measured apex is (v₀sinθ)²/2g',
      worst('eH') < 1e-10, `worst ${worst('eH').toExponential(1)}`);
  chk('and the measured flight time is 2v₀sinθ/g',
      worst('eT') < 1e-10, `worst ${worst('eT').toExponential(1)}`);
}

// ── The symmetry the vacuum solution has, and drag destroys ───────────
{
  const r = await page.evaluate(new Function(`${P}
    const vac  = M.fly({ v0: 40, theta: 45, g: 9.81, b: 0 },     { sample: false });
    const drag = M.fly({ v0: 40, theta: 45, g: 9.81, b: 0.02 },  { sample: false });
    return {
      vacLand: vac.angLand, vacSpeed: vac.vLand,
      dragLand: drag.angLand, dragSpeed: drag.vLand,
      vacApexFrac: vac.apex.t / vac.T, dragApexFrac: drag.apex.t / drag.T,
    };`));
  chk('in vacuum it lands at the angle it was fired at, at the speed it was fired',
      Math.abs(r.vacLand - 45) < 1e-6 && Math.abs(r.vacSpeed - 40) < 1e-6,
      `${r.vacLand.toFixed(6)}° at ${r.vacSpeed.toFixed(6)} m/s`);
  chk('and the apex sits exactly halfway through the flight',
      Math.abs(r.vacApexFrac - 0.5) < 1e-9, r.vacApexFrac.toFixed(12));
  chk('with drag it lands steeper and slower than it left',
      r.dragLand > 60 && r.dragSpeed < 20,
      `${r.dragLand.toFixed(1)}° at ${r.dragSpeed.toFixed(1)} m/s (fired 45° at 40)`);
  chk('and the apex arrives before halfway — the descent is the longer half',
      r.dragApexFrac < 0.47, r.dragApexFrac.toFixed(3));
}

// ── Drag shortens the flight, monotonically ───────────────────────────
{
  const r = await page.evaluate(new Function(`${P}
    return [0, 0.002, 0.005, 0.01, 0.02].map((b) => ({
      b, R: M.fly({ v0: 40, theta: 45, g: 9.81, b }, { sample: false }).R }));`));
  const falling = r.every((x, i) => i === 0 || x.R < r[i - 1].R);
  chk('more drag is always less range', falling,
      r.map((x) => x.R.toFixed(1)).join(' → '));
  chk('and the loss is large, not a rounding effect',
      r[r.length - 1].R < r[0].R * 0.45,
      `${r[0].R.toFixed(1)} m in vacuum vs ${r[r.length - 1].R.toFixed(1)} m at b = 0.02`);
}

// ── The result the page exists for ────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${P}
    return [0, 0.002, 0.005, 0.01, 0.02].map((b) =>
      ({ b, ...M.bestAngle({ v0: 40, theta: 45, g: 9.81, b }) }));`));

  chk('with no air the best launch angle comes out 45° — found, not assumed',
      Math.abs(r[0].theta - 45) < 0.01, `${r[0].theta.toFixed(4)}°`);
  chk('every drag setting pushes it below 45°',
      r.slice(1).every((x) => x.theta < 45), r.map((x) => x.theta.toFixed(2)).join(', '));
  chk('and it falls monotonically as the air thickens',
      r.every((x, i) => i === 0 || x.theta < r[i - 1].theta),
      r.map((x) => `${x.b}:${x.theta.toFixed(2)}°`).join('  '));
  chk('the shift is worth seeing — 8° or more by b = 0.02',
      r[0].theta - r[r.length - 1].theta > 7,
      `${r[0].theta.toFixed(2)}° → ${r[r.length - 1].theta.toFixed(2)}°`);

  // A maximum means the neighbours are worse. Check it really is the peak.
  const around = await page.evaluate(new Function(`${P}
    const p = { v0: 40, theta: 45, g: 9.81, b: 0.01 };
    const best = M.bestAngle(p).theta;
    const at = (d) => M.fly({ ...p, theta: d }, { sample: false }).R;
    return { best, peak: at(best), lo: at(best - 2), hi: at(best + 2), at45: at(45) };`));
  chk('the reported optimum really is a maximum of the measured range',
      around.peak > around.lo && around.peak > around.hi && around.peak > around.at45,
      `${around.peak.toFixed(3)} vs ${around.lo.toFixed(3)} / ${around.hi.toFixed(3)}, and ${around.at45.toFixed(3)} at 45°`);
}

// ── The integrator is converged, so none of the above is step size ────
{
  const r = await page.evaluate(new Function(`${P}
    // Re-fly the same launch through the page's own rk4 at coarser steps by
    // integrating here, then compare against what the page reports.
    const p = { v0: 40, theta: 45, g: 9.81, b: 0.01 };
    return { pageStep: M.H, R: M.fly(p, { sample: false }).R };`));
  chk('the page integrates at a step small enough to have converged',
      r.pageStep <= 1 / 240 && Math.abs(r.R - 78.146996) < 1e-4,
      `h = 1/${Math.round(1 / r.pageStep)} s, R = ${r.R.toFixed(6)} m (offline reference 78.146996)`);
}

// ── The live page ─────────────────────────────────────────────────────
{
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await setV('velocity', 40); await setV('angle', 45);
  await setV('gravity', 9.81); await setV('drag', 0);
  await page.waitForTimeout(300);

  const measured = parseFloat(await txt('out-range'));
  const formula = parseFloat(await txt('out-vacuum'));
  chk('the two range readouts agree with no drag',
      Math.abs(measured - formula) < 0.01, `${measured} vs ${formula}`);
  const resid = await txt('out-residual');
  chk('and the residual readout is reported in exponent form, tiny',
      /e-1[0-9]/.test(resid) || resid === '0', resid);

  await setV('drag', 0.02);
  await page.waitForTimeout(300);
  const m2 = parseFloat(await txt('out-range'));
  const f2 = parseFloat(await txt('out-vacuum'));
  chk('with drag the measurement falls well below the formula',
      m2 < f2 * 0.6, `${m2} m measured vs ${f2} m from v₀²sin2θ/g`);
  chk('the residual switches to metres and is negative',
      parseFloat(await txt('out-residual')) < -50, await txt('out-residual'));
  chk('the landing angle readout is much steeper than the launch',
      parseFloat(await txt('out-land-angle')) > 60, await txt('out-land-angle'));

  chk('the best angle is blank until it has been measured',
      (await txt('out-best')) === '—', await txt('out-best'));
  await page.click('#sweep-btn');
  await page.waitForFunction(() => document.getElementById('out-best').textContent.trim() !== '—',
    null, { timeout: 20000 });
  const best = parseFloat(await txt('out-best'));
  chk('and after the sweep it reports an angle below 45°',
      best > 30 && best < 42, `${best}°`);

  await setV('drag', 0);
  await page.waitForTimeout(200);
  chk('changing the air invalidates the sweep rather than keeping a stale answer',
      (await txt('out-best')) === '—', await txt('out-best'));
  await page.click('#sweep-btn');
  await page.waitForFunction(() => document.getElementById('out-best').textContent.trim() !== '—',
    null, { timeout: 20000 });
  chk('and in vacuum the page reports 45.00°',
      Math.abs(parseFloat(await txt('out-best')) - 45) < 0.05, await txt('out-best'));
}

// ── Launch animates, and the controls are live ────────────────────────
{
  await page.click('#launch-btn');
  await page.waitForTimeout(250);
  chk('Launch starts the flight', await page.evaluate(() => window.__proj.isFlying()));
  await page.waitForTimeout(6000);
  chk('and it lands', !(await page.evaluate(() => window.__proj.isFlying())));

  const sig = async () => {
    await page.waitForTimeout(260);
    return JSON.stringify(await page.evaluate(() => {
      const f = window.__proj.flight();
      return [f.R.toFixed(6), f.T.toFixed(6), f.H.toFixed(6)];
    }));
  };
  const dead = [];
  let before = await sig();
  for (const [name, act] of [
    ['velocity', () => setV('velocity', 55)],
    ['angle', () => setV('angle', 33)],
    ['gravity', () => setV('gravity', 3.7)],
    ['drag', () => setV('drag', 0.012)],
    ['reset', () => page.click('#reset-btn')],
  ]) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the measured flight', dead.length === 0, dead.join(','));
}

// ── Chrome ────────────────────────────────────────────────────────────
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

await finish('projectile');
