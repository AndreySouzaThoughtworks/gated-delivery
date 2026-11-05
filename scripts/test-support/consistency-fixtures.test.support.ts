import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "..", "audit", "consistency.ts");

type GuardResult = { code: number; out: string };
type ExecFailure = { status?: number; stdout?: string; stderr?: string };

export const write = (dir: string, relPath: string, body: string) => {
  assert(typeof body === "string", `${relPath} needs text content, got ${typeof body}`);
  const full = join(dir, relPath);
  assert(full.startsWith(dir), `${relPath} must stay inside ${dir}`);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
};

export const TEST_FILES_TABLE = 'paths."**/*.test.mjs"';
export const RELAXED_TEST_RULES = '["filesystem-in-test", "process-in-test"]';
export const SELECT_ALL = 'select = ["all"]';
export const STRICT_TSC_FLAGS = { strict: true, checkJs: true, noUnusedLocals: true, noUnusedParameters: true };
export const STRICT_ZANITY_CONFIG =`exclude = ["tests/fixtures/", "evals/fixtures/"]\n[rules]\n${SELECT_ALL}\n[${TEST_FILES_TABLE}]\ndisable = ${RELAXED_TEST_RULES}\n`;

export const ONE_SCENARIO = "## Test Scenarios\n\n| # | Prompt |\n|---|---|\n| 1 | a |\n\n";

/** A fixture the guard must accept: 1 skill, 1 agent, 1 hook, all documented. */
export const validRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "gated-delivery-guard-test-"));
  assert(typeof dir === "string" && dir.length > 0, `mkdtemp must yield a directory, got ${dir}`);
  write(dir, "plugin/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: x\n---\n\n## Heading One\n");
  write(
    dir,
    "plugin/skills/alpha/evals.md",
    ONE_SCENARIO + "| Signal | How to Measure |\n|---|---|\n| x | `grep -c foo out` |\n\n## Deterministic Checks\n\n```bash\n# expect: manual\ngrep -c foo output.md\n```\n",
  );
  write(dir, "plugin/agents/bot.md", "---\nname: bot\ndescription: x\n---\n");
  write(dir, "plugin/hooks/h.mjs", "process.exit(0);\n");
  write(dir, "plugin/hooks/h.test.mjs", "process.exit(0);\n");
  write(dir, "plugin/hooks/hooks.json", JSON.stringify({ hooks: [{ command: "node hooks/h.mjs" }] }));
  write(dir, "plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "p" }));
  write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ plugins: [{ name: "p", source: "plugin" }] }));
  write(dir, "README.md", "The plugin — 1 skills, 1 agents, 1 hooks.\n\n[MIT](LICENSE)\n");
  write(dir, "LICENSE", "MIT License\n");
  write(dir, "plugin/README.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n");
  write(dir, "docs/skill-graph.md", "| `/alpha` | a skill |\n| `bot` | an agent |\n| `h.mjs` | a hook |\n");
  write(dir, "zanity.toml", STRICT_ZANITY_CONFIG);
  write(dir, "tsconfig.json", JSON.stringify({ compilerOptions: STRICT_TSC_FLAGS }));
  assert(dir.startsWith(tmpdir()), `${dir} must be a throwaway under ${tmpdir()}`);
  return dir;
};

/** Runs the guard in `dir`. Returns { code, out } and never throws, so a red run stays assertable. */
export const runGuard = (dir: string, env: Record<string, string> = {}) => {
  assert(typeof dir === "string", `the guard runs in a directory, got ${typeof dir}`);
  let result: GuardResult;
  try {
    result = { code: 0, out: execFileSync("node", [GUARD], { cwd: dir, encoding: "utf8", env: { ...process.env, GATED_DELIVERY_BASE_REF: "", ...env } }) };
  } catch (e) {
    const failure = e as ExecFailure;
    result = { code: failure.status ?? 1, out: (failure.stdout ?? "") + (failure.stderr ?? "") };
  }
  assert(Number.isInteger(result.code), `the guard must report an integer exit code, got ${result.code}`);
  return result;
};
