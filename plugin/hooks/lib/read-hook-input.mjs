import { readFileSync } from "node:fs";

const STDIN_FD = 0;

export const readHookInput = () => {
  try {
    const raw = readFileSync(STDIN_FD, "utf8");
    console.assert(raw.trim().length > 0, `a hook sends its payload on stdin, got ${raw.length} characters`);
    const parsed = JSON.parse(raw);
    const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    console.assert(isObject, `a hook payload is a JSON object, got ${Array.isArray(parsed) ? "an array" : typeof parsed}`);
    return isObject ? parsed : {};
  } catch {
    return {};
  }
};
