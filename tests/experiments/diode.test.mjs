import fs from 'node:fs';
import path from 'node:path';
import { browser, chk, rows, BASE, ROOT, finish, lang } from '../lib/harness.mjs';

/*
 * The PN junction, held to being a diode.
 *
 * This page is badged an illustration, and that badge is the honest one: the
 * carriers are a few dozen dots, not 10^17 per cubic centimetre, and the
 * ammeter reads a percentage rather than milliamps. What the badge does not
 * license is illustrating the wrong thing, and for a while this page did.
 *
 * The current used to be counted as bodies crossing the junction rather than
 * as charge crossing it, so an electron going one way and a hole going the
 * other — which is one current, doubled — cancelled to nothing. Underneath
 * that, the depletion field was a constant while only the width moved, so
 * reverse bias built a barrier that was wider and no stronger and the drift
 * walked straight through it; and carriers leaving one edge reappeared at the
 * other, which kept the P side permanently stocked with electrons. Reverse
 * bias conducted more freely than forward. The panel showed the asymmetry
 * anyway, because currentLabel() had a branch on the polarity that typed it
 * in.
 *
 * So the checks below are about where the asymmetry comes from. Nothing in
 * the page now consults the polarity to decide how much current to report:
 * one expression serves both directions, and reverse reads zero because the
 * carriers do not cross.
 *
 * One of them has to read the source to hold that. Put the polarity branch
 * back while the mechanism underneath is working and no measurement on the
 * page moves — the branch agrees with the truth it is shadowing — so the only
 * way to hold "the answer is not typed in" is to look at whether it is typed
 * in. Everything else here is measured off the running page.
 */

const V = { min: 0, max: 2 };          // the voltage slider's own range
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/diode.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__diode);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 1).join(''));

/** Settle the junction at a bias and read it. Eight seconds: the ammeter
 *  averages over one, and the carriers need several transits before the
 *  crossing rate means anything. */
const settle = (q) => page.evaluate((s) => {
  const D = window.__diode;
  D.setBattery(s.battery ?? true);
  D.setPolarity(s.polarity ?? 1);
  D.setVoltage(s.volts ?? 1);
  D.setTemperature(s.temp ?? 0.5);
  D.advance(8, 480);
  const before = D.state();
  D.advance(0.5, 30);
  const after = D.state();
  // The median, not the mean. A carrier that recombines during the window
  // reappears somewhere else in its own region, and that one jump of forty
  // pixels drags the mean of twenty-nine carriers by more than a real drift
  // would — which is how this check first failed, on a page that was sitting
  // perfectly still.
  const drift = (key) => {
    const d = after[key].map((c, i) => c.x - before[key][i].x).sort((x, y) => x - y);
    return d.length ? d[d.length >> 1] : 0;
  };
  return { ...after, driftE: drift('electrons'), driftH: drift('holes'),
           pct: parseFloat(after.current) || 0 };
}, q);

// ── the junction exists ───────────────────────────────────────────────────
{
  const s = await settle({});
  chk('the junction is built and its carriers are on the board',
      s.electrons.length > 10 && s.holes.length > 10 && s.deviceWidth > 200,
      `${s.electrons.length}e ${s.holes.length}h across ${s.deviceWidth.toFixed(0)} px`);
}

// ── rectification: the one thing a diode is for ───────────────────────────
{
  const f = await settle({ polarity: 1, volts: V.max });
  const r = await settle({ polarity: -1, volts: V.max });
  chk('at full forward bias current flows', f.pct > 40, `${f.pct}%`);
  chk('at the same voltage reversed, it does not', r.pct <= 2, `${r.pct}%`);
  chk('so the junction rectifies, which is the whole of what a diode does',
      f.pct >= r.pct + 40, `forward ${f.pct}%, reverse ${r.pct}%`);
  chk('and the panel names which way it is biased',
      /forward|순방향|正向/i.test(f.bias) && /reverse|역방향|反向/i.test(r.bias),
      `${f.bias} / ${r.bias}`);
}

// ── the reverse direction blocks at every voltage, not just one ───────────
{
  const seen = [];
  let blocked = true;
  for (const volts of [0.5, 1, 1.5, 2]) {
    const s = await settle({ polarity: -1, volts });
    seen.push(`${volts}V ${s.pct}%`);
    if (s.pct > 2) blocked = false;
  }
  chk('reverse bias blocks across the slider, and harder reverse does not break it down',
      blocked, seen.join(', '));
}

