import { test } from "node:test";
import assert from "node:assert/strict";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";
import { NODE_END_OF_LIFE, nodeFloorProblems } from "./node-floor.ts";

const FLOOR = ">=22.18";
const STATING_README = { file: "README.md", text: "The plugin hooks run on Node 22 or later." };
const DAY_BEFORE_END_OF_LIFE = new Date("2027-04-29");
const END_OF_LIFE_DAY = new Date("2027-04-30");

test("a floor in security support with a matching README passes", () => {
  assert.deepEqual(nodeFloorProblems({ engines: FLOOR, documents: [STATING_README], today: DAY_BEFORE_END_OF_LIFE }), []);
});

test("a floor release that reached end of life on the injected date is reported with file, rule and fix", () => {
  const [problem] = nodeFloorProblems({ engines: FLOOR, documents: [STATING_README], today: END_OF_LIFE_DAY });
  assert.match(problem, /^package\.json sets the Node floor to 22, which reached end of life on 2027-04-30\. Hint: raise engines\.node/);
});

test("a floor missing from the end-of-life table is reported", () => {
  const [problem] = nodeFloorProblems({ engines: ">=18", documents: [], today: DAY_BEFORE_END_OF_LIFE });
  assert.match(problem, /floor to 18, which NODE_END_OF_LIFE .* does not list/);
});

test("engines that name no release are reported", () => {
  assert.match(nodeFloorProblems({ engines: undefined, documents: [], today: END_OF_LIFE_DAY })[0], /engines\.node is undefined/);
});

test("a document that states another floor is reported, dev-tooling versions of the same release are not", () => {
  const documents = [
    { file: "README.md", text: "Hooks run on Node 18 or later. Dev tooling needs Node 22.18 or newer." },
    { file: "docs/a.md", text: "Run Node 24 or later." },
  ];
  const problems = nodeFloorProblems({ engines: FLOOR, documents, today: DAY_BEFORE_END_OF_LIFE });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0], /^README\.md says "Node 18 or later" but package\.json sets the floor to Node 22\. Hint:/);
  assert.match(problems[1], /^docs\/a\.md says "Node 24 or later"/);
});

test("a README with no floor statement is reported", () => {
  const [problem] = nodeFloorProblems({ engines: FLOOR, documents: [{ file: "README.md", text: "No version here." }], today: DAY_BEFORE_END_OF_LIFE });
  assert.match(problem, /^README\.md states no Node floor\. Hint:/);
});

test("an invalid clock is refused instead of silently passing", () => {
  assert.throws(() => nodeFloorProblems({ engines: FLOOR, documents: [], today: new Date("not a date") }), /today must be a valid date/);
});

test("documents that are not a list are refused", () => {
  assert.throws(() => nodeFloorProblems({ engines: FLOOR, documents: undefined as never, today: DAY_BEFORE_END_OF_LIFE }), /documents must be a list/);
});

test("every table date is an ISO day", () => {
  for (const [release, day] of Object.entries(NODE_END_OF_LIFE)) assert.match(day, /^\d{4}-\d{2}-\d{2}$/, `release ${release}`);
});

test("the guard fails a repo whose README states another floor than package.json", () => {
  const dir = validRepo();
  write(dir, "package.json", JSON.stringify({ engines: { node: FLOOR } }));
  write(dir, "README.md", "The plugin — 1 skills, 1 agents, 1 hooks.\n\nHooks run on Node 18 or later.\n\n[MIT](LICENSE)\n");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md says "Node 18 or later"/);
});
