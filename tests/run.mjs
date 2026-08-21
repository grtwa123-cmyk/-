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
 *
 * --shard i/n runs every n-th suite, so CI can spread the whole thing over
 * parallel jobs. It is not a tuning knob: the suite passed 25 minutes of
 * wall time somewhere around the atom commit, CI's job ceiling is 25
 * minutes, and every run after that was killed at the ceiling and reported
 * as "cancelled" — the same word GitHub uses when a newer push supersedes a
 * run, which is why four commits went by before anyone read it as a
 * failure. Sharding puts each piece back well under the ceiling, so the
 * ceiling can go back to meaning what it says.
 *
 * --list prints what would run and exits, which is how the shards are
 * checked to be a partition rather than a guess.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const argv = process.argv.slice(2);

const list = argv.includes("--list");
let shard = null;
{
  const i = argv.indexOf("--shard");
  if (i !== -1) {
    const m = /^(\d+)\/(\d+)$/.exec(argv[i + 1] || "");
    if (!m || +m[1] < 1 || +m[1] > +m[2]) {
      console.error(`--shard wants i/n with 1 <= i <= n, got ${argv[i + 1]}`);
      process.exit(2);
    }
    shard = { i: +m[1] - 1, n: +m[2] };
  }
}
const filter = argv.filter((a, i) =>
  !a.startsWith("--") && !(argv[i - 1] === "--shard"));

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
].filter((p) => !filter.length || filter.some((q) => p.includes(q)))
  // Round-robin rather than contiguous blocks: the suites are alphabetical,
  // not sorted by cost, so consecutive ones are no more alike in runtime than
  // any others and dealing them out evens the shards better than cutting the
  // list into quarters would.
  .filter((_, idx) => !shard || idx % shard.n === shard.i);

if (list) {
  for (const s of suites) console.log(path.relative(here, s));
  process.exit(0);
}

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
