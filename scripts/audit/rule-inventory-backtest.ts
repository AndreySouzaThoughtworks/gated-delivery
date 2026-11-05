#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { markerLines } from "./rule-inventory.ts";

const EXIT_USAGE = 2;
const PERCENT = 100;
const GIT_BUFFER_BYTES = 64 * 1024 * 1024;

const { values } = parseArgs({ options: { commit: { type: "string" }, file: { type: "string" } } });
if (!values.file) {
  console.error("usage: node scripts/audit/rule-inventory-backtest.ts --file <path> [--commit <sha>]");
  process.exit(EXIT_USAGE);
}
const file = values.file;

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: GIT_BUFFER_BYTES, stdio: ["ignore", "pipe", "ignore"] }); // zanity: ignore[assertion-density] -- thin-wrapper: it only fixes the spawn options of git

const commits = values.commit ? [git(["rev-parse", values.commit]).trim()] : git(["log", "--no-merges", "--format=%H", "--", file]).split("\n").filter(Boolean);
let flagged = 0;
let compared = 0;
for (const commit of commits) {
  const [before, after] = [`${commit}^`, commit].map((revision) => {
    try {
      return git(["show", `${revision}:${file}`]);
    } catch {
      return null;
    }
  });
  if (before === null) continue;
  compared++;
  const anchors = markerLines(before).map((line) => line.text.trim());
  const missing = after === null ? anchors : anchors.filter((anchor) => !after.includes(anchor));
  if (missing.length) flagged++;
  console.log(`${commit.slice(0, 7)} ${git(["log", "-1", "--format=%s", commit]).trim()}: ${missing.length} of ${anchors.length} marker lines missing`);
  for (const anchor of missing) console.log(`  MISSING ${anchor}`);
}
console.log(`interruption rate: ${flagged} of ${compared} commits flag at least one missing anchor (${(PERCENT * flagged / Math.max(1, compared)).toFixed(1)}%)`);
