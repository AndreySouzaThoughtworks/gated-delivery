import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as specLint from "../../plugin/skills/spec/scripts/spec-lint.mjs";
import { lintSpec } from "../../plugin/skills/spec/scripts/spec-lint.mjs";
import { assertActionable, assertEveryLineActionable, assertErrorMatchesActionable } from "../test-support/actionable.test.support.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = join(HERE, "..", "..", "plugin", "skills", "spec", "scripts", "spec-lint.mjs");
const VALID = readFileSync(join(HERE, "fixtures", "valid-spec.md"), "utf8");
const TEMPLATE = readFileSync(join(HERE, "..", "..", "plugin", "skills", "spec", "templates", "change.md"), "utf8");

const swap = (from: string, to: string) => (text: string) => {
  assert(text.includes(from), `the fixture must contain ${JSON.stringify(from)} so the mutation can apply, got ${text.length} characters without it`);
  assert(from !== to, `a mutation must change the text, got ${JSON.stringify(from)} replaced by itself`);
  return text.replace(from, to);
};

const REJECTED: [string, (text: string) => string, string][] = [
  ["a missing ticket key", swap("ticket: PROJ-123", "ticket: nope"), "frontmatter ticket"],
  ["a wrong type", swap("type: change", "type: bug"), "frontmatter type"],
  ["an unknown status", swap("status: Ready", "status: Done"), "frontmatter status"],
  ["an impossible date", swap("2026-01-15", "2026-13-45"), "frontmatter created"],
  ["a title that names another ticket", swap("# PROJ-123 —", "# PROJ-999 —"), "title heading must start with the ticket id PROJ-123"],
  ["a missing section", swap("## Edges", "## Extras"), 'section "## Edges" is missing'],
  ["an empty section", swap("- (none)\n\n## Done-when", "\n## Done-when"), 'section "## Edges" is empty'],
  ["sections out of template order", swap("## Security", "## Interface"), "template order"],
  ["a template placeholder literal", swap("N/A — internal change", "YYYY-MM-DD internal change"), 'placeholder text "YYYY-MM-DD"'],
  ["an angle-bracket placeholder", swap("Order submission rejects", "<what becomes true> rejects"), "template placeholder <what becomes true>"],
  ["an AC that is not given-when-then", swap("Given a valid line, when submitted, then it is accepted.", "Valid lines work."), "AC[4] must read"],
  ["a malformed AC bullet", swap("- [ ] **AC[4]", "- [ ] AC 4"), "checklist line is not an AC"],
  ["an unknown AC tag", swap("`in-repo / unit test`:** Given a valid", "`in-repo / smoke`:** Given a valid"), "AC[4] has tag"],
  ["a duplicate AC id", swap("**AC[4]", "**AC[1]"), "AC[1] is defined twice"],
  ["a mix of tagged and untagged ACs with a cross-repo AC", swap(" — `in-repo / unit test`:** Given a valid", ":** Given a valid"), "every AC needs a tag"],
  ["a stale AC reference", swap("AC[1] and AC[2] each", "AC[1] and AC[9] each"), "AC[9] is referenced but not defined"],
  ["an in-repo AC in two slices", swap("### Slice 3 — AC4", "### Slice 3 — AC4, AC1"), "in-repo AC[1] must be in exactly one Rollout slice"],
  ["an in-repo AC in no slice", swap("### Slice 3 — AC4", "### Slice 3 — AC2"), "in-repo AC[4] must be in exactly one Rollout slice"],
  ["a cross-repo AC inside a slice", swap("### Slice 3 — AC4", "### Slice 3 — AC4, AC3"), "cross-repo AC[3] must be in no Rollout slice"],
  ["a slice heading without exposure", swap("— AC2 — exposure: flagged", "— AC2"), "Rollout heading"],
  ["slices numbered out of order", swap("### Slice 3 — AC4", "### Slice 4 — AC4"), "must be numbered 1, 2, 3"],
  ["a missing lane field", swap("- Shared interface: none\n- Verify needs: isolated\n\n### Slice 2", "- Verify needs: isolated\n\n### Slice 2"), 'Slice 1 lacks "- Shared interface'],
  ["an unknown Verify needs value", swap("Verify needs: exclusive", "Verify needs: whenever"), "Verify needs must start with"],
  ["a flagged slice without a Flag line", swap("Flag: validate-on-load — default off — removed when 14 days at 100% show an EMPTY_LINE rate under 0.1%", "Behind a flag."), "flagged Slice 2 must carry"],
  ["a vague removal condition", swap("14 days at 100% show an EMPTY_LINE rate under 0.1%", "once stable"), "not checkable"],
  ["a dependency on a later slice", swap("- Depends on: Slice 1", "- Depends on: Slice 3"), "depends on Slice 3, which does not merge before it"],
  ["a slice missing from the wave table", swap("| 3 | S3 | depends on S2 |\n", ""), "Slice 3 must appear in exactly one wave-table row"],
  ["a slice in a later wave than its dependencies need", swap("| 2 | S2 |", "| 3 | S2 |"), "a slice joins the earliest wave"],
  ["a missing Done-when slice block", swap("### Slice 3\n\n- [ ] Every AC assigned to this slice is implemented and verified by at least one test\n\n", ""), "Done-when must hold one"],
  ["a missing Per ticket block", swap("### Per ticket", "### Afterwards"), "lacks the \"### Per ticket\" block"],
  ["a cross-repo AC without evidence and owner", swap("- [ ] AC3 — evidence: screenshot of the checkout error in the ticket — owner: checkout team", "- [ ] done"), "cross-repo AC[3] has no Done-when line"],
  ["a cross-repo AC that is unassigned", swap("owner: checkout team", "owner: Unassigned"), "owner \"Unassigned\" is not a person"],
  ["a Domain model with neither entities nor N/A", swap("N/A — no domain entities added, changed, or renamed, the order already carries lines.", "Orders matter."), "Domain model must classify"],
  ["Red flags without a Contradictions ledger", swap("### Contradictions", "### Notes"), 'lacks "### Contradictions"'],
  ["an empty Contradictions ledger", swap("No contradictions detected between the inspected surfaces.", "Looks fine."), "an empty ledger reads as skipped"],
  ["a Ready spec with an unresolved decision", swap("- Decision: reject at submit", "- **Options:** a or b\n- Decision: reject at submit"), "unresolved entry"],
  ["a Relevant files entry with no guard", swap(" — guarded by `test/orders/order.spec.ts`", ""), "names no guard"],
  ["a Security row with an empty disposition", swap("N/A — no new trust boundary or sensitive data; STRIDE walk found nothing material, the endpoint is unchanged.", "| STRIDE threat | Surface | Mitigation | Disposition |\n|---|---|---|---|\n| Spoofing | endpoint | token check |  |"), "has an empty Disposition"],
  ["a Security row with a missing disposition cell", swap("N/A — no new trust boundary or sensitive data; STRIDE walk found nothing material, the endpoint is unchanged.", "| STRIDE threat | Surface | Mitigation | Disposition |\n|---|---|---|---|\n| Spoofing | endpoint | token check |"), "has an empty Disposition"],
];

