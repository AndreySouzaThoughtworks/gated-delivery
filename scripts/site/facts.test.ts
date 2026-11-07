import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSite } from "./build.ts";
import { callersOf, collectSiteData } from "./data.ts";
import type { SiteData, Skill } from "./data.ts";
import {
  budgetRows, budgetTable, checkLinks, ciPlatforms, commandsTable, dataBlock, excerptBlock, factVariables, filesUnder, findingsIn, inventoryTable, kindTable, knobsTable, licenseLine, liveEvidence,
  mistakesTable, missingReferences, nodeFloors, nodeTable, openMistakesTable, percentOf, ratchetTable, readSource, requiredChecksTable, ruleInventories, ruleQuotation, sectionOf, stampCounts, stampsTable,
  suppressionCounts, suppressionTable, tableUnder, versionPolicy,
} from "./facts.ts";
import { strayFileProblems, trackedFiles } from "./gates.ts";
import { demoOutput } from "./fragments.ts";
import { stackedTable } from "./html.ts";
import type { CheckEntry } from "./html.ts";
import { loadChecks } from "./registry.ts";

const REPOSITORY = process.cwd();
const WRONG = 5 as never;
const LINKED = ["plugin", "evals", "scripts", "docs", ".github", ".claude-plugin", "tests", "LICENSE", "package.json", "zanity-baseline.json", "message-actionability-baseline.json", "assertion-effectiveness-baseline.json"];
const CHECK: CheckEntry = { number: 8, id: "c", title: "T", rule: "r", fix: "f", example: "e", mistake: null, source: "scripts/audit/consistency.ts" };
const SKILL = { name: "alpha", path: "plugin/skills/alpha/SKILL.md", description: "d", rules: 2, mutation: { killed: 1, total: 2, unprotected: { lines: 3, nonBlank: 4 } }, budget: null, inputs: [], sections: [], steps: [], scripts: [], tier: "static", stampedAt: null } as Skill;
const DATA: SiteData = { skills: [SKILL], agents: [], commands: [], hooks: [], pluginScripts: [] };
const SUPPRESSION_LINE = `const a = 1; // ${"zanity:"} ${"ignore[assertion-density]"} -- single-invariant: one real check\n`;
const REAL_CONTEXT = { root: REPOSITORY, variables: {}, checks: [CHECK] };

const markdownTable = (heading: string, rows: string[], columns = 2) => {
  assert(rows.length > 0, `a table needs rows, got ${rows.length}; pass at least one row.`);
  assert(columns >= 2, `a table needs two or more columns, got ${columns}; pass a larger count.`);
  const header = Array.from({ length: columns }, (_, index) => `c${index}`);
  return `# t\n\n## ${heading}\n\n| ${header.join(" | ")} |\n|${header.map(() => "---").join("|")}|\n${rows.map((row) => `| ${row} |`).join("\n")}\n\n## Next\n`;
};

const scratch = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "site-facts-"));
  assert(root.startsWith(tmpdir()), `${root} must be a throwaway under ${tmpdir()}`);
  assert(Object.keys(files).every((path) => !path.startsWith("/")), `scratch files are relative paths, got ${JSON.stringify(Object.keys(files))}`);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
};

const developmentDoc = (command: string) => {
  assert(command !== "", `a command row needs a command, got an empty one`);
  assert(!command.includes("|"), `a command must not hold a pipe, got ${command}`);
  return scratch({ "docs/development.md": markdownTable("Tests", [`\`${command}\` | No | proves`], 3), "real.sh": "x" });
};

const packageWith = (node: unknown) => {
  assert(node !== undefined, `a package fixture needs an engines value, got undefined`);
  assert(typeof node === "string", `an engines value is text in these fixtures, got ${typeof node}`);
  return scratch({ "package.json": JSON.stringify({ engines: { node } }) });
};

const manifests = (marketplace: object, plugin: object) => {
  assert(typeof marketplace === "object" && marketplace !== null, `the marketplace fixture is an object, got ${typeof marketplace}`);
  assert(typeof plugin === "object" && plugin !== null, `the plugin fixture is an object, got ${typeof plugin}`);
  return scratch({ ".claude-plugin/marketplace.json": JSON.stringify(marketplace), "plugin/.claude-plugin/plugin.json": JSON.stringify(plugin) });
};

