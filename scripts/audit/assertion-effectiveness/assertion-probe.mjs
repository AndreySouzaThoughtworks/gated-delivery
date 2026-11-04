import assert from "node:assert";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), "log", `${process.pid}.log`);
const FIELD_SEPARATOR = "\t";
const RECORD_SEPARATOR = "\n";
const HELD = "held";
const FAILED = "failed";

/** @param {string} siteId */
export const probe = (siteId) => {
  assert(typeof siteId === "string" && siteId.length > 0, `probe needs a non-empty site id, got ${JSON.stringify(siteId)}`);
  assert(!siteId.includes(FIELD_SEPARATOR) && !siteId.includes(RECORD_SEPARATOR), `site id ${JSON.stringify(siteId)} must not contain a tab or newline, which delimit the log records`);
  return (/** @type {unknown} */ condition, /** @type {string | Error | undefined} */ message) => {
    appendFileSync(LOG_FILE, `${siteId}${FIELD_SEPARATOR}${condition ? HELD : FAILED}${RECORD_SEPARATOR}`);
    return assert(condition, message);
  };
};
