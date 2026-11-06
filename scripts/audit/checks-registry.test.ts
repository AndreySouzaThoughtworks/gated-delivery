import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, CHECK_FIELDS, checksRegistry, parseChecks, type Check } from "./checks-registry.ts";
import { GUARD_FILE, MAX_SENTENCE_WORDS, MAX_TITLE_WORDS, parityProblems, sectionsOf, sentenceProblems, type ParityInput } from "./checks-registry-parity.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDIT_WORKFLOW = ".github/workflows/audit.yml";
const DEVELOPMENT_DOC = "docs/development.md";
const MISTAKES_DOC = "docs/mistakes-to-rules.md";
const FIRST_STANDALONE_NUMBER = 36;
const FIVE_WORDS = "one two three four five";
const TWENTY_ONE_WORDS = `${Array.from({ length: MAX_SENTENCE_WORDS + 1 }, (_, index) => `w${index}`).join(" ")}.`;

const repoText = (path: string) => {
  assert(!path.startsWith("/"), `a repo path is relative to the root, got ${path}; drop the leading slash`);
  assert(path.length > 0, `a repo path must not be empty, got none; name a file`);
  return existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : null;
};

const realInput = (): ParityInput => {
  const input = {
    checks: CHECKS,
    guardSource: readFileSync(join(ROOT, GUARD_FILE), "utf8"),
    readSource: repoText,
    workflow: readFileSync(join(ROOT, AUDIT_WORKFLOW), "utf8"),
    developmentDoc: readFileSync(join(ROOT, DEVELOPMENT_DOC), "utf8"),
    mistakesDoc: readFileSync(join(ROOT, MISTAKES_DOC), "utf8"),
  };
  assert(input.checks.length > 0, `the real registry must hold rows, got ${input.checks.length}`);
  assert(input.guardSource.length > 0, `the guard source must not be empty, got ${input.guardSource.length} characters`);
  return input;
};

const withChecks = (checks: readonly Check[], overrides: Partial<ParityInput> = {}): ParityInput => {
  const input = { ...realInput(), checks, ...overrides };
  assert(Object.keys(input).length === Object.keys(realInput()).length, `a planted input must keep the same fields as the real one, got ${Object.keys(input)}`);
  assert(input.guardSource.length > 0, `a planted input needs a guard source, got ${input.guardSource.length} characters`);
  return input;
};
const rowOf = (number: number) => {
  const row = CHECKS.find((check) => check.number === number);
  assert(row !== undefined, `the real registry must hold check ${number}, got none; restore the row`);
  assert(row.number === number, `the row must carry number ${number}, got ${row.number}`);
  return row;
};
const withoutRow = (number: number) => {
  const rest = CHECKS.filter((check) => check.number !== number);
  assert(rest.length === CHECKS.length - 1, `exactly one row must go, got ${CHECKS.length - rest.length}; name a number the registry holds`);
  assert(rest.every((check) => check.number !== number), `no row may keep number ${number}`);
  return rest;
};
const editedRow = (number: number, edit: Partial<Check>) => {
  const edited = CHECKS.map((check) => (check.number === number ? { ...check, ...edit } : check));
  assert(edited.length === CHECKS.length, `an edit must keep every row, got ${edited.length} of ${CHECKS.length}`);
  assert(Object.keys(edit).length > 0, `an edit must change a field, got none; name one`);
  return edited;
};

const problemsOf = (input: ParityInput) => {
  const problems = parityProblems(input);
  assert(Array.isArray(problems), `the parity rules must return a list, got ${typeof problems}`);
  assert(problems.every((problem) => problem.includes("Hint:")), `every problem must end with a Hint, got ${problems.join("; ")}`);
  return problems.join("\n");
};

test("the real registry agrees with the guard, the workflow, the mistakes table and docs/development.md", () => {
  assert.deepEqual(parityProblems(realInput()), []);
});

test("the registry exports a typed list with exactly the agreed fields, and the accessor returns it", () => {
  assert.deepEqual(checksRegistry(), CHECKS);
  assert.throws(() => checksRegistry("registry.txt"), /the registry name must end in \.json, got registry\.txt/);
  assert.throws(() => checksRegistry("../checks-registry.json"), /must be a bare file name/);
  assert.throws(() => checksRegistry("absent.json"), /must exist, got none/);
  assert(CHECKS.length >= FIRST_STANDALONE_NUMBER, `the registry must hold every guard check, got ${CHECKS.length} rows`);
  for (const check of CHECKS) assert.deepEqual(Object.keys(check), CHECK_FIELDS, `check ${check.number} must keep the field names and their order`);
});

