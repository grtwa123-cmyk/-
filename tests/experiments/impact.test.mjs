/*
 * Egg drop — the impulse is the area under the curve, and the area is the
 * momentum that went away.
 *
 * The page writes down one contact law, F = k·u·(1 + a·u̇), and integrates it
 * with RK4. Everything on the panel is read off the curve that comes out: the
 * peak is the largest force reached, the collision time is how long the push
 * lasted, and the impulse is the trapezoidal area accumulated as it is swept.
 * These checks hold that area against the momentum actually removed — the
 * egg's change in momentum plus the weight the cushion worked against for the
 * whole contact — and hold the integrator itself against the one case where
 * the answer is known exactly, the same spring with the damping switched off.
 *
 * There is no randomness on this page, so the bounds are not absorbing
 * run-to-run scatter. Each sits about an order of magnitude above the
 * residual measured on this build, and each was watched fail under a planted
 * defect before it was written down.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/impact.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const n = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ex = (x, d = 2) => (Number.isFinite(x) ? x.toExponential(d) : String(x));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

const K = await page.evaluate(() => {
  const I = window.__impact;
  return { M: I.EGG_MASS, G: I.G, BREAK: I.BREAK_THRESHOLD,
           mats: Object.fromEntries(Object.entries(I.MATERIALS)
             .map(([k, m]) => [k, { k: m.k, a: m.a }])) };
});
const KEYS = Object.keys(K.mats);

// ── The area under the curve is the momentum that went away ──────────
const sweep = await page.evaluate(() => {
  const I = window.__impact;
  const out = [];
  for (const key of Object.keys(I.MATERIALS)) {
    for (const h of [0.02, 0.1, 0.5, 1.5, 4, 8, 12]) {
      const d = I.simulate(h, I.MATERIALS[key]);
      // Re-integrate the recorded curve here, independently of the page's
      // own running total, so a broken accumulator has nowhere to hide.
      let area = 0;
      for (let i = 1; i < d.samples.length; i++) {
        area += 0.5 * (d.samples[i - 1].F + d.samples[i].F)
                    * (d.samples[i].t - d.samples[i - 1].t);
      }
      out.push({ key, h, vIn: d.vIn, vOut: d.vOut, tc: d.tc, peak: d.peak,
                 impulse: d.impulse, dp: d.dp, weight: d.weight, peakAt: d.peakT / d.tc,
                 momentum: d.momentum, avgF: d.avgF, e: d.restitution,
                 broken: d.broken, steps: d.steps, area, samples: d.samples.length });
    }
  }
  return out;
});
{
  const worst = Math.max(...sweep.map((s) => Math.abs(s.impulse / s.momentum - 1)));
  chk(`∫F dt is the momentum removed — ${sweep.length} drops across three cushions and the whole slider`,
      worst < 1e-5,
      `worst ${ex(worst)}; e.g. ` + sweep.slice(0, 3)
        .map((s) => `${s.key} h=${s.h}: ${n(s.impulse, 5)} vs ${n(s.momentum, 5)}`).join(', '));

  /*
   * And both halves of the right-hand side matter. The egg's momentum change
   * alone is not the impulse: gravity pulls for the whole contact, so the
   * cushion has to remove that too. On the soft cushion the weight term is
   * nearly a fifth of a percent — small, but far bigger than the tolerance
   * above, so leaving it out is not something the check could miss.
   */
  const share = sweep.map((s) => s.weight / s.momentum);
  chk('with the weight the cushion worked against counted on that side too',
      Math.max(...share) > 1e-3
      && sweep.every((s) => Math.abs(s.impulse / s.dp - 1) > Math.abs(s.impulse / s.momentum - 1)),
      `weight is ${ex(Math.min(...share))}–${ex(Math.max(...share))} of the momentum removed`);

  // The page's running total against a fresh integration of its own samples.
  const worstArea = Math.max(...sweep.map((s) => Math.abs(s.area / s.impulse - 1)));
  chk('and the running total is the area under the curve the page actually drew',
      worstArea < 5e-3,
      `worst ${ex(worstArea)} between the accumulator and the sampled curve`);
}

// ── The fall ─────────────────────────────────────────────────────────
{
  const worst = Math.max(...sweep.map((s) =>
    Math.abs(s.vIn / Math.sqrt(2 * K.G * s.h) - 1)));
  chk('the impact speed is stepped out of the fall and lands on √(2gh)',
      worst < 1e-5,
      `worst ${ex(worst)}; e.g. h=12: ${n(sweep.find((s) => s.h === 12).vIn, 5)} `
      + `vs ${n(Math.sqrt(2 * K.G * 12), 5)}`);
}

