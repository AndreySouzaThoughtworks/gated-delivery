import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTimestamp, laterResume, mergeCarryForward, mergeSections, placeResume, renderSections, resumeHeading, splitSections } from "./handoff.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "handoff.mjs");
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_UNMERGEABLE = 3;
const SKILL_TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const TITLE = "# Handoff — PROJ-1";
const EARLY = "2026-01-01T09:00Z";
const LATE = "2026-01-01T10:30Z";

const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "handoff-test-")));
  assert(existsSync(dir), `${dir} must exist`);
  assert(readdirSync(dir).length === 0, `${dir} must start empty`);
  return dir;
};
const write = (dir, name, text) => {
  assert(typeof text === "string", `the text must be a string, got ${typeof text}`);
  writeFileSync(join(dir, name), text);
  assert(existsSync(join(dir, name)), `${name} must exist in ${dir}`);
  return join(dir, name);
};
const read = (path) => {
  assert(existsSync(path), `${path} must exist`);
  assert(path.startsWith(tmpdir()) || path.startsWith(realpathSync(tmpdir())), `${path} must be a scratch file`);
  return readFileSync(path, "utf8");
};

const resumeBlock = (actor, updated, next = "ship it", slice = "") => {
  assert(SKILL_TIMESTAMP_SHAPE.test(updated) || updated === "yesterday", `updated must be a timestamp, got ${updated}`);
  assert(actor !== "", `the actor must be named, got ${JSON.stringify(actor)}`);
  return `## Resume — ${actor}${slice}\n\n- Updated: ${updated}\n- Slice: s1\n- Branch: feat/PROJ-1-a\n- Base: origin/main at abc1234\n- PR: not opened\n- Last verified: abc1234 npm test\n- Next: ${next}`;
};
const entry = (title, evidence = "PR 7") => {
  assert(title !== "", `the entry needs a title, got ${JSON.stringify(title)}`);
  assert(evidence !== "", `the entry needs evidence, got ${JSON.stringify(evidence)}`);
  return `### ${title}\n\n**Status:** OPEN\n**Evidence:** ${evidence}\n**Impact:** later reader re-derives it\n**Next:** raise a ticket`;
};
const handoff = (sections) => {
  assert(Array.isArray(sections), `sections must be a list, got ${typeof sections}`);
  assert(sections.every((section) => section.startsWith("##")), "every section needs a heading");
  return `${TITLE}\n\n${sections.join("\n\n")}\n`;
};
const carry = (entries) => {
  assert(Array.isArray(entries), `entries must be a list, got ${typeof entries}`);
  assert(entries.every((item) => item.startsWith("###")), "every entry needs a heading");
  return `## Carry forward\n\n${entries.join("\n\n")}`;
};

const cli = (args) => {
  assert(Array.isArray(args), `arguments must be a list, got ${typeof args}`);
  const result = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
  assert(result.status !== null, `the script must exit on its own, got ${result.signal}`);
  return result;
};
const merged = (ours, theirs) => {
  assert(typeof ours === "string", `ours must be text, got ${typeof ours}`);
  assert(typeof theirs === "string", `theirs must be text, got ${typeof theirs}`);
  const dir = scratch();
  const out = join(dir, "out.md");
  const result = cli(["merge", "--ours", write(dir, "ours.md", ours), "--theirs", write(dir, "theirs.md", theirs), "--out", out]);
  return { result, out, text: existsSync(out) ? read(out) : null };
};
const resumeArgs = (file, extra = []) => {
  assert(typeof file === "string", `the file must be a path, got ${typeof file}`);
  assert(Array.isArray(extra), `extra must be a list, got ${typeof extra}`);
  return ["write-resume", "--file", file, "--actor", "claude-a", "--rollout-slice", "s2 of 3", "--branch", "feat/PROJ-1-b", "--base-ref", "origin/main", "--base-sha", "def5678", "--last-verified", "def5678 npm test", "--next", "open the PR", ...extra];
};

