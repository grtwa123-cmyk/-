import { browser, chk, rows, url, BASE as BASE_URL, finish } from '../lib/harness.mjs';

const B = url('experiments/lens.html');

const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// ── The lens equation and the classic cases ───────────────────────────
{
  const r = await page.evaluate(() => {
    const L = window.__lens;
    const cases = [[-30,10],[-20,10],[-15,10],[-5,10],[-30,-10],[-40,-10],[-50,20],[-12,10]];
    return cases.map(([u,f]) => {
      const p = { f, u, h: 4, n: 13 };
      const s = L.solve(p);
      return { u, f, v: s.v, m: s.m,
               lensEq: Number.isFinite(s.v) ? (1/s.v - 1/u - 1/f) : 0,
               magEq: Number.isFinite(s.v) ? (s.m - s.v/u) : 0,
               newton: Number.isFinite(s.v) ? ((-u - f) * (s.v - f) - f*f) : 0 };
    });
  });
  chk('1/v − 1/u = 1/f holds exactly for all eight cases',
      r.every(x => Math.abs(x.lensEq) < 1e-14), r.map(x=>x.lensEq.toExponential(1)).join(' '));
  chk('m = v/u holds exactly', r.every(x => Math.abs(x.magEq) < 1e-15), '');
  chk("Newton's x·x′ = f² holds exactly",
      r.every(x => Math.abs(x.newton) < 1e-11), r.map(x=>x.newton.toExponential(1)).join(' '));
  const byCase = Object.fromEntries(r.map(x=>[`${x.u}/${x.f}`, x]));
  chk('object beyond 2f → real, inverted, reduced (u=−30, f=10 → v=15, m=−0.5)',
      Math.abs(byCase['-30/10'].v-15)<1e-12 && Math.abs(byCase['-30/10'].m+0.5)<1e-12,
      `v=${byCase['-30/10'].v} m=${byCase['-30/10'].m}`);
  chk('object at 2f → life-size inverted (v=20, m=−1)',
      Math.abs(byCase['-20/10'].v-20)<1e-12 && Math.abs(byCase['-20/10'].m+1)<1e-12,
      `v=${byCase['-20/10'].v} m=${byCase['-20/10'].m}`);
  chk('object inside f → virtual, upright, magnified (u=−5, f=10 → v=−10, m=+2)',
      Math.abs(byCase['-5/10'].v+10)<1e-12 && Math.abs(byCase['-5/10'].m-2)<1e-12,
      `v=${byCase['-5/10'].v} m=${byCase['-5/10'].m}`);
  chk('diverging lens → virtual, upright, reduced (u=−30, f=−10 → v=−7.5, m=+0.25)',
      Math.abs(byCase['-30/-10'].v+7.5)<1e-12 && Math.abs(byCase['-30/-10'].m-0.25)<1e-12,
      `v=${byCase['-30/-10'].v} m=${byCase['-30/-10'].m}`);
}
{
  const r = await page.evaluate(() => {
    const L = window.__lens;
    return { atF: L.solve({ f: 10, u: -10, h: 4, n: 13 }).v,
             nearF: L.solve({ f: 10, u: -10.001, h: 4, n: 13 }).v };
  });
  chk('object exactly at the focus → image at infinity',
      !Number.isFinite(r.atF) && r.nearF > 10000, `${r.atF} / ${r.nearF.toExponential(2)}`);
}

// ── The point of the whole thing: every ray meets at the image ─────────
{
  const r = await page.evaluate(() => {
    const L = window.__lens;
    const cases = [[-30,10,4],[-15,10,2],[-5,10,3],[-30,-10,4],[-60,25,5],[-8,-6,2]];
    return cases.map(([u,f,h]) => {
      const p = { f, u, h, n: 31 };
      const s = L.solve(p);
      let worst = 0;
      for (let i = 0; i <= 200; i++) {
        const yL = -L.APERTURE + (2*L.APERTURE*i)/200;
        worst = Math.max(worst, Math.abs(L.rayAt(L.ray(yL, p), s.v) - s.height));
      }
      return { u, f, worst, height: s.height };
    });
  });
  chk('all 201 traced rays cross at the image point, six configurations',
      r.every(x => x.worst < 1e-12),
      r.map(x=>`u${x.u}/f${x.f}:${x.worst.toExponential(1)}`).join(' '));
}
{
  // the three principal rays are just members of the same fan
  const r = await page.evaluate(() => {
    const L = window.__lens;
    const p = { f: 10, u: -30, h: 4, n: 13 };
    const s = L.solve(p);
    const parallelIn = L.ray(p.h, p);          // arrives parallel to the axis
    const through0   = L.ray(0, p);            // through the optical centre
    const viaFocus   = L.ray(p.h*p.f/(p.f+p.u), p);
    return {
      parallelInSlope: parallelIn.theta,                       // must be 0
      crossesAxisAt: -parallelIn.yL / parallelIn.out,          // must be f
      centreUndeviated: through0.out - through0.theta,         // must be 0
      viaFocusOutSlope: viaFocus.out,                          // must be 0
      allMeet: [parallelIn, through0, viaFocus]
        .map(r => Math.abs(L.rayAt(r, s.v) - s.height)),
    };
  });
  chk('the ray arriving parallel leaves through the far focus',
      Math.abs(r.parallelInSlope) < 1e-15 && Math.abs(r.crossesAxisAt - 10) < 1e-12,
      `slope=${r.parallelInSlope} crosses at ${r.crossesAxisAt}`);
  chk('the ray through the centre is undeviated', Math.abs(r.centreUndeviated) < 1e-15,
      String(r.centreUndeviated));
  chk('the ray through the near focus leaves parallel to the axis',
      Math.abs(r.viaFocusOutSlope) < 1e-15, String(r.viaFocusOutSlope));
  chk('all three principal rays land on the image point',
      r.allMeet.every(d => d < 1e-13), r.allMeet.map(d=>d.toExponential(1)).join(' '));
}

