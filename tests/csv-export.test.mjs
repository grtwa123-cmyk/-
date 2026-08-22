/*
 * Taking the measurement away.
 *
 * Three pages hand their dataset over as CSV, chosen because their data are
 * shaped differently: projectile is a time series, photoelectric a handful of
 * fitted points, spectra a list of events with counts. If the pattern holds
 * for those three it will hold for the rest.
 *
 * The check that matters is not that a file arrives. It is that the file says
 * the same thing the page does — every value, at full precision, against the
 * page's own measurement hook. An export that quietly rounds, or that serves
 * a copy made when the page loaded rather than what is on screen now, is
 * worse than no export at all: it looks like evidence.
 */
import fs from "node:fs";
import { browser, chk, url, finish, lang } from "./lib/harness.mjs";

/** The file a click on #csv-btn produces, parsed into its two halves. */
async function grab(page) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click("#csv-btn"),
  ]);
  const text = fs.readFileSync(await dl.path(), "utf8");
  const lines = text.trim().split("\n");
  const meta = {};
  let i = 0;
  for (; i < lines.length && lines[i].startsWith("#"); i++) {
    const m = lines[i].match(/^#\s*([\w-]+)\s*=\s*(.*)$/);
    if (m) meta[m[1]] = m[2];
  }
  return {
    name: dl.suggestedFilename(),
    head: lines.slice(0, i),
    meta,
    columns: (lines[i] || "").split(","),
    rows: lines.slice(i + 1).map((l) => l.split(",")),
  };
}

const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-12 + 1e-12;

