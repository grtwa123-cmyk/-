import { browser, chk, rows, url, finish } from '../lib/harness.mjs';

const B = url('experiments/string.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(500);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// p is built the way params() does, so the same c = √(T/µ) is exercised.
const MK = `const S = window.__sw;
  const mk = (o={}) => { const L=o.L??1, T=o.T??80, mu=(o.mu??1.2)/1000,
    c=Math.sqrt(T/mu), fr=o.fr??[1,2];
    return { num:fr[0], den:fr[1], p:fr[0]/fr[1], L, T, mu, c, f1:c/(2*L),
      damping:o.damping??0, slow:400, dx:L/S.N, dt:(S.COURANT*(L/S.N))/c }; };`;

// ── The harmonic series is measured out of the motion ─────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    // Pluck off-centre so every harmonic under test is actually excited.
    const p = mk({ fr:[1,5], L:1, T:80, mu:1.2 });
    return { p, h: S.harmonics(p, { modes:[1,2,3,4,6,7], steps:120000 }) };`));
  const excited = r.h.filter((x) => x.excited);
  const err = excited.map((x) => Math.abs(x.f - x.want) / x.want);
  chk('every excited harmonic sits at n·c/2L, measured from its own period',
      excited.length >= 5 && Math.max(...err) < 0.005,
      excited.map((x,i)=>`n${x.n}:${x.f.toFixed(2)}/${x.want.toFixed(2)}(${(err[i]*100).toFixed(3)}%)`).join(' '));
  chk('the fundamental is c/2L',
      Math.abs(r.h[0].f - r.p.f1) / r.p.f1 < 0.002,
      `${r.h[0].f.toFixed(3)} vs ${r.p.f1.toFixed(3)} Hz`);
}

// ── f₁ = c/2L across lengths, tensions and densities ──────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const cases = [
      { L:1, T:80, mu:1.2 }, { L:0.5, T:80, mu:1.2 }, { L:1, T:320, mu:1.2 },
      { L:1, T:80, mu:4.8 }, { L:0.65, T:120, mu:2.0 },
    ];
    return cases.map(c => {
      const p = mk({ ...c, fr:[1,5] });
      const h = S.harmonics(p, { modes:[1], steps:90000 });
      return { ...c, c: p.c, f1: p.f1, measured: h[0].f };
    });`));
  const err = r.map((x) => Math.abs(x.measured - x.f1) / x.f1);
  chk('f₁ = c/2L over five strings, measured not asserted',
      Math.max(...err) < 0.005,
      r.map((x,i)=>`L${x.L}/T${x.T}/µ${x.mu}:${(err[i]*100).toFixed(3)}%`).join(' '));
  // Four times the tension is one octave, and only through c = √(T/µ).
  const base = r[0], quad = r[2];
  chk('four times the tension is exactly one octave',
      Math.abs(quad.f1 / base.f1 - 2) < 1e-12, `${(quad.f1/base.f1).toFixed(12)}`);
  chk('four times the density is exactly one octave down',
      Math.abs(r[3].f1 / base.f1 - 0.5) < 1e-12, `${(r[3].f1/base.f1).toFixed(12)}`);
  chk('half the length is exactly one octave up',
      Math.abs(r[1].f1 / base.f1 - 2) < 1e-12, `${(r[1].f1/base.f1).toFixed(12)}`);
}

