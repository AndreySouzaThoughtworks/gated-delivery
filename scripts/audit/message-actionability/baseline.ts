import assert from "node:assert";
import { actionabilityProblems } from "../../../plugin/scripts/run-cli.test.support.mjs";
import { extractMessages } from "./extract-messages.ts";

export const BASELINE_FILE = "message-actionability-baseline.json";
export const BASELINE_RULE = "not-actionable";
export const UPDATE_COMMAND = "node scripts/audit/message-actionability.ts --update-baseline";
const SCHEMA_VERSION = 1;
const IDENTITY_VERSION = 1;
const JSON_INDENT = 2;
const KEY_SEPARATOR = " | ";

export type Source = { path: string; text: string };
export type Finding = { path: string; rule: string; message: string };

const countKeys = (findings: Finding[]) => {
  assert(Array.isArray(findings), `the \`findings\` must be a list, got ${typeof findings}; pass { path, rule, message } entries.`);
  assert(findings.every(({ path, message }) => typeof path === "string" && typeof message === "string"), `every finding must hold a path and a message, got ${JSON.stringify(findings.find(({ path, message }) => typeof path !== "string" || typeof message !== "string"))}; fix the entry.`);
  const counts = new Map<string, number>();
  for (const { path, message } of findings) {
    const key = `${path}${KEY_SEPARATOR}${message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

export const countMessages = (sources: Source[]) => {
  assert(Array.isArray(sources), `the \`sources\` must be a list, got ${typeof sources}; pass { path, text } entries.`);
  assert(sources.every(({ text }) => typeof text === "string"), `every source must hold text, got ${JSON.stringify(sources.find(({ text }) => typeof text !== "string"))}; pass the file content.`);
  return sources.reduce((total, { text }) => total + extractMessages(text).length, 0);
};

export const findingsOf = (sources: Source[]): Finding[] => {
  assert(Array.isArray(sources), `the \`sources\` must be a list, got ${typeof sources}; pass { path, text } entries.`);
  assert(sources.every(({ text }) => typeof text === "string"), `every source must hold text, got ${JSON.stringify(sources.find(({ text }) => typeof text !== "string"))}; pass the file content.`);
  return sources.flatMap(({ path, text }) =>
    extractMessages(text)
      .filter((message) => actionabilityProblems(message.text).length > 0)
      .map((message) => ({ path, rule: BASELINE_RULE, message: message.text })),
  );
};

export const baselineText = (findings: Finding[]) => {
  assert(Array.isArray(findings), `the \`findings\` must be a list, got ${typeof findings}; use findingsOf to make them.`);
  assert(findings.every(({ rule }) => rule === BASELINE_RULE), `every finding must carry the rule "${BASELINE_RULE}", got ${JSON.stringify(findings.find(({ rule }) => rule !== BASELINE_RULE))}; use findingsOf to make them.`);
  return `${JSON.stringify({ schema_version: SCHEMA_VERSION, identity_version: IDENTITY_VERSION, findings }, null, JSON_INDENT)}\n`;
};

export const parseMessageBaseline = (text: string, source: string): Finding[] => {
  const document = JSON.parse(text) as { findings?: Finding[] };
  assert(Array.isArray(document.findings), `${source} must hold a findings list, got ${typeof document.findings}; run ${UPDATE_COMMAND}.`);
  assert(document.findings.every((finding) => finding.rule === BASELINE_RULE && typeof finding.path === "string" && typeof finding.message === "string"), `${source} must hold only "${BASELINE_RULE}" findings with a path and a message; run ${UPDATE_COMMAND}.`);
  return document.findings;
};

export const excessFindings = (findings: Finding[], reference: Finding[]) => {
  assert(Array.isArray(findings), `the \`findings\` must be a list, got ${typeof findings}; pass { path, rule, message } entries.`);
  assert(findings.every(({ path, message }) => typeof path === "string" && typeof message === "string"), `every finding must hold a path and a message, got ${JSON.stringify(findings.find(({ path, message }) => typeof path !== "string" || typeof message !== "string"))}; fix the entry.`);
  const limits = countKeys(reference);
  const seen = new Map<string, number>();
  return findings.filter(({ path, message }) => {
    const key = `${path}${KEY_SEPARATOR}${message}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return occurrence > (limits.get(key) ?? 0);
  });
};

export const compareToMessageBaseline = (findings: Finding[], baseline: Finding[]) => {
  assert(Array.isArray(findings), `the \`findings\` must be a list, got ${typeof findings}; pass { path, rule, message } entries.`);
  assert(Array.isArray(baseline), `the \`baseline\` must be a list, got ${typeof baseline}; pass the parsed baseline entries.`);
  return { added: excessFindings(findings, baseline), removable: excessFindings(baseline, findings) };
};

export const growthProblem = (headCount: number, baseCount: number, baseRef: string) => {
  assert(Number.isInteger(headCount) && Number.isInteger(baseCount), `both \`headCount\` and \`baseCount\` must be integers, got ${headCount} and ${baseCount}; pass entry counts.`);
  assert(baseRef !== "", `the \`baseRef\` must name a ref, got ${JSON.stringify(baseRef)}; pass one such as origin/main.`);
  return headCount > baseCount ? `${BASELINE_FILE} must not grow, but went from ${baseCount} to ${headCount} entries against ${baseRef}; rewrite the new messages instead.` : null;
};
