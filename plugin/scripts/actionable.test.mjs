import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONABLE_WORD_LIMIT, actionabilityProblems, assertActionable, assertEveryLineActionable, assertErrorIsActionable } from "./run-cli.test.support.mjs";

const GOOD = "spec.md:3: email address is banned in tickets; replace it with a placeholder.";
const NO_VALUE = "an address is banned in tickets; replace it with a placeholder.";
const NO_RULE = "spec.md:3: email address; replace it with a placeholder.";
const NO_FIX = "spec.md:3: email address is banned in tickets.";
const NAMES_NOTHING = "invalid input";
const NO_VALUE_PROBLEM = "names no file, line or offending value";
const NO_RULE_PROBLEM = "states no violated rule";
const NO_FIX_PROBLEM = "states no fix as an imperative after ';', '.' or 'Hint:'";

test("accepts a message with a location, a rule and a fix", () => {
  assert.deepEqual(actionabilityProblems(GOOD), []);
  assertActionable(GOOD);
});

test("rejects the known-bad message that names nothing", () => {
  assert.deepEqual(actionabilityProblems(NAMES_NOTHING), [NO_VALUE_PROBLEM, NO_FIX_PROBLEM]);
  assert.throws(() => assertActionable(NAMES_NOTHING), /is not actionable/);
});

for (const [name, message, problem] of [
  ["a location", NO_VALUE, NO_VALUE_PROBLEM],
  ["a violated rule", NO_RULE, NO_RULE_PROBLEM],
  ["a fix", NO_FIX, NO_FIX_PROBLEM],
]) {
  test(`rejects a message that lacks ${name}`, () => {
    assert.deepEqual(actionabilityProblems(message), [problem]);
    assert.throws(() => assertActionable(message), /is not actionable/);
  });
}

test("rejects a message one word over the limit and accepts one at the limit", () => {
  const goodWords = GOOD.split(" ").length;
  const atLimit = `${GOOD}${" word".repeat(ACTIONABLE_WORD_LIMIT - goodWords)}`;
  assert.equal(atLimit.split(" ").length, ACTIONABLE_WORD_LIMIT);
  assert.deepEqual(actionabilityProblems(atLimit), []);
  assert.match(actionabilityProblems(`${atLimit} word`).join(), /word limit/);
});

test("rejects a verb that does not follow a boundary", () => {
  assert.deepEqual(actionabilityProblems("spec.md:3: email address is banned, so replace it"), [NO_FIX_PROBLEM]);
});

test("checks every line of an output and refuses an empty one", () => {
  assertEveryLineActionable(`${GOOD}\n${GOOD}\n`);
  assert.throws(() => assertEveryLineActionable(`${GOOD}\n${NO_FIX}\n`), /is not actionable/);
  assert.throws(() => assertEveryLineActionable("\n"), /at least one message/);
  assert.throws(() => assertEveryLineActionable(undefined), /must be text/);
});

test("checks the message of a thrown error and refuses an action that does not throw", () => {
  assertErrorIsActionable(() => {
    throw new Error(GOOD);
  });
  assert.throws(() => assertErrorIsActionable(() => {
    throw new Error(NAMES_NOTHING);
  }), /is not actionable/);
  assert.throws(() => assertErrorIsActionable(() => undefined), /must throw/);
  assert.throws(() => assertErrorIsActionable("not a function"), /must be a function/);
});

test("refuses a message that is not text or is blank", () => {
  assert.throws(() => actionabilityProblems(undefined), /must be text/);
  assert.throws(() => actionabilityProblems("  "), /must not be blank/);
  assert.throws(() => assertActionable(undefined), /must be text/);
});
