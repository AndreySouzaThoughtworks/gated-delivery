import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARMS, scanText } from "../../plugin/skills/issue-writing/scripts/guardrail-scan.mjs";
import { assertEveryLineActionable, assertErrorIsActionable } from "../test-support/actionable.test.support.ts";

const SCAN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugin", "skills", "issue-writing", "scripts", "guardrail-scan.mjs");

const FLAGGED = [
  ["credential given a value", "the config has password: hunter2"],
  ["credential given a value", 'set API_KEY="abc123"'],
  ["bearer token", "send Bearer abcdefgh12345 in the header"],
  ["payment key", "use sk-test-abc123xyz"],
  ["AWS access key id", "key AKIAIOSFODNN7EXAMPLE leaked"],
  ["private key block", "-----BEGIN RSA PRIVATE KEY-----"],
  ["local user path", "see /Users/jane/project/file.ts"],
  ["connection string with user and password", "postgres://admin:s3cret@db.example.com/orders"],
  ["mongodb srv host", "mongodb+srv://cluster.example.net"],
  ["internal host", "calls billing.internal for totals"],
  ["IP address", "the host is 10.20.30.40 today"],
  ["email address", "ask jane.doe@example.com"],
  ["international phone number", "call +44 20 7946 0958"],
  ["national phone number", "call 020 79460958"],
  ["dashed phone number", "call 415-555-0132"],
];
const CLEAN = [
  "the word password in a sentence explaining a redaction",
  "Given an order line with quantity 0, when submitted, then it is rejected",
  "version 1.2.3 shipped",
  "see src/orders/order.ts",
  "tokenizer splits words",
];

test("every built-in arm flags its sample", () => {
  assert.deepEqual([...new Set(FLAGGED.map(([arm]) => arm))].sort(), ARMS.map(([name]) => name).sort(), "every arm needs a flagged sample");
  for (const [arm, sample] of FLAGGED) {
    const hits = scanText(sample);
    assert(hits.some((hit: { arm: string }) => hit.arm === arm), `${JSON.stringify(sample)} must hit the "${arm}" arm, got ${JSON.stringify(hits)}`);
  }
});

test("the command line explains every built-in arm as an actionable message", () => {
  const dir = mkdtempSync(join(tmpdir(), "guardrail-scan-arms-"));
  for (const [arm, sample] of FLAGGED) {
    const file = join(dir, "sample.md");
    writeFileSync(file, `${sample}\n`);
    const result = spawnSync("node", [SCAN, file], { encoding: "utf8" });
    assert(result.stdout.includes(`: ${arm} is banned`), `${JSON.stringify(sample)} must report the "${arm}" arm, got ${result.stdout}`);
    assertEveryLineActionable(result.stdout);
  }
});

test("clean prose raises no hit", () => {
  for (const sample of CLEAN) {
    const hits = scanText(sample);
    assert(hits.length === 0, `${JSON.stringify(sample)} must be clean, got ${JSON.stringify(hits)}`);
  }
});

test("hits carry the one-based line number and an extra term adds an arm", () => {
  const text = "fine\nfine\ncontact jane@example.com\nfine\nthe codename ORCHID";
  const hits = scanText(text, ["orchid"]);
  assert.deepEqual(hits, [{ line: 3, arm: "email address" }, { line: 5, arm: "extra guardrail term orchid" }], "the email is on line 3 and the term on line 5");
  assert.equal(scanText(text).length, 1, "without the term only the email hits");
});

test("text that is not a string is refused", () => {
  const scan = scanText as (text: unknown) => unknown;
  assert.throws(() => scan(Buffer.from("hello")), /the text to scan must be a string, got object/);
});

test("an extra term that is not a regex is refused", () => {
  assert.throws(() => scanText("hello", ["("]), /must be a valid regex/);
  assert.throws(() => scanText("hello", [""]), /non-empty regex/);
  assert.throws(() => scanText("hello", [".*"]), /must not match an empty line/);
  for (const term of ["(", "", ".*"]) assertErrorIsActionable(() => scanText("hello", [term]));
  assert.equal(scanText("orchid", ["orchid"]).length, 1, "a term that needs text still matches it");
  const scan = scanText as (text: string, extraTerms: unknown) => unknown;
  assert.throws(() => scan("hello", "orchid"), /extra terms must be a list/);
});

test("the command line exits 1 with file:line and never prints the match, 0 when clean, 2 on bad usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "guardrail-scan-"));
  const dirty = join(dir, "dirty.md");
  const clean = join(dir, "clean.md");
  writeFileSync(dirty, "ok\npassword: hunter2\n");
  writeFileSync(clean, "nothing sensitive here\n");
  const hit = spawnSync("node", [SCAN, dirty], { encoding: "utf8" });
  assert.deepEqual([hit.status, hit.stdout], [1, `${dirty}:2: credential given a value is banned in tickets; redact it.\n`], "a hit prints file, line, arm and fix only");
  assertEveryLineActionable(hit.stdout);
  const none = spawnSync("node", [SCAN, clean], { encoding: "utf8" });
  assert.deepEqual([none.status, none.stdout], [0, ""], "a clean file exits 0 silently");
  const termHit = spawnSync("node", [SCAN, clean, "--term", "sensitive"], { encoding: "utf8" });
  assert.equal(termHit.status, 1, `an extra term must hit, got ${termHit.status} ${termHit.stdout}`);
  assertEveryLineActionable(termHit.stdout);
  const usage = spawnSync("node", [SCAN], { encoding: "utf8", input: "password: hunter2\n" });
  assert.equal(usage.status, 2, `no file must be a usage error and never read stdin, got ${usage.status}`);
});
