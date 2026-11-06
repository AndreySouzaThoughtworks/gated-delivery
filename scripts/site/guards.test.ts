import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statedCountProblems } from "../audit/guide-freshness.ts";
import { siteWiringProblems } from "../audit/site-wiring.ts";
import { buildSite, main, readTree } from "./build.ts";
import { collectSiteData, directoryNames, exitCodesOf, fieldsOf, headingsOf, guardSectionNumbers, hooksOf, inventoryOf, listScripts, shippedScriptFiles, sourceUsageOf, markdownNames, pluginScripts, readText, scoreMutations, scriptIndex, scriptsCalled, tierOf, usageOf, warnOnlyChecks } from "./data.ts";
import type { Agent, Command, Hook, PluginScript, SiteData, Skill } from "./data.ts";
import { demoOutput, expandVariable, mistakeRows, renderFragment } from "./fragments.ts";
import { coverageProblems, handTypedCountProblems, leakProblems, linkProblems, quotationProblems, renderedCountProblems, siteProblems, siteReport, structureProblems, styleProblems } from "./gates.ts";
import { bulletList, callout, checkCard, escapeHtml, inlineCode, layout, quotation, relativeLink, table, tableOfContents, terminal, unescapeHtml } from "./html.ts";
import { attributesOf, balanceProblems, stripNonMarkup, tagsOf } from "./markup.ts";
import { agentsPage, buildPages, checksPage, commandsPage, evalTiersPage, evidenceRows, evidenceTable, fragmentFiles, hooksPage, instructionSection, pluginScriptsPage, siteVariables, skillPage, skillsIndex } from "./pages.ts";
import { loadChecks } from "./registry.ts";
import { declarations } from "./style.ts";

const REPOSITORY = process.cwd();
const ABSENT = join(tmpdir(), "site-guards-absent-root");
const WRONG = 5 as never;
const CHECK = { number: 1, id: "c", title: "T", rule: "r", fix: "f", example: "e", mistake: "m", source: "s" };
const PAGE = { path: "a.html", title: "A", summary: "s", body: "", source: "x" };
const SKILL = { name: "alpha", path: "plugin/skills/alpha/SKILL.md", description: "d", rules: null, mutation: null, budget: null, inputs: [], sections: [], steps: [], scripts: [], tier: "none", stampedAt: null } as Skill;
const AGENT = { name: "bot", path: "plugin/agents/bot.md", description: "d", rules: null, mutation: null, budget: null, model: null, tools: null } as Agent;
const COMMAND = { name: "go", path: "plugin/commands/go.md", description: "d", rules: null, mutation: null, budget: null, allowedTools: null } as Command;
const SCRIPT = { name: "s.mjs", path: "plugin/scripts/s.mjs", usage: [], exitCodes: [], exitWithoutArguments: 0, group: "shared", usageFrom: "none" } as PluginScript;
const DATA: SiteData = { skills: [SKILL], agents: [AGENT], commands: [COMMAND], hooks: [], pluginScripts: [SCRIPT] };
const CONTEXT = { root: REPOSITORY, file: "docs-site-src/x.html", variables: {}, checks: [CHECK] };
const INVENTORY_CONTEXT = { root: REPOSITORY, budgets: {}, mutations: new Map() };

type Guard = [label: string, call: () => unknown, message: RegExp];

