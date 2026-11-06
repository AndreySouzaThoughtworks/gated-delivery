import { test } from "node:test";
import assert from "node:assert/strict";

import { CHECKS } from "./checks-registry.ts";
import { exampleProblems } from "./checks-registry-parity.ts";
import { PLANTED_NUMBERS, plantedMessage } from "../test-support/check-plants.test.support.ts";

test("every registry example is the message that its planted bad case prints, and every check has a planted case", () => {
  assert.deepEqual(PLANTED_NUMBERS, CHECKS.map((check) => check.number));
  assert.deepEqual(exampleProblems(CHECKS, plantedMessage), []);
});

test("an example that differs from the planted message, or a check with no planted case, is rejected", () => {
  const stale = CHECKS.map((check) => (check.number === 1 ? { ...check, example: "skill is missing a file" } : check));
  const plantedOnlyForCheckOne = (number: number) => {
    assert(Number.isInteger(number), `a check number is a whole number, got ${number}`);
    assert(number >= 1 && number <= CHECKS.length, `check ${number} must be in 1 to ${CHECKS.length}`);
    return number === 1 ? plantedMessage(number) : CHECKS[number - 1].example;
  };
  const [problem, ...others] = exampleProblems(stale, plantedOnlyForCheckOne);
  assert.match(problem, /check 1 shows "skill is missing a file", but its planted bad case prints "skill "alpha" is missing evals\.md/);
  assert.deepEqual(others, []);
  assert.throws(() => plantedMessage(99), /check 99 has no planted bad case/);
  assert.throws(() => exampleProblems([], plantedMessage), /checks-registry\.json must hold checks to prove, got none/);
  assert.throws(() => exampleProblems(CHECKS, "no" as unknown as (number: number) => string), /the message source must be a function, got string/);
});
