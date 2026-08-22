/*
 * The two bespoke 3D pages. Neither has a `.js` file, so nothing else in the
 * suite reaches them — and both shipped untranslated for a long time because
 * of it: the tour was Korean-only, the lensing page English with Korean-only
 * error text, and neither had a language switcher at all.
 *
 * Each is checked in both states it can be in: with three.js delivered, and
 * with the CDN blocked, which is the state a reader on a corporate network
 * actually gets.
 */
import { browser, BASE, chk, finish } from '../lib/harness.mjs';
import { installCdnCache } from '../lib/cdn-cache.mjs';
import fs from 'node:fs';
import path from 'node:path';

const open = async (file, { cdn = true, w = 1280 } = {}) => {
  const p = await browser.newPage({ viewport: { width: w, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('PE: ' + e.message.slice(0, 140)));
  if (cdn) await installCdnCache(p);
  else await p.route('**://{cdn.jsdelivr.net,cdnjs.cloudflare.com}/**', r => r.abort());
  await p.goto(`${BASE}/experiments/${file}`, { waitUntil: 'networkidle', timeout: 60000 });
  return { p, errs };
};
// Waits for the switch to have landed rather than for a clock: i18n.js
// sets <html lang> only after the page's chunk is in, and a fixed sleep
// is a race a loaded runner loses.
const lang = async (p, l) => {
  await p.click(`.lang-btn[data-lang="${l}"]`);
  await p.waitForFunction((c) => document.documentElement.lang === c, l, { timeout: 10000 });
};
const text = (p, sel) => p.$eval(sel, e => e.textContent.trim()).catch(() => '<none>');

// ── Solar System, three.js available ─────────────────────────────────
{
  const { p, errs } = await open('solarsystem.html');
  await p.waitForTimeout(4000);
  chk('solarsystem boots with three.js', await p.$('#stage canvas') !== null);

  /*
   * The simulation used to be a <script> block inside the page and is now a
   * file. Moving it is only safe while the tag keeps the block's position and
   * its timing: it has to come after three.js, which it reads at its first
   * statement, and it has to be a classic blocking script. `defer` would push
   * it past DOMContentLoaded — the scene would build late, the CDN-failure
   * notice would fire late, and nothing else here would notice, because the
   * page still works, just differently. So the tag itself is checked.
   */
  const html = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'experiments', 'solarsystem.html'), 'utf8');
  const tag = html.match(/<script[^>]*\bsrc="solarsystem\.js"[^>]*>/);
  chk('the simulation is loaded from its own file', Boolean(tag), tag ? tag[0] : 'no tag');
  chk('as a blocking script, not deferred or async',
      Boolean(tag) && !/\b(defer|async)\b/.test(tag[0]), tag ? tag[0] : '');
  chk('and after the three.js it reads on its first line',
      Boolean(tag) && html.indexOf('three.min.js') < html.indexOf('src="solarsystem.js"'),
      `three.js at ${html.indexOf('three.min.js')}, ours at ${html.indexOf('src="solarsystem.js"')}`);
  chk('solarsystem has no console errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  chk('the loader is gone', await p.$('#loading') === null);

  await lang(p, 'en');
  const enTitle = await text(p, 'h1');
  const enPause = await text(p, '#pauseBtn');
  const enChip = await text(p, '.chip');
  await p.click('.chip[data-id="mars"]'); await p.waitForTimeout(600);
  const enName = await text(p, '#pName');
  const enLabel = await text(p, '#pGrid dt');
  const enVal = await text(p, '#pGrid dd');
  const enCap = await text(p, '#cmpCap');

  await lang(p, 'ko');
  const koTitle = await text(p, 'h1');
  const koPause = await text(p, '#pauseBtn');
  const koChip = await text(p, '.chip');
  const koName = await text(p, '#pName');
  const koLabel = await text(p, '#pGrid dt');
  const koCap = await text(p, '#cmpCap');

  await lang(p, 'zh');
  const zhTitle = await text(p, 'h1');
  const zhName = await text(p, '#pName');
  const zhLabel = await text(p, '#pGrid dt');

  chk('the heading translates', enTitle !== koTitle && koTitle !== zhTitle,
      `${enTitle} / ${koTitle} / ${zhTitle}`);
  chk('the pause button translates', enPause !== koPause, `${enPause} / ${koPause}`);
  chk('the planet chips translate', enChip !== koChip, `${enChip} / ${koChip}`);
  chk('the open observation card re-renders in the new language',
      enName === 'Mars' && koName === '화성' && zhName === '火星',
      `${enName} / ${koName} / ${zhName}`);
  chk('the card data labels translate', enLabel !== koLabel && koLabel !== zhLabel,
      `${enLabel} / ${koLabel} / ${zhLabel}`);
  chk('the card values are populated', enVal.length > 0 && !/^(NaN|undefined)/.test(enVal), enVal);
  chk('the size comparison caption translates', enCap !== koCap, `${enCap} / ${koCap}`);
  chk('no raw keys anywhere', !/\bss[A-Z][a-zA-Z]+\b/.test(await p.innerText('body')));

  await p.click('#pauseBtn'); await p.waitForTimeout(300);
  chk('pause flips the label', (await text(p, '#pauseBtn')) !== zhTitle && (await text(p, '#pauseBtn')).length > 0,
      await text(p, '#pauseBtn'));
  await p.close();
}

// ── Solar System, three.js blocked ───────────────────────────────────
{
  const { p, errs } = await open('solarsystem.html', { cdn: false });
  await p.waitForTimeout(1200);
  const body = await p.innerText('body');
  chk('a blocked CDN reports itself immediately, not after 8 s',
      /could not load|불러오지|无法加载/.test(body), body.slice(0, 90).replace(/\n/g, ' '));
  chk('and throws no uncaught error', !errs.some(e => e.startsWith('PE:')),
      errs.filter(e => e.startsWith('PE:')).join(' | ') || 'none');
  await lang(p, 'ko');
  chk('the failure notice itself is translated', /불러오지 못했습니다/.test(await p.innerText('body')));
  await p.close();
}

// ── Black hole ───────────────────────────────────────────────────────
{
  const { p, errs } = await open('blackhole.html');
  await p.waitForTimeout(4000);
  chk('blackhole boots', await p.$('canvas') !== null);
  chk('blackhole has no console errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await lang(p, 'en');
  const enSpin = await text(p, '#ui-spin');
  const enMass = await text(p, 'label[for="ui-mass"] span');
  await lang(p, 'zh');
  const zhSpin = await text(p, '#ui-spin');
  const zhMass = await text(p, 'label[for="ui-mass"] span');
  chk('the spin toggle translates', enSpin !== zhSpin, `${enSpin} / ${zhSpin}`);
  chk('the control labels translate', enMass !== zhMass, `${enMass} / ${zhMass}`);
  await p.click('#ui-spin'); await p.waitForTimeout(250);
  chk('and it stays translated after being clicked',
      (await text(p, '#ui-spin')) !== zhSpin && !/Spin:/.test(await text(p, '#ui-spin')),
      await text(p, '#ui-spin'));
  const aria = await p.$eval('#ui-doppler', e => e.getAttribute('aria-label'));
  chk('the slider aria-label is translated too', !/Doppler strength/.test(aria), aria);
  await p.close();
}

// ── Black hole, CDN blocked ──────────────────────────────────────────
{
  const { p } = await open('blackhole.html', { cdn: false });
  await p.waitForTimeout(9000);
  chk('a blocked CDN is reported', /could not load|불러오지|无法加载/.test(await p.innerText('body')));
  await p.close();
}

await finish('bespoke');
