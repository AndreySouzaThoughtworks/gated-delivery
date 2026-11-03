import { readFileSync } from "node:fs";
import { guardShell } from "./adapter.mjs";

const STDIN_FD = 0;

const result = guardShell(readFileSync(STDIN_FD, "utf8"), process.env);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status);
