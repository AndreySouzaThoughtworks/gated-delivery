import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROSE_SCAN_SCRIPT, phraseSource, textFilesUnder, ticDriftProblems } from "./prose-tic-drift.ts";
import { runGuard, validRepo, write } from "../test-support/consistency-fixtures.test.support.ts";

const SKILL_HEADER = "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\n";
const TIC_LIST = 'export const TICS = [{ phrases: ["worth noting", "honestly", "doesn\'t touch", "not just", "rather than", "instead of"] }];\nexport const ORDINARY_PHRASES = ["rather than", "instead of"];\n';
const COPIES: [string, string, string][] = [
  ["a grep alternation", "plugin/skills/alpha/SKILL.md", "grep -nEi 'worth noting|honestly' <path>\n"],
  ["a spaced alternation", "plugin/skills/alpha/SKILL.md", "pattern: honestly | not just\n"],
  ["an escaped alternation", "plugin/skills/alpha/SKILL.md", "grep 'worth noting\\|honestly' file\n"],
  ["an alternation with wildcard dots", "plugin/skills/alpha/notes.md", 'grep -ciE "worth.noting|doesn.t touch" output.md\n'],
  ["a list of -e options", "plugin/skills/alpha/notes.md", 'grep -ciE -e "worth noting" -e "not just" output.md\n'],
  ["an ordinary phrase beside a distinctive one", "plugin/skills/alpha/SKILL.md", "grep -E 'instead of|honestly' file\n"],
  ["a copy under evals", "evals/rules/x.json", '{ "regex": "NOT JUST|Honestly" }\n'],
];

const repoWithList = () => {
  const dir = validRepo();
  write(dir, "plugin/skills/prose-writing/SKILL.md", SKILL_HEADER.replace("alpha", "prose-writing"));
  write(dir, "plugin/skills/prose-writing/evals.md", readFileSync(join(dir, "plugin/skills/alpha/evals.md"), "utf8"));
  write(dir, "README.md", "The plugin — 2 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n");
  write(dir, "plugin/README.md", "| `/alpha` | a skill |\n| `/prose-writing` | a skill |\n| `bot` | an agent |\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `/prose-writing` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n");
  write(dir, PROSE_SCAN_SCRIPT, TIC_LIST);
  assert(readFileSync(join(dir, PROSE_SCAN_SCRIPT), "utf8") === TIC_LIST, `the fixture must hold the tic list at ${PROSE_SCAN_SCRIPT}`);
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  return dir;
};

test("a tic list copied as a regex alternation anywhere under plugin or evals is reported", () => {
  for (const [name, file, body] of COPIES) {
    const dir = repoWithList();
    write(dir, file, file.endsWith("SKILL.md") ? SKILL_HEADER + body : body);
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, `${name} in ${file} must fail the guard, got ${code}: ${out}`);
    assert.match(out, new RegExp(`${file.replace(/\./g, "\\.")}:\\d+ lists the tic phrases .* as a regex alternation, but the tic list must live only in ${PROSE_SCAN_SCRIPT.replace(/\./g, "\\.")}\\. Hint:`), `${name} must name its file and line, got ${out}`);
  }
});

test("single phrases, plain lists, repeats of one phrase, two ordinary phrases and the script itself pass", () => {
  const clean: [string, string][] = [
    ["plugin/skills/alpha/SKILL.md", "The scan flags worth noting and honestly in prose.\n"],
    ["plugin/skills/alpha/SKILL.md", "grep -c 'worth noting|a phrase of its own' file\n"],
    ["plugin/skills/alpha/SKILL.md", "| Construction | worth noting | delete it |\n"],
    ["plugin/skills/alpha/SKILL.md", "grep 'honestly|honestly' file\n"],
    ["plugin/skills/alpha/SKILL.md", "grep -E 'rather than|instead of' file\n"],
  ];
  const dir = repoWithList();
  for (const [file, body] of clean) write(dir, file, file.endsWith("SKILL.md") ? SKILL_HEADER + body : body);
  write(dir, PROSE_SCAN_SCRIPT, `${TIC_LIST}// worth noting|honestly\n`);
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, `lines that only mention tics must pass, got ${code}: ${out}`);
  assert.doesNotMatch(out, /as a regex alternation/);
});

test("a repository without the script skips the check", () => {
  const dir = validRepo();
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n\ngrep 'worth noting|honestly' file\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 0, `no script means no list to drift from, got ${code}: ${out}`);
});

test("the drift check refuses a blank phrase, an unscanned folder, a missing root and a one-phrase list", async () => {
  assert.throws(() => phraseSource("  "), /a tic phrase must be non-blank text, got "  "/);
  assert.throws(() => phraseSource(7 as unknown as string), /a tic phrase must be non-blank text, got 7/);
  assert.throws(() => textFilesUnder(tmpdir(), "docs"), /the folder must be one of plugin, evals, got "docs"/);
  await assert.rejects(ticDriftProblems(join(tmpdir(), "absent-root-for-tic-drift")), /must exist to check the tic list/);
  const dir = validRepo();
  write(dir, PROSE_SCAN_SCRIPT, 'export const TICS = [{ phrases: ["honestly"] }];\nexport const ORDINARY_PHRASES = [];\n');
  await assert.rejects(ticDriftProblems(dir), /must list at least two tic phrases, got 1/);
  assert.throws(() => phraseSource("two\nlines"), /a tic phrase must sit on one line/);
  assert.throws(() => textFilesUnder(join(tmpdir(), "absent-root-for-tic-drift"), "plugin"), /must exist to list its plugin files/);
  await assert.rejects(ticDriftProblems(""), /the repository root must be a non-empty path/);
  const withoutOrdinary = validRepo();
  write(withoutOrdinary, PROSE_SCAN_SCRIPT, 'export const TICS = [{ phrases: ["honestly", "not just"] }];\n');
  await assert.rejects(ticDriftProblems(withoutOrdinary), /must export .ORDINARY_PHRASES. as a list, got undefined/);
});

test("a phrase becomes a pattern that accepts a wildcard dot or an apostrophe", () => {
  const pattern = new RegExp(`^${phraseSource("doesn't touch")}$`, "i");
  for (const spelling of ["doesn't touch", "doesn’t touch", "doesn.t touch", "doesn't.touch"]) assert(pattern.test(spelling), `${spelling} must match the phrase pattern ${pattern}`);
  assert(!pattern.test("does touch"), "a different phrase must not match the pattern");
});
