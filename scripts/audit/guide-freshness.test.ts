import { test } from "node:test";
import assert from "node:assert/strict";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";
import { GUIDE_FILE, guideProblems } from "./guide-freshness.ts";
import { MAX_SENTENCE_WORDS } from "./asd-style.ts";

const INVENTORY = { skills: ["alpha", "beta"], agents: ["bot"], commands: ["commit"], hooks: 2 };
const LINKING_README = "Read the [guide](docs/guide.html).";
const FRESH_GUIDE = "<p>It ships 2 skills, 1 agents, 1 commands and 2 hooks: alpha, beta, bot and commit.</p>";
const longSentence = `${Array.from({ length: MAX_SENTENCE_WORDS + 1 }, (_, index) => `word${index}`).join(" ")}.`;

test("a guide that names everything, counts truly and is linked passes", () => {
  assert.deepEqual(guideProblems({ guide: FRESH_GUIDE, readme: LINKING_README, inventory: INVENTORY }), []);
});

test("a missing guide is reported with the file and the fix", () => {
  const [problem] = guideProblems({ guide: null, readme: LINKING_README, inventory: INVENTORY });
  assert.equal(problem, "docs/guide.html is missing. Hint: restore the guide, since the README links it.");
});

test("a README without the link is reported", () => {
  const [problem] = guideProblems({ guide: FRESH_GUIDE, readme: "No link here.", inventory: INVENTORY });
  assert.equal(problem, "README.md does not link docs/guide.html. Hint: add a link to the guide in the README.");
});

test("a skill, agent or command the guide does not name is reported once each", () => {
  const problems = guideProblems({ guide: "<p>It ships 2 skills: alpha.</p>", readme: LINKING_README, inventory: INVENTORY });
  assert.deepEqual(problems, [
    'docs/guide.html does not name the skill "beta". Hint: add it to the guide.',
    'docs/guide.html does not name the agent "bot". Hint: add it to the guide.',
    'docs/guide.html does not name the command "commit". Hint: add it to the guide.',
  ]);
});

test("a count that differs from the real one is reported for each kind", () => {
  const guide = "<p>alpha beta bot commit: 3 skills, 5 agents, 4 commands, 1 hooks.</p>";
  const problems = guideProblems({ guide, readme: LINKING_README, inventory: INVENTORY });
  assert.deepEqual(problems, [
    'docs/guide.html says "3 skills", which is not the real count of 2. Hint: change it to "2 skills".',
    'docs/guide.html says "5 agents", which is not the real count of 1. Hint: change it to "1 agents".',
    'docs/guide.html says "4 commands", which is not the real count of 1. Hint: change it to "1 commands".',
    'docs/guide.html says "1 hooks", which is not the real count of 2. Hint: change it to "2 hooks".',
  ]);
});

test("a count inside a quoted output block is not a statement, one in prose is", () => {
  const quoted = `<pre><code>README.md says "5 skills"</code></pre>${FRESH_GUIDE}`;
  assert.deepEqual(guideProblems({ guide: quoted, readme: LINKING_README, inventory: INVENTORY }), []);
  assert.equal(guideProblems({ guide: `${quoted}<p>It has 5 skills.</p>`, readme: LINKING_README, inventory: INVENTORY }).length, 1);
});

test("a README that is not text is refused", () => {
  assert.throws(() => guideProblems({ guide: FRESH_GUIDE, readme: undefined as never, inventory: INVENTORY }), /README must be text/);
});

test("an inventory that is not a list of skills is refused", () => {
  assert.throws(() => guideProblems({ guide: FRESH_GUIDE, readme: LINKING_README, inventory: {} as never }), /inventory must list skills/);
});

const repoWithGuardScripts = () => {
  const dir = validRepo();
  assert(dir.length > 0, `the fixture needs a directory, got ${dir}`);
  write(dir, "scripts/audit/asd-style.ts", "");
  write(dir, "scripts/audit/guide-freshness.ts", "");
  write(dir, "README.md", "The plugin — 1 skills, 1 agents, 1 hooks. Read the [guide](docs/guide.html).\n\n[MIT](LICENSE)\n");
  write(dir, GUIDE_FILE, "<p>It ships 1 skills, 1 agents and 1 hooks: alpha and bot.</p>");
  assert(dir.startsWith("/") || dir.includes(":"), `the fixture must be an absolute path, got ${dir}`);
  return dir;
};

test("the guard accepts a repo with a fresh guide and short sentences", () => {
  const { code, out } = runGuard(repoWithGuardScripts());
  assert.equal(code, 0, out);
});

test("the guard rejects a repo whose guide is missing", () => {
  const dir = repoWithGuardScripts();
  write(dir, GUIDE_FILE, "");
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /docs\/guide\.html does not name the skill "alpha"\. Hint:/);
});

test("the guard rejects a README that holds mostly long sentences", () => {
  const dir = repoWithGuardScripts();
  write(dir, "README.md", `The plugin — 1 skills, 1 agents, 1 hooks. Read the [guide](docs/guide.html).\n\n${longSentence}\n\n[MIT](LICENSE)\n`);
  const { code, out } = runGuard(dir);
  assert.equal(code, 1, out);
  assert.match(out, /README\.md has 75% of its 4 sentences within 20 words, below the 80% ASD-STE100 rule\. Hint: split each long sentence/);
});
