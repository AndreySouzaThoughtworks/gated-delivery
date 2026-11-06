import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMessages, readArguments, readInterpolation, readLiteral } from "./extract-messages.ts";
import { assertErrorIsActionable } from "../../test-support/actionable.test.support.ts";

const texts = (source: string) => {
  assert.equal(typeof source, "string", `the test source must be text, got ${typeof source}`);
  assert(source.length > 0, `the test source must not be empty, got ${source.length} characters`);
  const found = extractMessages(source);
  assert(Array.isArray(found), `extractMessages must return a list, got ${typeof found}`);
  return found.map(({ text }) => text);
};

test("reads the message of an assert, a push, a throw and an stderr write", () => {
  const source = [
    'assert(ok, "the file must exist, got nothing");',
    "errors.push(`${file} has no description`);",
    'throw new Error("the thing broke badly");',
    'process.stderr.write("usage: tool <file>\\n");',
  ].join("\n");
  assert.deepEqual(texts(source), ["the file must exist, got nothing", "${} has no description", "the thing broke badly", "usage: tool <file>"]);
});

test("collapses every interpolation, even a nested template, to one token", () => {
  assert.deepEqual(texts("errors.push(`${list.map((item) => `${item}!`).join(', ')} are bad values`);"), ["${} are bad values"]);
});

test("reports the one-based line of the call", () => {
  assert.deepEqual(extractMessages('const a = 1;\n\nassert(ok, "the second line holds this");'), [{ line: 3, text: "the second line holds this" }]);
});

test("skips an assert that has no message, a comment line and a message under twelve characters", () => {
  assert.deepEqual(texts("assert(ok);"), []);
  assert.deepEqual(texts('// assert(ok, "a commented assertion message");'), []);
  assert.deepEqual(texts('assert(ok, "too short");'), []);
});

test("joins the literals of a concatenated message and keeps commas inside calls out of the split", () => {
  assert.deepEqual(texts('assert(Boolean(a, b), "first half, " + "second half");'), ["first half, second half"]);
});

test("refuses source that is not text", () => {
  assert.throws(() => extractMessages(undefined as unknown as string), /the source must be text, got undefined/);
});

test("refuses source that holds a NUL byte", () => {
  assert.throws(() => extractMessages("assert(ok, \"a message\");\0"), /got a NUL byte \(.*\) at offset 24/);
  assertErrorIsActionable(() => extractMessages("\0"));
});

test("readLiteral reads to the closing quote and refuses a start that is no quote or a literal that never closes", () => {
  assert.deepEqual(readLiteral('"abc" rest', 0), ["abc", 5]);
  assert.throws(() => readLiteral("abc", 0), /a literal must start at a quote, got "a" at offset 0/);
  assert.throws(() => readLiteral('"abc', 0), /the literal opened at offset 0 never closes/);
  assertErrorIsActionable(() => readLiteral("abc", 0));
  assertErrorIsActionable(() => readLiteral('"abc', 0));
});

test("readInterpolation reads to the closing brace and refuses a start after no opener or an unclosed one", () => {
  assert.equal(readInterpolation("`${a}`", 3), 5);
  assert.equal(readInterpolation("`${{a: 1}.a}`", 3), 12);
  assert.throws(() => readInterpolation("`abc`", 3), /an interpolation must start after "\$\{"/);
  assert.throws(() => readInterpolation("`${a", 3), /never closes/);
  assertErrorIsActionable(() => readInterpolation("`abc`", 3));
  assertErrorIsActionable(() => readInterpolation("`${a", 3));
});

test("readArguments splits at top-level commas and refuses a start after no parenthesis or a call that never closes", () => {
  assert.deepEqual(readArguments('f("a", g(1, 2))', 2).map(({ pieces }) => pieces), [["a"], []]);
  assert.throws(() => readArguments("f(a", 0), /arguments must start after "\("/);
  assert.throws(() => readArguments("f(a, b", 2), /never closes/);
  assertErrorIsActionable(() => readArguments("f(a", 0));
  assertErrorIsActionable(() => readArguments("f(a, b", 2));
});
