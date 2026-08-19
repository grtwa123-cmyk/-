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
import { browser, chk, url, finish, ROOT } from './lib/harness.mjs';

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
  let probed = 0, resettable = 0;

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
        await btn.click();
        await page.waitForTimeout(300);
        const after = await controlState();
        const moved = Object.keys(opened).filter((k) => opened[k] !== after[k]);
        if (moved.length) {
          drifted.push(`${name} ${moved.slice(0, 2)
            .map((k) => `#${k} ${opened[k]}→${after[k]}`).join(', ')}`);
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
  const atRest = [], afterStart = [], noNotice = [];
  let started = 0;

  for (const name of PAGES) {
    try {
      await page.goto(url(`experiments/${name}.html`),
                      { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(700);
    } catch { continue; }

    const stage = page.locator('#stage, canvas').first();
    if (await stage.count() === 0) continue;
    const shot = async () => (await stage.screenshot()).toString('base64');

    if (await page.locator('.motion-notice').count() !== 1) noNotice.push(name);

    const a = await shot();
    await page.waitForTimeout(900);
    if (a !== (await shot())) atRest.push(name);

    // And after the reader presses the page's own Start: the gate freezes the
    // rAF timestamp, which does nothing for a loop that steps a fixed count
    // per callback and never reads the clock.
    const start = page.locator('#start-btn, #launch-btn, #excite-btn').first();
    if (await start.count() === 1 && await start.isEnabled()) {
      started++;
      await start.click();
      await page.waitForTimeout(400);
      const c = await shot();
      await page.waitForTimeout(900);
      if (c !== (await shot())) afterStart.push(name);
    }
  }

  chk('under reduced motion no page animates at rest',
      atRest.length === 0, atRest.slice(0, 5).join(', '));
  chk(`nor after its own Start is pressed — ${started} pages with one`,
      afterStart.length === 0, afterStart.slice(0, 5).join(', '));
  chk('and every one of them says so, with the notice that offers Play',
      noNotice.length === 0, noNotice.slice(0, 5).join(', '));
  await ctx.close();
}

await finish('sweep');
