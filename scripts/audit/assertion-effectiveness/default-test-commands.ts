export const DEFAULT_TEST_COMMANDS = [
  "node --test plugin/hooks/*.test.mjs",
  "node --test scripts/audit/*.test.ts scripts/audit/message-actionability/*.test.ts scripts/eval/*.test.ts scripts/cursor/*.test.ts",
  "node --test plugin/bootstrap/*.test.mjs plugin/bootstrap/guards/*.test.mjs",
  "node --test plugin/scripts/*.test.mjs",
  "node scripts/eval/run-checks.ts --lint",
  "node --test scripts/*.test.ts",
  "node plugin/skills/spec/scripts/spec-lint.mjs scripts/audit/fixtures/valid-spec.md",
  "node plugin/skills/deskcheck/scripts/deskcheck-lint.mjs scripts/audit/fixtures/deskcheck/valid.html",
  `for file in plugin/skills/issue-writing/templates/*.md plugin/skills/issue-writing/examples/*.md; do
  node plugin/skills/issue-writing/scripts/guardrail-scan.mjs "$file"
done`,
  "node --test scripts/audit/assertion-effectiveness/*.test.ts",
];
