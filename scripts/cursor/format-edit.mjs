import { readFileSync } from "node:fs";
import { formatEditedFile } from "./adapter.mjs";

const STDIN_FD = 0;

const result = formatEditedFile(readFileSync(STDIN_FD, "utf8"), process.cwd());
process.stderr.write(result.stderr);
process.exit(result.status);
