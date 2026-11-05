#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { git, planCleanup, requireIdentity } from "./slice-git.mjs";

const EXIT_DONE = 0;
const EXIT_USAGE = 2;
const EXIT_FAILURE = 4;
const JSON_INDENT = 2;
const USAGE = "usage: slice-cleanup.mjs --ticket <id> --actor <name> [--repo <dir>] [--dry-run]";

/**
 * @param {string[]} argv
 * @returns {{ ticket: string, actor: string, repo: string, dryRun: boolean }}
 */
const parseOptions = (argv) => { // zanity: ignore[assertion-density] -- thin-wrapper: parseArgs rejects unknown flags and requireIdentity asserts the ticket and actor formats
  const { values } = parseArgs({ args: argv, options: { ticket: { type: "string" }, actor: { type: "string" }, repo: { type: "string" }, "dry-run": { type: "boolean" } } });
  const ticket = values.ticket ?? "";
  const actor = values.actor ?? "";
  requireIdentity(ticket, actor);
  return { ticket, actor, repo: resolve(values.repo ?? process.cwd()), dryRun: values["dry-run"] === true };
};

/**
 * @param {string[]} argv
 * @returns {number}
 */
const main = (argv) => { // zanity: ignore[assertion-density] -- entry-point: parseOptions asserts every option and the cleanup plan decides what is removed
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    console.error(`slice-cleanup: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    const { repo, ticket, actor, dryRun } = options;
    const plan = planCleanup({ repo, ticket, actor });
    if (!dryRun) {
      for (const { branch, tree } of plan.removed) {
        if (tree !== null) git(repo, ["worktree", "remove", "--force", tree]);
        git(repo, ["worktree", "prune"]);
        git(repo, ["branch", "-D", branch]);
      }
    }
    console.log(JSON.stringify({ dryRun, ...plan }, null, JSON_INDENT));
    return EXIT_DONE;
  } catch (error) {
    console.error(`slice-cleanup: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILURE;
  }
};

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(realpathSync(entryPoint)).href) process.exitCode = main(process.argv.slice(2));
