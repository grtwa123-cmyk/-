/*
 * Lint — syntax and whitespace, with no dependencies.
 *
 * The project ships no build step and no runtime dependencies, so a linter
 * that needed installing would be the heaviest thing in the repo. These are
 * the two classes of problem that are worth a gate anyway:
 *
 *   1. A syntax error. Every simulation is loaded straight into a browser by a
 *      <script> tag, so a stray brace is a blank page, not a build failure.
 *   2. Drift from .editorconfig, which nothing else enforces.
 *
 * On checking ESM: `node --check` decides how to parse from the file's
 * extension, and for a `.js` file containing `export` it quietly reports
 * success without fully parsing — a genuine syntax error exits 0. Copying to a
 * `.mjs` temp file first is what makes the check real.
 *
 * Inline scripts count. Selecting files by a .js extension left 55 KB of
 * JavaScript in eight <script> blocks unparsed — 34 KB of it the solar system
 * tour, 12 KB the black hole — which is to say the two largest scripts on the
 * site were exempt from the gate that exists because a stray brace there is a
 * blank page rather than a build failure. They are extracted and checked with
 * everything else.
 *
 * Not every <script> holds JavaScript, and guessing wrong turns this gate into
 * a false alarm that never stops: blackhole.html keeps its fragment shader in
 * one and an import map in another. Blocks are selected by type, so GLSL and
 * JSON are left alone.
 */

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rel = (p) => path.relative(root, p);
const failures = [];

// --others --exclude-standard picks up files that are new but not ignored.
// Plain `git ls-files` lists only what is already staged or committed, so a
// brand-new file went unchecked until someone remembered to `git add` it —
// which is exactly when a syntax error is most likely to be there.
const tracked = execSync("git ls-files --cached --others --exclude-standard",
  { cwd: root, encoding: "utf8" })
  .trim().split("\n").filter(Boolean)
  .filter((f, i, a) => a.indexOf(f) === i);

const BINARY = /\.(png|jpe?g|ico|gif|webp|woff2?|ttf|mp3|wav)$/i;

// Third-party text that has to ship byte-for-byte. The OFL requires the
// licence to travel with the font, and reformatting someone else's licence to
// suit our .editorconfig is not a change we get to make — it arrives from
// upstream with a trailing space and no final newline, and it stays that way.
const VENDORED = /^assets\/fonts\/OFL\.txt$/;

const text = tracked.filter((f) => !BINARY.test(f) && !VENDORED.test(f));

// ── 1. Syntax ─────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sciencelab-lint-"));
let checked = 0;

for (const file of tracked.filter((f) => f.endsWith(".js"))) {
  const abs = path.join(root, file);
  const src = fs.readFileSync(abs, "utf8");
  // Top-level import/export means the browser loads it as a module.
  const isModule = /^\s*(import\s|export\s|export\{)/m.test(src);
  let target = abs;
  if (isModule) {
    target = path.join(tmp, file.replace(/[/\\]/g, "_") + ".mjs");
    fs.writeFileSync(target, src);
  }
  try {
    execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    checked++;
  } catch (err) {
    const msg = String(err.stderr || err.message)
      .split("\n").find((l) => /Error/.test(l)) || "syntax error";
    failures.push(`${file}: ${msg.trim()}`);
  }
}
/*
 * The same check for script blocks written into HTML.
 *
 * A block is JavaScript if it has no type or a JavaScript one — anything else
 * is somebody else's language and is skipped rather than failed. The temp copy
 * is padded with the blank lines the block sits below in the page, so node
 * reports a line number that matches the HTML file: pointing at the top of a
 * 34 KB block, which the first version did, barely narrows it down.
 */
const JS_TYPES = new Set(["", "module", "text/javascript",
                          "application/javascript", "text/ecmascript"]);
let inlineChecked = 0, inlineSkipped = 0;

for (const file of tracked.filter((f) => f.endsWith(".html"))) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, attrs, body] = m;
    if (/\ssrc\s*=/.test(attrs)) continue;            // an external file, checked above
    const typeMatch = attrs.match(/\stype\s*=\s*["']?([^"'\s>]+)/);
    const type = (typeMatch ? typeMatch[1] : "").toLowerCase();
    if (!JS_TYPES.has(type)) { inlineSkipped++; continue; }
    if (!body.trim()) continue;

    const line = src.slice(0, m.index).split("\n").length;
    const isModule = type === "module" || /^\s*(import\s|export\s|export\{)/m.test(body);
    const target = path.join(tmp, `${file.replace(/[/\\]/g, "_")}_${line}`
                                 + (isModule ? ".mjs" : ".js"));
    fs.writeFileSync(target, "\n".repeat(line - 1) + body);
    try {
      execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
      inlineChecked++;
    } catch (err) {
      const out = String(err.stderr || err.message);
      const msg = out.split("\n").find((l) => /Error/.test(l)) || "syntax error";
      const at = out.match(/^[^\n]*?:(\d+)$/m);
      failures.push(`${file}:${at ? at[1] : line}: inline <script>: ${msg.trim()}`);
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── 2. .editorconfig ──────────────────────────────────────────────────────
// charset=utf-8, end_of_line=lf, insert_final_newline, trim_trailing_whitespace
// (the last one is off for .md, where two trailing spaces are a line break).
for (const file of text) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (src.includes("\r")) failures.push(`${file}: CRLF line ending (want LF)`);
  if (src.length && !src.endsWith("\n")) failures.push(`${file}: no final newline`);
  if (!file.endsWith(".md")) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/[ \t]+$/.test(lines[i])) failures.push(`${file}:${i + 1}: trailing whitespace`);
    }
  }
}

// ── 3. no theme colours on a canvas ───────────────────────────────────────
/*
 * The experiment stages paint on a ground that stays dark in both themes, so
 * ink taken from the document's palette is only right in one of them. Four of
 * these variables flip: --text goes #ecf0fb → #141829, --muted #97a0bf →
 * #566080, and --border and --accent likewise. A canvas drawing with them
 * gives a light-theme reader dark ink on a dark ground.
 *
 * This is not hypothetical and it is not once. The galvanic cell shipped with
 * it and was caught by eye; a hunt afterwards found the same fault on three
 * more pages, the worst of them the Kepler plot on the orbit page at 1.16:1
 * where 4.5:1 is the floor for text. Nothing else notices — the theme suite
 * checks that a page repaints when the theme changes, which it does, in the
 * wrong colour.
 *
 * So the pattern is refused outright. A page that wants the reader's palette
 * on a canvas has to paint a matching ground first, and then this rule is the
 * wrong rule and should be changed deliberately rather than worked around.
 */
{
  const FLIPPING = ["--text", "--muted", "--border", "--accent"];
  const pages = fs.readdirSync(path.join(root, "experiments"))
    .filter((f) => f.endsWith(".js") || f.endsWith(".html"));
  for (const file of pages) {
    const src = fs.readFileSync(path.join(root, "experiments", file), "utf8");
    if (!/getContext\s*\(/.test(src)) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const v of FLIPPING) {
      if (code.includes(`"${v}"`) || code.includes(`'${v}'`)) {
        failures.push(`experiments/${file}: reads ${v} for a canvas that stays dark in both `
          + "themes — use a fixed colour (see the note in tests/lint.mjs)");
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────
if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error(`FAIL  ${f}`);
  if (failures.length > 40) console.error(`… and ${failures.length - 40} more`);
  console.error(`\n${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`lint: ${checked} JS files and ${inlineChecked} inline scripts parsed `
  + `(${inlineSkipped} non-JS blocks skipped), `
  + `${text.length} files match .editorconfig — clean`);
