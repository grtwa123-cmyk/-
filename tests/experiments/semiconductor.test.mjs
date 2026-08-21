/*
 * Doping and drift — holding an illustration to being the right illustration.
 *
 * This page is badged "Illustration": an animation of the idea, with no
 * quantitative model behind it. That is an honest badge and this suite does
 * not try to talk it up. There is no closed form here, no mobility, no
 * carrier concentration in cm⁻³ — inventing one to check against would be
 * claiming more than the page does, which is the one thing this site is not
 * supposed to do.
 *
 * What an illustration can still get wrong is the idea. n-type doped
 * electron-poor, holes drifting the same way as electrons, a battery whose
 * polarity does nothing — each would be a real defect, and "no quantitative
 * model" is no defence against any of them. So the checks hold the direction
 * of every arrow and the sign of every majority, and nothing else.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/semiconductor.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const types = await page.evaluate(() => window.__semi.types);
const state = await page.evaluate(() => window.__semi.state());
chk('three samples are on the bench — intrinsic, n-type and p-type',
    state.length === 3 && state.map((r) => r.key).join() === 'intrinsic,ntype,ptype',
    state.map((r) => r.key).join(', '));

// ── The doping is the right way round ────────────────────────────────
{
  const by = Object.fromEntries(types.map((t) => [t.key, t]));
  chk('intrinsic silicon carries as many holes as electrons, and no dopant at all',
      by.intrinsic.electrons === by.intrinsic.holes
      && by.intrinsic.donors === 0 && by.intrinsic.acceptors === 0,
      `${by.intrinsic.electrons}e / ${by.intrinsic.holes}h, `
      + `${by.intrinsic.donors} donors, ${by.intrinsic.acceptors} acceptors`);

  chk('n-type is electron-rich and doped with donors, not acceptors',
      by.ntype.electrons > 4 * by.ntype.holes
      && by.ntype.donors > 0 && by.ntype.acceptors === 0,
      `${by.ntype.electrons}e / ${by.ntype.holes}h, ${by.ntype.donors} donors`);

  chk('and p-type is its mirror — hole-rich, doped with acceptors',
      by.ptype.holes > 4 * by.ptype.electrons
      && by.ptype.acceptors > 0 && by.ptype.donors === 0,
      `${by.ptype.electrons}e / ${by.ptype.holes}h, ${by.ptype.acceptors} acceptors`);

  // The drawn carriers are the declared ones, not a separate handful.
  const wrong = state.filter((r) => {
    const t = by[r.key];
    return r.electrons.length !== t.electrons || r.holes.length !== t.holes;
  });
  chk('and the carriers on screen are the ones the doping calls for',
      wrong.length === 0,
      wrong.map((r) => `${r.key} drew ${r.electrons.length}e/${r.holes.length}h`).join(', ')
      || state.map((r) => `${r.key} ${r.electrons.length}e/${r.holes.length}h`).join(', '));
}

/**
 * Mean horizontal drift of each species, after running the carriers a while.
 *
 * Thermal motion is a random walk with no preferred direction, so it averages
 * away and what is left is the drift the field caused. Averaged over the
 * whole bench — all three samples — because the question is about the field,
 * which every sample shares.
 */
const drift = (polarity, { battery = true, volts = 3, temp = 1 } = {}) =>
  page.evaluate(([p, on, v, t]) => {
    const S = window.__semi;
    S.setBattery(on); S.setPolarity(p); S.setVoltage(v); S.setTemperature(t);
    // Settle first, and generously. The carriers are damped with a time
    // constant of about 0.8 s, so they coast: measured after only 0.6 s the
    // battery-off case still carried most of the drift the *previous* call's
    // field had given it, and read 17 px of travel where the answer is none.
    // Three seconds is nearly four damping times, so every measurement below
    // is of the steady drift rather than of the transient into it.
    S.advance(3, 300);
    const before = S.state();
    S.advance(0.6);
    const after = S.state();
    const mean = (kind) => {
      let sum = 0, n = 0;
      before.forEach((row, i) => {
        row[kind].forEach((c, j) => {
          // Wrap-around teleports a carrier across the sample; those steps
          // are not drift and would swamp the average, so they are dropped.
          const d = after[i][kind][j].x - c.x;
          const w = row.bounds.right - row.bounds.left;
          if (Math.abs(d) < w / 2) { sum += d; n++; }
        });
      });
      return n ? sum / n : NaN;
    };
    return { electrons: mean('electrons'), holes: mean('holes'), current: S.current() };
  }, [polarity, battery, volts, temp]);