// ── The elastic reference, where the answer is known exactly ─────────
{
  /*
   * Switch the damping off and a spring under constant gravity is still
   * simple harmonic motion, just about a shifted centre — so the contact
   * time and the peak force both have closed forms, weight included:
   *
   *   t_c = (2/ω₀)·(π − arctan(v₀ω₀/g))     F_peak = mg + √((mg)² + k·m·v₀²)
   *
   * This is the only place on the page where an exact answer exists, which
   * makes it the only real test the integrator can be given.
   */
  const el = await page.evaluate(() => {
    const I = window.__impact;
    const out = [];
    for (const key of Object.keys(I.MATERIALS)) {
      for (const h of [0.05, 0.5, 2, 8]) {
        const mat = { ...I.MATERIALS[key], a: 0 };
        const d = I.simulate(h, mat);
        const c = I.elastic(mat.k, d.vIn);
        out.push({ key, h, tc: d.tc, peak: d.peak, e: d.restitution,
                   wantTc: c.tc, wantPeak: c.peak });
      }
    }
    return out;
  });
  const wt = Math.max(...el.map((s) => Math.abs(s.tc / s.wantTc - 1)));
  const wp = Math.max(...el.map((s) => Math.abs(s.peak / s.wantPeak - 1)));
  chk(`with the damping off the contact lasts (2/ω₀)(π − arctan(v₀ω₀/g)) — ${el.length} cases`,
      wt < 1e-5, `worst ${ex(wt)}`);
  chk('and peaks at mg + √((mg)² + k·m·v₀²)', wp < 1e-5, `worst ${ex(wp)}`);
  const we = Math.max(...el.map((s) => Math.abs(s.e - 1)));
  chk('and gives the egg every bit of its speed back, as an elastic contact must',
      we < 1e-5, `worst |e − 1| = ${ex(we)}`);
}

// ── The lesson: same drop, three floors ──────────────────────────────
{
  const same = KEYS.map((key) => sweep.find((s) => s.key === key && s.h === 0.5));
  const js = same.map((s) => s.impulse);
  const ps = same.map((s) => s.peak);
  const ts = same.map((s) => s.tc);
  chk('the same drop onto three floors removes nearly the same momentum',
      Math.max(...js) / Math.min(...js) < 1.2,
      same.map((s) => `${s.key}: ${n(s.impulse, 4)} N·s`).join(', '));
  chk('but the peak force changes by more than a factor of ten, because the time did',
      Math.max(...ps) / Math.min(...ps) > 10
      && Math.max(...ts) / Math.min(...ts) > 10,
      same.map((s) => `${s.key}: ${n(s.peak, 1)} N over ${n(s.tc * 1000, 1)} ms`).join(', '));

  chk('and the average force is exactly the impulse spread over the contact',
      sweep.every((s) => Math.abs(s.avgF * s.tc / s.impulse - 1) < 1e-9),
      `worst ${ex(Math.max(...sweep.map((s) => Math.abs(s.avgF * s.tc / s.impulse - 1))))}`);

  /*
   * The old version of this page asserted peak ≈ (π/2)·average, which is the
   * ratio for a half-sine pulse — and it drew a half-sine, so it was true by
   * construction. A produced curve is not a half-sine. Gently, the ratio is
   * close to π/2; violently it is nearly three times that, because the
   * damping front-loads the pulse into a spike. That is the claim now: the
   * shape is not fixed, and the rule only holds in the gentle limit.
   */
  const gentle = sweep.filter((s) => s.h === 0.02).map((s) => s.peak / s.avgF);
  const violent = sweep.filter((s) => s.h === 12).map((s) => s.peak / s.avgF);
  const peakAt = sweep.map((s) => s.peakAt);
  chk('the pulse is close to a half-sine only when the drop is gentle, and spikes when it is not',
      Math.max(...gentle) < 1.75 && Math.min(...gentle) > Math.PI / 2
      && Math.min(...violent) > 2.5 * Math.max(...gentle) / 1.75
      && Math.min(...violent) > 4,
      `peak/avg is ${n(Math.min(...gentle))}–${n(Math.max(...gentle))} from 2 cm `
      + `(π/2 = ${n(Math.PI / 2)}) and ${n(Math.min(...violent))}–${n(Math.max(...violent))} from 12 m; `
      + `the peak moves from ${(Math.max(...peakAt) * 100).toFixed(0)}% of the contact to `
      + `${(Math.min(...peakAt) * 100).toFixed(0)}%`);
}