test("every named data block renders from the repository files", async () => {
  const data = await collectSiteData(REPOSITORY);
  const names = ["rule-kinds", "token-budgets", "suppressions", "ratchets", "open-mistakes", "env-vars", "audit-commands", "node-releases", "version-policy", "ci-platforms", "required-checks", "license", "rule-inventories", "stamps", "live-evidence"];
  const empty = names.filter((name) => dataBlock(name, { ...REAL_CONTEXT, data }).length === 0);
  assert.deepEqual(empty, [], `every block must render some html, got empty ${JSON.stringify(empty)}`);
});

test("rule kinds, inventories and ratchets show the repository numbers", async () => {
  const data = await collectSiteData(REPOSITORY);
  assert.match(kindTable(REPOSITORY), /<code>stop<\/code>/, "the kind table must count the stop rules");
  assert.match(inventoryTable(data), /evals\/rules\/skill-slice\.json/, "the inventory table must list the slice inventory");
  assert.match(ratchetTable(REPOSITORY), /message-actionability-baseline\.json/, "the ratchet table must list the message baseline");
  assert.match(suppressionTable(REPOSITORY), /<strong>total<\/strong>/, "the suppression table must end with the total");
  assert.match(budgetTable(REPOSITORY), /plugin\/skills\/slice\/SKILL\.md/, "the budget table must list the slice skill");
});

test("budgets come sorted from the largest and the plugin id joins both manifest names", () => {
  const sorted = budgetRows(REPOSITORY).map(([, budget]) => budget);
  assert.deepEqual(sorted, sorted.toSorted((a, b) => b - a), `budgets must come from the largest, got ${JSON.stringify(sorted)}`);
  assert.equal(factVariables(REPOSITORY).pluginId, "gated-delivery@gated-delivery", "the plugin id joins the plugin and the marketplace names");
  assert.equal(nodeFloors(REPOSITORY).major, String(Number.parseInt(nodeFloors(REPOSITORY).dev, 10)), "the dev floor starts with the major floor");
});

test("mistake tables link a check number to its card and read the knob and command tables", () => {
  const checks = Array.from({ length: 40 }, (_, index) => ({ ...CHECK, number: index + 1 }));
  assert.match(mistakesTable(REPOSITORY, checks), /href="ci-checks\.html#check-8"/, "a check number must link to its card");
  assert.match(openMistakesTable(REPOSITORY), /Why no rule catches it/, "the open table must keep its header");
  assert.match(knobsTable(REPOSITORY), /GATED_DELIVERY_VERIFY_CMD/, "the knob table must hold the verify variable");
  assert.match(commandsTable(REPOSITORY), /scripts\/audit/, "the audit commands must name the audit scripts");
  assert.match(requiredChecksTable(REPOSITORY), /zanity/, "the required checks must name zanity");
  assert.match(nodeTable(REPOSITORY), /yes/, "the node table must mark the plugin floor");
});

test("a rule quotation is byte exact and names the file that holds the anchor", () => {
  const html = ruleQuotation(REPOSITORY, "spec.hold-drafts");
  assert.match(html, /Do not write it until the user signs off on every section\./, "the anchor must be quoted whole");
  assert.match(html, /data-source="plugin\/skills\/spec\/SKILL\.md"/, "the quotation names the file that holds the anchor");
  assert.match(excerptBlock(REPOSITORY, "scripts/audit/consistency.ts", "// --- 28.", 2), /Instruction files stay within their token budget/, "the excerpt must start at the section header");
});

test("a rule or an excerpt that does not exist fails with its fix", () => {
  assert.throws(() => ruleQuotation(REPOSITORY, ""), /found by its id/);
  assert.throws(() => ruleQuotation(REPOSITORY, "no.such-rule"), /holds the rule "no\.such-rule"\. Fix: copy an id/);
  const root = scratch({ "evals/rules/a.json": JSON.stringify({ file: "x.md", rules: [{ id: "a.b", anchor: "gone", kind: "never", why: "w" }] }), "x.md": "other text" });
  assert.throws(() => ruleQuotation(root, "a.b"), /anchor of rule "a\.b" is in none of its files\. Fix:/);
  assert.throws(() => excerptBlock(REPOSITORY, "scripts/audit/consistency.ts", "// --- no such line", 2), /has no line that starts with/);
  assert.throws(() => excerptBlock(REPOSITORY, "scripts/audit/consistency.ts", "// ---", 0), /positive number of lines/);
});

