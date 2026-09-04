import { browser, chk, rows, BASE, url, finish, lang } from './lib/harness.mjs';
import { installCdnCache } from './lib/cdn-cache.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Counts come from the catalogue, not from a number typed here. Hard-coding
// them means every new experiment turns this suite red for no reason, which
// is exactly what happened when the 33rd was added.
const { EXPERIMENTS } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, '..', 'assets/index/experiments.js')).href);
const TOTAL = EXPERIMENTS.length;
const CATS = EXPERIMENTS.reduce((a, e) => ((a[e.cat] = (a[e.cat] || 0) + 1), a), {});

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
  chk('table lists every experiment', st.rows === TOTAL, `${st.rows} rows`);
  chk('every row links to a real experiment page',
      st.links.length===TOTAL && st.links.every(h=>/^experiments\/.+\.html$/.test(h)), st.links.slice(0,2).join(','));
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
  chk('reload restores the table view', st2.tableShown && st2.active==='table' && st2.rows===TOTAL,
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
      all===TOTAL && counts.Physics===CATS.Physics && counts.Chemistry===CATS.Chemistry && counts.Biology===CATS.Biology &&
      counts.Physics+counts.Chemistry+counts.Biology===all,
      `all=${all} ${JSON.stringify(counts)}`);
  await p.click('.tv-filter[data-cat="All"]'); await p.waitForTimeout(250);
  chk('"All" restores the full list',
      (await p.evaluate(()=>document.querySelectorAll('.tv-table tbody tr').length))===TOTAL);
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
      st.tableShown && st.rows===TOTAL && !st.stuck, JSON.stringify(st));

  await p.close();
}

// ── 4b. A CDN that HANGS, which is the one that used to stick ─────────────
/*
 * Aborting is the easy half. A refused request rejects the script's onerror
 * straight away, boot.js catches it, and its own recovery does not write
 * anything down — so a test that aborts cannot see this defect at all, and
 * one written that way passed against the bug.
 *
 * A captive portal, a throttled tunnel or a proxy holding the connection does
 * not refuse: it hangs. Then nothing rejects, and the eight-second timeout in
 * index.html wins the race — and it recovers by calling .click() on the table
 * button, which ran the same handler a person's click runs and wrote "table"
 * into localStorage. One slow load and the wall was off for good: the stored
 * choice outlived the outage that caused it, so the next visit went straight
 * to the table with the network working perfectly.
 *
 * `ev.isTrusted` separates a person from element.click(). The fallback still
 * switches the view; it just no longer claims the reader asked for it.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const hang = () => new Promise(() => {});          // never fulfils, never aborts
  await p.route('**/cdnjs.cloudflare.com/**', hang);
  await p.route('**/cdn.jsdelivr.net/**', hang);
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(11000);
  const stalled = await p.evaluate(() => ({
    table: !document.getElementById('tableView').hidden,
    saved: (() => { try { return localStorage.getItem('ui-mode'); } catch (e) { return 'unreadable'; } })(),
  }));
  chk('a CDN that hangs still lands on the table, and is not remembered as a choice',
      stalled.table && stalled.saved === null,
      `table=${stalled.table}, ui-mode=${JSON.stringify(stalled.saved)}`);
  const blocked = stalled.table;

  // The network is fine again. Same profile, same storage, just a reload.
  await p.unroute('**/cdnjs.cloudflare.com/**', hang);
  await p.unroute('**/cdn.jsdelivr.net/**', hang);
  await installCdnCache(p);
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelectorAll('#scene canvas').length > 0,
                          null, { timeout: 30000 }).catch(() => {});
  const back = await p.evaluate(() => ({
    wall: !document.getElementById('scene').hidden,
    canvas: document.querySelectorAll('#scene canvas').length,
    saved: (() => { try { return localStorage.getItem('ui-mode'); } catch (e) { return 'unreadable'; } })(),
  }));
  chk('one unreachable visit does not turn the wall off for good',
      blocked && back.wall && back.canvas > 0 && back.saved === null,
      `blocked→table ${blocked}, then wall=${back.wall} canvas=${back.canvas} `
      + `ui-mode=${JSON.stringify(back.saved)}`);
  await ctx.close();
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
  await lang(p, 'ko');
  const ko = await p.evaluate(()=>document.querySelector('.tv-link').textContent.trim());
  const koCol = await p.evaluate(()=>document.querySelector('.tv-table th:nth-child(2)').textContent.trim());
  const koBtn = await p.evaluate(()=>document.querySelector('#uiSwitch [data-ui="table"]').textContent.trim());
  chk('table re-renders in Korean (titles, headers and the switcher)',
      ko!==en && koCol!==enCol && /[가-힣]/.test(ko+koCol+koBtn), `${en}/${ko} · ${enCol}/${koCol} · ${koBtn}`);
  await lang(p, 'en');
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
  /*
   * The document cannot overflow: index.css puts overflow:hidden on html and
   * body so the wall can own the viewport, and the scrolling happens inside
   * .table-view. That made the document-level measurement below unable to
   * fail — it read 390 = 390 while the method column's nowrap header was
   * being sliced off at the right edge. So measure the scroller itself, and
   * the table inside it, which is where the overflow actually lands.
   */
  const o = await p.evaluate(() => {
    const view = document.querySelector('.table-view');
    const table = document.querySelector('.tv-table');
    return { doc: document.documentElement.scrollWidth, win: window.innerWidth,
             view: view.scrollWidth, viewClient: view.clientWidth,
             table: Math.ceil(table.getBoundingClientRect().width) };
  });
  chk(`table: no horizontal overflow at ${w}px`, o.doc <= o.win + 1, `doc=${o.doc} win=${o.win}`);
  chk(`and the table itself fits the column it is in at ${w}px`,
      o.view <= o.viewClient + 1 && o.table <= o.viewClient + 1,
      `table=${o.table} scroller=${o.view}/${o.viewClient}`);
  await ctx.close();
}

