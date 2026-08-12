/*
 * Take the measurement away.
 *
 * Every page on this site badged `measured` reads a textbook result back out
 * of a mechanism rather than printing it. A reader who wants to check that
 * claim should not have to retype numbers off a panel, so the pages that hold
 * a dataset worth checking hand it over as CSV.
 *
 * What goes in the file
 * ---------------------
 * The rows, and enough about where they came from to reproduce them. A column
 * of numbers with no record of the settings that produced it is not a
 * measurement, it is a list — so each file opens with commented lines naming
 * the experiment, its URL, the moment it was taken and the control values in
 * force. Spreadsheets drop those into the first column rather than hiding
 * them, which is untidy but honest; the alternative is a file nobody can
 * reproduce from.
 *
 * Column headers stay English in every language. They are names for a machine
 * — a script, a spreadsheet formula, a plotting library — and a header that
 * changed with the reader's locale would break every one of them. The button
 * that produces the file is translated; the file's interior is not.
 *
 * Values are written at full precision, not at the precision the panel shows.
 * The readout rounds because a screen has to; a file does not, and rounding
 * here would quietly cap what anyone can check the page against.
 */
(() => {
  /** One CSV field, quoted only when it has to be. */
  function field(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      // Full precision, but without the exponent soup for ordinary values:
      // 1e-7 stays readable, and an integer stays an integer.
      return Number.isFinite(v) ? String(v) : "";
    }
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /**
   * Build the file. `columns` are the machine-readable header names, `rows`
   * arrays in the same order, `meta` an object of settings recorded above it.
   */
  function build(title, columns, rows, meta) {
    const head = [
      `# Science Lab — ${title}`,
      `# ${location.href.split("?")[0]}`,
      `# taken ${new Date().toISOString()}`,
    ];
    for (const [k, v] of Object.entries(meta || {})) head.push(`# ${k} = ${v}`);
    const body = [columns.join(",")];
    for (const r of rows) body.push(r.map(field).join(","));
    // A trailing newline: POSIX text, and some tools drop the last row without.
    return `${head.join("\n")}\n${body.join("\n")}\n`;
  }

  /**
   * Hand the file to the browser.
   *
   * A Blob and an object URL rather than a data: URI, because a long
   * trajectory exceeds what some browsers accept in a URL — and this works
   * from file://, which the README promises.
   */
  function save(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately races the download in some browsers; a tick is
    // enough and the object is small.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Wire a button to a dataset builder.
   *
   * `make()` runs at click time, not at wiring time, so the file always holds
   * what the page is showing now rather than whatever it held when the page
   * loaded. It returns { title, columns, rows, meta, name }.
   */
  function attach(buttonId, make) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const d = make();
      // No rows, no file: an empty CSV reads as a measurement of nothing.
      // Untested, and deliberately so — none of the three pages that export
      // today can reach an empty dataset, so tests/csv-export.test.mjs says
      // this is unexercised rather than pretending to cover it.
      if (!d || !d.rows || !d.rows.length) return;
      save(d.name, build(d.title, d.columns, d.rows, d.meta));
      if (window.SFX && window.SFX.click) window.SFX.click({ gain: 0.18 });
    });
  }

  window.CSVExport = { attach, build, save };
})();
