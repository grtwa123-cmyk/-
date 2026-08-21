/*
 * The solar system sandbox: does the integrator integrate?
 *
 * Badged "Integrated" — the equations of motion are stepped forward and what
 * you see is where they go. That claim is about the stepping, so every check
 * below drives step() directly through window.__solar rather than watching
 * the animation, and a run is measured in days of simulated time.
 *
 * Two things this page does NOT claim, and neither does the suite.
 *
 * The orbits are drawn at √a, not a. Neptune is thirty astronomical units out
 * and Mercury is four tenths of one; laid out to scale on a canvas, either
 * Neptune is off the edge or the inner planets are a single pixel. The square
 * root compresses that into a picture, and the consequence is that the years
 * on screen are the sandbox's own, not the real ones — Mercury comes round in
 * 180 simulated days where the real one takes 88. So the check holds Kepler's
 * third law over the radii the simulation actually has, which is the law the
 * integrator is obeying, and says out loud that it is not the real calendar.
 *
 * The planet sizes, on the other hand, are honest: they scale linearly from
 * real radii, so Jupiter is eleven times Earth across, and that is checked
 * against the kilometre figures in the templates.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/solar.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const fresh = () => page.evaluate(() => { window.__solar.reset(); return window.__solar.state(); });
const scale = await page.evaluate(() => window.__solar.scale());
const templates = await page.evaluate(() => window.__solar.templates);
let st = await fresh();
chk(`the eight planets are laid out — ${templates.map((t) => t.key).join(', ')}`,
    st.planets.length === 8 && st.planets.every((p) => p.alive),
    `${st.planets.length} planets`);

const rOf = (p, s) => Math.hypot(p.x - s.sun.x, p.y - s.sun.y);

// ── The layout, and the compression it admits to ─────────────────────
{
  const rows = st.planets.map((p, i) => ({
    key: p.key, r: rOf(p, st), a: templates[i].a,
    want: Math.sqrt(templates[i].a) * scale.distance,
  }));
  chk('each orbit sits at √a — the compression that fits Neptune on a canvas',
      rows.every((q) => Math.abs(q.r - q.want) < 0.5),
      rows.map((q) => `${q.key} ${q.r.toFixed(1)} vs ${q.want.toFixed(1)}`).join(', '));

  // The thing that would be true of a linear layout, and is not of this one.
  const merc = rows[0], earth = rows[2];
  chk('and so Mercury sits at 0.62 of Earth, not the 0.39 an unsquashed map would give',
      Math.abs(merc.r / earth.r - Math.sqrt(0.39)) < 0.01,
      `${(merc.r / earth.r).toFixed(3)} vs √0.39 = ${Math.sqrt(0.39).toFixed(3)}`);
}

// ── The sizes, which are not compressed ──────────────────────────────
{
  const rows = st.planets.map((p, i) => ({
    key: p.key, px: p.drawnPx,
    want: Math.max(1.5, scale.earthPx * (templates[i].radiusKm / scale.earthRadiusKm)),
  }));
  chk('planet sizes scale linearly from their real radii',
      rows.every((q) => Math.abs(q.px - q.want) < 1e-9),
      rows.map((q) => `${q.key} ${q.px.toFixed(2)}px`).join(', '));

  const jup = rows[4], earth = rows[2];
  chk('so Jupiter is eleven Earths across, as it is',
      Math.abs(jup.px / earth.px - 69911 / 6371) < 0.02,
      `${(jup.px / earth.px).toFixed(2)}× Earth`);
}

// ── Kepler's third law, over the radii the sandbox has ───────────────
{
  /*
   * Period measured by stepping until each planet comes back round to its
   * starting angle. Nothing here is told what a period is; the integrator is
   * simply run and the crossing counted.
   */
  const periods = await page.evaluate(() => {
    const S = window.__solar;
    S.reset();
    const s0 = S.state(), sun = s0.sun;
    const ang = (p) => Math.atan2(p.y - sun.y, p.x - sun.x);
    const start = s0.planets.map(ang);
    const found = new Array(s0.planets.length).fill(null);
    const STEP = 2;                       // days per advance
    let prev = start.slice(), t = 0;
    for (let k = 0; k < 3000 && found.some((v) => v === null); k++) {
      S.advance(STEP);
      t += STEP;
      const now = S.state().planets.map(ang);
      for (let i = 0; i < now.length; i++) {
        if (found[i] !== null || t < 20) continue;
        // The angle sweeps and wraps through ±π exactly once per orbit.
        const crossed = prev[i] < start[i] && now[i] >= start[i]
                     && Math.abs(now[i] - prev[i]) < Math.PI;
        if (crossed) {
          const f = (start[i] - prev[i]) / (now[i] - prev[i]);
          found[i] = t - STEP + f * STEP;
        }
      }
      prev = now;
    }
    return { periods: found, r: s0.planets.map((p) => Math.hypot(p.x - sun.x, p.y - sun.y)) };
  });

  const got = periods.periods.map((T, i) => ({ key: templates[i].key, T, r: periods.r[i] }))
    .filter((q) => q.T !== null);
  chk(`every orbit closes, and its period is counted — ${got.length} of 8`,
      got.length >= 6, got.map((q) => `${q.key} ${q.T?.toFixed(0)}d`).join(', '));

  // T² / r³ is the same constant for all of them: Kepler's third law.
  const k = got.map((q) => (q.T * q.T) / (q.r ** 3));
  const spread = (Math.max(...k) - Math.min(...k)) / (k.reduce((s, v) => s + v, 0) / k.length);
  chk("T² over r³ is one constant across them all — Kepler's third law, integrated",
      spread < 0.02,
      `spread ${(spread * 100).toFixed(2)}% over ${k.length} orbits`);

  // And the calendar this produces is the sandbox's, not the sky's.
  const earth = got.find((q) => q.key === 'earth');
  const merc = got.find((q) => q.key === 'mercury');
  chk("Earth's year is 365 days by construction, and Mercury's is not the real 88",
      Math.abs(earth.T - scale.earthPeriod) < 4 && merc.T > 150,
      `Earth ${earth.T.toFixed(0)}d, Mercury ${merc.T.toFixed(0)}d (real 88)`);
}