// ── The contact law behaves ──────────────────────────────────────────
{
  const shape = await page.evaluate(() => {
    const I = window.__impact;
    const d = I.simulate(0.5, I.MATERIALS.medium);
    const F = d.samples.map((s) => s.F);
    return { first: F[0], last: F[F.length - 1], min: Math.min(...F),
             peak: d.peak, peakAt: d.peakT / d.tc, n: F.length,
             // a plain dashpot would jump to c·v at the instant of contact
             jump: I.contactForce(I.MATERIALS.medium, 0, d.vIn),
             mid: I.contactForce(I.MATERIALS.medium, 0.01, 0),
             pull: I.contactForce(I.MATERIALS.medium, 0.01, -1e6) };
  });
  chk('the force starts at zero rather than jumping, and never pulls the egg back down',
      shape.first === 0 && shape.jump === 0 && shape.min >= 0 && shape.pull === 0
      && shape.mid > 0,
      `F at contact ${shape.first}, minimum over the curve ${shape.min}, `
      + `F when the cushion is releasing fast ${shape.pull}`);
  chk('and the peak arrives in the first half, the damping taking the rest away',
      shape.peakAt > 0.1 && shape.peakAt < 0.5,
      `peak at ${(shape.peakAt * 100).toFixed(1)}% of the contact`);

  const e = sweep.filter((s) => s.h === 0.5).map((s) => s.e);
  chk('the egg comes back slower than it arrived, on every floor',
      e.every((v) => v > 0 && v < 1),
      KEYS.map((k, i) => `${k}: ${n(e[i], 4)}`).join(', '));
}

// ── Where each floor starts breaking the egg ─────────────────────────
{
  const edges = await page.evaluate(() => {
    const I = window.__impact;
    const out = {};
    for (const key of Object.keys(I.MATERIALS)) {
      let lo = 0.001;
      let hi = 30;
      // Bisect on a fact — did the peak clear the threshold? — rather than
      // on any expression for where it should.
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2;
        if (I.simulate(m, I.MATERIALS[key]).broken) hi = m; else lo = m;
      }
      out[key] = (lo + hi) / 2;
    }
    return out;
  });
  chk('a softer floor buys height, and by a lot — 3 cm on the hard one, metres on the soft',
      edges.hard < 0.06 && edges.medium > 10 * edges.hard
      && edges.soft > 5 * edges.medium,
      KEYS.map((k) => `${k}: ${n(edges[k], 3)} m`).join(', '));

  /*
   * The verdict has to be that boundary and not a second opinion about it.
   */
  const around = await page.evaluate((e) => {
    const I = window.__impact;
    const out = [];
    for (const [key, h] of Object.entries(e)) {
      out.push({ key, below: I.simulate(h * 0.9, I.MATERIALS[key]).broken,
                 above: I.simulate(h * 1.1, I.MATERIALS[key]).broken,
                 peakBelow: I.simulate(h * 0.9, I.MATERIALS[key]).peak,
                 peakAbove: I.simulate(h * 1.1, I.MATERIALS[key]).peak });
    }
    return out;
  }, edges);
  chk('and the verdict flips exactly where the measured peak crosses the threshold',
      around.every((s) => !s.below && s.above
                          && s.peakBelow < K.BREAK && s.peakAbove > K.BREAK),
      around.map((s) => `${s.key}: ${n(s.peakBelow, 1)} → ${n(s.peakAbove, 1)} N`).join(', '));
}