// ── The two carriers go opposite ways ────────────────────────────────
{
  const plus = await drift(1);
  chk('electrons and holes drift in opposite directions under the same field',
      Math.sign(plus.electrons) === -Math.sign(plus.holes)
      && Math.abs(plus.electrons) > 1 && Math.abs(plus.holes) > 1,
      `electrons ${plus.electrons.toFixed(2)} px, holes ${plus.holes.toFixed(2)} px`);

  const minus = await drift(-1);
  chk('and reversing the battery reverses both of them',
      Math.sign(minus.electrons) === -Math.sign(plus.electrons)
      && Math.sign(minus.holes) === -Math.sign(plus.holes),
      `+: ${plus.electrons.toFixed(2)}/${plus.holes.toFixed(2)}, `
      + `−: ${minus.electrons.toFixed(2)}/${minus.holes.toFixed(2)}`);

  chk('the current the panel reports turns round with it',
      plus.current !== minus.current && plus.current.length > 0,
      `"${plus.current}" then "${minus.current}"`);
}

// ── Switch it off and the drift stops ────────────────────────────────
{
  const off = await drift(1, { battery: false });
  const on = await drift(1, { battery: true });
  chk('with the battery off the carriers jitter but go nowhere',
      Math.abs(off.electrons) < Math.abs(on.electrons) / 10
      && Math.abs(off.holes) < Math.abs(on.holes) / 10,
      `off ${off.electrons.toFixed(3)}/${off.holes.toFixed(3)} px vs `
      + `on ${on.electrons.toFixed(2)}/${on.holes.toFixed(2)} px`);
  chk('and the panel says so rather than naming a direction',
      /off|없|关/i.test(off.current), `"${off.current}"`);
}

// ── More volts, more drift; more heat, more jitter ───────────────────
{
  const lo = await drift(1, { volts: 1 });
  const hi = await drift(1, { volts: 5 });
  chk('a bigger voltage drives a bigger drift',
      Math.abs(hi.electrons) > Math.abs(lo.electrons) * 1.5,
      `1 V → ${Math.abs(lo.electrons).toFixed(2)} px, 5 V → ${Math.abs(hi.electrons).toFixed(2)} px`);

  // Temperature is thermal agitation, so it widens the spread of velocities
  // without steering them anywhere.
  const spread = (t) => page.evaluate((temp) => {
    const S = window.__semi;
    S.setBattery(false); S.setTemperature(temp);
    S.advance(1.2);
    const v = S.state().flatMap((r) => [...r.electrons, ...r.holes]).map((c) => c.vy);
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  }, t);
  const cold = await spread(0.4), hot = await spread(2);
  chk('and a hotter sample shakes harder, without drifting anywhere',
      hot > cold * 1.5, `σ(v) ${cold.toFixed(1)} cold, ${hot.toFixed(1)} hot`);
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  await page.evaluate(() => { window.__semi.setBattery(true); window.__semi.setPolarity(1); });
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

  chk('the page badges itself an illustration, and claims nothing more',
      await page.$('.method-tag[data-method="illustrated"]') !== null
      && await page.$('.method-tag[data-method="measured"]') === null
      && await page.$('.method-tag[data-method="model"]') === null);

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('semiconductor');
