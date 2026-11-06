import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { write, validRepo, runGuard } from "../test-support/consistency-fixtures.test.support.ts";

const MODEL_POLICY_HINT = /pin a model only on the scout, since every other agent inherits the session model/;

const writeAgent = (dir: string, name: string, modelLine: string) => {
  assert(modelLine === "" || modelLine.endsWith("\n"), `a model line must end with a newline or be empty, got ${JSON.stringify(modelLine)}`);
  assert(/^[a-z-]+$/.test(name), `an agent name is lowercase letters and dashes, got ${name}`);
  write(dir, `plugin/agents/${name}.md`, `---\nname: ${name}\ndescription: x\n${modelLine}---\n`);
};

const withScout = (modelLine: string) => {
  assert(typeof modelLine === "string", `the scout model line must be text, got ${typeof modelLine}`);
  const dir = validRepo();
  writeAgent(dir, "scout", modelLine);
  write(dir, "README.md", "The plugin — 1 skills, 2 agents, 1 hooks.\n\n[MIT](LICENSE)\n");
  write(dir, "plugin/README.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n| `scout` | an agent |\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n| `scout` | an agent |\n| `h.mjs` | a hook |\n");
  assert(existsSync(join(dir, "plugin/agents/scout.md")), `the scout agent must be written under ${dir}`);
  return dir;
};

test("check 26 rejects a model on an agent the allow-list does not name", () => {
  for (const model of ["opus", "haiku"]) {
    const dir = validRepo();
    writeAgent(dir, "bot", `model: ${model}\n`);
    const { code, out } = runGuard(dir);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`agent "bot" pins model "${model}", but is not allowed to pin one`));
    assert.match(out, MODEL_POLICY_HINT);
  }
});

test("check 26 rejects a scout pinned to a model other than haiku", () => {
  const { code, out } = runGuard(withScout("model: sonnet\n"));
  assert.equal(code, 1, out);
  assert.match(out, /agent "scout" pins model "sonnet", but must pin "haiku"/);
  assert.match(out, MODEL_POLICY_HINT);
});

test("check 26 rejects a scout with no model", () => {
  const { code, out } = runGuard(withScout(""));
  assert.equal(code, 1, out);
  assert.match(out, /agent "scout" has no model, but must pin "haiku"/);
  assert.match(out, MODEL_POLICY_HINT);
});

test("check 26 accepts a scout pinned to haiku beside a bot with no model", () => {
  const { code, out } = runGuard(withScout("model: haiku\n"));
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /ERROR/);
});
