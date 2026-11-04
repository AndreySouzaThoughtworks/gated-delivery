import assert from "node:assert";
import { createHash } from "node:crypto";
import { extname, isAbsolute } from "node:path";
import { SyntaxKind } from "typescript/unstable/ast";
import type { CallExpression, Identifier, ImportDeclaration, Node, PropertyAccessExpression, SourceFile, StringLiteral } from "typescript/unstable/ast";

export const SOURCE_EXTENSIONS = [".mjs", ".ts"];
const ASSERT_MODULES = ["node:assert", "node:assert/strict", "assert", "assert/strict"];
const ASSERT_OK_MEMBER = "ok";
const PROBE_LOCAL_NAME = "__probe";
const MODULE_LEVEL = "<module>";
const HASH_LENGTH = 12;
const SHEBANG = "#!";
const LINE_FEED = "\n";
const WHITESPACE_RUN = /\s+/g;
const FUNCTION_KINDS = new Set([SyntaxKind.FunctionDeclaration, SyntaxKind.FunctionExpression, SyntaxKind.ArrowFunction, SyntaxKind.MethodDeclaration]);
const NAMING_PARENT_KINDS = new Set([SyntaxKind.VariableDeclaration, SyntaxKind.PropertyAssignment]);

export type AssertSite = {
  id: string;
  path: string;
  line: number;
  functionName: string;
  condition: string;
  calleeStart: number;
  calleeEnd: number;
  calleeText: string;
};

export const functionNameOf = (node: Node) => {
  assert(node.kind === SyntaxKind.CallExpression, `functionNameOf names the function around a call, got node kind ${node.kind}`);
  assert(node.parent !== undefined, `a call expression always has a parent, got ${node.parent}; the tree is detached`);
  for (let current = node.parent; current; current = current.parent) {
    if (!FUNCTION_KINDS.has(current.kind)) continue;
    const namingNode = (current as Node & { name?: Node }).name ?? (NAMING_PARENT_KINDS.has(current.parent.kind) ? (current.parent as Node & { name: Node }).name : undefined);
    if (namingNode) return namingNode.getText();
  }
  return MODULE_LEVEL;
};

export const findAssertSites = (sourceFile: SourceFile, path: string) => {
  assert(path !== "" && !isAbsolute(path), `findAssertSites needs a repo-relative path, got ${JSON.stringify(path)}`);
  assert(SOURCE_EXTENSIONS.includes(extname(path)), `findAssertSites reads ${SOURCE_EXTENSIONS.join(" or ")} files, got ${path}`);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (statement.kind !== SyntaxKind.ImportDeclaration) continue;
    const { importClause, moduleSpecifier } = statement as ImportDeclaration;
    if (importClause?.name && ASSERT_MODULES.includes((moduleSpecifier as StringLiteral).text)) names.add(importClause.name.text);
  }
  const sites: AssertSite[] = [];
  const queue: Node[] = [sourceFile];
  for (const node of queue) {
    node.forEachChild((child) => {
      queue.push(child);
    });
    if (node.kind !== SyntaxKind.CallExpression) continue;
    const { expression: callee, arguments: args } = node as CallExpression;
    const member = callee.kind === SyntaxKind.PropertyAccessExpression ? (callee as PropertyAccessExpression) : undefined;
    const calleeName = member?.name.getText() === ASSERT_OK_MEMBER ? member.expression : member ? undefined : callee;
    if (calleeName?.kind !== SyntaxKind.Identifier || !names.has((calleeName as Identifier).text) || args.length === 0 || args[0].kind === SyntaxKind.FalseKeyword) continue;
    const functionName = functionNameOf(node);
    const calleeStart = callee.getStart();
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(calleeStart);
    sites.push({
      id: `${path}:${line + 1}:${character + 1}`,
      path,
      line: line + 1,
      functionName,
      condition: args[0].getText().replace(WHITESPACE_RUN, " "),
      calleeStart,
      calleeEnd: callee.getEnd(),
      calleeText: callee.getText(),
    });
  }
  return sites.sort((first, second) => first.calleeStart - second.calleeStart);
};

export const siteMessage = (site: AssertSite) => {
  assert(site.functionName !== "", `an assert site in ${site.path} needs an enclosing function name or ${MODULE_LEVEL}`);
  assert(site.condition !== "", `an assert site in ${site.path} needs condition text`);
  const hash = createHash("sha256").update(site.condition).digest("hex").slice(0, HASH_LENGTH);
  return `${site.functionName} | ${hash}`;
};

export const instrumentText = (text: string, sites: AssertSite[], probeUrl: string) => {
  assert(probeUrl.startsWith("file://"), `instrumentText imports the probe by file URL, got ${JSON.stringify(probeUrl)}`);
  const stale = sites.find((site) => text.slice(site.calleeStart, site.calleeEnd) !== site.calleeText);
  assert(stale === undefined, `the text no longer matches ${stale?.id}; analyse the same text that is instrumented`);
  let instrumented = text;
  for (const site of [...sites].reverse()) {
    instrumented = `${instrumented.slice(0, site.calleeStart)}${PROBE_LOCAL_NAME}(${JSON.stringify(site.id)})${instrumented.slice(site.calleeEnd)}`;
  }
  const importLine = `import { probe as ${PROBE_LOCAL_NAME} } from ${JSON.stringify(probeUrl)}; `;
  const insertAt = instrumented.startsWith(SHEBANG) ? instrumented.indexOf(LINE_FEED) + 1 : 0;
  return `${instrumented.slice(0, insertAt)}${importLine}${instrumented.slice(insertAt)}`;
};
