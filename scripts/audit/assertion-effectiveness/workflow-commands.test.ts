import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TEST_COMMANDS } from "./default-test-commands.ts";
import { commandDrift, normalizeCommand, workflowRunCommands } from "./workflow-commands.ts";

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "audit.yml");
const NEW_TEST_STEP = "      - name: A new test\n        run: node --test scripts/new/*.test.ts\n";

const NOT_TEST_COMMANDS = [
  "npm ci",
  "npx tsc --noEmit",
  "node scripts/audit/consistency.ts",
  "node scripts/audit/suppressions.ts",
  "node scripts/audit/jsdoc-types-only.ts",
  "node scripts/audit/comments.ts",
  "node scripts/audit/site-wiring.ts",
  "node scripts/site/build.ts --check",
  'node plugin/bootstrap/guards/ratchet.mjs --baseline zanity-baseline.json --base-ref "$GATED_DELIVERY_BASE_REF"',
  'node plugin/bootstrap/guards/ratchet.mjs --baseline assertion-effectiveness-baseline.json --base-ref "$GATED_DELIVERY_BASE_REF"',
  'node plugin/bootstrap/guards/ratchet.mjs --baseline message-actionability-baseline.json --base-ref "$GATED_DELIVERY_BASE_REF"',
  "node scripts/audit/assertion-effectiveness.ts",
  "node --test plugin/hooks/*.test.mjs plugin/bootstrap/*.test.mjs plugin/bootstrap/guards/*.test.mjs plugin/scripts/*.test.mjs",
  "bash tests/leak-guard.test.sh",
  "bash tests/slice-scripts.test.sh",
  "bash tests/live-opt-in.test.sh",
  "bash tests/install-gitleaks.test.sh",
  "bash scripts/ci/install-gitleaks.sh",
  "bash tests/pre-push.test.sh",
];

test("workflowRunCommands reads inline and block scalar run steps, and ignores other keys", () => {
  const text = 'steps:\n  - run: echo one\n  - name: block\n    run: |\n      for f in a b; do\n        echo "$f"\n      done\n  - uses: x\n    with:\n      args: not a run\n';
  assert.deepStrictEqual(workflowRunCommands(text), ["echo one", 'for f in a b; do echo "$f" done']);
});

test("the tool's default test commands are exactly the test commands of .github/workflows/audit.yml", () => {
  const drift = commandDrift(readFileSync(WORKFLOW, "utf8"), DEFAULT_TEST_COMMANDS, NOT_TEST_COMMANDS);
  assert.deepStrictEqual(drift, { undeclared: [], absent: [] }, `audit.yml and the tool disagree; add each undeclared command to DEFAULT_TEST_COMMANDS (or NOT_TEST_COMMANDS here) and drop each absent one: ${JSON.stringify(drift)}`);
});

test("a test command added to audit.yml is reported undeclared, and a default missing from audit.yml is reported absent", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const grown = commandDrift(`${workflow}${NEW_TEST_STEP}`, DEFAULT_TEST_COMMANDS, NOT_TEST_COMMANDS);
  assert.deepStrictEqual(grown.undeclared, ["node --test scripts/new/*.test.ts"]);
  const shrunk = commandDrift(workflow.replaceAll("node --test scripts/*.test.ts", "echo removed"), DEFAULT_TEST_COMMANDS, NOT_TEST_COMMANDS);
  assert.deepStrictEqual(shrunk.absent, ["node --test scripts/*.test.ts"]);
});

test("normalizeCommand collapses whitespace, and refuses a value that is not text or holds only whitespace", () => {
  assert.strictEqual(normalizeCommand("  a\n   b\t c "), "a b c");
  assert.throws(() => normalizeCommand(7 as unknown as string), /a command is text, got number/);
  assert.throws(() => normalizeCommand("  \n "), /more than whitespace/);
});

test("workflowRunCommands refuses a run step with no command, and commandDrift refuses a workflow with no run step", () => {
  assert.throws(() => workflowRunCommands("steps:\n  - run:\n  - name: next\n"), /has no command/);
  assert.throws(() => workflowRunCommands(" \n"), /workflow text is empty/);
  assert.throws(() => commandDrift("name: empty\n", DEFAULT_TEST_COMMANDS, NOT_TEST_COMMANDS), /holds no run step/);
});

test("commandDrift refuses a command that is both declared and excluded", () => {
  assert.throws(() => commandDrift("- run: echo a\n", ["echo a"], ["echo  a"]), /declared twice/);
});
