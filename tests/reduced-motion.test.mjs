import { browser, chk, rows, BASE, finish } from './lib/harness.mjs';

const B = BASE;

// Canvas sims that must hold still under reduced motion but stay painted.
const PAGES = ['doppler','wave','pendulum','enzyme','gas','decay','lotka','projectile','refraction','lens'];

/** Does this page animate at rest with no preference set? Several wait for a
 *  Start/Launch press, and one is a static ray diagram — asserting that Play
 *  restarts motion on those would be asserting a bug into existence. */
async function animatesAtRest(name) {
  const ctx = await browser.newContext({ viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  await page.goto(`${B}/experiments/${name}.html`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(900);
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(900); const b = await shot();
  await ctx.close();
  return a !== b;
}

for (const name of PAGES) {
  const live = await animatesAtRest(name);
  const ctx = await browser.newContext({ reducedMotion:'reduce', viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push(e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  await page.goto(`${B}/experiments/${name}.html`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(900);

  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot();
  await page.waitForTimeout(1100);
  const b = await shot();

  const blank = a.length < 3000;
  chk(`${name}: canvas painted (not blank)`, !blank, `len ${a.length}`);
  chk(`${name}: still under reduced motion`, a === b, a===b?'':'frames differ');
  chk(`${name}: notice mounted`, await page.locator('.motion-notice').count() === 1);
  chk(`${name}: no console errors`, errs.length===0, errs.slice(0,1).join(''));

  // Play must restore real animation — but only where there was any.
  await page.locator('.motion-notice-btn').click();
  await page.waitForTimeout(250);
  const c = await shot();
  await page.waitForTimeout(900);
  const d = await shot();
  if (live) {
    chk(`${name}: Play resumes animation`, c !== d, c===d?'still frozen after Play':'');
  } else {
    chk(`${name}: Play is a no-op (page is static until the reader acts)`, c === d);
  }
  await ctx.close();
}

// Control: without the preference nothing changes and no notice appears.
{
  const ctx = await browser.newContext({ viewport:{width:1100,height:900} });
  const page = await ctx.newPage();
  await page.goto(`${B}/experiments/doppler.html`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(800);
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(900); const b = await shot();
  chk('no preference: animates normally', a !== b);
  chk('no preference: no notice injected', await page.locator('.motion-notice').count() === 0);
  await ctx.close();
}

let f=0; for(const r of rows){ if(!r.ok)f++; console.log(`${r.ok?'PASS':'FAIL'}  ${r.n}${r.ok||!r.d?'':'  ::  '+r.d}`); }
console.log(`\n${rows.length-f}/${rows.length} passed`);
process.exit(f?1:0);

await finish('Reduced motion');
