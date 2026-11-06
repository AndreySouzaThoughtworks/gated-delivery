import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORY_RULES, commentsIn, formatOffence, historyOffences, regexMayStartAt, runsOfComments, scannedFiles, stepCode, stepTemplate } from "./comments.ts";
import { gitRepo } from "../test-support/git-fixture.test.support.ts";

const FIXTURE_PREFIX = "comments-check-test-";
const CHECK = join(dirname(fileURLToPath(import.meta.url)), "comments.ts");
const SOURCE_FILE = "plugin/hooks/h.mjs";
const HISTORY_SAMPLES: Record<string, string[]> = {
  "temporal-contrast": [
    "Until now nothing ran those fences.",
    "The tables used to be duplicated across three docs.",
    "Absent is a silent no-op, same as before.",
    "The hook no longer reads the lockfile.",
    "Previously this walked every directory.",
    "It formerly shelled out to pnpm.",
    "Prettier originally ran through a package manager.",
    "Neither form was matched at first.",
    "The flag is not needed anymore.",
  ],
  "change-narration": [
    "The helper was moved into guard-core.",
    "The check has been renamed twice.",
    "We replaced the loop with a table.",
    "The old behaviour skipped hidden files.",
    "The other docs now link here.",
    "A newly added guard covers the case.",
  ],
  "bug-history": ["Regression: the scan swallowed the next line.", "This fixes a bug in the quote scan.", "The defect survived three review rounds."],
  "tracker-reference": ["See PR 81 for the reason.", "Closes #123.", "Added in commit 5225d9d.", "Introduced by fade166."],
  "dated-note": ["Added on 2026-11-06.", "Needed since 0.10 only.", "Fixed last sprint.", "Seen recently in CI."],
};
const REAL_CONSTRAINT_COMMENTS = [
  "Prettier is spawned as a plain .cjs file under this same Node, never through a package manager.",
  "`shell: true` would hand the file path back to a shell, where a file named `$(id -u)/a.ts` would run as a command.",
  "A slash preceded by a word character, dot or slash is a path or an \"and/or\", not a skill.",
  "Each helper is used to build one table row.",
  "--- 19. A shipped change is followed by a version bump ---",
];

const offencesOf = (comment: string) => {
  assert(comment.trim() !== "", "a sample comment needs text, got an empty one");
  assert(!comment.includes("\n"), `a sample comment is one line, got ${JSON.stringify(comment)}`);
  return historyOffences(SOURCE_FILE, `// ${comment}\nexport const answer = 1;\n`);
};

const runCheck = (args: string[]) => {
  assert(args.every((arg) => typeof arg === "string"), `every argument must be text, got ${JSON.stringify(args)}`);
  const result = spawnSync("node", [CHECK, ...args], { encoding: "utf8" });
  assert(result.status !== null, `the check must exit on its own, got signal ${result.signal}`);
  return { code: result.status, out: result.stdout + result.stderr };
};

for (const [rule, samples] of Object.entries(HISTORY_SAMPLES)) {
  test(`rejects every ${rule} sample and names the file, the line, the rule and a hint`, () => {
    assert(samples.length > 0, `rule ${rule} needs samples`);
    for (const sample of samples) {
      const offences = offencesOf(sample);
      assert(offences.some((offence) => offence.rule === rule), `expected ${rule} for "${sample}", got ${JSON.stringify(offences)}`);
      const message = formatOffence(offences.find((offence) => offence.rule === rule) as (typeof offences)[number]);
      assert(message.startsWith(`${SOURCE_FILE}:1: rule ${rule}: "`), `expected file, line and rule first in: ${message}`);
      assert(message.includes(". Hint: "), `expected a Hint in: ${message}`);
    }
  });
}

test("every rule in the table has samples and a hint", () => {
  assert.deepStrictEqual(Object.keys(HISTORY_SAMPLES), HISTORY_RULES.map((rule) => rule.name));
  const withoutHint = HISTORY_RULES.find((rule) => rule.hint.length === 0);
  assert(withoutHint === undefined, `every rule needs a hint, got none for ${withoutHint?.name}`);
});

