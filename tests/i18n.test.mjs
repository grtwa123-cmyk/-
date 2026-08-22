import { browser, chk, rows, BASE, url, finish, lang } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const B = BASE;
const ROOT = path.resolve(import.meta.dirname, '..');

/*
 * Which language a page pulled. The dictionaries are cut per page by
 * tools/split-i18n.py, so the normal path is i18n/pages/<lang>/<page>.js and
 * the whole i18n/<lang>.js is the fallback for a key its chunk lacked —
 * watched separately, because fetching it is the thing that must not happen.
 */
const dictHits = (page) => { const hits=[]; page.on('request',r=>{
  const m=r.url().match(/\/i18n\/pages\/(en|ko|zh)\//); if(m) hits.push(m[1]); }); return hits; };
const fullHits = (page) => { const hits=[]; page.on('request',r=>{
  const m=r.url().match(/\/i18n\/(en|ko|zh)\.js$/); if(m) hits.push(m[1]); }); return hits; };

// ── Only the active dictionary is fetched ────────────────────────────────
for (const [locale, want] of [['en-US','en'],['ko-KR','ko'],['zh-CN','zh']]) {
  const ctx = await browser.newContext({ locale, viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  const hits = dictHits(page);
  await page.goto(`${B}/index.html`,{waitUntil:'networkidle'});
  await page.waitForTimeout(400);
  chk(`${locale}: loads only the ${want} dictionary`,
    hits.length===1 && hits[0]===want, `requested [${hits.join(',')}]`);
  chk(`${locale}: <html lang> is ${want}`,
    await page.evaluate(()=>document.documentElement.lang)===want,
    await page.evaluate(()=>document.documentElement.lang));
  await ctx.close();
}

// ── Switching loads on demand and actually changes the text ──────────────
{
  const ctx = await browser.newContext({ locale:'en-US', viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  const hits = dictHits(page);
  await page.goto(`${B}/physics.html`,{waitUntil:'networkidle'});
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await lang(page, 'ko');
  const ko = await h1();
  await lang(page, 'zh');
  const zh = await h1();
  await lang(page, 'en');
  const back = await h1();
  chk('switching en/ko/zh changes the heading and returns',
    ko!==en && zh!==en && zh!==ko && back===en, `${en} | ${ko} | ${zh}`);
  chk('each dictionary fetched exactly once, in order',
    JSON.stringify(hits)===JSON.stringify(['en','ko','zh']), `[${hits.join(',')}]`);
  // re-switch must not refetch
  await lang(page, 'ko');
  chk('re-selecting a language does not refetch it', hits.length===3, `[${hits.join(',')}]`);
  await ctx.close();
}

// ── Subdirectory pages resolve the dictionary path ───────────────────────
{
  const ctx = await browser.newContext({ locale:'ko-KR', viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  const fails=[]; page.on('requestfailed',r=>fails.push(r.url()));
  page.on('response',r=>{ if(/\/i18n\//.test(r.url())&&r.status()>=400) fails.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${B}/experiments/enzyme.html`,{waitUntil:'networkidle'});
  await page.waitForTimeout(500);
  chk('experiments/ page fetches its chunk without a 404', fails.length===0, fails.join(' '));
  const title = await page.evaluate(()=>document.querySelector('h1').textContent.trim());
  chk('experiments/ page is translated', /효소/.test(title), title);
}

// ── The chunks on disk are the ones the splitter would write ─────────────
{
  /*
   * tools/split-i18n.py cuts i18n/pages/** from the three dictionaries. Add a
   * key, a page or an import and the chunks go stale, which nothing at runtime
   * would notice — the fallback would quietly cover it and every reader on
   * that page would pay for a second request. So the script is rerun into a
   * scratch copy and the result compared with what is committed.
   */
  const CHUNKS = path.join(ROOT, 'i18n', 'pages');
  const snapshot = () => {
    const out = new Map();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else out.set(path.relative(CHUNKS, f), fs.readFileSync(f, 'utf8'));
      }
    };
    walk(CHUNKS);
    return out;
  };

  // Asked as "would rerunning it change anything", not against git's index:
  // the question is whether the files match the script, which is true or false
  // regardless of what has been staged.
  const before = snapshot();
  let ran = true, err = '';
  try {
    execFileSync('python3', [path.join(ROOT, 'tools', 'split-i18n.py')],
                 { cwd: ROOT, stdio: 'pipe' });
  } catch (e) { ran = false; err = String(e.stderr || e.message).slice(0, 200); }
  chk('tools/split-i18n.py runs', ran, err);

  const after = snapshot();
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((f) => before.get(f) !== after.get(f));
  chk(`and the ${after.size} chunks on disk are the ones it writes`,
      changed.length === 0,
      changed.length ? `stale: ${changed.slice(0, 6).join(', ')} — rerun tools/split-i18n.py` : '');

  const man = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'i18n', 'pages', 'manifest.json'), 'utf8'));
  const counts = Object.values(man.pages).map((v) => v.length).sort((a, b) => a - b);
  const full = Object.keys(JSON.parse(execFileSync(process.execPath,
    ['-e', 'globalThis.window=globalThis;window.i18nRegister=(l,d)=>'
         + 'process.stdout.write(JSON.stringify(d));'
         + `require(${JSON.stringify(path.join(ROOT, 'i18n', 'en.js'))});`],
    { encoding: 'utf8' })));
  chk(`no page carries more than a tenth of the dictionary — ${full.length} keys, `
      + `worst page ${counts[counts.length - 1]}`,
      counts[counts.length - 1] < full.length / 10,
      `min ${counts[0]}, median ${counts[counts.length >> 1]}, max ${counts[counts.length - 1]}`);
}

// ── No page needs the fallback ───────────────────────────────────────────
{
  /*
   * The point of the whole arrangement. A key a chunk does not carry still
   * reaches the reader — i18n.js fetches the full dictionary and repaints —
   * but it costs a request and a flash of untranslated markup, so it must
   * never happen on a page as shipped.
   *
   * Every page is opened and switched through all three languages. That
   * reaches the markup and everything the language-change handlers redraw; the
   * keys a reader has to earn by moving a control are reached by each page's
   * own suite, which checks window.__i18nMisses in the same way.
   */
  const pages = ['index.html', 'physics.html', 'chemistry.html', 'biology.html']
    .concat(fs.readdirSync(path.join(ROOT, 'experiments'))
              .filter((f) => f.endsWith('.html')).map((f) => `experiments/${f}`));
  const short = [];
  for (const pg of pages) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    const full = fullHits(page);
    await page.goto(url(pg), { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(400);
    for (const l of ['ko', 'zh', 'en']) {
      await page.evaluate((x) => window.i18n.applyLang(x), l);
      await page.waitForTimeout(350);
    }
    const miss = await page.evaluate(() => window.__i18nMisses || []);
    await ctx.close();
    if (miss.length || full.length) short.push(`${pg}: ${miss.slice(0, 4).join(' ') || full.join(' ')}`);
  }
  chk(`every page's chunk carries every key it paints — ${pages.length} pages, three languages each`,
      short.length === 0,
      short.length ? `${short.slice(0, 4).join(' | ')} — rerun tools/split-i18n.py` : '');
}

// ── And the fallback works, for when one does ────────────────────────────
{
  /*
   * The net is only worth having if it holds, and nothing above exercises it
   * precisely because nothing is allowed to need it. So a chunk is served with
   * one key cut out of it, and the page has to end up showing the string
   * anyway — from the full dictionary, fetched because the key was missed.
   */
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const full = fullHits(page);
  await page.route(/\/i18n\/pages\/en\/physics\.js$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/^\s*"physicsHubTitle":.*$/m, '');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  await page.goto(`${B}/physics.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const missed = await page.evaluate(() => window.__i18nMisses || []);
  const heading = await page.evaluate(() => document.querySelector('h1').textContent.trim());
  await ctx.close();

  chk('a key cut out of a chunk is noticed', missed.includes('physicsHubTitle'), missed.slice(0, 4).join(' '));
  chk('and pulls the whole dictionary in behind it', full.includes('en'), `[${full.join(',')}]`);
  chk('so the reader still gets the string, not the key',
      heading.length > 0 && heading !== 'physicsHubTitle', heading);
}

{
  /*
   * The same again for the other way in. The check above cuts a data-i18n key,
   * which paint() walks and reports; a key asked for through t() takes a
   * different path, and deleting the report from t() left everything above
   * green. So this cuts the theme button's label, which assets/theme.js builds
   * as "theme" + the mode and looks up through t() alone — nothing in the
   * markup names it.
   */
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const full = fullHits(page);
  await page.route(/\/i18n\/pages\/en\/physics\.js$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/^\s*"theme(Auto|Light|Dark)":.*$/gm, '');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  await page.goto(`${B}/physics.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const missed = await page.evaluate(() => window.__i18nMisses || []);
  const label = await page.evaluate(() =>
    (document.querySelector('.theme-btn') || {}).textContent || '');
  await ctx.close();

  chk('a key reached only through t() is noticed too',
      missed.some((k) => /^theme(Auto|Light|Dark)$/.test(k)), missed.slice(0, 4).join(' '));
  chk('and it pulls the dictionary in the same way', full.includes('en'), `[${full.join(',')}]`);
  chk('and the button ends up labelled, not blank', label.trim().length > 0, JSON.stringify(label));
}

// ── Dictionaries carry text, never markup ────────────────────────────────
{
  /*
   * i18n.js assigns with textContent, unconditionally — so a tag inside a
   * dictionary value is not formatting, it is five visible characters. This
   * shipped twice before anyone noticed: refractionNote1 carried <code> and
   * genNote3 carried <strong>, and both pages printed the tags at the reader
   * in all three languages.
   *
   * Inline code in a note belongs in the markup, beside the translated label,
   * the way the Formulas lists already do it.
   */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dicts = {};
  globalThis.window = { i18nRegister: (l, d) => { dicts[l] = d; } };
  for (const loc of ['en', 'ko', 'zh']) {
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(path.join(root, 'i18n', `${loc}.js`), 'utf8'));
  }
  /*
   * Only the keys actually bound through an attribute are held to this. A page
   * may still pull a string out with t() and inject it with innerHTML on
   * purpose — solarsystem's comparison caption does exactly that, and its <b>
   * is meant — but anything reached by data-i18n goes through textContent and
   * cannot contain a tag.
   */
  const bound = new Set();
  const files = [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.html')),
    ...fs.readdirSync(path.join(root, 'experiments'))
      .filter((f) => f.endsWith('.html')).map((f) => `experiments/${f}`),
  ];
  for (const f of files) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([A-Za-z0-9_]+)"/g)) {
      bound.add(m[1]);
    }
  }
  const offenders = [];
  for (const [loc, d] of Object.entries(dicts)) {
    for (const k of bound) {
      const v = d[k];
      if (typeof v === 'string' && /<\/?[a-zA-Z][^>]*>/.test(v)) offenders.push(`${loc}.${k}`);
    }
  }
  chk(`no data-i18n value contains an HTML tag — ${bound.size} keys, textContent would print it`,
      offenders.length === 0, offenders.slice(0, 5).join(', '));
}

// ── No raw keys painted, in DOM or on canvas ─────────────────────────────
{
  const ctx = await browser.newContext({ locale:'ko-KR', viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  await page.goto(`${B}/experiments/enzyme.html`,{waitUntil:'networkidle'});
  await page.waitForTimeout(900);
  const raw = await page.evaluate(()=>{
    const bad=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const txt=(el.tagName==='TITLE'?document.title:el.textContent).trim();
      if(txt===el.dataset.i18n) bad.push(el.dataset.i18n);
    });
    return bad;
  });
  chk('no element shows its raw i18n key', raw.length===0, raw.slice(0,3).join(','));
  const resolves = await page.evaluate(()=>{
    const bad=[]; document.querySelectorAll('[data-i18n]').forEach(el=>{
      if(!window.i18n.t(el.dataset.i18n)) bad.push(el.dataset.i18n); });
    return bad;
  });
  chk('every data-i18n key resolves through t()', resolves.length===0, resolves.slice(0,3).join(','));
  chk('t() returns undefined for an unknown key',
    await page.evaluate(()=>window.i18n.t('__nope__')===undefined));
  chk('i18n.languages() still lists all three',
    JSON.stringify(await page.evaluate(()=>window.i18n.languages()))==='["en","ko","zh"]');
  await ctx.close();
}

// ── Persistence ──────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ locale:'en-US', viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  await page.goto(`${B}/index.html`,{waitUntil:'networkidle'});
  await lang(page, 'zh');
  const hits = dictHits(page);
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(400);
  chk('choice survives reload and refetches only zh',
    await page.evaluate(()=>document.documentElement.lang)==='zh'
    && hits.length===1 && hits[0]==='zh', `[${hits.join(',')}] lang=${await page.evaluate(()=>document.documentElement.lang)}`);
  await ctx.close();
}


await finish('Translations');
