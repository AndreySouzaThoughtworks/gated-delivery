#!/usr/bin/env node
import assert from "node:assert";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { API } from "typescript/unstable/sync";
import { SOURCE_EXTENSIONS, findAssertSites, instrumentText } from "./assertion-effectiveness/assertion-sites.ts";
import { DEFAULT_TEST_COMMANDS } from "./assertion-effectiveness/default-test-commands.ts";
import type { AssertSite } from "./assertion-effectiveness/assertion-sites.ts";
import { baselineDocument, compareToBaseline, formatReport, judgeSites, parseBaseline, readEvidence } from "./assertion-effectiveness/assertion-verdict.ts";

const PROBE_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "assertion-effectiveness", "assertion-probe.mjs");
const PROBE_FILE_NAME = basename(PROBE_SOURCE);
const PROBE_DIRECTORY = ".assertion-probe";
const LOG_DIRECTORY = "log";
const DEFAULT_BASELINE = "assertion-effectiveness-baseline.json";
const INSTRUMENTED_ROOTS = ["plugin/", "scripts/"];
const TEST_MARKER = ".test.";
const FIXTURE_SEGMENT = "/fixtures/";
const NODE_MODULES = "node_modules";
const NESTED_TEST_ENV = "NODE_TEST_CONTEXT";
const EXIT_NEW_UNPROVEN = 1;
const EXIT_STALE_BASELINE = 1;
const EXIT_TESTS_FAILED = 2;
const OUTPUT_TAIL_LINES = 40;
const MILLISECONDS_PER_SECOND = 1000;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const GIT_IDENTITY = ["-c", "core.hooksPath=/dev/null", "-c", "user.name=assertion-effectiveness", "-c", "user.email=assertion-effectiveness@localhost"];

const run = promisify(execFile);

const trackedFiles = (repo: string) => {
  assert(existsSync(join(repo, ".git")), `${repo} has no .git; pass --repo <root of a git checkout>, since tracked files come from git ls-files`);
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0");
  const files = listed.filter((file) => file && existsSync(join(repo, file)));
  assert(files.length > 0, `${repo} has no tracked files; commit or stage the files to measure`);
  return files;
};

const instrumentCopy = (copy: string, files: string[]) => {
  const targets = files.filter(
    (file) =>
      INSTRUMENTED_ROOTS.some((root) => file.startsWith(root)) &&
      SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension)) &&
      !file.includes(TEST_MARKER) &&
      !file.includes(FIXTURE_SEGMENT) &&
      basename(file) !== PROBE_FILE_NAME,
  );
  assert(targets.length > 0, `none of ${files.length} tracked files is a non-test ${SOURCE_EXTENSIONS.join(" or ")} file under ${INSTRUMENTED_ROOTS.join(" or ")}`);
  const probeDirectory = join(copy, PROBE_DIRECTORY);
  mkdirSync(join(probeDirectory, LOG_DIRECTORY), { recursive: true });
  copyFileSync(PROBE_SOURCE, join(probeDirectory, PROBE_FILE_NAME));
  const tsconfig = join(probeDirectory, "tsconfig.json");
  writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { allowJs: true, noEmit: true }, files: targets.map((file) => join(copy, file)) }));
  const probeUrl = pathToFileURL(join(probeDirectory, PROBE_FILE_NAME)).href;
  const sites: AssertSite[] = [];
  const api = new API({ cwd: copy });
  try {
    const [project] = api.updateSnapshot({ openProject: tsconfig }).getProjects();
    for (const file of targets) {
      const copiedPath = join(copy, file);
      const sourceFile = project.program.getSourceFile(copiedPath)!;
      const fileSites = findAssertSites(sourceFile, file);
      if (fileSites.length > 0) writeFileSync(copiedPath, instrumentText(sourceFile.text, fileSites, probeUrl));
      sites.push(...fileSites);
    }
  } finally {
    api.close();
  }
  assert(sites.length > 0, `no assert call found in ${targets.length} instrumentable files; there is nothing to measure`);
  return sites;
};

const { values } = parseArgs({
  options: {
    repo: { type: "string", default: process.cwd() },
    baseline: { type: "string", default: DEFAULT_BASELINE },
    "update-baseline": { type: "boolean", default: false },
    "test-command": { type: "string", multiple: true, default: DEFAULT_TEST_COMMANDS },
  },
});
const repo = resolve(values.repo);
const baselinePath = resolve(repo, values.baseline);
const started = performance.now();
const files = trackedFiles(repo);
const copy = mkdtempSync(join(tmpdir(), "assertion-effectiveness-"));
const testEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== NESTED_TEST_ENV));
try {
  for (const file of files) {
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    copyFileSync(join(repo, file), join(copy, file));
  }
  if (existsSync(join(repo, NODE_MODULES))) symlinkSync(join(repo, NODE_MODULES), join(copy, NODE_MODULES));
  execFileSync("git", ["init", "-q"], { cwd: copy });
  execFileSync("git", ["add", "-A"], { cwd: copy });
  execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", "copy"], { cwd: copy });
  const sites = instrumentCopy(copy, files);
  console.log(`instrumented ${sites.length} assert sites; running ${values["test-command"].length} test commands`);
  const results = await Promise.all(
    values["test-command"].map(async (command) => {
      try {
        await run("sh", ["-ec", command], { cwd: copy, env: testEnv, maxBuffer: OUTPUT_LIMIT_BYTES });
        return { command, passed: true, output: "" };
      } catch (error) {
        const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
        return { command, passed: false, output: `${stdout}${stderr}`.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n") };
      }
    }),
  );
  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    console.error(failed.map((result) => `tests failed in the instrumented copy: ${result.command}\n${result.output}`).join("\n\n"));
    process.exitCode = EXIT_TESTS_FAILED;
  } else {
    const judged = judgeSites(sites, readEvidence(join(copy, PROBE_DIRECTORY, LOG_DIRECTORY)));
    console.log(formatReport(judged));
    console.log(`took ${Math.round((performance.now() - started) / MILLISECONDS_PER_SECOND)}s`);
    if (values["update-baseline"]) {
      writeFileSync(baselinePath, baselineDocument(judged));
      console.log(`wrote ${values.baseline}`);
    } else {
      const baseline = existsSync(baselinePath) ? parseBaseline(readFileSync(baselinePath, "utf8"), values.baseline) : [];
      const { added, removable } = compareToBaseline(judged, baseline);
      if (removable.length > 0) {
        console.error(`${removable.length} baseline entries are now proven or gone; prune them with \`node scripts/audit/assertion-effectiveness.ts --update-baseline\`:\n${removable.map((finding) => `  ${finding.path} | ${finding.message}  ${finding.condition}`).join("\n")}`);
        process.exitCode = EXIT_STALE_BASELINE;
      }
      if (added.length > 0) {
        console.error(`${added.length} assertions are not proven by any test and are not in ${values.baseline}; add a test that makes each one fail, or remove the assertion:\n${added.map((entry) => `  ${entry.site.path}:${entry.site.line} ${entry.site.functionName}  ${entry.site.condition}`).join("\n")}`);
        process.exitCode = EXIT_NEW_UNPROVEN;
      }
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