// ── UI ────────────────────────────────────────────────────────────────
{
  await setV('focal',10); await setV('objdist',30); await setV('objheight',4);
  await page.waitForTimeout(300);
  chk('readout: v = 15.00 cm', (await txt('out-v'))==='15.00', await txt('out-v'));
  chk('readout: m = −0.500', (await txt('out-m'))==='-0.500', await txt('out-m'));
  chk('readout: image height = −2.00 cm', (await txt('out-height'))==='-2.00', await txt('out-height'));
  chk('readout: real · inverted · reduced', /real/.test(await txt('out-type')) &&
      /inverted/.test(await txt('out-type')) && /reduced/.test(await txt('out-type')), await txt('out-type'));
  chk('readout: Newton x·x′ equals f²', /100\.00 = f² = 100\.00/.test(await txt('out-newton')),
      await txt('out-newton'));
  const res = parseFloat(await txt('out-residual'));
  chk('readout: ray convergence error is at machine precision', res < 1e-12, await txt('out-residual'));

  await setV('objdist',20); await page.waitForTimeout(250);
  chk('at 2f the readout says life-size', /life-size/.test(await txt('out-type')), await txt('out-type'));
  await setV('objdist',10); await page.waitForTimeout(250);
  chk('at f the readout says the image is at infinity',
      (await txt('out-v'))==='∞' && /infinity/.test(await txt('out-type')), await txt('out-v'));
  await setV('objdist',5); await page.waitForTimeout(250);
  chk('inside f the image turns virtual, upright and enlarged',
      /virtual/.test(await txt('out-type')) && /upright/.test(await txt('out-type')) &&
      /enlarged/.test(await txt('out-type')), await txt('out-type'));

  await page.click('#kind-list .mol-btn[data-key="concave"]'); await page.waitForTimeout(250);
  await setV('objdist',30); await page.waitForTimeout(250);
  chk('diverging lens: v = −7.50, virtual upright reduced',
      (await txt('out-v'))==='-7.50' && /virtual/.test(await txt('out-type')) &&
      /upright/.test(await txt('out-type')) && /reduced/.test(await txt('out-type')),
      `${await txt('out-v')} ${await txt('out-type')}`);
  const anyReal = await page.evaluate(() => {
    const L = window.__lens;
    for (let d = 1; d <= 80; d += 0.5) {
      const s = L.solve({ f: -10, u: -d, h: 4, n: 13 });
      if (Number.isFinite(s.v) && s.v > 0) return d;
    }
    return null;
  });
  chk('a diverging lens forms no real image for any real object', anyReal === null, `u=${anyReal}`);
  await page.click('#kind-list .mol-btn[data-key="convex"]');
}
{
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(400);
  const snap = () => page.evaluate(()=>{
    const p = window.__lens.params(); const s = window.__lens.solve(p);
    return JSON.stringify([p.f,p.u,p.h,p.n,s.v,s.m,window.__lens.kind(),
      document.getElementById('out-v').textContent,
      document.getElementById('rays-value').textContent,
      document.getElementById('principal-on').checked]); });
  const dead = [];
  const acts = [
    ['focal', () => setV('focal',20)],
    ['objdist', () => setV('objdist',50)],
    ['objheight', () => setV('objheight',6)],
    ['rays', () => setV('rays',25)],
    ['principal-on', () => page.$eval('#principal-on', e=>{e.checked=!e.checked;e.dispatchEvent(new Event('change',{bubbles:true}));})],
    ['kind concave', () => page.click('#kind-list .mol-btn[data-key="concave"]')],
  ];
  for (const [name, act] of acts) {
    const b = await snap(); await act(); await page.waitForTimeout(180);
    if (await snap() === b) dead.push(name);
  }
  chk('no dead controls', dead.length===0, dead.join(','));
}
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(350);
  const ko = await h1(); const koType = await txt('out-type');
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(350);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(350);
  chk('title translates en/ko/zh and returns', ko!==en && zh!==en && zh!==ko && (await h1())===en,
      `${en} | ${ko} | ${zh}`);
  chk('the image-type readout translates too', /[가-힣]/.test(koType), koType);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}
{
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot();
  await setV('objdist', 60); await page.waitForTimeout(350);
  const b = await shot();
  chk('canvas repaints when the object moves', a!==b && a.length>3000, `len ${a.length}/${b.length}`);
}
await page.close();

for (const w of [320, 390, 768]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(450);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await p.close();
}


await finish('Lenses');