test("source readers and table parsers reject a missing source with the fix", () => {
  const root = scratch({ "doc.md": markdownTable("Rows", ["x | y", "z | w"]), "short.md": markdownTable("Rows", ["x | y | extra"]) });
  assert.deepEqual(tableUnder(root, "doc.md", "Rows", 2), [["x", "y"], ["z", "w"]]);
  assert.throws(() => tableUnder(root, "doc.md", "Rows", 0), /at least one column/);
  assert.throws(() => tableUnder(root, "short.md", "Rows", 2), /must hold rows of 2 cells, got \[3\]; fix the table/);
  assert.throws(() => sectionOf("text", ""), /found by its heading/);
  assert.throws(() => sectionOf("text", "Missing"), /has no section "## Missing"/);
  assert.throws(() => readSource(root, "/etc/hosts"), /relative to the repository root/);
  assert.throws(() => readSource(root, "absent.md"), /absent\.md must exist under the repository root/);
  assert.throws(() => ruleInventories(root), /evals\/rules must exist/);
  assert.throws(() => ruleInventories(scratch({ "evals/rules/note.txt": "x" })), /must hold inventories, got none/);
});

test("inventory and stamp facts reject inconsistent data", () => {
  assert.match(inventoryTable(DATA), /1 of 2 \(50%\)[\s\S]*3 of 4 \(75%\)/, "the table must show the score and the unprotected share");
  assert.throws(() => inventoryTable({ ...DATA, skills: WRONG }), /lists skills/);
  assert.throws(() => inventoryTable({ ...DATA, skills: [{ ...SKILL, mutation: { killed: 3, total: 2 } }] }), /killed mutants cannot exceed/);
  assert.throws(() => percentOf(1, -1), /whole of zero or more/);
  assert.throws(() => percentOf(3, 2), /part between zero and its whole/);
  assert.equal(percentOf(0, 0), 100, "an empty whole counts as complete");
  assert.throws(() => stampCounts({ ...DATA, skills: WRONG }), /stamp counts list skills/);
  assert.throws(() => stampCounts({ ...DATA, skills: [] }), /need skills, got none/);
  assert.throws(() => stampCounts({ ...DATA, skills: [{ ...SKILL, tier: "bogus" as never }] }), /needs a known tier/);
});

