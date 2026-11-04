import { test } from "node:test";
import assert from "node:assert";
import { SyntaxKind } from "typescript/unstable/ast";
import { findAssertSites, functionNameOf, instrumentText, siteMessage } from "./assertion-sites.ts";
import type { AssertSite } from "./assertion-sites.ts";
import type { Node, SourceFile } from "typescript/unstable/ast";

const NO_SOURCE = {} as SourceFile;
const PROBE_URL = "file:///probe.mjs";
const SITE: AssertSite = { id: "scripts/a.mjs:1:1", path: "scripts/a.mjs", line: 1, functionName: "run", condition: "ready", calleeStart: 0, calleeEnd: 6, calleeText: "assert" };

test("findAssertSites refuses an absolute or empty path and a file type it cannot read", () => {
  assert.throws(() => findAssertSites(NO_SOURCE, "/abs/a.mjs"), /repo-relative path/);
  assert.throws(() => findAssertSites(NO_SOURCE, ""), /repo-relative path/);
  assert.throws(() => findAssertSites(NO_SOURCE, "docs/a.md"), /reads .mjs or .ts files/);
});

test("siteMessage refuses a site without a function name or a condition", () => {
  assert.throws(() => siteMessage({ ...SITE, functionName: "" }), /enclosing function name/);
  assert.throws(() => siteMessage({ ...SITE, condition: "" }), /condition text/);
});

test("siteMessage changes with the condition and not with the line", () => {
  assert.notStrictEqual(siteMessage({ ...SITE, condition: "a" }), siteMessage({ ...SITE, condition: "b" }));
  assert.strictEqual(siteMessage({ ...SITE, line: 1 }), siteMessage({ ...SITE, line: 90 }));
});

test("instrumentText refuses a path that is not a file URL, and text that changed since it was analysed", () => {
  assert.throws(() => instrumentText("assert(ready);", [SITE], "/probe.mjs"), /by file URL/);
  assert.throws(() => instrumentText("check(ready);", [SITE], PROBE_URL), /no longer matches scripts\/a.mjs:1:1/);
});

test("instrumentText swaps only the callee and puts the import after a shebang line", () => {
  const text = '#!/usr/bin/env node\nassert(ready, "msg");\n';
  const site = { ...SITE, id: "scripts/a.mjs:2:1", line: 2, calleeStart: 20, calleeEnd: 26 };
  assert.strictEqual(instrumentText(text, [site], PROBE_URL), `#!/usr/bin/env node\nimport { probe as __probe } from "${PROBE_URL}"; __probe("scripts/a.mjs:2:1")(ready, "msg");\n`);
});

test("functionNameOf names the nearest named function, a variable that holds an arrow, or the module", () => {
  const module = { kind: SyntaxKind.SourceFile };
  const declaration = { kind: SyntaxKind.VariableDeclaration, parent: module, name: { getText: () => "held" } };
  const arrow = { kind: SyntaxKind.ArrowFunction, parent: declaration };
  const method = { kind: SyntaxKind.MethodDeclaration, parent: module, name: { getText: () => "named" } };
  const callback = { kind: SyntaxKind.ArrowFunction, parent: method };
  assert.strictEqual(functionNameOf({ kind: SyntaxKind.CallExpression, parent: arrow } as unknown as Node), "held");
  assert.strictEqual(functionNameOf({ kind: SyntaxKind.CallExpression, parent: callback } as unknown as Node), "named");
  assert.strictEqual(functionNameOf({ kind: SyntaxKind.CallExpression, parent: module } as unknown as Node), "<module>");
});

test("functionNameOf refuses a node that is not a call and a call with no parent", () => {
  assert.throws(() => functionNameOf({ kind: SyntaxKind.Identifier, parent: {} } as unknown as Node), /names the function around a call/);
  assert.throws(() => functionNameOf({ kind: SyntaxKind.CallExpression } as unknown as Node), /tree is detached/);
});