const GUARDS: Guard[] = [
  ["escapeHtml rejects a non-string", () => escapeHtml(WRONG), /escaping needs text/],
  ["escapeHtml rejects an already escaped entity", () => escapeHtml("a &amp; b"), /already escaped/],
  ["unescapeHtml rejects a non-string", () => unescapeHtml(WRONG), /unescaping needs text/],
  ["unescapeHtml rejects a raw angle bracket", () => unescapeHtml("<b>"), /holds a raw </],
  ["inlineCode rejects a non-string", () => inlineCode(WRONG), /inline code needs text/],
  ["inlineCode rejects an odd backtick count", () => inlineCode("`open"), /odd number of backticks/],
  ["bulletList rejects a non-array", () => bulletList(WRONG), /needs an array of items/],
  ["bulletList rejects a non-string item", () => bulletList([WRONG]), /every list item must be html text/],
  ["relativeLink rejects a leading slash", () => relativeLink("/a.html", "b.html"), /relative to the site root/],
  ["relativeLink rejects an empty target", () => relativeLink("a.html", ""), /joins two named pages/],
  ["callout rejects a non-string", () => callout(WRONG), /needs html text/],
  ["callout rejects a blank string", () => callout("  "), /needs content/],
  ["terminal rejects an empty caption", () => terminal("", "x"), /needs a caption/],
  ["terminal rejects non-string text", () => terminal("t", WRONG), /needs text/],
  ["quotation rejects an empty source", () => quotation("", "x"), /names its source file/],
  ["quotation rejects empty text", () => quotation("s", ""), /needs text/],
  ["table rejects no column", () => table([], []), /at least one column/],
  ["table rejects a short row", () => table(["a", "b"], [["x"]]), /every row needs 2 cells/],
  ["checkCard rejects a zero number", () => checkCard({ ...CHECK, number: 0 }), /positive integer/],
  ["checkCard rejects an empty title", () => checkCard({ ...CHECK, title: "" }), /needs an id and a title/],
  ["tableOfContents rejects a non-string", () => tableOfContents(WRONG), /built from html text/],
  ["tableOfContents rejects a whole document", () => tableOfContents("<html>"), /fragment, got a whole document/],
  ["layout rejects a non-html path", () => layout({ ...PAGE, path: "a.txt" }, [{ path: "a.html", label: "A" }]), /must end in \.html/],
  ["layout rejects an empty menu", () => layout(PAGE, []), /needs navigation links/],
  ["stripNonMarkup rejects a non-string", () => stripNonMarkup(WRONG), /markup must be text/],
  ["stripNonMarkup rejects a NUL character", () => stripNonMarkup("a\u0000b"), /holds a NUL character at offset 1/],
  ["attributesOf rejects a non-string", () => attributesOf(WRONG), /attributes come from tag text/],
  ["attributesOf rejects a raw angle bracket", () => attributesOf("<a"), /holds a raw </],
  ["tagsOf rejects a non-string", () => tagsOf(WRONG), /markup must be text/],
  ["tagsOf rejects a NUL character", () => tagsOf("a\u0000b"), /holds a NUL character at offset 1/],
  ["balanceProblems rejects an empty file name", () => balanceProblems("", "x"), /needs a file name/],
  ["balanceProblems rejects non-string html", () => balanceProblems("f", WRONG), /must be html text/],
  ["declarations rejects an empty theme", () => declarations({} as never), /at least one token/],
  ["declarations rejects a non-hex value", () => declarations({ bg: "red" } as never), /must be a hex colour/],
  ["mistakeRows rejects a non-string", () => mistakeRows(WRONG), /come from markdown text/],
  ["mistakeRows rejects text with no table", () => mistakeRows("no table here"), /must hold a markdown table/],
  ["expandVariable rejects an empty name", () => expandVariable(CONTEXT)("", ""), /uses an empty variable/],
  ["renderFragment rejects non-string text", () => renderFragment(WRONG, CONTEXT), /a fragment is text/],
  ["renderFragment rejects an empty file name", () => renderFragment("x", { ...CONTEXT, file: "" }), /needs a file name/],
  ["x-mistake rejects a blank match", () => renderFragment(`<x-mistake match=" "/>`, CONTEXT), /blank match/],
  ["x-check rejects number zero", () => renderFragment(`<x-check number="0"/>`, CONTEXT), /check numbers start at 1/],
  ["coverageProblems rejects non-array skills", () => coverageProblems({ ...DATA, skills: WRONG }, new Map(), []), /lists skills/],
  ["coverageProblems rejects a non-Map", () => coverageProblems(DATA, WRONG, []), /Map of path to html/],
  ["coverageProblems rejects a non-array of shipped scripts", () => coverageProblems(DATA, new Map(), WRONG), /list of files from disk/],
  ["shippedScriptFiles rejects an empty root", () => shippedScriptFiles(""), /got an empty path/],
  ["shippedScriptFiles rejects an absent root", () => shippedScriptFiles(ABSENT), /must exist to list scripts/],
  ["scriptIndex rejects an empty root", () => scriptIndex(""), /scripts are indexed under the repository root/],
  ["scriptIndex rejects an absent root", () => scriptIndex(ABSENT), /must exist to index scripts/],
  ["listScripts rejects a folder outside the plugin", () => listScripts(REPOSITORY, "docs", "shared", false), /under plugin\//],
  ["listScripts rejects an unknown group", () => listScripts(REPOSITORY, "plugin/scripts", "other" as never, false), /shared, skill or bootstrap/],
  ["sourceUsageOf rejects a non-string", () => sourceUsageOf(WRONG), /read from script text/],
  ["sourceUsageOf rejects a NUL character", () => sourceUsageOf("a\u0000"), /holds a NUL character/],
  ["handTypedCountProblems rejects an empty file name", () => handTypedCountProblems("", "x"), /needs a file name/],
  ["handTypedCountProblems rejects non-string text", () => handTypedCountProblems("f", WRONG), /fragment is text/],
  ["renderedCountProblems rejects a non-Map", () => renderedCountProblems(WRONG, []), /Map of path to html/],
  ["renderedCountProblems rejects non-array counts", () => renderedCountProblems(new Map(), WRONG), /list of \[label, number\] pairs/],
  ["structureProblems rejects an empty file name", () => structureProblems("", "x"), /needs a file name/],
  ["structureProblems rejects non-string html", () => structureProblems("f", WRONG), /must be html text/],
  ["linkProblems rejects a non-Map", () => linkProblems(WRONG), /Map of path to html/],
  ["linkProblems rejects an empty site", () => linkProblems(new Map()), /got no page/],
  ["leakProblems rejects an empty file name", () => leakProblems("", "x"), /needs a file name/],
  ["leakProblems rejects non-string html", () => leakProblems("f", WRONG), /must be html text/],
  ["quotationProblems rejects an absent root", () => quotationProblems("f", "x", ABSENT), /resolve against the repository root/],
  ["quotationProblems rejects non-string html", () => quotationProblems("f", WRONG, REPOSITORY), /must be html text/],
  ["styleProblems rejects an empty source", () => styleProblems("f", "x", ""), /needs the file that wrote it/],
  ["styleProblems rejects non-string html", () => styleProblems("f", WRONG, "s"), /must be html text/],
  ["siteProblems rejects a non-Map", () => siteProblems({ files: WRONG } as never), /Map of path to html/],
  ["siteProblems rejects non-array fragments", () => siteProblems({ files: new Map(), fragments: WRONG } as never), /list of files/],
  ["siteReport rejects a non-Map", () => siteReport(WRONG), /Map of path to html/],
  ["siteReport rejects an empty site", () => siteReport(new Map()), /at least one page/],
  ["readText rejects an empty root", () => readText("", "x"), /got an empty root/],
  ["readText rejects an absolute path", () => readText(REPOSITORY, "/etc/hosts"), /relative to the root/],
  ["exitCodesOf rejects a non-string", () => exitCodesOf(WRONG), /come from script text/],
  ["exitCodesOf rejects a NUL character", () => exitCodesOf("a\u0000"), /holds a NUL character/],
  ["headingsOf rejects a non-string", () => headingsOf(WRONG, /a/g), /headings come from text/],
  ["headingsOf rejects a non-global pattern", () => headingsOf("a", /a/), /must be global/],
  ["usageOf rejects non-string output", () => usageOf(WRONG, ""), /script output text/],
  ["usageOf rejects a non-string source", () => usageOf("", WRONG), /fallback reads script text/],
  ["fieldsOf rejects a non-markdown path", () => fieldsOf(REPOSITORY, "a.txt"), /markdown file/],
  ["fieldsOf rejects a missing file", () => fieldsOf(REPOSITORY, "plugin/agents/none.md"), /must exist under/],
  ["inventoryOf rejects an empty rule name", () => inventoryOf(INVENTORY_CONTEXT, "", "plugin/x.md"), /got an empty name/],
  ["inventoryOf rejects a path outside the plugin", () => inventoryOf(INVENTORY_CONTEXT, "n", "other/x.md"), /lives under plugin\//],
  ["tierOf rejects an empty name", () => tierOf(REPOSITORY, ""), /named skill/],
  ["tierOf rejects a path", () => tierOf(REPOSITORY, "a/b"), /is a folder name/],
  ["scriptsCalled rejects non-string text", () => scriptsCalled(WRONG, new Map()), /come from skill text/],
  ["scriptsCalled rejects a non-Map index", () => scriptsCalled("x", WRONG), /must be a Map/],
  ["pluginScripts rejects an empty root", () => pluginScripts(""), /got an empty path/],
  ["pluginScripts rejects a root with no scripts", () => pluginScripts(ABSENT), /must exist under/],
  ["directoryNames rejects an empty folder", () => directoryNames(REPOSITORY, ""), /needs a name/],
  ["directoryNames rejects a climbing folder", () => directoryNames(REPOSITORY, ".."), /must not climb out/],
  ["markdownNames rejects an empty folder", () => markdownNames(REPOSITORY, ""), /needs a name/],
  ["markdownNames rejects a climbing folder", () => markdownNames(REPOSITORY, ".."), /must not climb out/],
  ["hooksOf rejects an empty root", () => hooksOf(""), /got an empty path/],
  ["hooksOf rejects an absent root", () => hooksOf(ABSENT), /must exist to read hooks/],
  ["siteVariables rejects non-array skills", () => siteVariables({ ...DATA, skills: WRONG }, [], []), /must list skills/],
  ["siteVariables rejects non-array checks", () => siteVariables(DATA, WRONG, []), /checks must be a list/],
  ["evidenceRows rejects a fractional rule count", () => evidenceRows({ ...SKILL, rules: 1.5 }), /whole number or null/],
  ["evidenceRows rejects more kills than mutants", () => evidenceRows({ ...SKILL, mutation: { killed: 3, total: 2 } }), /cannot exceed all mutants/],
  ["evidenceTable rejects an empty path", () => evidenceTable({ ...SKILL, path: "" }), /names its source file/],
  ["evidenceTable rejects an empty tier", () => evidenceTable(SKILL, ""), /tier is a word/],
  ["skillPage rejects an empty name", () => skillPage({ ...SKILL, name: "" }, new Map()), /named after its skill/],
  ["skillPage rejects a non-Map", () => skillPage(SKILL, WRONG), /Map of path to link/],
  ["skillsIndex rejects non-array skills", () => skillsIndex({ ...DATA, skills: WRONG }), /lists skills/],
  ["skillsIndex rejects a repeated name", () => skillsIndex({ ...DATA, skills: [SKILL, SKILL] }), /skill names must be unique/],
  ["instructionSection rejects an empty kind", () => instructionSection("", AGENT, []), /needs a kind/],
  ["instructionSection rejects non-array details", () => instructionSection("agent", AGENT, WRONG), /list of rows/],
  ["agentsPage rejects a non-array", () => agentsPage(WRONG), /lists agents/],
  ["agentsPage rejects a repeated name", () => agentsPage([AGENT, AGENT]), /agent names must be unique/],
  ["commandsPage rejects a non-array", () => commandsPage(WRONG), /lists commands/],
  ["commandsPage rejects a repeated name", () => commandsPage([COMMAND, COMMAND]), /command names must be unique/],
  ["hooksPage rejects a non-array", () => hooksPage(WRONG), /lists hooks/],
  ["hooksPage rejects a hook with no file", () => hooksPage([{ event: "e" } as unknown as Hook]), /needs a file name/],
  ["pluginScriptsPage rejects a non-array", () => pluginScriptsPage(WRONG), /lists scripts/],
  ["pluginScriptsPage rejects a repeated name", () => pluginScriptsPage([SCRIPT, SCRIPT]), /script names must be unique/],
  ["checksPage rejects a non-array", () => checksPage(WRONG, [], []), /lists checks/],
  ["checksPage rejects a repeated number", () => checksPage([CHECK, CHECK], [], []), /check numbers must be unique/],
  ["checksPage rejects a warn-only number with no row", () => checksPage([CHECK], [9], []), /every warn-only check needs a registry row/],
  ["guardSectionNumbers rejects an empty root", () => guardSectionNumbers(""), /got an empty path/],
  ["guardSectionNumbers rejects a root with no guard", () => guardSectionNumbers(ABSENT), /to count the guard checks/],
  ["warnOnlyChecks rejects an empty root", () => warnOnlyChecks(""), /got an empty path/],
  ["warnOnlyChecks rejects a root with no guard", () => warnOnlyChecks(ABSENT), /to tell which checks only warn/],
  ["evalTiersPage rejects non-array skills", () => evalTiersPage({ ...DATA, skills: WRONG }), /lists skills/],
  ["evalTiersPage rejects an unknown tier", () => evalTiersPage({ ...DATA, skills: [{ ...SKILL, tier: "bogus" as never }] }), /needs a known tier/],
  ["fragmentFiles rejects an empty root", () => fragmentFiles(""), /got an empty path/],
  ["fragmentFiles rejects the fragment folder", () => fragmentFiles(join(REPOSITORY, "docs-site-src")), /pass the repository root/],
  ["buildPages rejects an empty registry", () => buildPages(REPOSITORY, DATA, []), /needs registry rows/],
  ["readTree rejects an absent folder", () => readTree(ABSENT), /must exist to be read/],
  ["readTree rejects an absolute sub folder", () => readTree(REPOSITORY, "/x"), /relative to the site folder/],
  ["statedCountProblems rejects non-text", () => statedCountProblems("p", WRONG, []), /must be text/],
  ["statedCountProblems rejects non-array counts", () => statedCountProblems("p", "x", WRONG), /list of \[label, count\] pairs/],
  ["siteWiringProblems rejects a file as root", () => siteWiringProblems(join(REPOSITORY, "package.json")), /must be a directory/],
  ["siteWiringProblems rejects an absent root", () => siteWiringProblems(ABSENT), /must exist to check the site wiring/],
];

test("every function states its input contract, and each assertion fails on the input it names", () => {
  for (const [label, call, message] of GUARDS) assert.throws(call, message, `${label} must throw ${message}`);
});

test("async entry points reject a bad root, bad rows and a bad demo with the fix", async () => {
  const empty = mkdtempSync(join(tmpdir(), "site-guards-"));
  await assert.rejects(scoreMutations(empty, []), /must exist under .* to score rule inventories/);
  await assert.rejects(scoreMutations(REPOSITORY, WRONG), /rule names must be a list/);
  await assert.rejects(collectSiteData(empty), /must hold plugin\/, got none/);
  mkdirSync(join(empty, "plugin"));
  await assert.rejects(collectSiteData(empty), /must hold evals\/token-budget\.json, got none/);
  await assert.rejects(buildSite(REPOSITORY, join(empty, "out"), []), /needs registry rows for the checks page/);
  await assert.rejects(main(WRONG, REPOSITORY), /the arguments are a list/);
  await assert.rejects(main([], ""), /needs the repository root/);
  await assert.rejects(loadChecks(""), /read under the repository root/);
  mkdirSync(join(empty, "docs-site-src", "demos", "bad"), { recursive: true });
  writeFileSync(join(empty, "docs-site-src", "demos", "bad", "demo.json"), "{}");
  assert.throws(() => demoOutput(empty, "bad"), /must hold a script and an args list/);
});
