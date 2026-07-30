import { browser, chk, rows, BASE, finish } from './lib/harness.mjs';

const B = BASE;

const dictHits = (page) => { const hits=[]; page.on('request',r=>{
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
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(600);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(600);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  const back = await h1();
  chk('switching en/ko/zh changes the heading and returns',
    ko!==en && zh!==en && zh!==ko && back===en, `${en} | ${ko} | ${zh}`);
  chk('each dictionary fetched exactly once, in order',
    JSON.stringify(hits)===JSON.stringify(['en','ko','zh']), `[${hits.join(',')}]`);
  // re-switch must not refetch
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
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
  chk('experiments/ page fetches ../i18n/ko.js without a 404', fails.length===0, fails.join(' '));
  const title = await page.evaluate(()=>document.querySelector('h1').textContent.trim());
  chk('experiments/ page is translated', /효소/.test(title), title);
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
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(600);
  const hits = dictHits(page);
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(400);
  chk('choice survives reload and refetches only zh',
    await page.evaluate(()=>document.documentElement.lang)==='zh'
    && hits.length===1 && hits[0]==='zh', `[${hits.join(',')}] lang=${await page.evaluate(()=>document.documentElement.lang)}`);
  await ctx.close();
}


await finish('Translations');
