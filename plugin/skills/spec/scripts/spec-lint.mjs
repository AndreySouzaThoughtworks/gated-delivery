#!/usr/bin/env node
// Structural lint for a spec written by /spec (plugin/skills/spec/templates/change.md).
// Usage: node <skill base directory>/scripts/spec-lint.mjs <spec.md>...  Exits 1 and prints one line per problem.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TEMPLATE_SECTIONS = [
  "Summary",
  "Relevant files",
  "Red flags",
  "Architecture sketch",
  "Domain model",
  "Acceptance criteria",
  "Interface",
  "Security",
  "Open decisions",
  "Rollout",
  "Edges",
  "Done-when",
  "Outcome",
];
export const OPTIONAL_SECTIONS = ["Architecture sketch", "Outcome"];
export const STATUSES = ["Draft", "Ready", "Shipped"];
export const EXPOSURES = ["complete", "unwired", "flagged"];
export const LANE_FIELDS = ["Depends on", "Write surface", "Shared interface", "Verify needs"];
export const VERIFY_NEEDS = ["isolated", "exclusive"];
export const CROSS_REPO_TAG = "cross-repo / manual verification";
export const AC_TAGS = ["in-repo / unit test", "in-repo / integration test", CROSS_REPO_TAG];
export const NO_CONTRADICTIONS_LINE = "No contradictions detected between the inspected surfaces.";
export const PLACEHOLDERS = [
  "PROJ-XXX",
  "YYYY-MM-DD",
  "AC[N]",
  "### Slice N",
  "### Slice <n>",
  "docs / tests / code / config / history",
  "(none, or",
  "(single slice, or the ordered sequence)",
  "Type sketches go here",
  "the executor should choose",
];
const ANGLE_PLACEHOLDER = /(?<![\w`])<[A-Za-z][^<>\n`]*>/;
const VAGUE_REMOVAL = /agreed period|once stable|everyone is happy|\btbd\b/i;
const UNOWNED = /^(unassigned|tbd|n\/a|none|(see )?(the )?open decision)/i;
const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AC_LINE = /^- \[[ xX]\] \*\*AC\[(\d+)\](?: — `([^`]+)`)?:\*\* (.*)$/;
const GIVEN_WHEN_THEN = /\bgiven\b.+\bwhen\b.+\bthen\b/i;
const SLICE_HEADING = /^### Slice (\d+) — (.+?) — exposure: (\S+)\s*$/;
const FLAG_LINE = /^Flag[^:\n]*:\s*(.+?)\s+—\s+default\s+(on|off)\s+—\s+removed when\s+(.+)$/m;
const AC_REFERENCE = /AC\[?(\d+)\]?(?:\s*[–-]\s*(?:AC\[?)?(\d+)\]?)?/g;
const WAVE_ROW = /^\|\s*(\d+)\s*\|([^|]*)\|/gm;
const FRONTMATTER_BLOCK = /^---\n([\s\S]*?)\n---\n/;
const FENCE = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;
/**
 * @typedef {{ title: string, line: string, body: string }} HeadingPart
 * @typedef {HeadingPart & { number: number, acs: number[], exposure: string, matched: boolean, lanes: Record<string, string | undefined>, dependsOn: number[] }} Slice
 * @typedef {{ line: string, id: number, tag: string | undefined, text: string, matched: boolean }} Criterion
 * @typedef {{ frontmatter: Record<string, string>, body: string, prose: string, sections: HeadingPart[], bodies: Record<string, string>, slices: Slice[], criteria: Criterion[], heading: string | undefined }} Spec
 */

const MAX_EXPANDED_IDS = 1000;
const EXIT_PROBLEMS = 1;

/**
 * @param {string} text
 * @returns {number[]}
 */
const idsIn = (text) => { // zanity: ignore[assertion-density] -- multi-caller-helper: used by slice parsing and the AC coverage rule, and the range cap is the only way a regex-matched number list can go wrong
  /** @type {number[]} */
  const ids = [];
  for (const [, from, to] of text.matchAll(AC_REFERENCE)) {
    for (let id = Number(from); id <= Number(to ?? from) && ids.length <= MAX_EXPANDED_IDS; id += 1) ids.push(id);
  }
  assert(ids.length <= MAX_EXPANDED_IDS, `an AC range must not expand to more than ${MAX_EXPANDED_IDS} numbers, got ${ids.length} from ${JSON.stringify(text.slice(0, 80))}; write a smaller range`);
  return ids;
};

/**
 * @param {string} text
 * @param {number} level
 * @returns {HeadingPart[]}
 */
const splitByHeading = (text, level) => { // zanity: ignore[assertion-density] -- multi-caller-helper: four callers pass literal levels and prose strings, so the nested-heading check is its only input-dependent invariant
  const hashes = "#".repeat(level);
  const marks = [...text.matchAll(new RegExp(`^${hashes} (.+)$`, "gm"))];
  const parts = marks.map((mark, i) => ({
    title: mark[1].trim(),
    line: mark[0],
    body: text.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? text.length).trim(),
  }));
  assert(parts.every((p) => !new RegExp(`^${hashes} `, "m").test(p.body)), `a ${hashes} part must not contain another ${hashes} heading, got one inside ${JSON.stringify(parts.find((p) => new RegExp(`^${hashes} `, "m").test(p.body))?.title)}`);
  return parts;
};

/**
 * @param {string} raw
 * @param {RegExp} [blockPattern]
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export const splitFrontmatter = (raw, blockPattern = FRONTMATTER_BLOCK) => {
  assert(typeof raw === "string", `a spec must be text, got ${typeof raw}`);
  const block = raw.match(blockPattern);
  assert(block === null || block.index === 0, `the frontmatter block must start at the first character, got offset ${block?.index}`);
  /** @type {Record<string, string>} */
  const frontmatter = {};
  for (const line of (block?.[1] ?? "").split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const body = raw.slice(block?.[0].length ?? 0);
  return { frontmatter, body };
};

/**
 * @param {string} raw
 * @returns {Spec}
 */
export const parseSpec = (raw) => { // zanity: ignore[assertion-density] -- exported-and-tested: the text-type check is its only input precondition, and everything else it builds from the text comes out of split and match calls
  assert(typeof raw === "string", `a spec must be text, got ${typeof raw}`);
  const { frontmatter, body } = splitFrontmatter(raw);
  const prose = body.replace(FENCE, "");
  const sections = splitByHeading(prose, 2);
  const bodies = Object.fromEntries(sections.map((s) => [s.title, s.body]));
  const slices = splitByHeading(bodies.Rollout ?? "", 3).map((s) => {
    const [, number, acs, exposure] = s.line.match(SLICE_HEADING) ?? [];
    const lanes = Object.fromEntries(LANE_FIELDS.map((field) => [field, s.body.match(new RegExp(`^- ${field}:[ \\t]*(.*)$`, "m"))?.[1]?.trim()]));
    const dependsOn = /^none\b/i.test(lanes["Depends on"] ?? "") ? [] : [...(lanes["Depends on"] ?? "").matchAll(/\d+/g)].map((n) => Number(n[0]));
    return { ...s, number: Number(number), acs: idsIn(acs ?? ""), exposure, matched: number !== undefined, lanes, dependsOn };
  });
  const criteria = (bodies["Acceptance criteria"] ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- ["))
    .map((line) => {
      const match = line.match(AC_LINE);
      return { line, id: Number(match?.[1]), tag: match?.[2], text: match?.[3] ?? "", matched: Boolean(match) };
    });
  return { frontmatter, body, prose, sections, bodies, slices, criteria, heading: prose.match(/^# (.+)$/m)?.[1] };
};

/** @type {((spec: Spec) => string[])[]} */
const RULES = [
  (spec) => {
    const { ticket, type, status, created } = spec.frontmatter;
    const problems = [];
    if (!TICKET_ID.test(ticket ?? "")) problems.push(`frontmatter ticket must be a tracker key such as PROJ-123, got ${JSON.stringify(ticket)}; write the ticket id`);
    if (type !== "change") problems.push(`frontmatter type must be change, got ${JSON.stringify(type)}; set "type: change"`);
    if (!STATUSES.includes(status)) problems.push(`frontmatter status must be one of ${STATUSES.join(", ")}, got ${JSON.stringify(status)}; set it`);
    if (!ISO_DATE.test(created ?? "") || Number.isNaN(Date.parse(created))) problems.push(`frontmatter created must be a real YYYY-MM-DD date, got ${JSON.stringify(created)}; write today's date`);
    if (TICKET_ID.test(ticket ?? "") && !spec.heading?.startsWith(`${ticket} `)) problems.push(`the title heading must start with the ticket id ${ticket}, got ${JSON.stringify(spec.heading)}; write "# ${ticket} — <title>"`);
    return problems;
  },
  (spec) => {
    const problems = [];
    const titles = spec.sections.map((s) => s.title);
    for (const required of TEMPLATE_SECTIONS.filter((t) => !OPTIONAL_SECTIONS.includes(t))) {
      if (!titles.includes(required)) problems.push(`section "## ${required}" is missing; add it, writing "N/A — <reason>" when nothing applies`);
    }
    for (const empty of spec.sections.filter((s) => TEMPLATE_SECTIONS.includes(s.title) && s.body.length === 0)) {
      problems.push(`section "## ${empty.title}" is empty; fill it or ${OPTIONAL_SECTIONS.includes(empty.title) ? "remove its heading" : 'write "N/A — <reason>"'}`);
    }
    const known = titles.filter((t) => TEMPLATE_SECTIONS.includes(t));
    const expected = TEMPLATE_SECTIONS.filter((t) => known.includes(t));
    if (known.join("|") !== expected.join("|")) problems.push(`sections must follow the template order ${expected.join(", ")}, got ${known.join(", ")}; reorder them`);
    return problems;
  },
  (spec) => {
    const problems = PLACEHOLDERS.filter((p) => spec.body.includes(p)).map((p) => `placeholder text ${JSON.stringify(p)} is still in the spec; replace it with the real content`);
    const angle = spec.prose.replace(INLINE_CODE, "").match(ANGLE_PLACEHOLDER)?.[0];
    if (angle) problems.push(`template placeholder ${angle} is still in the spec; replace it or put literal code in backticks`);
    return problems;
  },
  (spec) => {
    const problems = [];
    if (spec.criteria.length === 0) problems.push('no acceptance criteria found; write each as "- [ ] **AC[1]:** Given ..., when ..., then ..."');
    for (const bad of spec.criteria.filter((c) => !c.matched)) problems.push(`checklist line is not an AC: ${JSON.stringify(bad.line)}; write "- [ ] **AC[n]:** Given ..., when ..., then ..."`);
    const real = spec.criteria.filter((c) => c.matched);
    for (const ac of real) {
      if (!GIVEN_WHEN_THEN.test(ac.text)) problems.push(`AC[${ac.id}] must read "Given ..., when ..., then ...", got ${JSON.stringify(ac.text)}; rewrite it as an input and expected output`);
      if (ac.tag && !AC_TAGS.includes(ac.tag)) problems.push(`AC[${ac.id}] has tag ${JSON.stringify(ac.tag)}; use one of ${AC_TAGS.join(" | ")}`);
    }
    for (const id of new Set(real.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i))) problems.push(`AC[${id}] is defined twice; give each acceptance criterion its own number`);
    const untagged = real.filter((c) => !c.tag).map((c) => `AC[${c.id}]`);
    if (real.some((c) => c.tag === CROSS_REPO_TAG) && untagged.length > 0) problems.push(`with a ${CROSS_REPO_TAG} AC every AC needs a tag; tag ${untagged.join(", ")}`);
    return problems;
  },
  (spec) => {
    const defined = new Set(spec.criteria.map((c) => c.id));
    const referenced = new Set(idsIn(spec.prose.replace(INLINE_CODE, "")));
    return [...referenced].filter((id) => !defined.has(id)).map((id) => `AC[${id}] is referenced but not defined; fix the number or add the criterion`);
  },
  (spec) => {
    const problems = [];
    if (spec.slices.length === 0) problems.push('Rollout has no slice; add "### Slice 1 — AC1, AC2 — exposure: complete"');
    for (const bad of spec.slices.filter((s) => !s.matched || !EXPOSURES.includes(s.exposure))) {
      problems.push(`Rollout heading ${JSON.stringify(bad.line)} must read "### Slice <n> — <AC list> — exposure: ${EXPOSURES.join(" | ")}"`);
    }
    const numbers = spec.slices.filter((s) => s.matched).map((s) => s.number);
    if (numbers.join(",") !== numbers.map((_, i) => i + 1).join(",")) problems.push(`Rollout slices must be numbered 1, 2, 3 in order, got ${numbers.join(", ")}; renumber them`);
    for (const ac of spec.criteria.filter((c) => c.matched)) {
      const holders = spec.slices.filter((s) => s.acs.includes(ac.id)).map((s) => s.number);
      if (ac.tag !== CROSS_REPO_TAG && holders.length !== 1) problems.push(`in-repo AC[${ac.id}] must be in exactly one Rollout slice, found in ${holders.length === 0 ? "none" : holders.join(", ")}; assign it to one slice`);
      if (ac.tag === CROSS_REPO_TAG && holders.length > 0) problems.push(`cross-repo AC[${ac.id}] must be in no Rollout slice, found in ${holders.join(", ")}; remove it from the slice heading`);
    }
    return problems;
  },
  (spec) => {
    const problems = [];
    for (const slice of spec.slices.filter((s) => s.matched)) {
      for (const field of LANE_FIELDS.filter((f) => !slice.lanes[f])) problems.push(`Slice ${slice.number} lacks "- ${field}: ..."; add it, writing none when it does not apply`);
      const verify = slice.lanes["Verify needs"];
      if (verify && !VERIFY_NEEDS.some((need) => verify.startsWith(need))) problems.push(`Slice ${slice.number} Verify needs must start with ${VERIFY_NEEDS.join(" or ")}, got ${JSON.stringify(verify)}; fix it`);
      const flag = slice.body.match(FLAG_LINE);
      if (slice.exposure === "flagged" && !flag) problems.push(`flagged Slice ${slice.number} must carry "Flag: <name> — default off — removed when <condition>"; add the line`);
      if (flag && VAGUE_REMOVAL.test(flag[3])) problems.push(`Slice ${slice.number} removal condition ${JSON.stringify(flag[3])} is not checkable; name a duration with a threshold or a named event`);
      for (const dependency of slice.dependsOn.filter((d) => d >= slice.number)) problems.push(`Slice ${slice.number} depends on Slice ${dependency}, which does not merge before it; reorder or fix Depends on`);
    }
    return problems;
  },
  (spec) => {
    const waveOf = new Map();
    for (const [, wave, cell] of (spec.bodies.Rollout ?? "").matchAll(WAVE_ROW)) {
      for (const [number] of cell.matchAll(/\d+/g)) waveOf.set(Number(number), [...(waveOf.get(Number(number)) ?? []), Number(wave)]);
    }
    const problems = [];
    for (const slice of spec.slices.filter((s) => s.matched)) {
      const waves = waveOf.get(slice.number) ?? [];
      if (waves.length !== 1) problems.push(`Slice ${slice.number} must appear in exactly one wave-table row, found in ${waves.length}; fix the Wave table`);
      const earliest = Math.max(0, ...slice.dependsOn.map((d) => waveOf.get(d)?.[0] ?? 0)) + 1;
      if (waves.length === 1 && waves[0] !== earliest) problems.push(`Slice ${slice.number} is in wave ${waves[0]} but its dependencies put it in wave ${earliest}; a slice joins the earliest wave after everything it depends on`);
    }
    return problems;
  },
  (spec) => {
    const done = spec.bodies["Done-when"] ?? "";
    const blocks = splitByHeading(done, 3);
    const numbers = blocks.map((b) => b.title.match(/^Slice (\d+)\b/)?.[1]).filter(Boolean).map(Number);
    const expected = spec.slices.filter((s) => s.matched).map((s) => s.number);
    const problems = [];
    if (numbers.join(",") !== expected.join(",")) problems.push(`Done-when must hold one "### Slice <n>" block per Rollout entry in order (${expected.join(", ")}), got ${numbers.join(", ") || "none"}; add or reorder the blocks`);
    if (!blocks.some((b) => b.title === "Per ticket")) problems.push('Done-when lacks the "### Per ticket" block; write its checklist');
    for (const ac of spec.criteria.filter((c) => c.tag === CROSS_REPO_TAG)) {
      const line = done.match(new RegExp(`AC\\[?${ac.id}\\]?\\s*—\\s*evidence:\\s*(.+?)\\s*—\\s*owner:\\s*(.+)$`, "m"));
      if (!line) problems.push(`cross-repo AC[${ac.id}] has no Done-when line "AC${ac.id} — evidence: <what, where> — owner: <person, team or role>"; add it`);
      else if (UNOWNED.test(line[2].trim())) problems.push(`cross-repo AC[${ac.id}] owner is ${JSON.stringify(line[2].trim())}; name the most likely owning person, team or role`);
    }
    return problems;
  },
  (spec) => {
    const domain = spec.bodies["Domain model"] ?? "";
    const classified = /^N\/A — \S/m.test(domain) || /^### (Added|Changed|Renamed|Referenced)/m.test(domain);
    return domain && !classified ? ['Domain model must classify entities under "### Added/Changed/Renamed/Referenced" or say "N/A — <reason>"; add one'] : [];
  },
  (spec) => {
    const redFlags = spec.bodies["Red flags"];
    if (!redFlags) return [];
    const ledger = splitByHeading(redFlags, 3).find((s) => s.title === "Contradictions")?.body;
    if (ledger === undefined) return ['Red flags lacks "### Contradictions"; add the ledger or the line "No contradictions detected between the inspected surfaces."'];
    const rows = ledger.split("\n").filter((l) => l.startsWith("|")).slice(2).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
    const problems = rows.filter((r) => r.length !== 6 || !r[5]).map((r) => `Contradictions row ${JSON.stringify(r[0])} needs six cells with a Disposition; fill the last column`);
    if (rows.length === 0 && !ledger.includes(NO_CONTRADICTIONS_LINE)) problems.push(`Contradictions holds neither a row nor the line ${JSON.stringify(NO_CONTRADICTIONS_LINE)}; an empty ledger reads as skipped`);
    return problems;
  },
  (spec) => {
    const open = /^- \*\*Options:\*\*|needs user input/m.test(spec.bodies["Open decisions"] ?? "");
    return ["Ready", "Shipped"].includes(spec.frontmatter.status) && open ? [`status ${spec.frontmatter.status} but Open decisions still holds an unresolved entry; resolve it or set status: Draft`] : [];
  },
];

/**
 * @param {string} raw
 */
export const lintSpec = (raw) => { // zanity: ignore[assertion-density] -- thin-wrapper: parses with parseSpec, which asserts the text type, then runs the rule list over the result
  const spec = parseSpec(raw);
  const problems = RULES.flatMap((rule) => rule(spec));
  return problems;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    process.stderr.write("usage: node <skill base directory>/scripts/spec-lint.mjs <spec.md>...\n");
    process.exit(EXIT_PROBLEMS);
  }
  let failed = false;
  for (const file of files) {
    /** @type {string[]} */
    let problems;
    try {
      problems = lintSpec(readFileSync(file, "utf8"));
    } catch (error) {
      problems = [error instanceof Error ? error.message : String(error)];
    }
    for (const problem of problems) {
      process.stdout.write(`${file}: ${problem}\n`);
      failed = true;
    }
  }
  process.exit(failed ? EXIT_PROBLEMS : 0);
}