// ── Where you pluck decides which harmonics exist ─────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const at = (fr) => {
      const p = mk({ fr });
      S.pluck(p);
      const a = S.spectrum().map(Math.abs);
      const peak = Math.max(...a);
      // A_n ∝ sin(nπp)/n² is the Fourier series of the triangle we started with
      const want = [];
      for (let n = 1; n <= a.length; n++) want.push(Math.abs(Math.sin(n*Math.PI*p.p)/(n*n)));
      const w0 = want[0];
      return { fr, rel: a.map(x=>x/peak), want: want.map(x=>x/w0) };
    };
    return { half: at([1,2]), third: at([1,3]), quarter: at([1,4]), fifth: at([1,5]) };`));

  const silent = (o) => o.rel.map((v,i)=>({n:i+1,v})).filter((x)=>x.v < 1e-6).map((x)=>x.n);
  chk('plucking at the midpoint removes every even harmonic',
      JSON.stringify(silent(r.half)) === JSON.stringify([2,4,6,8,10,12]),
      silent(r.half).join(','));
  chk('the suppression is exact, not approximate (< 1e-12 of the fundamental)',
      Math.max(...[2,4,6,8,10,12].map((n)=>r.half.rel[n-1])) < 1e-12,
      Math.max(...[2,4,6,8,10,12].map((n)=>r.half.rel[n-1])).toExponential(1));
  chk('plucking at a third removes every third harmonic',
      JSON.stringify(silent(r.third)) === JSON.stringify([3,6,9,12]), silent(r.third).join(','));
  chk('plucking at a quarter removes every fourth harmonic',
      JSON.stringify(silent(r.quarter)) === JSON.stringify([4,8,12]), silent(r.quarter).join(','));
  chk('plucking at a fifth removes every fifth harmonic',
      JSON.stringify(silent(r.fifth)) === JSON.stringify([5,10]), silent(r.fifth).join(','));

  // The surviving amplitudes must follow sin(nπp)/n², not merely be present.
  for (const [name, o] of [['midpoint', r.half], ['a third', r.third], ['a fifth', r.fifth]]) {
    const live = o.want.map((w,i)=>({ n:i+1, w, g:o.rel[i] })).filter((x)=>x.w > 1e-9);
    const e = live.map((x) => Math.abs(x.g - x.w) / x.w);
    chk(`amplitudes after plucking at ${name} follow sin(nπp)/n²`,
        Math.max(...e) < 0.01,
        live.map((x,i)=>`n${x.n}:${(e[i]*100).toFixed(2)}%`).join(' '));
  }
}

// ── A pure mode is a standing wave: its nodes do not move ─────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const p = mk({ fr:[1,5] });
    const out = [];
    for (const n of [1,2,3,4,5]) {
      S.pureMode(n);
      // The nodes of mode n are at i = k·N/n. Watch them for a full period.
      const nodes = [];
      for (let k = 1; k < n; k++) nodes.push(Math.round(S.N*k/n));
      let worst = 0, other = 0;
      const steps = Math.round((1/(n*p.f1))/p.dt);
      for (let s = 0; s < steps; s++) {
        S.step(p);
        const shape = S.shape();
        for (const i of nodes) worst = Math.max(worst, Math.abs(shape[i]));
        other = Math.max(other, Math.abs(shape[Math.round(S.N/(2*n))]));
      }
      const a = S.spectrum().map(Math.abs);
      const purity = a[n-1] / a.reduce((s,x)=>s+x, 0);
      out.push({ n, worstNode: worst, antinode: other, purity });
    }
    return out;`));
  chk('a pure mode keeps its nodes dead still for a whole period',
      r.every((x) => x.n === 1 || x.worstNode / x.antinode < 1e-6),
      r.map(x=>`n${x.n}:${(x.worstNode/x.antinode).toExponential(1)}`).join(' '));
  chk('and it stays a single harmonic — nothing leaks into the others',
      r.every((x) => x.purity > 0.999),
      r.map(x=>`n${x.n}:${x.purity.toFixed(6)}`).join(' '));
}

// ── The integrator ────────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const p = mk({ fr:[1,5], damping:0 });
    S.pluck(p);
    S.step(p);
    let e0 = S.energy(p), mn = e0, mx = e0;
    for (let k = 0; k < 60000; k++) { S.step(p); const e = S.energy(p);
      mn = Math.min(mn, e); mx = Math.max(mx, e); }
    return { e0, mn, mx, spread: (mx-mn)/e0 };`));
  chk('undamped, the total energy holds to under 1% over 60000 steps',
      r.spread < 0.01, `${(r.spread*100).toFixed(4)}%`);
  chk('the Courant number is inside the stability limit',
      await page.evaluate(()=>window.__sw.COURANT < 1), String(await page.evaluate(()=>window.__sw.COURANT)));
  chk('the grid divides by 2, 3, 4, 5, 6, 8, 9, 10 and 12 so the nodes are exact',
      await page.evaluate(()=>[2,3,4,5,6,8,9,10,12].every(d=>window.__sw.N % d === 0)),
      String(await page.evaluate(()=>window.__sw.N)));
}

// ── Damping must take energy out without moving the pitch ─────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const measure = (damping) => {
      const p = mk({ fr:[1,3], damping });
      S.pluck(p);
      // The envelope, not an instantaneous value: mode 1 is a sinusoid, so
      // sampling |a| at one arbitrary final step reports wherever the phase
      // happened to land — 50% even with no damping at all.
      let last = S.modeAmp(1), n = 0, cross = [], early = 0, late = 0;
      const total = 30000, edge = 4000;
      for (let k = 0; k < total; k++) {
        S.step(p); n++;
        const a = S.modeAmp(1);
        if (last > 0 && a <= 0) cross.push(n);
        last = a;
        if (k < edge) early = Math.max(early, Math.abs(a));
        if (k >= total - edge) late = Math.max(late, Math.abs(a));
      }
      const steps = cross.length > 1
        ? (cross[cross.length-1]-cross[0])/(cross.length-1) : NaN;
      return { damping, steps, f: 1/(steps*p.dt), want: p.f1,
               decay: late/early, t: total*p.dt };
    };
    return [0, 0.6, 3, 8].map(measure);`));
  const worst = Math.max(...r.map((x) => Math.abs(x.f - x.want) / x.want));
  chk('damping does not move the pitch — the string stays in tune',
      worst < 0.002,
      r.map(x=>`γ${x.damping}:${x.f.toFixed(1)}Hz`).join(' '));
  chk('and it does take energy out, faster the harder you damp',
      r.every((x,i,a) => i===0 || x.decay < a[i-1].decay) && r[0].decay > 0.95,
      r.map(x=>`γ${x.damping}:${(x.decay*100).toFixed(1)}%`).join(' '));
}

