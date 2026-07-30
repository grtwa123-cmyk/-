/*
 * Runs every suite and sums up.
 *
 * Each suite is a separate process. They each stand up their own server and
 * browser, so one crashing takes nothing else down with it, and a suite can
 * still be run on its own while working on it:
 *
 *     node tests/experiments/enzyme.test.mjs
 *
 * Pass a substring to run a subset:  npm test -- enzyme lens
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const filter = process.argv.slice(2);

const suites = [
  path.join(here, "smoke.mjs"),
  ...fs.readdirSync(here)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => path.join(here, f)),
  ...fs.readdirSync(path.join(here, "experiments"))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => path.join(here, "experiments", f)),
].filter((p) => !filter.length || filter.some((q) => p.includes(q)));

const run = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath,
    ["--no-warnings=MODULE_TYPELESS_PACKAGE_JSON", file],
    { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => resolve({ file, code, out }));
});

const started = Date.now();
const results = [];
for (const suite of suites) {
  const name = path.relative(here, suite);
  process.stdout.write(`\n──  ${name}\n`);
  const r = await run(suite);
  // Echo the suite's own output so a failure reads the same as running it alone.
  process.stdout.write(r.out.trimEnd() + "\n");
  results.push({ name, ...r });
}

const tally = (out) => {
  const m = out.match(/(\d+)\/(\d+) passed/);
  return m ? { pass: +m[1], total: +m[2] } : { pass: 0, total: 0 };
};

let checks = 0, passed = 0, failedSuites = 0;
console.log("\n════ summary ════");
for (const r of results) {
  const { pass, total } = tally(r.out);
  checks += total; passed += pass;
  if (r.code !== 0) failedSuites++;
  const status = r.code === 0 ? "ok  " : "FAIL";
  console.log(`  ${status}  ${r.name.padEnd(38)} ${total ? `${pass}/${total}` : `exit ${r.code}`}`);
}
console.log(`\n${results.length - failedSuites}/${results.length} suites, ` +
  `${passed}/${checks} checks, ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failedSuites ? 1 : 0);
