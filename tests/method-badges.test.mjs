/*
 * The method badge is a claim the site makes about itself on every experiment
 * page: measured, integrated, solved, closed form, real data, illustration —
 * and, separately, whether a suite checks it.
 *
 * A claim nothing enforces is marketing. These checks are what stop it from
 * drifting: the badge on the page has to match the catalogue, the "verified"
 * mark has to match what is actually on disk in tests/experiments, and a page
 * badged `measured` has to expose a hook that a test could read the
 * measurement out of — because that is what the word means here.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { browser, chk, url, finish, lang } from './lib/harness.mjs';
import { installCdnCache } from './lib/cdn-cache.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');

const METHODS = ['measured', 'integrated', 'solved', 'formula', 'model', 'illustrated'];
const KEY = {
  measured: 'methodMeasured', integrated: 'methodIntegrated', solved: 'methodSolved',
  formula: 'methodFormula', model: 'methodModel', illustrated: 'methodIllustrated',
};

// ── The catalogue ─────────────────────────────────────────────────────
const cat = read('assets/index/experiments.js');
const entries = [...cat.matchAll(/url: "(experiments\/([a-z]+)\.html)"[^}]*?method: "([a-z]+)"/g)]
  .map((m) => ({ url: m[1], name: m[2], method: m[3] }));

chk('every catalogue entry declares a method',
    entries.length === (cat.match(/url: "experiments\//g) || []).length,
    `${entries.length} of ${(cat.match(/url: "experiments\//g) || []).length}`);

const unknown = entries.filter((e) => !METHODS.includes(e.method));
chk('every method is one of the six known values', unknown.length === 0,
    unknown.map((e) => `${e.name}=${e.method}`).join(', '));

// ── The badge on each page matches the catalogue ──────────────────────
{
  const wrong = [];
  for (const e of entries) {
    const html = read(e.url);
    const m = html.match(/class="method-tag" data-method="([a-z]+)" data-i18n="([A-Za-z]+)"/);
    if (!m) { wrong.push(`${e.name}: no badge`); continue; }
    if (m[1] !== e.method) wrong.push(`${e.name}: page says ${m[1]}, catalogue says ${e.method}`);
    if (m[2] !== KEY[e.method]) wrong.push(`${e.name}: label key ${m[2]} does not match ${e.method}`);
  }
  chk('every experiment page carries the badge its catalogue entry declares',
      wrong.length === 0, wrong.slice(0, 4).join(' | '));
}

// ── "Verified" means a physics suite exists, and nothing else ─────────
const suites = new Set(readdirSync(`${ROOT}/tests/experiments`)
  .filter((f) => f.endsWith('.test.mjs')).map((f) => f.replace('.test.mjs', '')));
const verifiedCount = entries.filter((e) => suites.has(e.name)).length;
{
  const wrong = [];
  for (const e of entries) {
    const claimed = read(e.url).includes('class="method-verified"');
    const real = suites.has(e.name);
    if (claimed !== real) {
      wrong.push(`${e.name}: page ${claimed ? 'claims' : 'omits'} verified, suite ${real ? 'exists' : 'does not'}`);
    }
  }
  chk('a page is marked verified exactly when it has a suite of its own',
      wrong.length === 0, wrong.slice(0, 4).join(' | '));

  // The table view repeats the claim, so it has to agree as well.
  const tv = read('assets/index/table-view.js');
  const listed = new Set([...tv.matchAll(/"(experiments\/[a-z]+\.html)"/g)].map((m) => m[1]));
  const should = new Set(entries.filter((e) => suites.has(e.name)).map((e) => e.url));
  const missing = [...should].filter((u) => !listed.has(u));
  const extra = [...listed].filter((u) => !should.has(u));
  chk("the table view's verified list matches the suites on disk",
      missing.length === 0 && extra.length === 0,
      `missing ${missing.join(',') || 'none'}; extra ${extra.join(',') || 'none'}`);
}

// ── `measured` has to mean something ──────────────────────────────────
{
  // Every page that claims its result is read out of the mechanism exposes a
  // window.__* hook — that hook is how a suite reads the measurement out, and
  // a page with no way to be interrogated cannot support the claim.
  const noHook = [];
  for (const e of entries.filter((x) => x.method === 'measured')) {
    const js = existsSync(`${ROOT}/experiments/${e.name}.js`)
      ? read(`experiments/${e.name}.js`) : read(e.url);
    if (!/window\.__[a-zA-Z]+\s*=/.test(js)) noHook.push(e.name);
  }
  chk('every page badged `measured` exposes a hook the measurement can be read from',
      noHook.length === 0, noHook.join(', '));
}

// ── The labels exist in all three languages ───────────────────────────
{
  const need = [...METHODS.map((m) => KEY[m]), ...METHODS.map((m) => KEY[m] + 'Why'),
    'methodVerified', 'methodVerifiedWhy', 'methodLegend'];
  const missing = [];
  for (const lang of ['en', 'ko', 'zh']) {
    const dict = read(`i18n/${lang}.js`);
    for (const k of need) if (!new RegExp(`^  ${k}:`, 'm').test(dict)) missing.push(`${lang}/${k}`);
  }
  chk('every badge label and explanation is translated in all three languages',
      missing.length === 0, missing.slice(0, 5).join(', '));
}

// ── And it renders ────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(url('experiments/phases.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const seen = await page.$eval('.method-tag', (el) => ({
    text: el.textContent.trim(), title: el.getAttribute('title'),
    method: el.dataset.method,
  }));
  chk('the badge renders with its translated label and explanation',
      seen.method === 'measured' && seen.text.length > 0 && seen.title.length > 20,
      `${seen.text} — "${(seen.title || '').slice(0, 40)}…"`);

  await lang(page, 'ko');
  const ko = await page.$eval('.method-tag', (el) => ({
    text: el.textContent.trim(), title: el.getAttribute('title'),
  }));
  chk('and both translate', ko.text !== seen.text && ko.title !== seen.title,
      `${seen.text} → ${ko.text}`);

  chk('the verified mark renders beside it',
      (await page.$eval('.method-verified', (el) => el.textContent.trim())).length > 0);

  // The landing table repeats the claim for the whole catalogue. Reaching it
  // means switching view the way a reader does — there is no ?view= parameter,
  // the choice lives in localStorage. Asking for a URL that does not exist
  // happened to work here only because the CDN is blocked in the sandbox, so
  // the wall failed and fell back to the table; on CI the wall loads and there
  // is no table to find. Serve the CDN and press the button instead, so this
  // checks the same thing in both places.
  await installCdnCache(page);
  await page.goto(url('index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#uiSwitch .ui-btn[data-ui="table"]', { timeout: 20000 });
  await page.click('#uiSwitch .ui-btn[data-ui="table"]');
  await page.waitForSelector('.tv-table tbody tr', { timeout: 20000 });
  const counts = await page.evaluate(() => {
    const tags = [...document.querySelectorAll('.tv-table .method-tag')];
    return { rows: document.querySelectorAll('.tv-table tbody tr').length,
      tags: tags.length, verified: document.querySelectorAll('.tv-table .method-verified').length,
      blank: tags.filter((t) => !t.textContent.trim()).length };
  });
  chk('the table view shows a method for every row',
      counts.rows > 0 && counts.tags === counts.rows && counts.blank === 0,
      `${counts.tags} badges over ${counts.rows} rows, ${counts.blank} blank`);
  // Derived, not written down: a hard-coded number here would be one more
  // claim to keep in step with the filesystem, which is the whole problem.
  chk('and marks exactly the verified ones', counts.verified === verifiedCount,
      `${counts.verified} marked, ${verifiedCount} suites on disk`);

  await page.close();
}

await finish('method-badges');
