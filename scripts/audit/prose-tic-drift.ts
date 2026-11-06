import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROSE_SCAN_SCRIPT = "plugin/skills/prose-writing/scripts/prose-scan.mjs";
const SCANNED_FOLDERS = ["plugin", "evals"];
const TEXT_EXTENSIONS = [".md", ".json", ".mjs", ".sh", ".toml", ".yml"];
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const ALTERNATION = String.raw`(?:\s*\\?\|\s*|["']?\s+-e\s+["']?)`;

type TicList = { phrases: string[] }[];

export const phraseSource = (phrase: string) => {
  assert(typeof phrase === "string" && phrase.trim() !== "", `a tic phrase must be non-blank text, got ${JSON.stringify(phrase)}; remove it from the tic list.`);
  assert(!phrase.includes("\n"), `a tic phrase must sit on one line, got ${JSON.stringify(phrase)}; split it into two phrases.`);
  return phrase.replace(REGEX_SPECIALS, "\\$&").replaceAll(" ", "[\\s.]+").replaceAll("'", "['’.]");
};

export const textFilesUnder = (root: string, folder: string): string[] => {
  assert(SCANNED_FOLDERS.includes(folder), `the folder must be one of ${SCANNED_FOLDERS.join(", ")}, got ${JSON.stringify(folder)}; pass a scanned folder.`);
  assert(existsSync(root), `${root} must exist to list its ${folder} files, got none; pass the repository root.`);
  const base = join(root, folder);
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((name) => TEXT_EXTENSIONS.some((extension) => name.endsWith(extension)) && !name.split("/").includes("node_modules"))
    .map((name) => `${folder}/${name}`);
};

const loadPhrases = async (scriptPath: string) => {
  const { TICS, ORDINARY_PHRASES } = (await import(pathToFileURL(scriptPath).href)) as { TICS: TicList; ORDINARY_PHRASES: string[] };
  assert(Array.isArray(ORDINARY_PHRASES), `${PROSE_SCAN_SCRIPT} must export \`ORDINARY_PHRASES\` as a list, got ${typeof ORDINARY_PHRASES}; add the list of ordinary phrases.`);
  const phrases = [...new Set(TICS.flatMap((group) => group.phrases))];
  assert(phrases.length >= 2, `${PROSE_SCAN_SCRIPT} must list at least two tic phrases, got ${phrases.length}; add the tics the writing rules ban.`);
  return { phrases, ordinary: ORDINARY_PHRASES.map((phrase) => new RegExp(`^${phraseSource(phrase)}$`, "i")) };
};

export const ticDriftProblems = async (root: string) => {
  assert(typeof root === "string" && root !== "", `the repository root must be a non-empty path, got ${JSON.stringify(root)}; pass the root.`);
  assert(existsSync(root), `${root} must exist to check the tic list, got none; pass the repository root.`);
  const scriptPath = join(root, PROSE_SCAN_SCRIPT);
  if (!existsSync(scriptPath)) return [];
  const { phrases, ordinary } = await loadPhrases(scriptPath);
  const phrase = `(${phrases.map(phraseSource).join("|")})`;
  const pair = new RegExp(`${phrase}${ALTERNATION}${phrase}`, "gi");
  const problems: string[] = [];
  for (const file of SCANNED_FOLDERS.flatMap((folder) => textFilesUnder(root, folder)).filter((name) => name !== PROSE_SCAN_SCRIPT)) {
    readFileSync(join(root, file), "utf8").split("\n").forEach((line, index) => {
      const copy = [...line.matchAll(pair)].find(([, first, second]) => first.toLowerCase() !== second.toLowerCase() && !(ordinary.some((pattern) => pattern.test(first)) && ordinary.some((pattern) => pattern.test(second))));
      if (copy) problems.push(`${file}:${index + 1} lists the tic phrases "${copy[1]}" and "${copy[2]}" as a regex alternation, but the tic list must live only in ${PROSE_SCAN_SCRIPT}. Hint: delete the copy and call the script.`);
    });
  }
  return problems;
};