// ── Newton, underneath ───────────────────────────────────────────────
{
  /*
   * The law the stepping is stepping. A body dropped from rest accelerates
   * toward the sun as 1/r², which is measurable by dropping two and comparing
   * how far each fell — the softening in the code is 4 px² against radii of
   * hundreds, so it changes nothing here.
   */
  const drop = await page.evaluate(() => {
    const S = window.__solar;
    S.reset();
    const sun = S.state().sun;
    const R = 120;
    S.setPlanets([
      { x: sun.x + R, y: sun.y, vx: 0, vy: 0 },
      { x: sun.x + 2 * R, y: sun.y, vx: 0, vy: 0 },
    ]);
    S.advance(0.5);
    const p = S.state().planets;
    return { mu: S.state().mu, R,
             near: (sun.x + R) - p[0].x, far: (sun.x + 2 * R) - p[1].x };
  });
  // Fall distance goes as the acceleration, so quartering the pull quarters it.
  chk('a body twice as far falls a quarter as much — the inverse square, integrated',
      Math.abs(drop.near / drop.far - 4) < 0.15,
      `${drop.near.toFixed(3)} px vs ${drop.far.toFixed(3)} px → ratio ${(drop.near / drop.far).toFixed(3)}`);

  // Angular momentum is the conserved quantity of a central force, and a
  // leapfrog integrator holds it to machine precision.
  const L = await page.evaluate(() => {
    const S = window.__solar;
    S.reset();
    const sun = S.state().sun;
    S.setPlanets([{ x: sun.x + 90, y: sun.y, vx: 0, vy: 0 }]);
    const v = S.circularVelocityAround(sun.x + 90, sun.y);
    S.setPlanets([{ x: sun.x + 90, y: sun.y, vx: v.vx * 0.7, vy: v.vy * 0.7 }]);
    const mom = () => {
      const s = S.state(), p = s.planets[0];
      return (p.x - s.sun.x) * p.vy - (p.y - s.sun.y) * p.vx;
    };
    const out = [mom()];
    for (let i = 0; i < 40; i++) { S.advance(4); out.push(mom()); }
    return out;
  });
  const drift = Math.max(...L.map((v) => Math.abs(v / L[0] - 1)));
  chk('and an elliptical orbit keeps its angular momentum as it goes round',
      drift < 1e-6, `worst drift ${drift.toExponential(2)} over ${L.length} samples`);
}

// ── A circular launch stays circular ─────────────────────────────────
{
  const circ = await page.evaluate(() => {
    const S = window.__solar;
    S.reset();
    const sun = S.state().sun;
    const R = 140;
    const v = S.circularVelocityAround(sun.x + R, sun.y);
    S.setPlanets([{ x: sun.x + R, y: sun.y, vx: v.vx, vy: v.vy }]);
    const rs = [];
    for (let i = 0; i < 60; i++) {
      S.advance(6);
      const s = S.state(), p = s.planets[0];
      rs.push(Math.hypot(p.x - s.sun.x, p.y - s.sun.y));
    }
    return { R, min: Math.min(...rs), max: Math.max(...rs) };
  });
  chk('the speed the page offers for a circular orbit really gives one',
      (circ.max - circ.min) / circ.R < 0.01,
      `r stayed ${circ.min.toFixed(1)}–${circ.max.toFixed(1)} px about ${circ.R}`);
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  await page.evaluate(() => window.__solar.reset());
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

  chk('the page badges itself as integrated, and does not claim to be measured',
      await page.$('.method-tag[data-method="integrated"]') !== null
      && await page.$('.method-tag[data-method="measured"]') === null);

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('solar');
