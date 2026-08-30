/*
 * The whole catalogue, one invariant at a time.
 *
 * Six behaviours are promised on every page — theme, language, URL state,
 * reduced motion, fonts, audio — and each was verified on a handful of sample
 * pages: reduced motion on 14 of 38, CSV on 4, URL state on 3, theme, fonts
 * and audio on 2 apiece. Sampling leaks, and we know the rate: a one-off sweep
 * of all 38 found four reduced-motion violations the 14-page list had never
 * touched — phases and electrolysis animating at rest, epidemic and expression
 * animating after Start, each behind a notice reading "paused".
 *
 * So this asks one cheap question per page per guarantee, and leaves the
 * thorough interrogation to the suites that already do it well. The split is
 * deliberate: a sweep that tried to be thorough would cost more minutes than
 * anyone will spend, and the failure it exists to catch — a page that opted
 * out of a site-wide behaviour entirely — is visible from one question.
 *
 * What is NOT claimed here. The theme pass asserts the page repaints, not that
 * its contrast is sound: the site's plates are translucent glass over a
 * painted ground, so a computed colour reads rgba(255,255,255,0.58) in dark
 * mode as readily as in light and a contrast ratio built from it would be
 * fiction. Real contrast stays with tests/theme.test.mjs on its samples.
 */
import fs from 'node:fs';
import path from 'node:path';
import { browser, chk, url, serveCdn, finish, ROOT } from './lib/harness.mjs';

const PAGES = fs.readdirSync(path.join(ROOT, 'experiments'))
  .filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort();

/**
 * A legal, non-default value for the first range control on a page, read out
 * of the markup rather than the browser: the URL pass needs it before the page
 * loads, and parsing four attributes is cheaper than a round trip.
 */