// ── a turn-on knee, which nothing types in ────────────────────────────────
{
  const curve = [];
  for (const volts of [0, 0.5, 1, 1.5, 2]) curve.push([volts, (await settle({ volts })).pct]);
  const shown = curve.map(([v, p]) => `${v}V ${p}%`).join(', ');
  chk('below the knee the forward direction carries nothing either',
      curve[0][1] <= 2 && curve[1][1] <= 2, shown);
  chk('above it, it carries most of what it can', curve[4][1] > 40, shown);
  // Monotone in the mean, with room for the counting noise: the reading is a
  // crossing rate off 58 carriers, so neighbouring points overlap.
  let rises = true;
  for (let i = 1; i < curve.length; i++) if (curve[i][1] < curve[i - 1][1] - 15) rises = false;
  chk('and the curve climbs with the voltage the whole way, never doubling back',
      rises, shown);
}

// ── the barrier, which is where the rectification comes from ──────────────
{
  const off = await settle({ battery: false });
  const f1 = await settle({ polarity: 1, volts: 1 });
  const f2 = await settle({ polarity: 1, volts: V.max });
  chk('forward bias narrows the depletion region, and harder forward narrows it more',
      f1.depletionHalfWidth < off.depletionHalfWidth && f2.depletionHalfWidth <= f1.depletionHalfWidth,
      `off ${off.depletionHalfWidth.toFixed(1)} → 1 V ${f1.depletionHalfWidth.toFixed(1)}`
      + ` → ${V.max} V ${f2.depletionHalfWidth.toFixed(1)}`);

  const r1 = await settle({ polarity: -1, volts: 1 });
  const r2 = await settle({ polarity: -1, volts: V.max });
  chk('and reverse bias widens it, the other way about',
      r1.depletionHalfWidth > off.depletionHalfWidth && r2.depletionHalfWidth > r1.depletionHalfWidth,
      `off ${off.depletionHalfWidth.toFixed(1)} → 1 V ${r1.depletionHalfWidth.toFixed(1)}`
      + ` → ${V.max} V ${r2.depletionHalfWidth.toFixed(1)}`);

  chk('which is why the barrier is wide exactly when the current is small',
      r2.depletionHalfWidth > f2.depletionHalfWidth && r2.pct < f2.pct,
      `reverse ${r2.depletionHalfWidth.toFixed(1)} px at ${r2.pct}%,`
      + ` forward ${f2.depletionHalfWidth.toFixed(1)} px at ${f2.pct}%`);
}

// ── which way the carriers actually go ────────────────────────────────────
{
  /*
   * Which way a carrier is being pushed has to be read out of the transient,
   * not out of a settled run, and it took two failing checks to see why. Once
   * the junction has been at a bias for a few seconds every carrier is in a
   * cycle — driven across and recombined, or driven into its contact and
   * re-emitted — and each lap ends with a jump backwards that cancels the
   * travel. The mean displacement over a window is then about zero whichever
   * way the battery points, and reads as pure noise. So: settle at rest,
   * throw the switch, and watch the first four-tenths of a second, which is
   * less than it takes anyone to reach the far end.
   */
  const kick = (polarity) => page.evaluate((p) => {
    const D = window.__diode;
    D.setBattery(true); D.setPolarity(1); D.setVoltage(0); D.setTemperature(0.5);
    D.advance(6, 360);
    const before = D.state();
    D.setPolarity(p); D.setVoltage(2);
    D.advance(0.4, 24);
    const after = D.state();
    const drift = (k) => {
      const d = after[k].map((c, i) => c.x - before[k][i].x).sort((x, y) => x - y);
      return d[d.length >> 1];
    };
    return { e: drift('electrons'), h: drift('holes') };
  }, polarity);

  const fk = await kick(1);
  chk('switched to forward, electrons and holes drift toward each other, not together',
      fk.e > 1 && fk.h < -1, `e ${fk.e.toFixed(1)} px, h ${fk.h.toFixed(1)} px`);

  const rk = await kick(-1);
  chk('and switched to reverse it pulls them apart instead — both drifts turn round',
      rk.e < -1 && rk.h > 1, `e ${rk.e.toFixed(1)} px, h ${rk.h.toFixed(1)} px`);

  // Where they end up is the picture the page is actually drawing.
  const away = (s) => {
    const j = s.junctionX;
    const d = (arr) => arr.reduce((t, c) => t + Math.abs(c.x - j), 0) / arr.length;
    return (d(s.electrons) + d(s.holes)) / 2;
  };
  const f = await settle({ polarity: 1, volts: V.max });
  const r = await settle({ polarity: -1, volts: V.max });
  chk('so forward bias crowds them onto the junction and reverse clears them off it',
      away(r) > away(f) * 1.5,
      `mean distance from the junction: forward ${away(f).toFixed(0)} px, reverse ${away(r).toFixed(0)} px`);
}