test("a guard section with no registry row is rejected, naming the number", () => {
  const problems = problemsOf(withChecks(withoutRow(22)));
  assert.match(problems, /consistency\.ts has check 22, but checks-registry\.json has no row for it/);
  assert.match(problems, /has no row 22 but numbers up to/);
});

test("a registry row whose guard section is gone is rejected, for an inline and a delegated check", () => {
  const guardSource = realInput().guardSource;
  const inline = problemsOf(withChecks(CHECKS, { guardSource: guardSource.replace("// --- 13. ", "// --- 13 ") }));
  assert.match(inline, /check 13 has no section 13 in scripts\/audit\/consistency\.ts/);
  const delegated = problemsOf(withChecks(CHECKS, { guardSource: guardSource.replace("// --- 33. ", "// --- 33 ") }));
  assert.match(delegated, /check 33 has no section 33 in scripts\/audit\/consistency\.ts/);
});

test("a row whose section never pushes a problem, or never calls its named function, is rejected", () => {
  const guardSource = realInput().guardSource;
  const silent = guardSource.replace(/(\/\/ --- 14\. [\s\S]*?)errors\.push/, "$1noop");
  assert.match(problemsOf(withChecks(CHECKS, { guardSource: silent })), /check 14 points at a section of scripts\/audit\/consistency\.ts that never pushes/);
  const uncalled = guardSource.replace("asdStyleProblems(styleDocuments(ROOT))", "[]");
  assert.match(problemsOf(withChecks(CHECKS, { guardSource: uncalled })), /check 33 names asdStyleProblems, but the section of scripts\/audit\/consistency\.ts never calls it/);
});

test("a row whose source file or exported name is missing is rejected", () => {
  assert.match(problemsOf(withChecks(editedRow(31, { source: "scripts/audit/gone.ts#nodeFloorProblems" }))), /check 31 names scripts\/audit\/gone\.ts, which does not exist/);
  assert.match(problemsOf(withChecks(editedRow(31, { source: "scripts/audit/node-floor.ts#renamedProblems" }))), /check 31 names renamedProblems, which scripts\/audit\/node-floor\.ts does not export/);
});

test("a standalone row that no workflow step runs is rejected", () => {
  const workflow = realInput().workflow.replace("scripts/audit/comments.ts", "scripts/audit/other.ts");
  assert.match(problemsOf(withChecks(CHECKS, { workflow })), /check 36 names scripts\/audit\/comments\.ts, which no step of the audit workflow runs/);
});

test("repeated and skipped numbers are rejected", () => {
  assert.match(problemsOf(withChecks([...CHECKS, { ...rowOf(1), id: "skill-files-again" }])), /repeats check number 1 in 2 rows/);
  assert.match(problemsOf(withChecks(withoutRow(20))), /has no row 20 but numbers up to/);
});

test("a row without a title, rule, fix or example is rejected, naming the field", () => {
  for (const field of ["title", "rule", "fix", "example"] as const) {
    assert.match(problemsOf(withChecks(editedRow(4, { [field]: "  " }))), new RegExp(`check 4 has no ${field}\\. Hint: write the ${field} text`), `a blank ${field} must be rejected`);
  }
  const { fix: _removed, ...withoutFix } = rowOf(4);
  assert.match(problemsOf(withChecks(CHECKS.map((check) => (check.number === 4 ? (withoutFix as Check) : check)))), /check 4 must have exactly the fields .* missing \[fix\]/);
});

test("an extra field, a bad id, a long title and long or multi-sentence text are rejected", () => {
  assert.match(problemsOf(withChecks(editedRow(4, { severity: "error" } as Partial<Check>))), /check 4 must have exactly the fields .* extra \[severity\]/);
  assert.match(problemsOf(withChecks(editedRow(4, { id: "Marketplace_Source" }))), /check 4 id "Marketplace_Source" is not kebab-case/);
  const longTitle = Array.from({ length: MAX_TITLE_WORDS + 1 }, () => "word").join(" ");
  assert.match(problemsOf(withChecks(editedRow(4, { title: longTitle }))), new RegExp(`check 4 title has more than ${MAX_TITLE_WORDS} words`));
  assert.match(problemsOf(withChecks(editedRow(4, { rule: TWENTY_ONE_WORDS }))), new RegExp(`check 4 rule has ${MAX_SENTENCE_WORDS + 1} words, over ${MAX_SENTENCE_WORDS}`));
  assert.match(problemsOf(withChecks(editedRow(4, { fix: `${FIVE_WORDS}. ${FIVE_WORDS}.` }))), /check 4 fix must be one sentence that ends with a period/);
  assert.match(problemsOf(withChecks(editedRow(4, { fix: FIVE_WORDS }))), /check 4 fix must be one sentence that ends with a period/);
});