test("the valid fixture passes with no problems", () => {
  const problems = lintSpec(VALID);
  assert.deepEqual(problems, [], `a spec that follows the template must report nothing, got ${problems.join(" | ")}`);
  assert.equal(lintSpec(VALID.replace("status: Ready", "status: Draft")).length, 0, "a Draft spec with the same body is clean too");
});

for (const [name, mutate, expected] of REJECTED) {
  test(`rejects ${name}`, () => {
    const problems = lintSpec(mutate(VALID));
    assert(problems.some((p) => p.includes(expected)), `expected a problem containing ${JSON.stringify(expected)}, got ${JSON.stringify(problems)}`);
    assert(problems.length > 0, `a mutated spec (${name}) must not come back clean, got ${problems.length} problems`);
  });
}

const REWRITTEN = ["an angle-bracket placeholder", "a slice heading without exposure", "a slice in a later wave than its dependencies need", "a cross-repo AC that is unassigned", "an empty Contradictions ledger"];

test("the rewritten problems are actionable behind their file prefix", () => {
  const rewritten = REJECTED.filter(([name]) => REWRITTEN.includes(name));
  assert.equal(rewritten.length, REWRITTEN.length, `every rewritten case must exist in REJECTED, got ${rewritten.length} of ${REWRITTEN.length}`);
  for (const [, mutate, expected] of rewritten) assertActionable(`spec.md: ${lintSpec(mutate(VALID)).find((problem) => problem.includes(expected))}`);
});