test("accepts a comment that states a constraint, and a section header", () => {
  for (const comment of REAL_CONSTRAINT_COMMENTS) assert.deepStrictEqual(offencesOf(comment), [], `expected no offence for "${comment}"`);
});

test("reads history across the lines of one comment and reports the line it starts on", () => {
  const source = "export const a = 1;\n// The scan is the same as\n// before for hidden files.\n";
  const offences = historyOffences(SOURCE_FILE, source);
  assert.deepStrictEqual(offences.map((offence) => `${offence.where} ${offence.rule}`), [`${SOURCE_FILE}:2 temporal-contrast`]);
  assert.deepStrictEqual(historyOffences(SOURCE_FILE, "// no longer\n\n// reads\n").map((offence) => offence.where), [`${SOURCE_FILE}:1`]);
});

test("finds a trailing comment and a block comment, and skips a JSDoc block", () => {
  const source = ["export const a = 1; // used to be 2", "export const x = 0;", "/* previously a table", "   of rows */", "/** previously typed */", "export const b = 1;", ""].join("\n");
  assert.deepStrictEqual(historyOffences(SOURCE_FILE, source).map((offence) => offence.where), [`${SOURCE_FILE}:1`, `${SOURCE_FILE}:3`]);
});

test("ignores history words inside strings, regex literals and templates, even with comment marks", () => {
  const source = [
    'const url = "https://example.test/used to";',
    "const quote = 'it\\'s // no longer';",
    "const pattern = /\\/\\/ previously/;",
    "const klass = /[/] formerly/;",
    "const text = `until now // ${items.map((item) => `${item} used to`).join(\", \")} // originally`;",
    "const ratio = total / 2 / 4; // fine",
    "",
  ].join("\n");
  assert.deepStrictEqual(historyOffences(SOURCE_FILE, source), []);
});

test("finds a comment that follows a template with a nested template, at the right line", () => {
  const source = "const a = `x ${y ? `z` : \"w\"}\n`;\n// previously here\n";
  assert.deepStrictEqual(commentsIn(source).map((comment) => `${comment.line} ${comment.text}`), ["3 previously here"]);
});

test("a division is not a regex, and a regex after a keyword is", () => {
  assert.deepStrictEqual(commentsIn("const a = b / c; // one\nconst d = e / f; // two\n").map((comment) => comment.text), ["one", "two"]);
  assert.deepStrictEqual(commentsIn("const a = () => { return /[/]/.test(x); }; // three\n").map((comment) => comment.text), ["three"]);
  assert.strictEqual(regexMayStartAt("a / b", 2), false);
  assert.strictEqual(regexMayStartAt("x = /b/", 4), true);
  assert.strictEqual(regexMayStartAt("return /b/", 7), true);
  assert.strictEqual(regexMayStartAt("/b/", 0), true);
});

test("runs join comments on adjacent lines only", () => {
  const runs = runsOfComments([
    { line: 1, text: "a", index: 0 },
    { line: 2, text: "b", index: 3 },
    { line: 4, text: "c", index: 9 },
  ]);
  assert.deepStrictEqual(runs.map((run) => run.map((comment) => comment.text)), [["a", "b"], ["c"]]);
});

test("a source that is not text, or holds a NUL byte, stops the scan and says why", () => {
  assert.throws(() => commentsIn(1 as unknown as string), /the source must be text, got number/);
  assert.throws(() => commentsIn("// a\0b"), /got a NUL byte at index 4/);
});

test("the scanner entry points reject a start that is not inside the source", () => {
  const state = () => {
    const fresh = { contexts: [{ template: false, depth: 0 }], comments: [] };
    assert(fresh.contexts.length === 1, `a scan starts in one code context, got ${fresh.contexts.length}`);
    assert(fresh.comments.length === 0, `a scan starts with no comment, got ${fresh.comments.length}`);
    return fresh;
  };
  for (const step of [stepCode, stepTemplate]) {
    assert.throws(() => step("abc", -1, state()), /whole index from 0, got -1/);
    assert.throws(() => step("abc", 1.5, state()), /whole index from 0, got 1.5/);
    assert.throws(() => step("abc", 3, state()), /inside the 3 of the source, got index 3/);
  }
  assert.strictEqual(stepCode("let a", 0, state()), 5);
  assert.strictEqual(stepTemplate("abc`", 0, state()), 3);
  assert.strictEqual(stepTemplate("\\", 0, state()), 1);
  assert.throws(() => regexMayStartAt("a / b", -1), /whole number from 0, got -1/);
  assert.throws(() => regexMayStartAt("a / b", 0), /a regex literal starts at a slash, got "a" at index 0/);
});

