import { browser, chk, rows, BASE, url, finish } from './lib/harness.mjs';
import { installCdnCache } from './lib/cdn-cache.mjs';

const B = url('index.html');

// ── 1. Default is still the wall, and it still boots ──────────────────
{
  const p = await browser.newPage({ viewport:{width:1280,height:860} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push('C:'+m.text()); });
  await installCdnCache(p);
  await p.goto(B, { waitUntil:'domcontentloaded' });
  await p.waitForFunction(() => document.getElementById('loader')?.classList.contains('gone'),
    { timeout: 20000 }).catch(()=>{});
  const st = await p.evaluate(()=>({
    num: document.getElementById('ldNum')?.textContent.trim(),
    gone: document.getElementById('loader')?.classList.contains('gone'),
    canvas: !!document.querySelector('#scene canvas'),
    tableHidden: document.getElementById('tableView').hidden,
    active: document.querySelector('#uiSwitch .ui-btn.active')?.dataset.ui }));
  chk('default view is the wall and it still boots to 100%',
      st.gone && /100/.test(st.num||'') && st.canvas && st.tableHidden && st.active==='wall',
      JSON.stringify(st));
  chk('wall boots with no errors', errs.length===0, errs.slice(0,2).join(' | '));
  await p.close();
}

// ── 2. Switching to the table, and it sticks across a reload ──────────
{
  const ctx = await browser.newContext({ viewport:{width:1280,height:900} });
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await installCdnCache(p);
  await p.goto(B, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(3000);
  await p.click('#uiSwitch [data-ui="table"]');
  await p.waitForTimeout(600);
  const st = await p.evaluate(()=>({
    tableShown: !document.getElementById('tableView').hidden,
    sceneHidden: document.getElementById('scene').hidden,
    rows: document.querySelectorAll('.tv-table tbody tr').length,
    links: [...document.querySelectorAll('.tv-link')].map(a=>a.getAttribute('href')),
    bodyClass: document.body.className,
    saved: localStorage.getItem('ui-mode') }));
  chk('switching shows the table and hides the scene',
      st.tableShown && st.sceneHidden && st.bodyClass.includes('ui-table'), JSON.stringify(st.bodyClass));
  chk('table lists every experiment', st.rows === 32, `${st.rows} rows`);
  chk('every row links to a real experiment page',
      st.links.length===32 && st.links.every(h=>/^experiments\/.+\.html$/.test(h)), st.links.slice(0,2).join(','));
  chk('choice is persisted', st.saved === 'table', String(st.saved));

  // reload: table must come back WITHOUT touching the CDN
  const cdnHits = [];
  const p2 = await ctx.newPage();
  p2.on('request', r => { if (/cdn\.jsdelivr|cdnjs\./.test(r.url())) cdnHits.push(r.url()); });
  await p2.goto(B, { waitUntil:'networkidle' });
  await p2.waitForTimeout(1500);
  const st2 = await p2.evaluate(()=>({
    tableShown: !document.getElementById('tableView').hidden,
    active: document.querySelector('#uiSwitch .ui-btn.active')?.dataset.ui,
    rows: document.querySelectorAll('.tv-table tbody tr').length,
    canvas: !!document.querySelector('#scene canvas') }));
  chk('reload restores the table view', st2.tableShown && st2.active==='table' && st2.rows===32,
      JSON.stringify(st2));
  chk('table mode requests NO CDN scripts at all', cdnHits.length===0,
      cdnHits.slice(0,2).join(' | '));
  chk('table mode never creates a WebGL canvas', !st2.canvas, String(st2.canvas));
  await p2.close();
  await ctx.close();
}

// ── 3. Filters ────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport:{width:1280,height:900} });
  await ctx.addInitScript(()=>{ try{ localStorage.setItem('ui-mode','table'); }catch(e){} });
  const p = await ctx.newPage();
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(800);
  const all = await p.evaluate(()=>document.querySelectorAll('.tv-table tbody tr').length);
  const counts = {};
  for (const cat of ['Physics','Chemistry','Biology']) {
    await p.click(`.tv-filter[data-cat="${cat}"]`);
    await p.waitForTimeout(250);
    counts[cat] = await p.evaluate(()=>document.querySelectorAll('.tv-table tbody tr').length);
  }
  chk('category filters split the catalogue exactly',
      all===32 && counts.Physics===19 && counts.Chemistry===9 && counts.Biology===4 &&
      counts.Physics+counts.Chemistry+counts.Biology===all,
      `all=${all} ${JSON.stringify(counts)}`);
  await p.click('.tv-filter[data-cat="All"]'); await p.waitForTimeout(250);
  chk('"All" restores the full list',
      (await p.evaluate(()=>document.querySelectorAll('.tv-table tbody tr').length))===32);
  await ctx.close();
}

// ── 4. The real prize: CDN blocked lands on the table, not a dead spinner ──
{
  const p = await browser.newPage({ viewport:{width:1280,height:900} });
  await p.route('**/cdnjs.cloudflare.com/**', r => r.abort());
  await p.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await p.goto(B, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(11000);
  const st = await p.evaluate(()=>({
    tableShown: !document.getElementById('tableView').hidden,
    rows: document.querySelectorAll('.tv-table tbody tr').length,
    note: !document.getElementById('uiFallbackNote').hidden,
    stuck: /Building the wall/.test(document.body.innerText) }));
  chk('CDN blocked: lands on the full table, not a dead spinner',
      st.tableShown && st.rows===32 && !st.stuck, JSON.stringify(st));
  await p.close();
}

// ── 5. i18n + keyboard + mobile ───────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport:{width:1280,height:900} });
  await ctx.addInitScript(()=>{ try{ localStorage.setItem('ui-mode','table'); }catch(e){} });
  const p = await ctx.newPage();
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  const en = await p.evaluate(()=>document.querySelector('.tv-link').textContent.trim());
  const enCol = await p.evaluate(()=>document.querySelector('.tv-table th:nth-child(2)').textContent.trim());
  await p.click('.lang-btn[data-lang="ko"]'); await p.waitForTimeout(500);
  const ko = await p.evaluate(()=>document.querySelector('.tv-link').textContent.trim());
  const koCol = await p.evaluate(()=>document.querySelector('.tv-table th:nth-child(2)').textContent.trim());
  const koBtn = await p.evaluate(()=>document.querySelector('#uiSwitch [data-ui="table"]').textContent.trim());
  chk('table re-renders in Korean (titles, headers and the switcher)',
      ko!==en && koCol!==enCol && /[가-힣]/.test(ko+koCol+koBtn), `${en}/${ko} · ${enCol}/${koCol} · ${koBtn}`);
  await p.click('.lang-btn[data-lang="en"]'); await p.waitForTimeout(400);
  // keyboard: the first row link must be reachable and be a real anchor
  const focusable = await p.evaluate(()=>{
    const a = document.querySelector('.tv-link'); a.focus();
    return { tag: document.activeElement.tagName, href: document.activeElement.getAttribute('href') }; });
  chk('rows expose real keyboard-reachable links',
      focusable.tag==='A' && /experiments\//.test(focusable.href||''), JSON.stringify(focusable));
  await ctx.close();
}
for (const w of [320, 390, 768]) {
  const ctx = await browser.newContext({ viewport:{width:w,height:820}, deviceScaleFactor:2 });
  await ctx.addInitScript(()=>{ try{ localStorage.setItem('ui-mode','table'); }catch(e){} });
  const p = await ctx.newPage();
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`table: no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await ctx.close();
}

console.log('\n=== view switcher verification ===');

await finish('View switcher');
