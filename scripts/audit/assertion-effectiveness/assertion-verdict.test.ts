import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test-support/temp-dir.mjs";
import { baselineDocument, compareToBaseline, formatReport, judgeSites, parseBaseline, readEvidence } from "./assertion-verdict.ts";
import type { Evidence, Judged, Verdict } from "./assertion-verdict.ts";
import type { AssertSite } from "./assertion-sites.ts";

const FIRST: AssertSite = { id: "a.mjs:1:1", path: "a.mjs", line: 1, functionName: "run", condition: "ready", calleeStart: 0, calleeEnd: 6, calleeText: "assert" };
const SECOND: AssertSite = { ...FIRST, id: "a.mjs:2:1", line: 2 };
const THIRD: AssertSite = { ...FIRST, id: "a.mjs:3:1", line: 3 };
const OTHER_FILE: AssertSite = { ...FIRST, id: "b.mjs:2:1", path: "b.mjs", line: 2 };
const JUDGED_FIRST: Judged = { site: FIRST, evaluations: 2, falsified: 0, verdict: "unproven", message: "run | 1", key: "a.mjs | run | 1" };
const JUDGED_SECOND: Judged = { site: SECOND, evaluations: 0, falsified: 0, verdict: "unevaluated", message: "run | 2", key: "a.mjs | run | 2" };
const JUDGED_PROVEN: Judged = { site: THIRD, evaluations: 1, falsified: 1, verdict: "proven", message: "run | 3", key: "a.mjs | run | 3" };

test("readEvidence tallies evaluations and falsifications per site across log files", () => {
  const logs = tempDir("assertion-verdict", "logs");
  writeFileSync(join(logs, "1.log"), "a.mjs:1:1\theld\na.mjs:1:1\tfailed\n");
  writeFileSync(join(logs, "2.log"), "a.mjs:1:1\theld\n");
  assert.deepStrictEqual(readEvidence(logs).get("a.mjs:1:1"), { evaluations: 3, falsified: 1 });
});

test("readEvidence ignores files that are not logs, and refuses a relative directory, a log the probe did not name and a malformed record", () => {
  const logs = tempDir("assertion-verdict", "bad");
  mkdirSync(join(logs, "nested"));
  writeFileSync(join(logs, "notes.txt"), "not a record");
  assert.strictEqual(readEvidence(logs).size, 0);
  assert.throws(() => readEvidence("relative/log"), /needs the absolute log directory/);
  writeFileSync(join(logs, "stray.log"), "");
  assert.throws(() => readEvidence(logs), /holds stray.log, which the probe never writes/);
  rmSync(join(logs, "stray.log"));
  writeFileSync(join(logs, "3.log"), "a.mjs:1:1\tmaybe\n");
  assert.throws(() => readEvidence(logs), /malformed record/);
});

test("judgeSites classes a site by falsifications and evaluations", () => {
  const evidence: Evidence = new Map([["a.mjs:1:1", { evaluations: 2, falsified: 1 }], ["a.mjs:2:1", { evaluations: 4, falsified: 0 }]]);
  assert.deepStrictEqual(judgeSites([FIRST, SECOND, THIRD], evidence).map((entry) => entry.verdict), ["proven", "unproven", "unevaluated"]);
});

test("judgeSites refuses no sites and a log naming a site that was never instrumented", () => {
  assert.throws(() => judgeSites([], new Map()), /needs the instrumented sites, got 0/);
  assert.throws(() => judgeSites([FIRST], new Map([["b.mjs:9:1", { evaluations: 1, falsified: 0 }]])), /never instrumented: b.mjs:9:1/);
});

test("judgeSites keeps two sites with the same function and condition apart with a repeat mark", () => {
  const [first, second] = judgeSites([FIRST, { ...FIRST, id: "a.mjs:5:1", line: 5 }], new Map());
  assert.notStrictEqual(first.key, second.key);
  assert.match(second.message, / #2$/);
});

test("compareToBaseline lists new unproven sites as added and baseline entries without one as removable", () => {
  const baseline = parseBaseline(baselineDocument([JUDGED_FIRST, JUDGED_PROVEN]), "inline");
  const { added, removable } = compareToBaseline([JUDGED_FIRST, JUDGED_SECOND, JUDGED_PROVEN], [...baseline, { path: "gone.mjs", rule: "unproven-assertion", message: "old | 1", condition: "x" }]);
  assert.deepStrictEqual(added.map((entry) => entry.site.line), [2]);
  assert.deepStrictEqual(removable.map((finding) => finding.path), ["gone.mjs"]);
});

test("compareToBaseline refuses a baseline that lists one site twice and two unproven sites that share a key", () => {
  const entry = { path: "a.mjs", rule: "unproven-assertion", message: "run | 1", condition: "ready" };
  assert.throws(() => compareToBaseline([JUDGED_FIRST], [entry, entry]), /lists one site twice among its 2 entries/);
  assert.throws(() => compareToBaseline([JUDGED_FIRST, { ...JUDGED_FIRST }], []), /share a baseline key/);
});

test("baselineDocument keeps unproven sites only, with their condition", () => {
  const document = JSON.parse(baselineDocument([JUDGED_FIRST, JUDGED_PROVEN]));
  assert.deepStrictEqual(document.findings, [{ path: "a.mjs", rule: "unproven-assertion", message: "run | 1", condition: "ready" }]);
});

test("baselineDocument refuses a site with no condition or message and two sites with one key", () => {
  assert.throws(() => baselineDocument([{ ...JUDGED_FIRST, site: { ...FIRST, condition: "" } }]), /a.mjs:1:1 has no condition or message/);
  assert.throws(() => baselineDocument([{ ...JUDGED_FIRST, message: "" }]), /has no condition or message/);
  assert.throws(() => baselineDocument([JUDGED_FIRST, { ...JUDGED_FIRST }]), /share a key/);
});

test("parseBaseline refuses an empty file and a document that is not a list of unproven-assertion findings", () => {
  assert.throws(() => parseBaseline("  ", "base.json"), /base.json is empty/);
  assert.throws(() => parseBaseline("{}", "base.json"), /base.json must hold a findings array/);
  assert.throws(() => parseBaseline('{"findings":[{"path":"a","rule":"other","message":"m"}]}', "base.json"), /base.json must hold a findings array/);
});

test("formatReport groups unproven sites by file with their condition and counts every class", () => {
  const report = formatReport([{ ...JUDGED_FIRST, site: { ...FIRST, condition: "x > 1" }, evaluations: 3 }, { ...JUDGED_SECOND, site: OTHER_FILE }, JUDGED_PROVEN]);
  assert.match(report, /^a\.mjs\n {2}\(b\) never false run:1 {2}x > 1 {2}\[3 evaluations\]\nb\.mjs\n {2}\(c\) never evaluated run:2/);
  assert.match(report, /sites 3: \(a\) proven 1, \(b\) unproven 1, \(c\) unevaluated 1$/);
});

test("formatReport refuses a corrupt log and an unknown verdict", () => {
  assert.throws(() => formatReport([{ ...JUDGED_FIRST, falsified: 3 }]), /a.mjs:1:1 was false 3 times in 2 evaluations/);
  assert.throws(() => formatReport([{ ...JUDGED_FIRST, verdict: "bogus" as Verdict }]), /outside proven, unproven and unevaluated/);
});