test("formatTimestamp renders the shape date -u +%Y-%m-%dT%H:%MZ prints", () => {
  assert.equal(formatTimestamp(new Date(Date.UTC(2026, 10, 5, 4, 7, 59))), "2026-11-05T04:07Z");
});

test("formatTimestamp rejects a non-date and an invalid date", () => {
  assert.throws(() => formatTimestamp("2026-01-01"), /must be a Date/);
  assert.throws(() => formatTimestamp(new Date(Number.NaN)), /valid date/);
});

test("splitSections and renderSections round-trip a document and respect code fences", () => {
  const text = `${TITLE}\n\n## One\n\nbody\n\n\`\`\`\n## not a heading\n\`\`\`\n\n## Two\n\ntail`;
  const sections = splitSections(text, "## ");
  assert.deepEqual(sections.parts.map((part) => part.heading), ["## One", "## Two"]);
  assert.equal(sections.head, TITLE);
  assert.equal(renderSections(sections), text);
});

test("splitSections and renderSections reject bad input", () => {
  assert.throws(() => splitSections(42, "## "), /must be a string/);
  assert.throws(() => splitSections("x", "# "), /heading prefix/);
  assert.throws(() => renderSections({ head: 1, parts: [] }), /head must be a string/);
  assert.throws(() => renderSections({ head: "", parts: [{ heading: "plain", body: "" }] }), /markdown heading/);
});

test("resumeHeading names the actor and the slice and rejects malformed ones", () => {
  assert.equal(resumeHeading("claude-a", undefined), "## Resume — claude-a");
  assert.equal(resumeHeading("claude-a", "2"), "## Resume — claude-a — s2");
  assert.throws(() => resumeHeading("  ", undefined), /one non-empty line/);
  assert.throws(() => resumeHeading("a\nb", undefined), /one non-empty line/);
  assert.throws(() => resumeHeading("claude-a", "two"), /slice must be a number/);
});

test("placeResume rejects a non-Resume heading and a non-list", () => {
  assert.throws(() => placeResume([], { heading: "## Outcome", body: "" }), /not a Resume heading/);
  assert.throws(() => placeResume("x", { heading: "## Resume — a", body: "" }), /must be a list/);
});

test("mergeSections rejects non-text inputs", () => {
  assert.throws(() => mergeSections(1, ""), /ours must be a string/);
  assert.throws(() => mergeSections("", 1), /theirs must be a string/);
});

