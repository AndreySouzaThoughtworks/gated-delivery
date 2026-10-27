import { readFileSync } from "node:fs";

const STDIN_FD = 0;

export const readHookInput = () => {
  console.assert(Number.isInteger(STDIN_FD), `stdin must be addressed by an integer file descriptor, got ${STDIN_FD}`);
  try {
    const parsed = JSON.parse(readFileSync(STDIN_FD, "utf8"));
    const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    const payload = isObject ? parsed : {};
    console.assert(typeof payload === "object" && !Array.isArray(payload), `a hook payload is always an object, got ${typeof payload}`);
    return payload;
  } catch {
    return {};
  }
};