function urlProbe(name) {
  const html = fs.readFileSync(path.join(ROOT, 'experiments', `${name}.html`), 'utf8');
  for (const tag of html.match(/<input[^>]*type="range"[^>]*>/g) || []) {
    const at = (k) => (tag.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
    const id = at('id'), min = Number(at('min')), max = Number(at('max'));
    const step = Number(at('step')) || 1, value = Number(at('value'));
    if (!id || !Number.isFinite(min) || !Number.isFinite(max)) continue;
    if (tag.includes('data-url="skip"')) continue;
    // A step off the default, staying inside the range and on the grid.
    const up = value + step, down = value - step;
    const want = up <= max ? up : down >= min ? down : null;
    if (want === null) continue;
    return { id, want: Number(want.toFixed(6)) };
  }
  return null;
}

// ── Pass A: two loads per page — clean, then with a control in the URL ──
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  // Before any page script runs: record whether an AudioContext is ever
  // constructed. A page that opens one on load rather than on a gesture is
  // blocked by every browser's autoplay policy and silent thereafter.
  await ctx.addInitScript(() => {
    window.__audioOpened = 0;
    for (const k of ['AudioContext', 'webkitAudioContext']) {
      const Real = window[k];
      if (!Real) continue;
      window[k] = function (...a) { window.__audioOpened++; return new Real(...a); };
      window[k].prototype = Real.prototype;
    }
  });
  const page = await ctx.newPage();

  const noRestore = [], audio = [], fonts = [], flat = [], drifted = [], errs = [];
  const kept = [], notClimbing = [];
  let probed = 0, resettable = 0, watched = 0;

  /*
   * Every readout that is currently empty. Restricting the Reset check to
   * these is what makes it decisive: a readout showing a live noisy quantity
   * reads differently every time it is looked at and can say nothing, but one
   * that opened at zero, filled up, and did not go back to zero is a tally
   * that survived a Reset. The existing check compares controls only, so a
   * chart of recorded points or a running tally could sail through it.
   */
  /*
   * Which readouts are cumulative tallies is named here, not inferred.
   *
   * Inferring it was tried twice and failed twice, both times on chemotaxis.
   * "Opens empty and fills" describes a fit as well as a count, and a fit
   * does not behave like one: ℓ off a nearly-flat histogram opens at 24312,
   * comes down through 7269, 3818, 2829 towards 1000, and starts high again
   * after a Reset — read as a tally, a Reset that did nothing. Requiring it
   * to climb only swapped which readout slipped through, because the r²
   * beside it climbs. Requiring it to open at a literal 0 only swapped it
   * back, because a hopeless fit prints 0.000.
   *
   * There is no property of the numbers that separates a count from a
   * statistic, so the pages say which is which. Five of them carry one, and
   * a page that stops carrying one is named by the coverage check below
   * rather than quietly dropping out of it.
   */
  const TALLIES = {
    decay: ['out-decayed', 'out-halves', 'out-elapsed'],
    epidemic: ['out-r', 'out-time'],
    expression: ['out-time'],
    kinetics: ['out-c', 'out-collisions'],
    titration: ['out-pct'],
  };
  const tallies = (ids) => page.evaluate((keys) => Object.fromEntries(keys.map((id) => {
    const n = parseFloat((document.getElementById(id)?.textContent || '')
      .replace(/[^0-9.eE+-]/g, ''));
    return [id, Number.isFinite(n) ? n : null];
  })), ids);

  /** Every addressable control's value, as the page currently has it. */
  const controlState = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('input[id], select[id]')]
      .filter((e) => !['button', 'submit', 'reset', 'file', 'hidden'].includes(e.type))
      .map((e) => [e.id, e.type === 'checkbox' ? String(e.checked) : e.value])));

  for (const name of PAGES) {
    // Reset means "the state this page opened in" — not the raw markup. A
    // page that adjusts its own controls at start-up (phases picks a preset)
    // must come back to what the reader first saw, or Reset is a control that
    // moves you somewhere new.
    try {
      await page.goto(url(`experiments/${name}.html`),
                      { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(450);
      const opened = await controlState();
      const btn = page.locator('#reset-btn, #reset').first();
      if (await btn.count() === 1 && await btn.isEnabled()) {
        resettable++;
        // Let it accumulate something first, so Reset has work to do.
        const start = page.locator('#start-btn, #launch-btn, #excite-btn').first();
        if (await start.count() === 1 && await start.isEnabled()) await start.click();
        /*
         * Two waits on conditions, no wall clock. First until every named
         * tally has started, then until every one of them has moved past
         * where it was — because "started" is not "climbing", and 600 ms of
         * head start is a property of the machine. CI caught that: kinetics
         * counts one molecule of C, and six hundred milliseconds later on a
         * two-core runner it had still counted one.
         */
        const ids = TALLIES[name] || [];
        const climbed = (before) => page.waitForFunction(([keys, was]) => keys.every((id) => {
          const n = parseFloat((document.getElementById(id)?.textContent || '')
            .replace(/[^0-9.eE+-]/g, ''));
          return Number.isFinite(n) && n > (was ? was[id] : 0);
        }), [ids, before], { timeout: 30000 }).catch(() => {});
        if (ids.length) await climbed(null);
        const mid = await tallies(ids);
        if (ids.length) await climbed(mid);
        const filled = await tallies(ids);
        await btn.click();
        await page.waitForTimeout(300);
        const after = await controlState();
        const moved = Object.keys(opened).filter((k) => opened[k] !== after[k]);
        if (moved.length) {
          drifted.push(`${name} ${moved.slice(0, 2)
            .map((k) => `#${k} ${opened[k]}→${after[k]}`).join(', ')}`);
        }
        const back = await tallies(ids);
        for (const id of ids) {
          const a = mid[id], b = filled[id], c = back[id];
          if (!(a > 0) || !(b > a)) { notClimbing.push(`${name} #${id} ${a} → ${b}`); continue; }
          watched++;
          if (!(c < b)) kept.push(`${name} #${id} ${a} → ${b} → ${c}`);
        }
      }
    } catch (e) { errs.push(`${name}: ${e.message.slice(0, 50)}`); continue; }

    const probe = urlProbe(name);
    const q = probe ? `?${probe.id}=${probe.want}` : '';
    try {
      await page.goto(url(`experiments/${name}.html${q}`),
                      { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(500);
    } catch (e) { errs.push(`${name}: ${e.message.slice(0, 50)}`); continue; }

    if (probe) {
      probed++;
      const got = await page.evaluate((id) => document.getElementById(id)?.value, probe.id);
      if (Number(got) !== probe.want) noRestore.push(`${name} #${probe.id}: ${got} ≠ ${probe.want}`);
    }

    const state = await page.evaluate(async () => {
      await document.fonts.ready;
      return { opened: window.__audioOpened, hasFont: document.fonts.check('16px Pretendard') };
    });
    if (state.opened > 0) audio.push(`${name} (${state.opened})`);
    if (!state.hasFont) fonts.push(name);

    // Repaint on theme: a static strip of chrome, so an animating canvas
    // cannot make two themes differ for the wrong reason.
    const clip = { x: 0, y: 0, width: 900, height: 150 };
    const shot = async (m) => {
      await page.evaluate((t) => window.Theme.set(t), m);
      await page.waitForTimeout(120);
      return (await page.screenshot({ clip })).toString('base64');
    };
    const light = await shot('light'), dark = await shot('dark');
    if (light === dark) flat.push(name);
    await page.evaluate(() => window.Theme.set('auto'));
  }

  chk(`every page loads (${PAGES.length} experiments)`, errs.length === 0, errs.slice(0, 3).join(' | '));
  chk(`a control set from the query string is restored — ${probed} pages with a slider`,
      noRestore.length === 0, noRestore.slice(0, 4).join(' | '));
  chk('no page opens an AudioContext before a gesture',
      audio.length === 0, audio.slice(0, 4).join(', '));
  chk('every page has its own typeface, not a system fallback',
      fonts.length === 0, fonts.slice(0, 4).join(', '));
  chk('every page repaints when the theme changes',
      flat.length === 0, flat.slice(0, 4).join(', '));
  chk(`and empties what the page had counted up — ${watched} tallies watched`,
      kept.length === 0, kept.slice(0, 4).join(' | '));
  chk('and every tally the pages are supposed to keep was climbing before it',
      notClimbing.length === 0, notClimbing.slice(0, 4).join(' | '));
  chk(`Reset returns a page to the state it opened in — ${resettable} pages with the button`,
      drifted.length === 0, drifted.slice(0, 4).join(' | '));
  await ctx.close();
}

// ── Pass B: the same catalogue under prefers-reduced-motion ──────────────
{
  const ctx = await browser.newContext({
    reducedMotion: 'reduce', viewport: { width: 1100, height: 900 },
  });
  const page = await ctx.newPage();
  const atRest = [], afterStart = [], noNotice = [], broke = [];
  let started = 0;

  for (const name of PAGES) {
    try {
      await page.goto(url(`experiments/${name}.html`),
                      { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(700);
    } catch { continue; }

    /*
     * Everything from here is inside a catch that records the page, because
     * a sweep of thirty-eight pages that dies on one of them and names none
     * is no use. It happened: a screenshot hung on "waiting for element to
     * be stable" until Playwright's timeout, and the stack pointed at this
     * function, which every page goes through. The run reported no failing
     * check and exit 1.
     *
     * The screenshot also gets its own short deadline. The default is
     * thirty seconds of a single page refusing to settle, which is long
     * enough to threaten the job's own ceiling.
     */
    try {
      const stage = page.locator('#stage, canvas').first();
      if (await stage.count() === 0) continue;
      /*
       * A viewport screenshot clipped to the stage, rather than an element
       * screenshot of it. The element path additionally waits for the element
       * to be stable and to be scrollable into view, and on blackhole that
       * wait never ended: the bar this gate injects was pushing a canvas the
       * exact height of the viewport down a page with overflow:hidden, so it
       * could never be brought fully into view. That is fixed in
       * reduced-motion.js; the clipped capture skips the wait regardless.
       *
       * The deadline is twenty-five seconds because blackhole needs it. Its
       * shader integrates a photon geodesic per pixel, and under the software
       * GL that both CI and this container use, one frame — and so one
       * screenshot — takes eight to ten seconds. Measured four in a row:
       * 9872, 8288, 8524, 8705 ms. Five seconds is not a strict deadline for
       * that page, it is a guaranteed failure.
       *
       * The clip takes in whatever the page floats above the stage, which
       * under this preference is all static.
       */
      // Bring it into view before measuring — on orbit the stage sits below
      // the fold, and a clip taken from where it was is empty. The two
      // full-bleed pages cannot scroll at all and do not need to; the catch
      // lets them past.
      await stage.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const box = await stage.boundingBox();
      const vp = page.viewportSize();
      if (!box) continue;
      const x = Math.max(0, Math.min(box.x, vp.width));
      const y = Math.max(0, Math.min(box.y, vp.height));
      const clip = {
        x, y,
        width: Math.min(box.width, vp.width - x),
        height: Math.min(box.height, vp.height - y),
      };
      if (clip.width < 1 || clip.height < 1) continue;
      const shot = async () =>
        (await page.screenshot({ clip, timeout: 25000 })).toString('base64');

      if (await page.locator('.motion-notice').count() !== 1) noNotice.push(name);

      const a = await shot();
      await page.waitForTimeout(900);
      if (a !== (await shot())) atRest.push(name);

      // And after the reader presses the page's own Start: the gate freezes
      // the rAF timestamp, which does nothing for a loop that steps a fixed
      // count per callback and never reads the clock.
      const start = page.locator('#start-btn, #launch-btn, #excite-btn').first();
      if (await start.count() === 1 && await start.isEnabled()) {
        started++;
        await start.click();
        await page.waitForTimeout(400);
        const c = await shot();
        await page.waitForTimeout(900);
        if (c !== (await shot())) afterStart.push(name);
      }
    } catch (e) {
      broke.push(`${name}: ${String(e.message || e).split('\n')[0]}`);
    }
  }

  chk('under reduced motion no page animates at rest',
      atRest.length === 0, atRest.slice(0, 5).join(', '));
  chk(`nor after its own Start is pressed — ${started} pages with one`,
      afterStart.length === 0, afterStart.slice(0, 5).join(', '));
  chk('and every one of them says so, with the notice that offers Play',
      noNotice.length === 0, noNotice.slice(0, 5).join(', '));
  chk('and every page could be photographed at all',
      broke.length === 0, broke.slice(0, 3).join(' | '));
  await ctx.close();
}

/*
 * Pause has to stop the picture, not just the model.
 *
 * Two pages were gating their arithmetic on the pause flag and letting the
 * drawing run on regardless. On equilibrium the dots kept drifting round the
 * box — six per cent of the canvas changing while paused against six and a
 * half while running, so the button looked broken. On electrolysis the water
 * went on rippling off performance.now(), which the reduced-motion gate can
 * freeze but Pause cannot. Neither had a check: the pages' own suites asked
 * whether the simulation *clock* stopped, and it did.
 *
 * Worse, equilibrium's "canvas animates" check was passing because of it —
 * the block before it left the page frozen, and the ungated dots supplied the
 * motion. A bug was holding a check up.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const moving = [], broke = [];
  let checked = 0;
  for (const name of PAGES) {
    try {
      await page.goto(url(`experiments/${name}.html`), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const btn = page.locator('#pause-btn');
      if (await btn.count() !== 1) continue;
      // Some pages sit idle until their own Start.
      const start = page.locator('#start-btn, #launch-btn, #excite-btn').first();
      if (await start.count() === 1 && await start.isEnabled()) {
        await start.click();
        await page.waitForTimeout(500);
      }
      const stage = page.locator('#stage, canvas').first();
      if (await stage.count() === 0) continue;
      await stage.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      const box = await stage.boundingBox();
      const vp = page.viewportSize();
      if (!box) continue;
      const x = Math.max(0, Math.min(box.x, vp.width));
      const y = Math.max(0, Math.min(box.y, vp.height));
      const clip = { x, y, width: Math.min(box.width, vp.width - x),
                     height: Math.min(box.height, vp.height - y) };
      if (clip.width < 1 || clip.height < 1) continue;
      const shot = async () =>
        (await page.screenshot({ clip, timeout: 25000 })).toString('base64');

      await btn.click();
      await page.waitForTimeout(500);
      checked++;
      const a = await shot();
      await page.waitForTimeout(1000);
      if (a !== (await shot())) moving.push(name);
    } catch (e) {
      broke.push(`${name}: ${String(e.message || e).split('\n')[0]}`);
    }
  }
  chk(`Pause stops the picture, not only the clock — ${checked} pages with the button`,
      moving.length === 0, moving.slice(0, 5).join(', '));
  chk('and every one of them could be photographed paused',
      broke.length === 0, broke.slice(0, 3).join(' | '));
  await ctx.close();
}

/*
 * Every stage has to hand the display as many pixels as the display has.
 *
 * A canvas whose backing store is smaller than its CSS box times the device
 * pixel ratio is upscaled by the compositor: soft edges, blurred text, and
 * nothing in the page to say so. epidemic was doing it — 860 px of store
 * stretched over a 658 px box on a 2× screen, 1.31× where the other
 * forty-one pages are 2.00× or better — because it sized its canvas from the
 * width attribute in the markup and never looked at devicePixelRatio.
 *
 * Checked at 2×, because at 1× an under-sized store is indistinguishable
 * from a correct one.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 },
                                         deviceScaleFactor: 2 });
  /*
   * The two 3D pages fetch three.js from a CDN, which this container's browser
   * cannot reach and CI can — so without this the sweep measured 40 canvases
   * here and 42 there, and the two it dropped were the only ones on the site
   * whose backing store is not simply width × dpr. The check went green here
   * three times and red on CI on a page that had never been looked at locally.
   */
  await serveCdn(ctx);
  const page = await ctx.newPage();
  const soft = [], broke = [], exceptions = [];
  let measured = 0;
  /*
   * Pages that hand the display fewer pixels than it has, on purpose, with
   * the fraction they were built to use. blackhole ray-marches a geodesic per
   * pixel — up to 240 integration steps at Medium — so its preset renders at
   * 0.8 of the device ratio and offers High and Ultra to anyone who would
   * rather have the pixels than the frame rate. That is a different thing
   * from forgetting devicePixelRatio, and the check below proves which it is.
   */
  const BELOW_ON_PURPOSE = { blackhole: 0.8 };
  for (const name of PAGES) {
    try {
      await page.goto(url(`experiments/${name}.html`),
                      { waitUntil: 'domcontentloaded', timeout: 25000 });
      /*
       * Wait for a canvas that has been laid out and sized, rather than half
       * a second. A page still booting reports a zero-width box and drops out
       * of the count, and on a slower runner enough of them dropped out to
       * take the coverage floor below its minimum — this check went red on CI
       * while passing here three times running. The two 3D pages need seconds,
       * not milliseconds, before their canvas exists at its real size.
       */
      await page.waitForFunction(() => {
        const c = document.querySelector('canvas');
        return c && c.width > 2 && c.getBoundingClientRect().width > 2;
      }, null, { timeout: 20000 }).catch(() => {});
      const r = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        if (!c) return null;
        const box = c.getBoundingClientRect();
        if (box.width < 2 || c.width < 2) return null;
        return { store: c.width, css: Math.round(box.width),
                 dpr: window.devicePixelRatio, ratio: c.width / box.width };
      });
      if (!r) continue;
      measured++;
      const want = (BELOW_ON_PURPOSE[name] ?? 1) * r.dpr;
      // Allow a little slack for rounding, not for a halved store.
      if (r.ratio < want * 0.95) {
        soft.push(`${name} (${r.store} px store for a ${r.css} px box at ${r.dpr}× — `
          + `${r.ratio.toFixed(2)}×, wanted ${want.toFixed(2)}×)`);
      }
      if (name in BELOW_ON_PURPOSE) exceptions.push({ name, ...r });
    } catch (e) {
      broke.push(`${name}: ${String(e.message || e).split('\n')[0]}`);
    }
  }
  chk(`no stage is upscaled on a 2× display — ${measured} canvases measured`,
      soft.length === 0 && measured >= 35, soft.slice(0, 4).join(' | ') || `only ${measured} measured`);
  chk('and every one of them could be measured', broke.length === 0, broke.slice(0, 3).join(' | '));

  /*
   * The exception, held to the reason it was granted.
   *
   * Allowing blackhole to sit at 1.6× on a list would let a genuinely lost
   * devicePixelRatio hide behind the same number for ever. So the claim is
   * that the shortfall is the quality preset and nothing else: at Medium the
   * store is dpr × 0.8, and asking for High has to move it to the full dpr on
   * the same page in the same box. A page that had dropped the pixel ratio
   * would not move.
   */
  if (exceptions.some((e) => e.name === 'blackhole')) {
    await page.goto(url('experiments/blackhole.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__bh && document.querySelector('canvas')?.width > 2,
                               null, { timeout: 30000 }).catch(() => {});
    const seen = {};
    for (const q of ['medium', 'high', 'ultra']) {
      await page.evaluate((n) => window.__bh.preset(n), q);
      await page.waitForTimeout(300);
      seen[q] = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c.width / c.getBoundingClientRect().width;
      });
    }
    const ok = Math.abs(seen.medium / (2 * 0.8) - 1) < 0.05
      && Math.abs(seen.high / 2 - 1) < 0.05
      && seen.ultra > seen.high * 1.1;
    chk('and the one stage below 2× is the quality preset saying so, not a lost ratio',
        ok, Object.entries(seen).map(([q, v]) => `${q} ${v.toFixed(2)}×`).join(', '));
  }
  await ctx.close();
}

await finish('sweep');