// ── The live page ─────────────────────────────────────────────────────
{
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(400);
  await setV('length', 1); await setV('tension', 80); await setV('density', 1.2);
  await page.waitForTimeout(200);
  const c = parseFloat(await txt('out-speed'));
  const f1 = parseFloat(await txt('out-f1'));
  chk('readout: c = √(T/µ) = 258.2 m/s', Math.abs(c - Math.sqrt(80/0.0012)) < 0.15, String(c));
  chk('readout: f₁ = c/2L', Math.abs(f1 - c/2) < 0.15, `${f1} vs ${(c/2).toFixed(1)}`);
  await page.waitForFunction(() => {
    const t = document.getElementById('out-measured').textContent;
    return /^[\d.]+$/.test(t);
  }, { timeout: 30000 }).catch(()=>{});
  const meas = parseFloat(await txt('out-measured'));
  chk('the measured f₁ converges on the predicted one',
      Number.isFinite(meas) && Math.abs(meas - f1)/f1 < 0.02, `${meas} vs ${f1}`);
}
{
  // The pluck slider is the headline control; the readout must follow it.
  await setV('pluck', 9); await page.waitForTimeout(300);   // 1/2
  chk('readout at the midpoint lists the even harmonics as missing',
      (await txt('out-missing')) === '2, 4, 6, 8, 10, 12', await txt('out-missing'));
  await setV('pluck', 6); await page.waitForTimeout(300);   // 1/3
  chk('readout at a third lists every third harmonic as missing',
      (await txt('out-missing')) === '3, 6, 9, 12', await txt('out-missing'));
  await setV('pluck', 5); await page.waitForTimeout(300);   // 1/4
  chk('readout at a quarter lists every fourth harmonic as missing',
      (await txt('out-missing')) === '4, 8, 12', await txt('out-missing'));
  chk('the pluck label shows the fraction', (await txt('pluck-value')) === '1/4',
      await txt('pluck-value'));
}
{
  // 60 → 240 N, both inside the slider's range. Asking for 320 silently
  // clamped to the 250 N maximum and the ratio came out at 1.77.
  await setV('pluck', 4); await setV('tension', 60); await page.waitForTimeout(250);
  const before = parseFloat(await txt('out-f1'));
  await setV('tension', 240); await page.waitForTimeout(300);
  const after = parseFloat(await txt('out-f1'));
  chk('quadrupling the tension doubles the readout pitch',
      Math.abs(after / before - 2) < 0.01, `${before} → ${after}`);
  await setV('tension', 80); await page.waitForTimeout(200);
}
{
  // A screenshot of a vibrating string differs every frame, so comparing one
  // proved a control alive whatever it did — a deliberately dead entry
  // planted in this list passed. Each slider is held to the model instead.
  await page.evaluate(() => window.__sw.setRunning(false));
  const sig = async () => {
    await page.waitForTimeout(140);
    return page.evaluate(() => {
      const p = window.__sw.params();
      return JSON.stringify([p.p, p.L, p.T, p.mu, p.c, p.f1, p.damping, p.slow]);
    });
  };
  const dead = [];
  const acts = [
    ['pluck', () => setV('pluck', 3)],
    ['length', () => setV('length', 0.4)],
    ['tension', () => setV('tension', 200)],
    ['density', () => setV('density', 5)],
    ['damping', () => setV('damping', 5)],
    ['slow', () => setV('slow', 4)],
  ];
  let before = await sig();
  for (const [name, act] of acts) {
    await act();
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every slider changes the model it claims to', dead.length===0, dead.join(','));

  // The two buttons change no parameter — they restart the string, which
  // `clear()` records by putting the clock back to zero. That is the effect,
  // so that is what is checked.
  await page.evaluate(() => window.__sw.setRunning(true));
  const restarts = [];
  for (const [name, sel] of [['pure harmonic', '#bow-btn'], ['pluck button', '#pluck-btn']]) {
    await page.waitForTimeout(400);
    const t0 = await page.evaluate(() => window.__sw.simTime());
    await page.click(sel);
    const t1 = await page.evaluate(() => window.__sw.simTime());
    if (!(t0 > 0 && t1 < t0)) restarts.push(`${name} (${t0.toFixed(4)} → ${t1.toFixed(4)})`);
  }
  chk('and both buttons restart the string', restarts.length===0, restarts.join(', '));
  await page.click('#reset-btn'); await page.waitForTimeout(250);
}
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns', ko!==en && zh!==en && zh!==ko && (await h1())===en,
      `${en} | ${ko} | ${zh}`);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}
{
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(700); const b = await shot();
  chk('canvas animates', a!==b && a.length>3000, `len ${a.length}`);
}
chk('no console errors after the whole run', errs.length===0, errs.slice(0,3).join(' | '));
await page.close();

for (const w of [320, 390, 768]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await p.close();
}

await finish('Standing waves');
