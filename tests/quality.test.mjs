/*
 * The quality setting: a finer step, never a different answer.
 *
 * Fine halves-or-better the time step of the pages that consult it, the way a
 * real lab buys a better instrument — the sampling changes, the phenomenon
 * must not. So the two things worth holding are the wiring (the toggle
 * actually reaches the step size, persists, and rebuilds the field) and the
 * promise (the same closed-form tolerances the standard suites use still
 * hold when the step is fine).
 *
 * The control must exist only where it does something: a quality toggle on a
 * page that never consults it would be furniture, and this suite checks its
 * absence as firmly as its presence.
 */
import { browser, chk, url, finish } from './lib/harness.mjs';

const WIRED = ['epidemic', 'expression', 'decay'];

// ── The control, its persistence, and its reach ──────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(url('experiments/expression.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  chk('the wired pages carry the quality control',
      await page.locator('.quality-btn').count() === 1);

  // In the chrome row beside the theme button — not merely somewhere. The
  // first cut mounted before theme.js had built the row, and the fallback
  // parked the button at the bottom of the page; existence alone passed.
  chk('and it sits in the chrome row with the theme control, not in a fallback slot',
      await page.locator('.chrome-row .quality-btn').count() === 1
      && await page.evaluate(() => {
        const b = document.querySelector('.quality-btn').getBoundingClientRect();
        return b.top < 200 && b.height > 0;
      }),
      'the button is not in .chrome-row near the top of the page');

  const before = await page.evaluate(() => ({
    dt: window.__expr.DT, label: document.querySelector('.quality-btn').textContent.trim(),
  }));
  await page.click('.quality-btn');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    dt: window.__expr.DT, level: window.Quality.level,
    label: document.querySelector('.quality-btn').textContent.trim(),
    t: window.__expr.state().t,
  }));
  chk('Fine reaches the step size — the simulation really steps more finely',
      before.dt === 0.01 && after.dt === 0.004 && after.level === 'fine',
      `DT ${before.dt} -> ${after.dt}, level ${after.level}`);
  chk('and the field is rebuilt for it, since its probabilities were baked at the old step',
      after.t === 0, `t = ${after.t}`);
  chk('and the button says so', before.label !== after.label,
      `"${before.label}" -> "${after.label}"`);

  // The setting is the reader's, not the tab's.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const persisted = await page.evaluate(() => ({
    dt: window.__expr.DT, level: window.Quality.level,
  }));
  chk('the choice survives a reload', persisted.level === 'fine' && persisted.dt === 0.004,
      JSON.stringify(persisted));

  // Same storage, different page: epidemic opens already fine.
  await page.goto(url('experiments/epidemic.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const epi = await page.evaluate(() => ({ dt: window.__epi.DT, level: window.Quality.level }));
  chk('and it is one setting across the site, not one per page',
      epi.level === 'fine' && epi.dt === 0.02, JSON.stringify(epi));
  await ctx.close();
}

// ── Absent where it can do nothing ───────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(url('experiments/pendulum.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  chk('a page that does not consult the setting does not offer the toggle',
      await page.locator('.quality-btn').count() === 0);
  await page.close();
}

// ── The promise: sharper, never different ────────────────────────────
{
  /*
   * Everything below runs at Fine, against the very tolerances the standard
   * suites hold their pages to. Quality must never be needed for the physics
   * to land — and it must not move it either.
   */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(url('experiments/epidemic.html'), { waitUntil: 'networkidle' });
  await page.evaluate(() => window.Quality.set('fine'));
  await page.waitForTimeout(300);

  const epi = await page.evaluate(() => {
    const runs = [];
    for (let k = 0; k < 4; k++) {
      const r = window.__epi.run({ N: 4000, c: 4, p: 0.5, g: 1, speed: 1 });
      if (r.finalFraction > 0.02) runs.push(r);
    }
    const avg = (f) => runs.map(f).reduce((a, b) => a + b, 0) / runs.length;
    return { took: runs.length, r0: avg((x) => x.r0),
             fin: avg((x) => x.finalFraction), finT: avg((x) => x.finalTheory),
             period: avg((x) => x.period), dt: window.__epi.DT };
  });
  chk('a fine-stepped epidemic still counts the R₀ its dials imply (suite bound: 6%)',
      epi.dt === 0.02 && epi.took >= 2 && Math.abs(epi.r0 / 2.0 - 1) < 0.06,
      `DT=${epi.dt}, R₀ ${epi.r0.toFixed(3)} vs 2.0 over ${epi.took} runs`);
  chk('and its final size still solves the equation nobody typed in (suite bound: 0.03)',
      Math.abs(epi.fin - epi.finT) < 0.03,
      `${epi.fin.toFixed(4)} vs ${epi.finT.toFixed(4)}`);
  chk('and the infectious period is still 1/γ (suite bound: 5%)',
      Math.abs(epi.period - 1) < 0.05, `${epi.period.toFixed(3)} vs 1.000`);

  await page.goto(url('experiments/expression.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const expr = await page.evaluate(() => {
    const flat = window.__expr.run({ cells: 1500, k: 20, kon: 1, koff: 0, g: 1 });
    const bursty = window.__expr.run({ cells: 1500, k: 30, kon: 1, koff: 1, g: 1 });
    return { dt: window.__expr.DT, flatFano: flat.fano,
             burstyFano: bursty.fano, burstyTheory: bursty.fanoTheory };
  });
  chk('a fine-stepped never-off gene is still Poisson (suite bound: |F−1| < 0.18)',
      expr.dt === 0.004 && Math.abs(expr.flatFano - 1) < 0.18,
      `DT=${expr.dt}, F=${expr.flatFano.toFixed(3)}`);
  chk('and a switching one still lands on the telegraph formula (suite bound: 15%)',
      Math.abs(expr.burstyFano / expr.burstyTheory - 1) < 0.15,
      `F=${expr.burstyFano.toFixed(2)} vs ${expr.burstyTheory.toFixed(2)}`);
  await ctx.close();
}

// ── The wiring is real in the third page too ─────────────────────────
{
  /*
   * decay reads the factor live inside step() rather than baking it, so the
   * observable is the sub-step cap's effect: at Fine the roll happens in
   * pieces at least 2.5× smaller. The page does not expose its sub-step
   * count, but it does expose time and the roll's granularity is time — so
   * the check reads the source for the consultation, which a deleted line
   * fails, and the shared-storage check above already proves the setting
   * reaches this page's context.
   */
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../experiments/decay.js', import.meta.url), 'utf8');
  chk('decay consults the setting for its sub-step cap',
      /halfLife \* \(window\.Quality \? window\.Quality\.pick\(0\.05, 0\.02\)/.test(src),
      'the sub-step cap no longer asks Quality');

  const q = fs.readFileSync(new URL('../assets/quality.js', import.meta.url), 'utf8');
  chk('and the fork itself is honest — fine returns the fine value, not a synonym for standard',
      /pick\(standard, fine\) \{ return level === "fine" \? fine : standard; \}/.test(q),
      'Quality.pick has been reworded — re-read it');
}

await finish('quality');