test("a mistake that no row of the mistakes table names for that check is rejected, and null is accepted", () => {
  assert.match(problemsOf(withChecks(editedRow(5, { mistake: "No such category" }))), /check 5 cites the mistake "No such category"/);
  assert.match(problemsOf(withChecks(editedRow(5, { mistake: "A check that cannot fail" }))), /check 5 cites the mistake "A check that cannot fail"/);
  assert.deepEqual(parityProblems(withChecks(editedRow(5, { mistake: null }))), []);
});

test("docs/development.md holds no hand-written check list", () => {
  const document = realInput().developmentDoc;
  assert.match(problemsOf(withChecks(CHECKS, { developmentDoc: `${document}\n| Topic | Checks | What fails |\n|---|---|---|\n| Cost | 28 | A file over budget |\n` })), /holds a table with a Checks column/);
  assert.match(problemsOf(withChecks(CHECKS, { developmentDoc: `${document}\n- ${rowOf(24).title.toUpperCase()}\n` })), /repeats the check title "Repository carries a linked license"/);
});

test("the guard section parser refuses text with no numbered section and splits sections at the next header", () => {
  assert.throws(() => sectionsOf("const a = 1;\n"), /must hold numbered sections/);
  assert.throws(() => sectionsOf(7 as unknown as string), /the guard source must be text, got number/);
  const sections = sectionsOf("// --- 1. a\nerrors.push(1);\n// --- 2. b\nwarnings.push(2);\n// --- report ---\nconsole.log(3);\n");
  assert.deepEqual([...sections.keys()], [1, 2]);
  assert.doesNotMatch(sections.get(2) ?? "", /console\.log/);
});

test("the registry parser refuses text that is not a non-empty list", () => {
  assert.throws(() => parseChecks("{}"), /must hold a list of checks, got object/);
  assert.throws(() => parseChecks("[]"), /must hold at least one check, got an empty list/);
  assert.equal(parseChecks('[{"number":1}]').length, 1);
});

test("the parity rules refuse a registry that is not a list, a row with a bad number and a source with two symbols", () => {
  assert.throws(() => parityProblems(withChecks([7 as unknown as Check])), /every check number must be a whole number/);
  assert.throws(() => parityProblems(withChecks(editedRow(1, { number: 0 }))), /a check number must be positive, got 0/);
  assert.throws(() => parityProblems(withChecks(editedRow(1, { source: "" }))), /check 1 needs a source/);
  assert.throws(() => parityProblems(withChecks(editedRow(1, { source: "a.ts#b#c" }))), /check 1 must name one file and at most one symbol/);
  assert.throws(() => parityProblems(withChecks(7 as unknown as Check[])), /the registry must be a list of rows, got number/);
  assert.throws(() => parityProblems(withChecks([])), /checks-registry\.json must hold checks, got none/);
});

test("the parity rules refuse inputs that are not text or not a reader", () => {
  assert.throws(() => parityProblems(withChecks(CHECKS, { readSource: "x" as unknown as ParityInput["readSource"] })), /the source reader must be a function, got string/);
  assert.throws(() => parityProblems(withChecks(CHECKS, { workflow: 7 as unknown as string })), /the workflow must be text, got number/);
  assert.throws(() => parityProblems(withChecks(CHECKS, { mistakesDoc: 7 as unknown as string })), /the mistakes document must be text, got number/);
  assert.throws(() => parityProblems(withChecks(CHECKS, { developmentDoc: 7 as unknown as string })), /docs\/development\.md must be text, got number/);
  assert.throws(() => parityProblems(withChecks(CHECKS, { developmentDoc: "" })), /docs\/development\.md must not be empty/);
});

test("the mistake field refuses a value that is neither null nor a category", () => {
  assert.throws(() => parityProblems(withChecks(editedRow(1, { mistake: 7 as unknown as string }))), /the mistake of check 1 must be null or a category/);
});

test("a sentence check refuses non-text and an unnamed row, and reports each fault of a sentence", () => {
  assert.throws(() => sentenceProblems(7 as unknown as string, "row"), /row must be text, got number/);
  assert.throws(() => sentenceProblems("A sentence.", "  "), /a sentence needs a label/);
  assert.deepEqual(sentenceProblems("A short sentence.", "row"), []);
  assert.equal(sentenceProblems(`${TWENTY_ONE_WORDS.slice(0, -1)}`, "row").length, 2);
});
