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
const text = tracked.filter((f) => !BINARY.test(f));

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

// ── Report ────────────────────────────────────────────────────────────────
if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error(`FAIL  ${f}`);
  if (failures.length > 40) console.error(`… and ${failures.length - 40} more`);
  console.error(`\n${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`lint: ${checked} JS files parsed, ${text.length} files match .editorconfig — clean`);
