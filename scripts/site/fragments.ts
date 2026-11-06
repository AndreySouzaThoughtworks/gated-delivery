import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { callout, checkCard, inlineCode, table, terminal } from "./html.ts";
import type { CheckEntry } from "./html.ts";

export const FRAGMENTS_DIRECTORY = "docs-site-src";
export const DEMOS_DIRECTORY = `${FRAGMENTS_DIRECTORY}/demos`;
export const MISTAKES_FILE = "docs/mistakes-to-rules.md";

const VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g;
const CALLOUT = /<x-callout>([\s\S]*?)<\/x-callout>/g;
const TERMINAL = /<x-terminal title="([^"]+)">([\s\S]*?)<\/x-terminal>/g;
const DEMO = /<x-demo name="([\w-]+)"\s*\/>/g;
const MISTAKE = /<x-mistake match="([^"]+)"\s*\/>/g;
const CHECK = /<x-check number="(\d+)"\s*\/>/g;
const TABLE_CELL_SPLIT = /\s*\|\s*/;
const TABLE_ROW = /^\|(.+)\|\s*$/;
const MISTAKE_COLUMNS = ["Mistake", "Category", "Rule"];
const DEMO_TIMEOUT_MS = 10000;
const PROMPT = "$ ";
const FIRST_COLUMNS = 3;

export type Demo = { script: string; args: string[] };
export type FragmentContext = { root: string; file: string; variables: Record<string, number | string>; checks: CheckEntry[] };

export const mistakeRows = (markdown: string) => {
  assert(typeof markdown === "string", `mistake rows come from markdown text, got ${typeof markdown}; pass the file body.`);
  assert(markdown.includes("|"), `${MISTAKES_FILE} must hold a markdown table, got no pipe character; restore the mistakes table.`);
  return markdown
    .split("\n")
    .flatMap((line) => TABLE_ROW.exec(line)?.[1] ?? [])
    .map((row) => row.split(TABLE_CELL_SPLIT).map((cell) => cell.trim()).filter((cell) => cell !== ""))
    .filter((cells) => cells.length >= MISTAKE_COLUMNS.length);
};

export const demoOutput = (root: string, name: string) => {
  const folder = join(root, DEMOS_DIRECTORY, name);
  assert(existsSync(join(folder, "demo.json")), `${DEMOS_DIRECTORY}/${name}/demo.json is missing, so the demo "${name}" cannot run. Fix: add demo.json with a script and its arguments.`);
  const demo: Demo = JSON.parse(readFileSync(join(folder, "demo.json"), "utf8"));
  assert(typeof demo.script === "string" && Array.isArray(demo.args), `${DEMOS_DIRECTORY}/${name}/demo.json must hold a script and an args list, got ${JSON.stringify(demo)}; add both.`);
  const run = spawnSync(process.execPath, [join(root, demo.script), ...demo.args], { cwd: folder, encoding: "utf8", timeout: DEMO_TIMEOUT_MS });
  const scriptName = demo.script.split("/").at(-1);
  const command = `${PROMPT}node ${scriptName} ${demo.args.join(" ")}`.trimEnd();
  return `${command}\n${`${run.stdout}${run.stderr}`.trimEnd()}\n(exit ${run.status})`;
};

export const expandVariable = (context: FragmentContext) => (_match: string, name: string) => {
  assert(name !== "", `${context.file} uses an empty variable {{}}; name a site variable.`);
  const value = context.variables[name];
  assert(value !== undefined, `${context.file} uses {{${name}}}, which is not a site variable. Fix: use one of ${Object.keys(context.variables).join(", ")}.`);
  return String(value);
};

const expandMistake = (context: FragmentContext) => (_match: string, fragment: string) => {
  assert(fragment.trim() !== "", `${context.file} has an x-mistake with a blank match; copy a phrase from a real row.`);
  const rows = mistakeRows(readFileSync(join(context.root, MISTAKES_FILE), "utf8"));
  const row = rows.find((cells) => cells[0].includes(fragment));
  assert(row, `${context.file} quotes a mistake that matches "${fragment}", but ${MISTAKES_FILE} has no such row. Fix: copy a phrase from the first column of a real row.`);
  return table(MISTAKE_COLUMNS, [row.slice(0, FIRST_COLUMNS).map(inlineCode)]);
};

const expandCheck = (context: FragmentContext) => (_match: string, digits: string) => {
  assert(Number(digits) > 0, `${context.file} shows check ${digits}, but check numbers start at 1; use a registry number.`);
  const check = context.checks.find(({ number }) => number === Number(digits));
  assert(check, `${context.file} shows check ${digits}, but the registry has no such check. Fix: use a number from the registry.`);
  return checkCard(check);
};

export const renderFragment = (text: string, context: FragmentContext) => {
  assert(typeof text === "string", `a fragment is text, got ${typeof text}; pass the file body.`);
  assert(context.file !== "", `a fragment needs a file name for its messages, got an empty one; pass its path.`);
  return text
    .replace(TERMINAL, (_match, title: string, body: string) => terminal(title, body.replace(/^\n/, "")))
    .replace(DEMO, (_match, name: string) => terminal(`Real output of ${name}`, demoOutput(context.root, name)))
    .replace(MISTAKE, expandMistake(context))
    .replace(CHECK, expandCheck(context))
    .replace(CALLOUT, (_match, inner: string) => callout(inner))
    .replace(VARIABLE, expandVariable(context));
};