// ── Projectile: a time series ────────────────────────────────────────
{
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url("experiments/projectile.html"), { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click("#launch-btn");
  await page.waitForFunction(() => window.__proj.flight() !== null, null, { timeout: 20000 });

  const csv = await grab(page);
  const flight = await page.evaluate(() => {
    const f = window.__proj.flight();
    return { n: f.path.length, first: f.path[0], last: f.path[f.path.length - 1], R: f.R };
  });

  chk("the trajectory downloads, named for the shot that produced it",
      /^projectile-v\d+-a\d+/.test(csv.name), csv.name);
  chk("with a header row naming the columns in SI units",
      csv.columns.join(",") === "t_s,x_m,y_m,speed_ms", csv.columns.join(","));
  chk("and a row for every sample the page measured",
      csv.rows.length === flight.n, `${csv.rows.length} rows vs ${flight.n} samples`);

  // Full precision, not the two decimals the panel shows. Rounding here would
  // cap what anyone can check the page against.
  const last = csv.rows[csv.rows.length - 1].map(Number);
  chk("the last row is the landing, to the precision the page computed it",
      near(last[0], flight.last.t) && near(last[1], flight.last.x)
        && near(last[3], flight.last.v),
      `t ${last[0]} vs ${flight.last.t}, x ${last[1]} vs ${flight.last.x}`);
  chk("and carries more digits than the readout does",
      String(last[1]).replace(/^-?\d*\.?/, "").length > 4, String(last[1]));

  /*
   * Provenance. A column of numbers with no record of the settings that made
   * it is a list, not a measurement — and the settings recorded have to be
   * the ones in force, not defaults baked in at load.
   */
  const ui = await page.evaluate(() => window.__proj.params());
  chk("the file records the settings it was taken under",
      Number(csv.meta.v0_ms) === ui.v0 && Number(csv.meta.angle_deg) === ui.theta
        && Number(csv.meta.drag_b) === ui.b,
      `v0 ${csv.meta.v0_ms}/${ui.v0}, angle ${csv.meta.angle_deg}/${ui.theta}, b ${csv.meta.drag_b}/${ui.b}`);
  chk("and the measured results beside them",
      near(Number(csv.meta.measured_range_m), flight.R),
      `${csv.meta.measured_range_m} vs ${flight.R}`);
  chk("and names the experiment and its address",
      /Science Lab — Projectile Motion/.test(csv.head[0])
        && /projectile\.html/.test(csv.head[1]),
      csv.head.slice(0, 2).join(" | "));

  // Change the shot; the next file has to be the new one.
  await page.$eval("#velocity", (el) => {
    el.value = String(Number(el.value) - 7);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#launch-btn");
  await page.waitForTimeout(1200);
  const again = await grab(page);
  chk("a second export is the new shot, not the first one over again",
      Number(again.meta.v0_ms) !== Number(csv.meta.v0_ms)
        && again.rows.length !== csv.rows.length,
      `v0 ${csv.meta.v0_ms} → ${again.meta.v0_ms}, ${csv.rows.length} → ${again.rows.length} rows`);

  chk("no page errors while exporting", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── Photoelectric: the points a fit was made from ────────────────────
{
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(url("experiments/photoelectric.html"), { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  /*
   * csv.js refuses to write a file with no rows, and nothing here proves it,
   * because none of these three pages can reach that state: projectile
   * measures a flight on load, and spectra and photoelectric each start with
   * one point already taken. Clearing the photoelectric graph does not empty
   * it either — the current setting is measured again immediately. The guard
   * stays as defence for the next page that exports, and is noted as
   * unexercised rather than claimed as tested.
   *
   * What can be checked is that an export straight after load is the state at
   * click time and not a placeholder: one point, the one the page has.
   */
  const before = await page.evaluate(() => window.__pe.points().length);
  const fresh = await grab(page);
  chk("an export before the reader does anything is the point already taken",
      before === 1 && fresh.rows.length === 1,
      `${before} points, ${fresh.rows.length} rows`);

  await page.click("#measure-btn");
  await page.waitForFunction(() => window.__pe.points().length > 5, null, { timeout: 30000 });
  const csv = await grab(page);
  const pts = await page.evaluate(() => window.__pe.points());
  const fit = await page.evaluate(() => window.__pe.planck());

  chk("after measuring, the points download",
      csv.rows.length === pts.length && pts.length > 5,
      `${csv.rows.length} rows vs ${pts.length} points`);
  chk("with the columns the regression needs",
      csv.columns.join(",") === "metal,frequency_Hz,stopping_voltage_V",
      csv.columns.join(","));

  // Every point, not just the endpoints: a fit is only as good as all of them.
  const off = csv.rows.filter((r, i) =>
    !near(Number(r[1]), pts[i].f) || !near(Number(r[2]), pts[i].ke));
  chk("and every point matches the page's own, exactly",
      off.length === 0, `${off.length} of ${pts.length} differ`);

  chk("the fitted h travels with the points that produced it",
      fit && near(Number(csv.meta.fitted_h_Js), fit.h),
      `${csv.meta.fitted_h_Js} vs ${fit && fit.h}`);
  await ctx.close();
}

// ── Spectra: a list of events ────────────────────────────────────────
{
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(url("experiments/spectra.html"), { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  for (let i = 0; i < 12; i++) {
    await page.click("#excite-btn");
    await page.waitForTimeout(220);
  }
  await page.waitForFunction(() => window.__spectra.lines().length > 1, null, { timeout: 30000 });

  const csv = await grab(page);
  const lines = await page.evaluate(() => window.__spectra.lines());
  chk("the emitted lines download",
      csv.rows.length === lines.length && lines.length > 1,
      `${csv.rows.length} rows vs ${lines.length} lines`);
  chk("with the transition each one came from",
      csv.columns.join(",")
        === "wavelength_nm,n_lower,n_upper,series,count,photon_energy_eV",
      csv.columns.join(","));

  const bad = csv.rows.filter((r, i) =>
    !near(Number(r[0]), lines[i].nm) || Number(r[1]) !== lines[i].n1
    || Number(r[2]) !== lines[i].n2 || Number(r[4]) !== lines[i].count);
  chk("and every wavelength, transition and count is the page's own",
      bad.length === 0, `${bad.length} of ${lines.length} differ`);

  /*
   * This is the list the atom actually emitted, not the table of everything
   * hydrogen can emit — the distinction the page is built on. From n = 5
   * there are ten possible lines and a dozen cascades will not have found
   * all of them.
   */
  const possible = await page.evaluate(() => {
    const n = window.__spectra.params().level;
    return (n * (n - 1)) / 2;
  });
  chk("and it is what was seen, not the full table of what is possible",
      lines.length <= possible, `${lines.length} seen of ${possible} possible`);
  await ctx.close();
}

// ── The button says so in every language ─────────────────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url("experiments/spectra.html"), { waitUntil: "networkidle" });
  const label = async () => page.$eval("#csv-btn", (el) => el.textContent.trim());
  const en = await label();
  await lang(page, 'ko');
  await page.waitForFunction(() => /[가-힣]/.test(document.getElementById("csv-btn").textContent),
                             null, { timeout: 20000 }).catch(() => {});
  const ko = await label();
  chk("the export button is translated", en !== ko && /[가-힣]/.test(ko), `${en} / ${ko}`);

  /*
   * The file's interior is not, and should not be. Column headers are names
   * for a spreadsheet formula or a plotting script, and one that changed with
   * the reader's locale would break every one of them.
   */
  await page.close();
  const p2 = await ctx.newPage();
  await p2.goto(url("experiments/spectra.html"), { waitUntil: "networkidle" });
  await p2.waitForTimeout(300);
  for (let i = 0; i < 6; i++) { await p2.click("#excite-btn"); await p2.waitForTimeout(200); }
  await p2.waitForFunction(() => window.__spectra.lines().length > 0, null, { timeout: 20000 });
  const ctx2 = ctx;
  const dlPage = p2;
  await dlPage.context().setDefaultTimeout(20000);
  const [dl] = await Promise.all([
    dlPage.waitForEvent("download", { timeout: 20000 }),
    dlPage.click("#csv-btn"),
  ]).catch(() => [null]);
  const text = dl ? fs.readFileSync(await dl.path(), "utf8") : "";
  chk("but the column headers stay English, so a script can read them",
      /wavelength_nm,n_lower,n_upper/.test(text),
      (text.split("\n").find((l) => l.startsWith("wavelength")) || "(no header)"));
  await ctx2.close();
}

// ── Gene expression: a histogram, and the header conventions ─────────────
// Added when its first export shipped opening "# Science Lab — undefined"
// under a filename with no extension: the maker skipped the fields the other
// exporters fill in, and nothing was reading the head of the file.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(url("experiments/expression.html"), { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  // Carry the field somewhere non-trivial before exporting.
  await page.evaluate(() => {
    const st = window.__expr.state();
    for (let i = 0; i < 900; i++) window.__expr.step(st);
  });
  const d = await grab(page);

  chk("expression: the file is named like a CSV",
      /^gene-expression.*\.csv$/.test(d.name), d.name);
  chk("expression: the head names the page, not undefined",
      d.head.length >= 3 && /Gene Expression/i.test(d.head[0]) && !/undefined/.test(d.head.join("\n")),
      d.head[0] || "(empty head)");
  chk("expression: the settings ride along as metadata",
      ["cells", "transcription_rate", "k_on", "k_off", "decay_rate"]
        .every((k) => k in d.meta),
      Object.keys(d.meta).join(","));

  // The bars are the claim, so the file must be the field: every cell binned
  // exactly once, and the mean rebuilt from the rows equal to the page's own.
  const q = await page.evaluate(() => {
    const m = window.__expr.measure(window.__expr.state());
    return { cells: window.__expr.state().m.length, mean: m.mean };
  });
  const counted = d.rows.reduce((s, r) => s + Number(r[1]), 0);
  const mean = d.rows.reduce((s, r) => s + Number(r[0]) * Number(r[1]), 0) / counted;
  chk("expression: every cell is in the file exactly once",
      counted === q.cells, `${counted} rows-worth vs ${q.cells} cells`);
  chk("expression: the mean rebuilt from the file is the page's measurement",
      Math.abs(mean - q.mean) < 1e-9, `${mean} vs ${q.mean}`);
  await page.close();
}

await finish("csv export");
