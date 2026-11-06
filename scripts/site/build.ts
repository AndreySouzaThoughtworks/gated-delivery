#!/usr/bin/env node
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { collectSiteData } from "./data.ts";
import { siteProblems, siteReport } from "./gates.ts";
import type { SiteFiles, Sources } from "./gates.ts";
import { layout } from "./html.ts";
import type { CheckEntry } from "./html.ts";
import { NAVIGATION, buildPages, fragmentFiles, siteVariables } from "./pages.ts";
import { loadChecks } from "./registry.ts";

export const OUTPUT_DIRECTORY = "docs-site";
const CHECK_FLAG = "--check";
const USAGE = `usage: node scripts/site/build.ts [${CHECK_FLAG}]; ${CHECK_FLAG} builds into a temporary folder, runs every gate and writes nothing to ${OUTPUT_DIRECTORY}/`;
const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const MS_PER_SECOND = 1000;
const COUNT_LABELS = ["skills", "agents", "commands", "hooks", "checks"];

export const readTree = (directory: string, folder = ""): SiteFiles => {
  assert(existsSync(directory), `the site folder ${directory} must exist to be read, got none; build it first.`);
  assert(!folder.startsWith("/"), `a sub folder is relative to the site folder, got ${folder}; drop the leading slash.`);
  const files: SiteFiles = new Map();
  for (const entry of readdirSync(join(directory, folder), { withFileTypes: true })) {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) for (const [name, text] of readTree(directory, path)) files.set(name, text);
    else files.set(path, readFileSync(join(directory, path), "utf8"));
  }
  return files;
};

export const buildSite = async (root: string, outDirectory: string, checks: CheckEntry[]) => {
  assert(existsSync(root), `the repository root ${root} must exist, got none; pass the repository root.`);
  assert(checks.length > 0, `the site needs registry rows for the checks page, got none; pass the registry.`);
  const data = await collectSiteData(root);
  const pages = buildPages(root, data, checks);
  rmSync(outDirectory, { recursive: true, force: true });
  for (const page of pages) {
    mkdirSync(dirname(join(outDirectory, page.path)), { recursive: true });
    writeFileSync(join(outDirectory, page.path), layout(page, NAVIGATION));
  }
  const sources: Sources = Object.fromEntries(pages.map(({ path, source }) => [path, source]));
  const variables = siteVariables(data, checks);
  const counts = COUNT_LABELS.map((label): [string, number] => [label, variables[label as keyof typeof variables]]);
  const fragments = fragmentFiles(root).map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));
  const files = readTree(outDirectory);
  return { files, problems: siteProblems({ root, files, sources, data, counts, fragments }) };
};

export const main = async (argv: string[], root: string, loader: (root: string) => Promise<CheckEntry[]> = loadChecks) => {
  assert(Array.isArray(argv), `the arguments are a list, got ${typeof argv}; pass process.argv.slice(2).`);
  assert(root !== "", `the build needs the repository root, got an empty path; pass the working directory.`);
  const unknown = argv.filter((argument) => argument !== CHECK_FLAG);
  if (unknown.length > 0) {
    console.error(`unknown argument ${unknown[0]}. ${USAGE}`);
    return EXIT_USAGE;
  }
  const checkOnly = argv.includes(CHECK_FLAG);
  const outDirectory = checkOnly ? mkdtempSync(join(tmpdir(), "site-check-")) : join(root, OUTPUT_DIRECTORY);
  try {
    const started = performance.now();
    const { files, problems } = await buildSite(root, outDirectory, await loader(root));
    for (const line of siteReport(files)) console.log(line);
    console.log(`built in ${((performance.now() - started) / MS_PER_SECOND).toFixed(2)} s${checkOnly ? " (check only, nothing written to " + OUTPUT_DIRECTORY + "/)" : ` into ${OUTPUT_DIRECTORY}/`}`);
    for (const problem of problems) console.error(`  ERROR ${problem}`);
    if (problems.length > 0) {
      console.error(`\n${problems.length} site problem(s) must not reach main; fix them before merge.`);
      return EXIT_PROBLEMS;
    }
    return EXIT_OK;
  } catch (error) {
    console.error(`site build failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_PROBLEMS;
  } finally {
    if (checkOnly) rmSync(outDirectory, { recursive: true, force: true });
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) process.exitCode = await main(process.argv.slice(2), process.cwd());