// ── the settings that mean nothing is happening ───────────────────────────
{
  const off = await settle({ battery: false });
  chk('with the battery off the panel reports no bias and no current',
      /off|꺼짐|关/i.test(off.bias) && off.current === '—',
      `${off.bias} / ${off.current}`);
  chk('and nothing drifts either way', Math.abs(off.driftE) < 1 && Math.abs(off.driftH) < 1,
      `e ${off.driftE.toFixed(1)} px, h ${off.driftH.toFixed(1)} px`);

  const zero = await settle({ volts: 0 });
  chk('at zero volts it is biased neither way, with nothing flowing',
      /zero|영|零/i.test(zero.bias) && zero.pct === 0, `${zero.bias} / ${zero.current}`);
  /*
   * There was a check here that the back-and-forth traffic across the
   * junction does not average up into a current that is not there — the
   * reason the page smooths the signed rate rather than its size. It is
   * gone, because counting the crossings showed there is no such traffic to
   * average: below the knee and in reverse the tally over ten seconds is
   * exactly zero, at every temperature the slider offers, and above the knee
   * every crossing goes the same way. Rectifying before smoothing is still
   * the wrong thing to do and the page still does not do it, but on this
   * page the difference cannot be observed, and a check that cannot fail is
   * not evidence of anything. Planting that defect passed all 28.
   */
}

// ── the readout is a rate, not a per-frame tally ──────────────────────────
{
  // Same eight seconds of physics, four times the steps. A tally per frame
  // would read a quarter as much.
  const at = (steps) => page.evaluate((n) => {
    const D = window.__diode;
    D.setBattery(true); D.setPolarity(1); D.setVoltage(2); D.setTemperature(0.5);
    D.advance(8, n);
    return Math.abs(D.state().currentRate);
  }, steps);
  const coarse = await at(240);
  const fine = await at(960);
  chk('the ammeter reads the same at four times the frame rate, being a rate itself',
      Math.abs(coarse - fine) < 0.5 * Math.max(coarse, fine),
      `${coarse.toFixed(3)} at 30 fps vs ${fine.toFixed(3)} at 120`);
}

// ── i18n and chrome ───────────────────────────────────────────────────────
{
  const title = async () => (await page.locator('h1').textContent()).trim();
  const en = await title();
  await lang(page, 'ko');
  const ko = await title();
  await lang(page, 'zh');
  const zh = await title();
  await lang(page, 'en');
  chk('title translates en/ko/zh and returns',
      en !== ko && ko !== zh && (await title()) === en, `${en} / ${ko} / ${zh}`);

  const missing = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', missing.length === 0, missing.slice(0, 3).join(', '));

  chk('the page badges itself an illustration, and claims nothing more',
      await page.locator('.method-tag[data-method="illustrated"]').count() === 1);

  // The one source-level check, for the reason given at the top of the file.
  {
    const src = fs.readFileSync(path.join(ROOT, 'experiments/diode.js'), 'utf8');
    const at = src.indexOf('function currentLabel(');
    let depth = 0, end = at;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = src.slice(at, end);
    chk('and the ammeter does not ask which way the battery points before answering',
        at !== -1 && !/\bpolarity\b/.test(body),
        at === -1 ? 'currentLabel() not found' : 'currentLabel() branches on polarity');
  }
}

chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const w of [320, 390, 768]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(160);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
}

console.log('=== diode ===');
let f = 0;
for (const r of rows) { if (!r.ok) f++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok || !r.d ? '' : '  ::  ' + r.d}`); }
console.log(`\n${rows.length - f}/${rows.length} passed`);
await finish('diode');
process.exit(f ? 1 : 0);