test("stamp tables and live evidence say what the stamps hold", () => {
  assert.match(liveEvidence(DATA), /No skill holds a live stamp/);
  assert.match(liveEvidence({ ...DATA, skills: [{ ...SKILL, tier: "live" }] }), /1 skills hold a live stamp/);
  assert.match(stampsTable(DATA), /tier-static">static<\/span><\/td><td>1</);
  assert.throws(() => stampsTable({ ...DATA, skills: WRONG }), /stamp table lists skills/);
  assert.throws(() => stampsTable({ ...DATA, skills: [] }), /stamp table needs skills/);
  assert.throws(() => liveEvidence({ ...DATA, skills: WRONG }), /live evidence reads skills/);
  assert.throws(() => liveEvidence({ ...DATA, skills: [] }), /live evidence needs skills/);
});

test("kind and budget facts reject empty or malformed files", () => {
  const noRules = scratch({ "evals/rules/a.json": JSON.stringify({ file: "x.md", rules: [] }) });
  assert.throws(() => kindTable(noRules), /counts rules, got none/);
  const blankKind = scratch({ "evals/rules/a.json": JSON.stringify({ file: "x.md", rules: [{ id: "a", anchor: "a", kind: "", why: "w" }] }) });
  assert.throws(() => kindTable(blankKind), /every rule has a kind/);
  assert.throws(() => budgetRows(scratch({ "evals/token-budget.json": JSON.stringify({ budgets: {} }) })), /must hold budgets, got none/);
  assert.throws(() => budgetRows(scratch({ "evals/token-budget.json": JSON.stringify({ budgets: { a: -1 } }) })), /positive whole number/);
});

test("suppressions are counted by reason code in source files only", () => {
  const root = scratch({ "scripts/audit/suppressions.count": "3\n", "scripts/a.ts": SUPPRESSION_LINE, "plugin/b.mjs": SUPPRESSION_LINE, "plugin/node_modules/c.mjs": SUPPRESSION_LINE, "plugin/notes.txt": SUPPRESSION_LINE });
  const counts = suppressionCounts(root);
  assert.equal(counts.coded, 2, `node_modules and other extensions are skipped, got ${counts.coded}`);
  assert.equal(counts.total, 3, "the total is the committed count");
  assert.equal(counts.byCode.find(({ code }) => code === "single-invariant")?.count, 2, "the count is grouped by reason code");
  assert.match(suppressionTable(root), /<td>1<\/td>/, "the other markers row is the difference");
});

test("suppression and ratchet facts reject a bad count file and a bad baseline", () => {
  assert.throws(() => suppressionCounts(scratch({ "scripts/audit/suppressions.count": "many" })), /must hold one whole number/);
  assert.throws(() => suppressionCounts(""), /got an empty path/);
  assert.throws(() => suppressionTable(""), /got an empty path/);
  const tooMany = scratch({ "scripts/audit/suppressions.count": "1\n", "scripts/a.ts": SUPPRESSION_LINE, "plugin/b.mjs": SUPPRESSION_LINE });
  assert.throws(() => suppressionTable(tooMany), /2 coded suppressions exceed the 1 that/);
  assert.throws(() => findingsIn(scratch({ "b.json": "{}" }), "b.json"), /must hold a findings list/);
  assert.throws(() => findingsIn(REPOSITORY, "b.txt"), /baseline is a json file/);
  assert.equal(findingsIn(scratch({ "b.json": '{"findings":[1,2]}' }), "b.json"), 2);
  assert.throws(() => ratchetTable(scratch({ "zanity-baseline.json": '{"findings":[]}' })), /message-actionability-baseline\.json must exist/);
});

test("file listings reject a bad folder and skip a missing one", () => {
  const root = scratch({ "plugin/a.mjs": "x" });
  assert.deepEqual(filesUnder(root, "absent"), [], "a missing folder lists nothing");
  assert.deepEqual(filesUnder(root, "plugin"), ["plugin/a.mjs"]);
  assert.throws(() => filesUnder(root, "/plugin"), /relative to the repository root/);
  assert.throws(() => filesUnder("", "plugin"), /got an empty path/);
});

test("check links name a missing check and reject bad input", () => {
  assert.match(checkLinks("<code>check 8</code> and <code>check 8a</code>", [CHECK]), /<a href="ci-checks\.html#check-8"><code>check 8<\/code><\/a> and <a href="ci-checks\.html#check-8">/);
  assert.throws(() => checkLinks("<code>check 99</code>", [CHECK]), /names check 99, but the registry has no such check\. Fix:/);
  assert.throws(() => checkLinks("x", WRONG), /resolve against registry rows/);
  assert.throws(() => checkLinks(WRONG, [CHECK]), /added to html text/);
  assert.throws(() => mistakesTable(REPOSITORY, WRONG), /links to registry rows/);
});

test("commands that name a missing file fail the table with the file", () => {
  const root = scratch({ "real.sh": "x" });
  assert.deepEqual(missingReferences(root, "bash real.sh && bash gone.sh && node tests/*.test.ts"), ["gone.sh", "tests/*.test.ts"]);
  assert.throws(() => missingReferences("", "x"), /got an empty path/);
  assert.throws(() => missingReferences(root, WRONG), /a command is text/);
  assert.throws(() => commandsTable(developmentDoc("bash gone.sh")), /name files which do not exist: gone\.sh\. Fix:/);
  assert.match(commandsTable(developmentDoc("bash real.sh")), /bash real\.sh/);
});

test("a knob with a wrong name and a bad node range fail with the fix", () => {
  const knobs = scratch({ "docs/onboarding.md": "## Knobs (environment variables)\n\n| a | b | c |\n|---|---|---|\n| `BAD` | none | effect |\n" });
  assert.throws(() => knobsTable(knobs), /named in backticks with the GATED_DELIVERY_ prefix/);
  assert.throws(() => nodeFloors(packageWith("lts")), /names no Node release/);
  assert.throws(() => nodeFloors(packageWith(">=19")), /does not list\. Fix: add the release/);
  assert.deepEqual(nodeFloors(packageWith(">=22")), { major: "22", dev: "22", endOfLife: "2027-04-30" });
  assert.deepEqual(nodeFloors(packageWith(">=22.18")), { major: "22", dev: "22.18", endOfLife: "2027-04-30" });
});

test("tables and variables reject an empty or non-text root", () => {
  for (const call of [budgetTable, ratchetTable, openMistakesTable, nodeTable, factVariables, requiredChecksTable]) {
    assert.throws(() => call(""), /got an empty path/, `${call.name} must reject an empty root`);
    assert.throws(() => call(WRONG), /reads the repository root as text/, `${call.name} must reject a non-text root`);
  }
  assert.throws(() => mistakesTable("", []), /got an empty path/);
  assert.throws(() => knobsTable(""), /got an empty path/);
  assert.throws(() => commandsTable(""), /got an empty path/);
  assert.throws(() => versionPolicy(""), /got an empty path/);
});

test("manifests, platforms and the licence are read, and a bad file is named", () => {
  assert.match(versionPolicy(manifests({ name: "m", plugins: [{ version: "1.0.0" }] }, { name: "p" })), /A version field exists: 1\.0\.0/);
  assert.throws(() => versionPolicy(manifests({ name: "m" }, { name: "p" })), /must list plugins/);
  assert.match(ciPlatforms(scratch({ ".github/workflows/a.yml": "jobs:\n  a:\n    runs-on: windows-latest\n" })), /A Windows job exists/);
  assert.match(ciPlatforms(scratch({ ".github/workflows/a.yml": "jobs:\n  a:\n    runs-on: ubuntu-latest\n" })), /No CI job runs on Windows/);
  assert.throws(() => ciPlatforms(scratch({})), /must exist under/);
  assert.throws(() => ciPlatforms(scratch({ ".github/workflows/a.yml": "name: x\n" })), /must name a runner/);
  assert.match(licenseLine(scratch({ LICENSE: "MIT License\n\ntext" })), /blob\/main\/LICENSE">MIT License<\/a>/);
  assert.throws(() => licenseLine(scratch({ LICENSE: "\ntext" })), /must start with the licence name/);
  assert.throws(() => licenseLine(scratch({ LICENSE: "<b>x" })), /plain text/);
});

test("data blocks reject an unknown name and a missing site data", () => {
  assert.throws(() => dataBlock("bogus", REAL_CONTEXT), /asks for the data block "bogus", which does not exist\. Fix: use one of/);
  assert.throws(() => dataBlock("stamps", REAL_CONTEXT), /needs the collected site data/);
});

test("a stacked table labels each cell and rejects a short row", () => {
  assert.match(stackedTable(["A", "B"], [["1", "2"]]), /<td data-label="B">2<\/td>/);
  assert.throws(() => stackedTable([], []), /at least one column/);
  assert.throws(() => stackedTable(["A", "B"], [["1"]]), /every row needs 2 cells/);
});

test("callers are found by whole name and the agents list them", async () => {
  const texts = new Map([["skill a", "run the scout agent"], ["skill b", "scout-like helper"], ["agent scout", "scout itself"]]);
  assert.deepEqual(callersOf("scout", texts), ["skill a"], "a longer name and the agent itself are not callers");
  assert.throws(() => callersOf("", texts), /named agent/);
  assert.throws(() => callersOf("scout", WRONG), /Map of label to text/);
  const data = await collectSiteData(REPOSITORY);
  const executor = data.agents.find(({ name }) => name === "slice-executor");
  assert.deepEqual(data.agents.filter((agent) => agent.calledFrom === undefined).map(({ name }) => name), [], "every agent lists its callers");
  assert(executor?.calledFrom?.includes("skill slice"), `the slice skill calls the slice-executor, got ${JSON.stringify(executor?.calledFrom)}`);
});

test("tracked backup and patch files are reported by name with the fix", () => {
  assert.deepEqual(strayFileProblems(["a.ts", "docs/b.md"]), []);
  const problems = strayFileProblems(["scripts/x.test.ts.bak", "a.orig", "dir/b.rej", "ok.ts"]);
  assert.equal(problems.length, 3, `three stray files must be reported, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /scripts\/x\.test\.ts\.bak is a stray backup or patch leftover that the repository tracks\. Rule: .* Fix: remove it with git rm scripts\/x\.test\.ts\.bak\./);
  assert.throws(() => strayFileProblems(WRONG), /list of paths/);
  assert.throws(() => strayFileProblems([WRONG]), /every tracked path is text/);
});

test("the tracked file listing needs a real root and reads a repository", () => {
  assert.throws(() => trackedFiles(""), /got an empty path/);
  assert.throws(() => trackedFiles(join(tmpdir(), "site-no-such-root")), /must exist to list tracked files/);
  assert.deepEqual(trackedFiles(scratch({ "a.txt": "x" })), [], "a folder with no repository lists nothing");
  const root = scratch({ "keep.txt": "x", "old.txt.bak": "x" });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  assert.deepEqual(trackedFiles(root).toSorted(), ["keep.txt", "old.txt.bak"], "the listing holds each tracked file");
});

test("a tracked backup file fails the whole site build", async () => {
  const site = mkdtempSync(join(tmpdir(), "site-stray-"));
  for (const name of LINKED) symlinkSync(join(REPOSITORY, name), join(site, name));
  cpSync(join(REPOSITORY, "docs-site-src"), join(site, "docs-site-src"), { recursive: true });
  writeFileSync(join(site, "left.txt.bak"), "x");
  execFileSync("git", ["init", "-q"], { cwd: site });
  execFileSync("git", ["add", "-A"], { cwd: site });
  const { problems } = await buildSite(site, join(site, "docs-site"), await loadChecks(REPOSITORY));
  assert(problems.some((problem) => problem.startsWith("left.txt.bak is a stray backup")), `the build must report the tracked backup file, got ${JSON.stringify(problems)}`);
});

test("a demo setup command that fails stops the build with the command and the fix", () => {
  const root = scratch({ "docs-site-src/demos/bad/demo.json": JSON.stringify({ script: "x.mjs", args: [], setup: ["exit 3"] }) });
  assert.throws(() => demoOutput(root, "bad"), /demo\.json setup command "exit 3" exited with 3: .*Fix: correct the command/);
});

test("a demo runs its setup first, hides the scratch path and quotes an argument with a space", () => {
  const files = { "docs-site-src/demos/ok/demo.json": JSON.stringify({ script: "echo.mjs", args: ["a b"], setup: ["echo hi > made.txt"], cwd: "." }), "echo.mjs": 'import { readFileSync } from "node:fs"; console.log(readFileSync("made.txt", "utf8").trim(), process.cwd());' };
  const output = demoOutput(scratch(files), "ok");
  assert.match(output, /^\$ node echo\.mjs "a b"\nhi <fixture>\n\(exit 0\)$/, `the setup runs first and the scratch path is hidden, got ${output}`);
});

test("a demo script reached through a symlinked folder still runs as the main module", () => {
  const real = scratch({ "tool.mjs": 'import { fileURLToPath } from "node:url"; import { resolve } from "node:path"; console.log(resolve(process.argv[1]) === fileURLToPath(import.meta.url) ? "main" : "imported");' });
  const root = scratch({ "docs-site-src/demos/linked/demo.json": JSON.stringify({ script: "linked/tool.mjs", args: [] }) });
  symlinkSync(real, join(root, "linked"));
  assert.match(demoOutput(root, "linked"), /\nmain\n/, "a script behind a symlink must see itself as the main module");
});

const keepFiles = (keep: string) => {
  assert(typeof keep === "string", `a keep pattern is text, got ${typeof keep}; pass a string.`);
  assert(!keep.includes("\n"), `a keep pattern matches one line, got a newline in ${JSON.stringify(keep)}; drop the newline.`);
  return {
    "docs-site-src/demos/kept/demo.json": JSON.stringify({ script: "lines.mjs", args: [], keep }),
    "lines.mjs": 'console.log("alpha"); console.log("beta"); console.log("alpha two");',
  };
};

test("a keep fixture rejects a pattern that is not one line of text", () => {
  assert.throws(() => keepFiles(5 as never), /a keep pattern is text, got number/);
  assert.throws(() => keepFiles("a\nb"), /a keep pattern matches one line/);
});

test("a demo keep pattern shows only the matching lines and counts the hidden ones", () => {
  const output = demoOutput(scratch(keepFiles("^alpha")), "kept");
  assert.equal(output, "$ node lines.mjs\nalpha\nalpha two\n(2 of 3 output lines shown)\n(exit 0)", `only the alpha lines may stay, got ${output}`);
});

test("a demo keep pattern that matches nothing or is empty stops the build with the fix", () => {
  assert.throws(() => demoOutput(scratch(keepFiles("^gamma")), "kept"), /keep \^gamma matches none of the 3 output lines; fix the pattern/);
  assert.throws(() => demoOutput(scratch(keepFiles("")), "kept"), /keep is an empty pattern, so it would hide every line/);
});