test("the unfilled template is rejected", () => {
  const problems = lintSpec(TEMPLATE);
  assert(problems.some((p) => p.includes("PROJ-XXX")), `the template's placeholders must be flagged, got ${JSON.stringify(problems)}`);
  assert(problems.length >= 5, `an unfilled template breaks many rules, got ${problems.length}`);
});

test("the command line exits 1 on a bad spec and 0 on a good one", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-lint-"));
  const bad = join(dir, "bad.md");
  writeFileSync(bad, VALID.replace("type: change", "type: bug"));
  const failed = spawnSync("node", [LINT, bad], { encoding: "utf8" });
  assert(failed.status === 1 && failed.stdout.includes(`${bad}: frontmatter type`), `a bad spec must exit 1 naming the file, got ${failed.status} ${failed.stdout}`);
  const passed = spawnSync("node", [LINT, join(HERE, "fixtures", "valid-spec.md")], { encoding: "utf8" });
  assert(passed.status === 0 && passed.stdout === "", `a good spec must exit 0 silently, got ${passed.status} ${passed.stdout}`);
  const usage = spawnSync("node", [LINT], { encoding: "utf8" });
  assert.equal(usage.status, 1, `no file must exit 1, got ${usage.status}`);
  assertEveryLineActionable(usage.stderr);
});

const TOLERATED_FRONTMATTER = "ticket: PROJ-123\nlinks:\n  - one\n  - two\n# note\n# keyed: comment\n  : orphan value\ntype: change\n";

test("regression: frontmatter list items and comment lines parse without throwing", () => {
  const raw = VALID.replace("ticket: PROJ-123\ntype: change\n", TOLERATED_FRONTMATTER);
  assert(raw !== VALID, `the mutation must change the fixture, got ${raw.length} characters both before and after`);
  const spec = specLint.parseSpec(raw);
  assert.deepEqual(spec.frontmatter, { ticket: "PROJ-123", links: "", "# keyed": "comment", "": "orphan value", type: "change", status: "Ready", created: "2026-01-15" });
  assert.equal(spec.body, VALID.slice(VALID.indexOf("# PROJ-123")));
  assert.deepEqual(lintSpec(raw), []);
});

test("regression: text without a frontmatter block parses to an empty frontmatter and the whole text as body", () => {
  const spec = specLint.parseSpec("# no block\n");
  assert.deepEqual([spec.frontmatter, spec.body], [{}, "# no block\n"]);
});

test("splitFrontmatter rejects a block pattern that matches past the first character", () => {
  const unanchored = /---\n([\s\S]*?)\n---\n/;
  assertErrorMatchesActionable(() => specLint.splitFrontmatter("intro\n---\na: b\n---\nbody", unanchored), /block must start at the first character, got offset 6/);
  assert.deepEqual(specLint.splitFrontmatter("---\na: b\n---\nbody"), { frontmatter: { a: "b" }, body: "body" });
});

test("an AC range that expands past the limit is refused", () => {
  assertErrorMatchesActionable(() => lintSpec(swap("### Slice 1 — AC1 —", "### Slice 1 — AC1-5000 —")(VALID)), /an AC range must not expand to more than 1000 numbers/);
});

test("a heading with no title inside a section is refused", () => {
  assertErrorMatchesActionable(() => lintSpec(`${VALID}\n## \nmore text\n`), /a ## part must not contain another ## heading/);
});

test("splitFrontmatter and parseSpec reject non-text input", () => {
  assertErrorMatchesActionable(() => specLint.splitFrontmatter(42 as never), /the .raw. spec must be text, got number/);
  assertErrorMatchesActionable(() => specLint.parseSpec(undefined as never), /the .raw. spec must be text, got undefined/);
});

test("a Security table with every disposition filled passes", () => {
  const filled = swap("N/A — no new trust boundary or sensitive data; STRIDE walk found nothing material, the endpoint is unchanged.", "| STRIDE threat | Surface | Mitigation | Disposition |\n|---|---|---|---|\n| Spoofing | endpoint | token check | control exists |")(VALID);
  assert.deepEqual(lintSpec(filled), [], "a filled STRIDE table must report nothing");
});