test("the run and offence helpers reject input that would give a wrong report", () => {
  assert.throws(() => runsOfComments("no" as unknown as []), /the comments must be a list, got string/);
  assert.throws(
    () =>
      runsOfComments([
        { line: 5, text: "a", index: 0 },
        { line: 2, text: "b", index: 1 },
      ]),
    /must arrive in line order, got lines 5, 2/,
  );
  assert.throws(() => historyOffences("", "// a\n"), /an offence names its file, got ""/);
  assert.throws(() => historyOffences("a\nb.ts", "// a\n"), /a file name must fit one report line, got "a\\nb.ts"/);
  assert.throws(() => formatOffence({ where: "no line", rule: "dated-note", snippet: "s", hint: "h" }), /reads <file>:<line>, got "no line"/);
  assert.throws(() => formatOffence({ where: "a.ts:1", rule: "made-up", snippet: "s", hint: "h" }), /names one of temporal-contrast.*got "made-up"/);
});

test("lists tracked source files under the scanned folders and skips fixtures and other types", () => {
  const dir = gitRepo(
    {
      "plugin/hooks/a.mjs": "export const a = 1;\n",
      "scripts/b.ts": "export const b = 1;\n",
      "tests/c.js": "export const c = 1;\n",
      "scripts/fixtures/d.ts": "// used to\n",
      "scripts/notes.md": "used to\n",
      "docs/e.ts": "// used to\n",
    },
    FIXTURE_PREFIX,
  );
  assert.deepStrictEqual(scannedFiles(dir).sort(), ["plugin/hooks/a.mjs", "scripts/b.ts", "tests/c.js"]);
  assert.throws(() => scannedFiles(join(tmpdir(), "comments-check-test-no-such-directory")), /must exist, got none; pass --repo/);
  assert.throws(() => scannedFiles(mkdtempSync(join(tmpdir(), "comments-check-test-no-git-"))), /has no \.git; pass --repo <root of a git checkout>/);
});

test("the check exits 1 on a history comment and prints file, line, rule and hint", () => {
  const dir = gitRepo({ [SOURCE_FILE]: "export const a = 1;\n// Until now this read the lockfile.\n" }, FIXTURE_PREFIX);
  const { code, out } = runCheck(["--repo", dir]);
  assert.strictEqual(code, 1, out);
  assert(out.includes(`${SOURCE_FILE}:2: rule temporal-contrast: "Until now this read the lockfile."`), `expected the offence line, got: ${out}`);
  assert(out.includes("Hint: delete the before-and-after contrast"), `expected the hint, got: ${out}`);
});

test("the check exits 0 on a clean tree and counts the files it read", () => {
  const dir = gitRepo({ [SOURCE_FILE]: "// Prettier never runs through a shell.\nexport const a = 1;\n" }, FIXTURE_PREFIX);
  const { code, out } = runCheck(["--repo", dir]);
  assert.strictEqual(code, 0, out);
  assert(out.includes("OK: no history comments in 1 source files"), `expected the count, got: ${out}`);
});

test("the check stops on a stray argument and on a repo with no source file", () => {
  const stray = runCheck(["plugin"]);
  assert.notStrictEqual(stray.code, 0, stray.out);
  assert(stray.out.includes('takes no positional argument, got ["plugin"]'), `expected the argument named, got: ${stray.out}`);
  const empty = runCheck(["--repo", gitRepo({ "README.md": "used to\n" }, FIXTURE_PREFIX)]);
  assert.notStrictEqual(empty.code, 0, empty.out);
  assert(empty.out.includes("tracks no source file under plugin/, scripts/, tests/"), `expected the empty repo named, got: ${empty.out}`);
});