// ── The method legend ────────────────────────────────────────────────
{
  /*
   * The six badges used to explain themselves only through a title tooltip,
   * which never opens on a touchscreen — on a phone they were six words with
   * no way to find out what any of them claimed. The legend puts the same
   * text on the page, and its counts come from the catalogue rather than
   * being written down, so it cannot drift away from the table above it.
   */
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('ui-mode', 'table'); } catch (e) { /* */ } });
  await page.goto(B, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tv-legend dt', { timeout: 20000 });

  const seen = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tv-legend dt')].map((dt, i) => ({
      label: dt.textContent.replace(/\d+$/, '').trim(),
      count: Number((dt.querySelector('.tv-legend-n') || {}).textContent),
      why: (document.querySelectorAll('.tv-legend dd')[i] || {}).textContent || '',
    }));
    // What the table itself shows, to hold the legend against.
    const tally = {};
    for (const tag of document.querySelectorAll('.tv-table .method-tag')) {
      const k = tag.dataset.method;
      tally[k] = (tally[k] || 0) + 1;
    }
    return {
      rows,
      tally,
      verifiedRows: document.querySelectorAll('.tv-table .method-verified').length,
      principle: (document.querySelector('.tv-principle') || {}).textContent || '',
    };
  });

  chk('the plain view carries a legend for the badges',
      seen.rows.length >= 5, `${seen.rows.length} entries`);
  chk('and every entry explains itself in a full sentence, not a key',
      seen.rows.every((r) => r.why.length > 30 && !/^[a-z]+[A-Z]/.test(r.why)),
      seen.rows.map((r) => `${r.label}:${r.why.length}`).join(' '));

  // The whole point of computing them: legend and table cannot disagree.
  const legendTotal = seen.rows.slice(0, -1).reduce((a, r) => a + r.count, 0);
  const tableTotal = Object.values(seen.tally).reduce((a, n) => a + n, 0);
  chk('the legend counts add up to the catalogue it is describing',
      legendTotal === tableTotal, `legend ${legendTotal} vs table ${tableTotal}`);
  chk('and the Verified count is the number of rows carrying the mark',
      seen.rows[seen.rows.length - 1].count === seen.verifiedRows,
      `legend ${seen.rows[seen.rows.length - 1].count} vs ${seen.verifiedRows} rows`);

  // A method with no pages would be a category describing nothing.
  chk('no method is listed that no experiment uses',
      seen.rows.slice(0, -1).every((r) => r.count > 0),
      seen.rows.map((r) => `${r.label}=${r.count}`).join(' '));

  chk('and the page states the principle the badges exist for',
      seen.principle.length > 60 && /measure/i.test(seen.principle),
      seen.principle.slice(0, 60));

  // Korean too — the legend is built in JS, which is where translations get
  // forgotten, and the counts must survive the rebuild.
  await lang(page, 'ko');
  await page.waitForFunction(() => {
    const dd = document.querySelector('.tv-legend dd');
    return dd && /[가-힣]/.test(dd.textContent);
  }, { timeout: 20000 }).catch(() => {});
  const ko = await page.evaluate(() => ({
    why: (document.querySelector('.tv-legend dd') || {}).textContent || '',
    principle: (document.querySelector('.tv-principle') || {}).textContent || '',
    counts: [...document.querySelectorAll('.tv-legend-n')].map((n) => Number(n.textContent)),
  }));
  chk('the legend translates', /[가-힣]/.test(ko.why), ko.why.slice(0, 40));
  chk('and so does the principle', /[가-힣]/.test(ko.principle), ko.principle.slice(0, 40));
  chk('and the counts survive the re-render',
      ko.counts.length === seen.rows.length
        && ko.counts.every((n, i) => n === seen.rows[i].count),
      `${ko.counts.join(',')} vs ${seen.rows.map((r) => r.count).join(',')}`);
  await ctx.close();
}

console.log('\n=== view switcher verification ===');

await finish('View switcher');
