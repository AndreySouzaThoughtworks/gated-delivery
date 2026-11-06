import { test } from "node:test";
import assert from "node:assert/strict";
import { BASELINE_RULE, baselineText, compareToMessageBaseline, countMessages, excessFindings, findingsOf, growthProblem, parseMessageBaseline } from "./baseline.ts";
import type { Finding } from "./baseline.ts";
import { assertActionable, assertErrorIsActionable } from "../../test-support/actionable.test.support.ts";

const GOOD_MESSAGE = "the file must exist, got ${file}; create it.";
const BAD_MESSAGE = "something went wrong here";
const SOURCES = [
  { path: "plugin/scripts/a.mjs", text: `assert(ok, \`${GOOD_MESSAGE}\`);\nassert(ok, "${BAD_MESSAGE}");` },
  { path: "scripts/audit/b.ts", text: `errors.push("${BAD_MESSAGE}");` },
];
const finding = (path: string, message: string): Finding => {
  assert(path !== "" && message !== "", `a finding needs a path and a message, got ${JSON.stringify({ path, message })}`);
  assert(path.includes("."), `a finding path names a file with an extension, got ${path}`);
  return { path, rule: BASELINE_RULE, message };
};
const notAList = undefined as unknown as Finding[];

test("findingsOf keeps only the messages that are not actionable and names their file", () => {
  assert.deepEqual(findingsOf(SOURCES), [finding("plugin/scripts/a.mjs", BAD_MESSAGE), finding("scripts/audit/b.ts", BAD_MESSAGE)]);
});

test("countMessages counts every message, actionable or not", () => {
  assert.equal(countMessages(SOURCES), 3);
});

test("findingsOf and countMessages refuse sources that are not a list of texts", () => {
  const notSources = undefined as unknown as [];
  const noText = [{ path: "a.mjs" }] as unknown as [];
  for (const action of [() => findingsOf(notSources), () => countMessages(notSources), () => findingsOf(noText), () => countMessages(noText)]) assertErrorIsActionable(action);
  assert.throws(() => findingsOf(notSources), /the `sources` must be a list, got undefined/);
  assert.throws(() => countMessages(noText), /every source must hold text/);
});

test("a baseline text round-trips through parseMessageBaseline", () => {
  const findings = findingsOf(SOURCES);
  assert.deepEqual(parseMessageBaseline(baselineText(findings), "baseline.json"), findings);
});

test("baselineText refuses findings that are not a list or carry another rule", () => {
  assert.throws(() => baselineText([{ path: "a.mjs", rule: "other", message: BAD_MESSAGE }]), /must carry the rule "not-actionable"/);
  assert.throws(() => baselineText(notAList), /the `findings` must be a list, got undefined/);
  assertErrorIsActionable(() => baselineText([{ path: "a.mjs", rule: "other", message: BAD_MESSAGE }]));
});

test("parseMessageBaseline refuses a document without findings and a finding of another rule", () => {
  assert.throws(() => parseMessageBaseline("{}", "baseline.json"), /baseline\.json must hold a findings list/);
  assert.throws(() => parseMessageBaseline(JSON.stringify({ findings: [{ path: "a.mjs", rule: "other", message: BAD_MESSAGE }] }), "baseline.json"), /must hold only "not-actionable" findings/);
  assert.throws(() => parseMessageBaseline(JSON.stringify({ findings: [{ path: "a.mjs", rule: BASELINE_RULE }] }), "baseline.json"), /with a path and a message/);
  assertErrorIsActionable(() => parseMessageBaseline("{}", "baseline.json"));
});

test("compareToMessageBaseline names a message the baseline does not hold and a baseline entry nothing produces", () => {
  const baseline = [finding("a.mjs", BAD_MESSAGE), finding("gone.mjs", BAD_MESSAGE)];
  const { added, removable } = compareToMessageBaseline([finding("a.mjs", BAD_MESSAGE), finding("new.mjs", BAD_MESSAGE)], baseline);
  assert.deepEqual(added, [finding("new.mjs", BAD_MESSAGE)]);
  assert.deepEqual(removable, [finding("gone.mjs", BAD_MESSAGE)]);
});

test("excessFindings counts a message that repeats in one file and refuses entries that are not findings", () => {
  const twice = [finding("a.mjs", BAD_MESSAGE), finding("a.mjs", BAD_MESSAGE)];
  assert.deepEqual(excessFindings(twice, [finding("a.mjs", BAD_MESSAGE)]), [finding("a.mjs", BAD_MESSAGE)]);
  assert.deepEqual(excessFindings([finding("a.mjs", BAD_MESSAGE)], twice), []);
  assert.deepEqual(excessFindings(twice, twice), []);
  assert.throws(() => excessFindings(notAList, twice), /the `findings` must be a list, got undefined/);
  assert.throws(() => excessFindings(twice, notAList), /the `findings` must be a list, got undefined/);
  assert.throws(() => excessFindings(twice, [{ path: "a.mjs" }] as unknown as Finding[]), /every finding must hold a path and a message/);
  assert.throws(() => excessFindings([{ path: "a.mjs" }] as unknown as Finding[], twice), /every finding must hold a path and a message/);
  assertErrorIsActionable(() => excessFindings(twice, [{ path: "a.mjs" }] as unknown as Finding[]));
});

test("compareToMessageBaseline refuses findings or a baseline that is not a list", () => {
  assert.throws(() => compareToMessageBaseline(notAList, []), /the `findings` must be a list/);
  assert.throws(() => compareToMessageBaseline([], notAList), /the `baseline` must be a list/);
  assertErrorIsActionable(() => compareToMessageBaseline([], notAList));
});

test("growthProblem rejects a baseline that grew, in an actionable message, and accepts one that held or shrank", () => {
  const problem = growthProblem(5, 4, "origin/main");
  assert.match(problem ?? "", /must not grow, but went from 4 to 5 entries against origin\/main/);
  assertActionable(problem ?? "");
  assert.equal(growthProblem(4, 4, "origin/main"), null);
  assert.equal(growthProblem(3, 4, "origin/main"), null);
});

test("growthProblem refuses counts that are not integers and a blank base ref", () => {
  assert.throws(() => growthProblem(Number.NaN, 4, "origin/main"), /both `headCount` and `baseCount` must be integers/);
  assert.throws(() => growthProblem(4, 4, ""), /the `baseRef` must name a ref/);
  assertErrorIsActionable(() => growthProblem(Number.NaN, 4, "origin/main"));
  assertErrorIsActionable(() => growthProblem(4, 4, ""));
});
