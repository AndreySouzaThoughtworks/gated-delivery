#!/usr/bin/env node
import { readFileSync } from "node:fs";

const EXIT_NOT_FOUND = 1;
const EXIT_UNSUPPORTED = 2;
const fixture = JSON.parse(readFileSync(process.env.GH_STUB_FIXTURE ?? "", "utf8"));
const [group, action, branch] = process.argv.slice(2);

if (group === "pr" && action === "list") {
  console.log(JSON.stringify(fixture.list ?? []));
} else if (group === "pr" && action === "view") {
  const view = fixture.view?.[branch];
  if (view === undefined) {
    console.error(`no pull requests found for branch "${branch}"`);
    process.exitCode = EXIT_NOT_FOUND;
  } else {
    console.log(JSON.stringify(view));
  }
} else {
  console.error(`gh stub does not serve: ${process.argv.slice(2).join(" ")}`);
  process.exitCode = EXIT_UNSUPPORTED;
}