test("write-resume writes the block the SKILL.md template shows with a UTC timestamp from the clock", () => {
  const dir = scratch();
  const file = join(dir, "handoff.md");
  const before = formatTimestamp(new Date());
  const result = cli(resumeArgs(file));
  const after = formatTimestamp(new Date());
  assert.equal(result.status, EXIT_OK, result.stderr);
  const [block] = read(file).match(/^## Resume — claude-a\n\n[\s\S]*$/);
  const [updatedLine] = block.match(/^- Updated: .*$/m);
  const stamp = updatedLine.replace("- Updated: ", "");
  assert.match(stamp, SKILL_TIMESTAMP_SHAPE);
  assert.ok(stamp >= before && stamp <= after, `${stamp} must lie within ${before}..${after}`);
  assert.equal(block, `## Resume — claude-a\n\n- Updated: ${stamp}\n- Slice: s2 of 3\n- Branch: feat/PROJ-1-b\n- Base: origin/main at def5678\n- PR: not opened\n- Last verified: def5678 npm test\n- Next: open the PR\n`);
});

test("write-resume puts a slice suffix in the heading and records the PR", () => {
  const file = join(scratch(), "handoff.md");
  const result = cli(resumeArgs(file, ["--slice", "2", "--pr", "https://example.test/pr/7"]));
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(read(file), /^## Resume — claude-a — s2\n\n- Updated: .*\n- Slice: s2 of 3\n[\s\S]*\n- PR: https:\/\/example\.test\/pr\/7\n/);
});

test("write-resume replaces its own block, keeps another actor's, and leaves Carry forward last", () => {
  const dir = scratch();
  const file = write(dir, "handoff.md", handoff([resumeBlock("claude-a", EARLY, "old step"), resumeBlock("claude-b", EARLY, "b step"), carry([entry("dead end")])]));
  assert.equal(cli(resumeArgs(file)).status, EXIT_OK);
  const sections = splitSections(read(file), "## ");
  assert.deepEqual(sections.parts.map((part) => part.heading), ["## Resume — claude-a", "## Resume — claude-b", "## Carry forward"]);
  assert.match(sections.parts[0].body, /- Next: open the PR/);
  assert.doesNotMatch(read(file), /old step/);
  assert.match(sections.parts[1].body, /- Updated: 2026-01-01T09:00Z[\s\S]*- Next: b step/);
  assert.match(sections.parts[2].body, /### dead end/);
});

test("write-resume adds a new actor's block before Carry forward when no Resume block exists", () => {
  const file = write(scratch(), "handoff.md", handoff([carry([entry("dead end")])]));
  assert.equal(cli(resumeArgs(file)).status, EXIT_OK);
  assert.deepEqual(splitSections(read(file), "## ").parts.map((part) => part.heading), ["## Resume — claude-a", "## Carry forward"]);
});

test("write-resume rejects a missing field, a multi-line value and a non-numeric slice", () => {
  const file = join(scratch(), "handoff.md");
  const missing = cli(resumeArgs(file).filter((arg, index, all) => arg !== "--next" && all[index - 1] !== "--next"));
  assert.equal(missing.status, EXIT_USAGE);
  assert.match(missing.stderr, /--next is required/);
  const multiline = cli(resumeArgs(file, ["--pr", "a\nb"]));
  assert.equal(multiline.status, EXIT_USAGE);
  assert.match(multiline.stderr, /--pr must be one line/);
  assert.equal(cli(resumeArgs(file, ["--slice", "two"])).status, EXIT_USAGE);
  assert.equal(existsSync(file), false);
});

test("an unknown subcommand and an unknown option are usage errors", () => {
  assert.equal(cli(["archive"]).status, EXIT_USAGE);
  assert.equal(cli(["merge", "--theirs", "x", "--wat", "y"]).status, EXIT_USAGE);
});

test("merge keeps both actors' Resume blocks whole", () => {
  const { result, text } = merged(handoff([resumeBlock("claude-a", EARLY, "a step")]), handoff([resumeBlock("claude-b", LATE, "b step")]));
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(text, handoff([resumeBlock("claude-a", EARLY, "a step"), resumeBlock("claude-b", LATE, "b step")]));
});

test("merge resolves one actor's own block for one slice to the later Updated, from either side", () => {
  const older = handoff([resumeBlock("claude-a", EARLY, "stale", " — s1"), resumeBlock("claude-b", EARLY, "b step", " — s1")]);
  const newer = handoff([resumeBlock("claude-a", LATE, "fresh", " — s1")]);
  for (const [ours, theirs] of [[older, newer], [newer, older]]) {
    const { result, text } = merged(ours, theirs);
    assert.equal(result.status, EXIT_OK, result.stderr);
    assert.match(text, /- Next: fresh/);
    assert.doesNotMatch(text, /stale/);
    assert.match(text, /## Resume — claude-b — s1/);
  }
});

test("merge treats the same actor's different slices as two blocks", () => {
  const { result, text } = merged(handoff([resumeBlock("claude-a", EARLY, "one", " — s1")]), handoff([resumeBlock("claude-a", EARLY, "two", " — s2")]));
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(text, /## Resume — claude-a — s1[\s\S]*## Resume — claude-a — s2/);
});

test("merge keeps two Carry forward entries as two, even under one title", () => {
  const { result, text } = merged(handoff([carry([entry("flaky", "PR 1")])]), handoff([carry([entry("flaky", "PR 2"), entry("other")])]));
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(splitSections(splitSections(text, "## ").parts[0].body, "### ").parts.length, 3);
  assert.match(text, /PR 1/);
  assert.match(text, /PR 2/);
});

test("merge keeps an entry present in both files once", () => {
  const { text } = merged(handoff([carry([entry("flaky")])]), handoff([carry([entry("flaky")])]));
  assert.equal(text, handoff([carry([entry("flaky")])]));
});

test("merge appends a Carry forward section only one side has", () => {
  const { result, text } = merged(handoff([resumeBlock("claude-a", EARLY)]), handoff([resumeBlock("claude-a", EARLY), carry([entry("flaky")])]));
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(text, /## Carry forward[\s\S]*### flaky/);
});

test("merge exits 3 for two different blocks that claim the same Updated", () => {
  const { result, out } = merged(handoff([resumeBlock("claude-a", EARLY, "one")]), handoff([resumeBlock("claude-a", EARLY, "two")]));
  assert.equal(result.status, EXIT_UNMERGEABLE);
  assert.match(result.stderr, /STOP and ask the user: .*both say Updated: 2026-01-01T09:00Z/);
  assert.equal(existsSync(out), false);
});

test("merge exits 3 when a differing block has no valid Updated line", () => {
  const broken = resumeBlock("claude-a", "yesterday");
  assert.equal(merged(handoff([broken]), handoff([resumeBlock("claude-a", LATE)])).result.status, EXIT_UNMERGEABLE);
  assert.equal(merged(handoff([resumeBlock("claude-a", LATE)]), handoff([broken])).result.status, EXIT_UNMERGEABLE);
});

test("merge exits 3 for a section outside the three cases that differs", () => {
  const ours = handoff(["## Outcome\n\nshipped one thing", resumeBlock("claude-a", EARLY)]);
  const theirs = handoff(["## Outcome\n\nshipped another thing", resumeBlock("claude-a", EARLY)]);
  const { result } = merged(ours, theirs);
  assert.equal(result.status, EXIT_UNMERGEABLE);
  assert.match(result.stderr, /## Outcome differs between the files/);
});

test("merge exits 3 for a section only one file has, outside the three cases", () => {
  const { result } = merged(handoff([resumeBlock("claude-a", EARLY)]), handoff([resumeBlock("claude-a", EARLY), "## Notes\n\nfree text"]));
  assert.equal(result.status, EXIT_UNMERGEABLE);
  assert.match(result.stderr, /## Notes exists in only one file/);
});

test("merge accepts an identical section outside the three cases", () => {
  const same = handoff(["## Outcome\n\nshipped", resumeBlock("claude-a", EARLY)]);
  const { result, text } = merged(same, same);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(text, same);
});

test("merge exits 3 when the text before the first section differs", () => {
  const { result } = merged(`# One\n\n${resumeBlock("claude-a", EARLY)}\n`, `# Two\n\n${resumeBlock("claude-a", EARLY)}\n`);
  assert.equal(result.status, EXIT_UNMERGEABLE);
  assert.match(result.stderr, /before the first section differs/);
});

test("merge exits 3 when the text above the first Carry forward entry differs", () => {
  const { result } = merged(handoff(["## Carry forward\n\nintro one\n\n### a\n\nx"]), handoff(["## Carry forward\n\nintro two\n\n### a\n\nx"]));
  assert.equal(result.status, EXIT_UNMERGEABLE);
  assert.match(result.stderr, /before its first entry differs/);
});

test("merge needs all three paths and existing inputs", () => {
  const dir = scratch();
  const present = write(dir, "a.md", "x\n");
  assert.equal(cli(["merge", "--ours", present, "--theirs", present]).status, EXIT_USAGE);
  const missing = cli(["merge", "--ours", present, "--theirs", join(dir, "gone.md"), "--out", join(dir, "o.md")]);
  assert.equal(missing.status, EXIT_USAGE);
  assert.match(missing.stderr, /both input files must exist/);
});

const closeScene = (overrides = {}) => {
  assert(typeof overrides === "object" && overrides !== null, `overrides must be an object, got ${typeof overrides}`);
  const dir = scratch();
  const spec = write(dir, "spec.md", "---\nticket: PROJ-1\nstatus: Ready\n---\n# Spec\n");
  const outcomeFile = write(dir, "outcome.md", "Shipped the thing.\nThe dead end was X.\n");
  const ticket = join(dir, "PROJ-1");
  const slice1 = handoff([resumeBlock("claude-a", EARLY, "one", " — s1"), carry([entry("slice one finding")])]);
  const slice2 = handoff([resumeBlock("claude-b", LATE, "two", " — s2")]);
  const files = { "handoff.md": handoff([resumeBlock("claude-a", EARLY, "main"), carry([entry("main finding")])]), "handoff-s1.md": slice1, "handoff-s2.md": slice2, ...overrides };
  mkdirSync(ticket);
  for (const [name, text] of Object.entries(files)) write(ticket, name, text);
  assert(existsSync(join(ticket, "handoff.md")), `the scene needs a handoff in ${ticket}`);
  return { dir, ticket, spec, outcomeFile, slice1, slice2 };
};
const closeArgs = ({ ticket, outcomeFile, spec }) => {
  assert(existsSync(outcomeFile), `${outcomeFile} must exist`);
  assert(existsSync(spec), `${spec} must exist`);
  return ["close", "--dir", ticket, "--outcome-file", outcomeFile, "--spec", spec];
};

test("close folds per-slice handoffs, keeps every per-slice file, and marks them folded on the first line", () => {
  const scene = closeScene();
  const result = cli(closeArgs(scene));
  assert.equal(result.status, EXIT_OK, result.stderr);
  const { closedAt } = JSON.parse(result.stdout);
  assert.match(closedAt, SKILL_TIMESTAMP_SHAPE);
  assert.deepEqual(readdirSync(scene.ticket).sort(), ["handoff-s1.md", "handoff-s2.md", "handoff.md"]);
  assert.equal(read(join(scene.ticket, "handoff-s1.md")), `Folded into handoff.md: ${closedAt}\n\n${scene.slice1}`);
  assert.equal(read(join(scene.ticket, "handoff-s2.md")).split("\n")[0], `Folded into handoff.md: ${closedAt}`);
  const text = read(join(scene.ticket, "handoff.md"));
  for (const wanted of ["## Resume — claude-a\n", "## Resume — claude-b — s2", "## Resume — claude-a — s1", "### main finding", "### slice one finding"]) assert.ok(text.includes(wanted), `${wanted} must be folded in`);
});

test("close leads the handoff with the outcome and stamps every Resume block Closed", () => {
  const scene = closeScene();
  const { closedAt } = JSON.parse(cli(closeArgs(scene)).stdout);
  const { parts } = splitSections(read(join(scene.ticket, "handoff.md")), "## ");
  assert.equal(parts[0].heading, "## Outcome");
  assert.equal(parts[0].body, "Shipped the thing.\nThe dead end was X.");
  const resumes = parts.filter((part) => part.heading.startsWith("## Resume"));
  assert.equal(resumes.length, 3);
  for (const block of resumes) assert.ok(block.body.endsWith(`\n- Closed: ${closedAt}`), `${block.heading} must end with Closed`);
});

test("close sets the spec frontmatter status to Shipped and nothing else in it", () => {
  const scene = closeScene();
  assert.equal(cli(closeArgs(scene)).status, EXIT_OK);
  assert.equal(read(scene.spec), "---\nticket: PROJ-1\nstatus: Shipped\n---\n# Spec\n");
});

test("close run twice neither re-folds nor duplicates Closed or Outcome", () => {
  const scene = closeScene();
  cli(closeArgs(scene));
  const handoffAfterFirst = read(join(scene.ticket, "handoff.md"));
  const sliceAfterFirst = read(join(scene.ticket, "handoff-s1.md"));
  assert.equal(cli(closeArgs(scene)).status, EXIT_OK);
  assert.equal(read(join(scene.ticket, "handoff.md")), handoffAfterFirst);
  assert.equal(read(join(scene.ticket, "handoff-s1.md")), sliceAfterFirst);
});

test("close with a fold outside the three cases exits 3 and changes no file", () => {
  const scene = closeScene({ "handoff-s1.md": handoff([resumeBlock("claude-a", EARLY, "one", " — s1")]), "handoff-s2.md": handoff([resumeBlock("claude-a", EARLY, "different", " — s1")]) });
  const before = Object.fromEntries(readdirSync(scene.ticket).map((name) => [name, read(join(scene.ticket, name))]));
  const specBefore = read(scene.spec);
  const result = cli(closeArgs(scene));
  assert.equal(result.status, EXIT_UNMERGEABLE);
  assert.deepEqual(Object.fromEntries(readdirSync(scene.ticket).map((name) => [name, read(join(scene.ticket, name))])), before);
  assert.equal(read(scene.spec), specBefore);
});

test("close folds only Resume blocks and Carry forward, ignoring a per-slice file's other sections", () => {
  const scene = closeScene({ "handoff-s1.md": handoff(["## Scratch\n\nnot carried", resumeBlock("claude-a", EARLY, "one", " — s1")]), "handoff-s2.md": handoff([resumeBlock("claude-b", LATE, "two", " — s2")]) });
  assert.equal(cli(closeArgs(scene)).status, EXIT_OK);
  assert.doesNotMatch(read(join(scene.ticket, "handoff.md")), /not carried/);
  assert.match(read(join(scene.ticket, "handoff-s1.md")), /not carried/);
});

test("close needs a handoff, a non-empty outcome, and a spec with a status line", () => {
  const scene = closeScene();
  const noHandoff = cli(["close", "--dir", scene.dir, "--outcome-file", scene.outcomeFile, "--spec", scene.spec]);
  assert.equal(noHandoff.status, EXIT_USAGE);
  assert.match(noHandoff.stderr, /there is no handoff to close/);
  const emptyOutcome = write(scene.dir, "empty.md", "  \n");
  assert.equal(cli(closeArgs({ ...scene, outcomeFile: emptyOutcome })).status, EXIT_USAGE);
  const noStatus = write(scene.dir, "bare.md", "---\nticket: PROJ-1\n---\n# Spec\n");
  const bare = cli(closeArgs({ ...scene, spec: noStatus }));
  assert.equal(bare.status, EXIT_USAGE);
  assert.match(bare.stderr, /needs frontmatter with a status: line/);
  assert.equal(cli(["close", "--dir", scene.ticket]).status, EXIT_USAGE);
  assert.equal(read(join(scene.ticket, "handoff.md")).includes("Outcome"), false);
});

test("laterResume rejects a non-Resume heading and two different headings", () => {
  const block = { heading: "## Resume — claude-a", body: `- Updated: ${EARLY}` };
  assert.throws(() => laterResume({ heading: "## Outcome", body: "" }, block), /not a Resume heading/);
  assert.throws(() => laterResume(block, { heading: "## Resume — claude-b", body: `- Updated: ${LATE}` }), /only one actor's own block/);
  assert.equal(laterResume(block, { ...block, body: `- Updated: ${LATE}` }).body, `- Updated: ${LATE}`);
});

test("mergeCarryForward rejects non-text input", () => {
  assert.throws(() => mergeCarryForward(1, ""), /ours must be a string/);
  assert.throws(() => mergeCarryForward("", 1), /theirs must be a string/);
});
