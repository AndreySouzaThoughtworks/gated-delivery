import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { siteMessage } from "./assertion-sites.ts";
import type { AssertSite } from "./assertion-sites.ts";

export const BASELINE_RULE = "unproven-assertion";
const BASELINE_SCHEMA_VERSION = 1;
const BASELINE_IDENTITY_VERSION = 1;
const LOG_SUFFIX = ".log";
const FIELD_SEPARATOR = "\t";
const FAILED = "failed";
const HELD = "held";
const REPEAT_MARK = " #";
const KEY_SEPARATOR = " | ";
const JSON_INDENT = 2;

export type Evidence = Map<string, { evaluations: number; falsified: number }>;
export type Verdict = "proven" | "unproven" | "unevaluated";
export type Judged = { site: AssertSite; evaluations: number; falsified: number; verdict: Verdict; message: string; key: string };
export type BaselineFinding = { path: string; rule: string; message: string; condition: string };

export const readEvidence = (logDirectory: string) => {
  assert(isAbsolute(logDirectory), `readEvidence needs the absolute log directory, got ${JSON.stringify(logDirectory)}`);
  const logFiles = readdirSync(logDirectory).filter((name) => name.endsWith(LOG_SUFFIX));
  assert(logFiles.every((name) => /^\d+\.log$/.test(name)), `${logDirectory} holds ${logFiles.find((name) => !/^\d+\.log$/.test(name))}, which the probe never writes; its files are named <pid>${LOG_SUFFIX}`);
  const evidence: Evidence = new Map();
  for (const file of logFiles) {
    for (const record of readFileSync(join(logDirectory, file), "utf8").split("\n").filter(Boolean)) {
      const [id, outcome, ...extra] = record.split(FIELD_SEPARATOR);
      assert(extra.length === 0 && (outcome === HELD || outcome === FAILED), `${file} holds a malformed record ${JSON.stringify(record)}; expected <site id>${JSON.stringify(FIELD_SEPARATOR)}${HELD} or ${FAILED}`);
      const tally = evidence.get(id) ?? { evaluations: 0, falsified: 0 };
      tally.evaluations += 1;
      tally.falsified += outcome === FAILED ? 1 : 0;
      evidence.set(id, tally);
    }
  }
  return evidence;
};

export const judgeSites = (sites: AssertSite[], evidence: Evidence) => {
  assert(sites.length > 0, `judgeSites needs the instrumented sites, got ${sites.length}`);
  const unknown = [...evidence.keys()].filter((id) => !sites.some((site) => site.id === id));
  assert(unknown.length === 0, `the log names sites that were never instrumented: ${unknown.slice(0, 3).join(", ")}; the log directory is stale`);
  const seen = new Map<string, number>();
  return sites.map((site): Judged => {
    const { evaluations, falsified } = evidence.get(site.id) ?? { evaluations: 0, falsified: 0 };
    const message = siteMessage(site);
    const occurrence = (seen.get(`${site.path}${KEY_SEPARATOR}${message}`) ?? 0) + 1;
    seen.set(`${site.path}${KEY_SEPARATOR}${message}`, occurrence);
    const verdict = falsified > 0 ? "proven" : evaluations > 0 ? "unproven" : "unevaluated";
    const repeatedMessage = occurrence > 1 ? `${message}${REPEAT_MARK}${occurrence}` : message;
    return { site, evaluations, falsified, verdict, message: repeatedMessage, key: `${site.path}${KEY_SEPARATOR}${repeatedMessage}` };
  });
};

export const compareToBaseline = (judged: Judged[], baseline: BaselineFinding[]) => {
  const baselineKeys = baseline.map((finding) => `${finding.path}${KEY_SEPARATOR}${finding.message}`);
  assert(new Set(baselineKeys).size === baseline.length, `the baseline lists one site twice among its ${baseline.length} entries; each key must appear once`);
  const unprovenNow = judged.filter((entry) => entry.verdict !== "proven");
  const current = new Set(unprovenNow.map((entry) => entry.key));
  assert(current.size === unprovenNow.length, `two unproven sites share a baseline key; ${unprovenNow.length} sites gave ${current.size} keys`);
  return {
    added: unprovenNow.filter((entry) => !baselineKeys.includes(entry.key)),
    removable: baseline.filter((_finding, index) => !current.has(baselineKeys[index])),
  };
};

export const baselineDocument = (judged: Judged[]) => {
  const unproven = judged.filter((entry) => entry.verdict !== "proven");
  const incomplete = unproven.find((entry) => entry.site.condition === "" || entry.message === "");
  assert(incomplete === undefined, `${incomplete?.site.id} has no condition or message, so its baseline entry would not work as a to-do item`);
  assert(new Set(unproven.map((entry) => entry.key)).size === unproven.length, `two of the ${unproven.length} unproven sites share a key, so the baseline could not tell them apart`);
  const findings = unproven.map((entry): BaselineFinding => ({ path: entry.site.path, rule: BASELINE_RULE, message: entry.message, condition: entry.site.condition }));
  return `${JSON.stringify({ schema_version: BASELINE_SCHEMA_VERSION, identity_version: BASELINE_IDENTITY_VERSION, findings }, null, JSON_INDENT)}\n`;
};

export const parseBaseline = (text: string, source: string) => {
  assert(text.trim() !== "", `${source} is empty; delete it or regenerate it with --update-baseline`);
  const document = JSON.parse(text) as { findings?: BaselineFinding[] };
  assert(Array.isArray(document.findings) && document.findings.every((finding) => finding.rule === BASELINE_RULE && typeof finding.path === "string" && typeof finding.message === "string"), `${source} must hold a findings array of ${BASELINE_RULE} entries with path and message`);
  return document.findings;
};

export const formatReport = (judged: Judged[]) => {
  const impossible = judged.find((entry) => entry.falsified > entry.evaluations);
  assert(impossible === undefined, `${impossible?.site.id} was false ${impossible?.falsified} times in ${impossible?.evaluations} evaluations; the log is corrupt`);
  const unproven = judged.filter((entry) => entry.verdict !== "proven");
  const neverFalse = unproven.filter((entry) => entry.verdict === "unproven");
  const neverEvaluated = unproven.filter((entry) => entry.verdict === "unevaluated");
  assert(neverFalse.length + neverEvaluated.length === unproven.length, `a verdict outside proven, unproven and unevaluated was found among ${judged.length} sites`);
  const byFile = new Map<string, Judged[]>();
  for (const entry of unproven) byFile.set(entry.site.path, [...(byFile.get(entry.site.path) ?? []), entry]);
  const lines = [...byFile].flatMap(([path, entries]) => [
    path,
    ...entries.map((entry) => `  ${entry.verdict === "unproven" ? "(b) never false" : "(c) never evaluated"} ${entry.site.functionName}:${entry.site.line}  ${entry.site.condition}  [${entry.evaluations} evaluations]`),
  ]);
  return [...lines, `sites ${judged.length}: (a) proven ${judged.length - unproven.length}, (b) unproven ${neverFalse.length}, (c) unevaluated ${neverEvaluated.length}`].join("\n");
};