// ── The live page ────────────────────────────────────────────────────
{
  const live = await page.evaluate(async () => {
    const I = window.__impact;
    I.setRunning(false);
    I.reset();
    const el = document.getElementById('drop-height');
    el.value = '0.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    I.select('medium');
    I.drop();
    const seen = [I.phase()];
    let midContact = null;
    for (let i = 0; i < 300; i++) {
      I.advance(0.01);
      if (I.phase() !== seen[seen.length - 1]) seen.push(I.phase());
      if (I.phase() === 'contact' && !midContact) midContact = I.eggPosition();
    }
    const d = I.drops()[I.drops().length - 1];
    const txt = (id) => document.getElementById('prop-' + id).textContent.trim();
    return { seen, d, midContact, count: I.drops().length,
             verdict: txt('verdict'), v: txt('impact-v'), peak: txt('peak-f'),
             avg: txt('avg-f'), imp: txt('impulse'), tc: txt('collision-t'),
             e: txt('restitution'),
             want: I.simulate(0.5, I.MATERIALS.medium) };
  });
  chk('a drop falls, makes contact and finishes, and the egg is pressed into the cushion on the way',
      live.seen.join('>') === 'falling>contact>done' && live.count === 1
      && live.midContact && live.midContact.u > 0 && live.midContact.F > 0,
      `${live.seen.join(' → ')}; mid-contact compression ${n(live.midContact?.u * 1000, 2)} mm `
      + `under ${n(live.midContact?.F, 1)} N`);

  chk('the drop that was animated is the drop that was measured',
      Math.abs(live.d.impulse - live.want.impulse) < 1e-12
      && Math.abs(live.d.peak - live.want.peak) < 1e-12
      && Math.abs(live.d.tc - live.want.tc) < 1e-15,
      `J ${n(live.d.impulse, 6)} vs ${n(live.want.impulse, 6)}`);

  chk('and the panel prints that measurement, both sides of the impulse ledger',
      live.imp === `${live.d.impulse.toFixed(4)} / ${live.d.momentum.toFixed(4)} N·s`
      && live.peak === `${live.d.peak.toFixed(1)} N`
      && live.avg === `${live.d.avgF.toFixed(1)} N`
      && live.tc === `${(live.d.tc * 1000).toFixed(1)} ms`
      && live.e === live.d.restitution.toFixed(3)
      && live.v === `${live.d.vIn.toFixed(2)} / ${Math.sqrt(2 * 9.81 * 0.5).toFixed(2)} m/s`,
      `${live.imp} | ${live.peak} | ${live.avg} | ${live.tc} | e ${live.e} | ${live.v}`);

  chk('and says whether the egg survived, agreeing with the measured peak',
      (live.d.peak > K.BREAK) === (live.verdict !== 'Egg survived'),
      `${live.verdict} at ${n(live.d.peak, 1)} N against ${K.BREAK} N`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  const sig = async () => page.evaluate(() => JSON.stringify([
    document.getElementById('drop-height-value')?.textContent,
    window.__impact.params(),
    [...document.querySelectorAll('#material-list .mol-btn')]
      .map((b) => b.classList.contains('active')),
  ]));
  const dead = [];
  let before = await sig();
  await setV('drop-height', 2.5);
  if ((await sig()) === before) dead.push('drop-height');
  before = await sig();
  await page.click('#material-list .mol-btn[data-key="soft"]');
  if ((await sig()) === before) dead.push('material');
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  const afterDrop = await page.evaluate(() => {
    const I = window.__impact;
    I.setRunning(false);
    I.drop();
    for (let i = 0; i < 300; i++) I.advance(0.01);
    return I.drops().length;
  });
  await page.click('#clear-graph-btn');
  const cleared = await page.evaluate(() => window.__impact.drops().length);
  chk('Clear graph discards the curves rather than leaving stale ones on screen',
      afterDrop === 1 && cleared === 0, `${afterDrop} → ${cleared}`);

  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    p: window.__impact.params(), phase: window.__impact.phase(),
    record: window.__impact.record(),
  }));
  chk('Reset restores the defaults and puts the egg back',
      after.p.dropHeight === 0.5 && after.phase === 'idle' && after.record === null,
      JSON.stringify({ h: after.p.dropHeight, phase: after.phase }));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  /*
   * Wait for the title to actually change rather than for a fixed number of
   * milliseconds. The zh dictionary is fetched on demand, and on a slow
   * machine a fixed delay is not always enough — which shows up as ko and zh
   * reporting the same string and the check failing for no reason at all.
   */
  const lang = async (code, prev) => {
    await page.click(`.lang-btn[data-lang="${code}"]`);
    await page.waitForFunction(
      (p) => document.querySelector('h1').textContent.trim() !== p, prev,
      { timeout: 8000 },
    ).catch(() => {});
    return h1();
  };
  const en = await h1();
  const ko = await lang('ko', en);
  const zh = await lang('zh', ko);
  await lang('en', zh);
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
    await page.waitForTimeout(300);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('impact');
