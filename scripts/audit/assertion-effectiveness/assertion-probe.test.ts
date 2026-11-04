import { test } from "node:test";
import assert from "node:assert";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempDir } from "../../test-support/temp-dir.mjs";

const PROBE_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "assertion-probe.mjs");

test("the probe logs held and failed evaluations, still throws like assert, and refuses ids that break the log", async () => {
  const home = tempDir("assertion-probe", "home");
  mkdirSync(join(home, "log"));
  copyFileSync(PROBE_SOURCE, join(home, "assertion-probe.mjs"));
  const { probe } = await import(pathToFileURL(join(home, "assertion-probe.mjs")).href);
  assert.strictEqual(probe("a.mjs:1:1")(true, "fine"), undefined);
  assert.throws(() => probe("a.mjs:1:1")(0, "must hold"), /must hold/);
  assert.strictEqual(readFileSync(join(home, "log", `${process.pid}.log`), "utf8"), "a.mjs:1:1\theld\na.mjs:1:1\tfailed\n");
  assert.throws(() => probe(""), /non-empty site id/);
  assert.throws(() => probe(7), /non-empty site id/);
  assert.throws(() => probe("a\tb"), /must not contain a tab or newline/);
  assert.throws(() => probe("a\nb"), /must not contain a tab or newline/);
});
