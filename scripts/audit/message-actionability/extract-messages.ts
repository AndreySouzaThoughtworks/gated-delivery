import assert from "node:assert";

export type Message = { line: number; text: string };
type Argument = { pieces: string[] };

const MESSAGE_CALL = /\b(?:(?:errors|warnings|problems|found|violations|failures|offences)\.push|assert\b(?:\.ok)?|throw new (?:\w+\.)?\w+|console\.error|process\.(?:stderr|stdout)\.write)\(/g;
const ASSERT_CALL = /^assert\b(?:\.ok)?\($/;
const COMMENT_LINE = /^\s*(?:\/\/|\*)/;
const MIN_MESSAGE_LENGTH = 12;
const MIN_ASSERT_ARGUMENTS = 2;
const QUOTES = new Set(["'", '"', "`"]);
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);
const INTERPOLATION = "${}";
const INTERPOLATION_OPENER = "${";
const PIECE_SEPARATOR = " ";
const LINE_BREAK_ESCAPE = "n";
const WHITESPACE = /\s+/g;
const NUL = "\0";

export const readInterpolation = (source: string, start: number) => {
  assert(source.slice(start - INTERPOLATION_OPENER.length, start) === INTERPOLATION_OPENER, `an interpolation must start after "${INTERPOLATION_OPENER}", got ${JSON.stringify(source.slice(Math.max(0, start - INTERPOLATION_OPENER.length), start))} before offset ${start}; pass the offset after the brace.`);
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    index += 1;
  }
  assert(depth === 0, `the interpolation opened at offset ${start} never closes; add the missing "}".`);
  return index;
};

export const readLiteral = (source: string, start: number): [text: string, end: number] => {
  assert(QUOTES.has(source[start]), `a literal must start at a quote, got ${JSON.stringify(source[start])} at offset ${start}; pass the offset of an opening quote.`);
  const quote = source[start];
  let text = "";
  let index = start + 1;
  while (index < source.length && source[index] !== quote) {
    if (source[index] === "\\") {
      text += source[index + 1] === LINE_BREAK_ESCAPE ? PIECE_SEPARATOR : source[index + 1];
      index += 2;
    } else if (quote === "`" && source.startsWith(INTERPOLATION_OPENER, index)) {
      text += INTERPOLATION;
      index = readInterpolation(source, index + INTERPOLATION_OPENER.length);
    } else {
      text += source[index];
      index += 1;
    }
  }
  assert(source[index] === quote, `the literal opened at offset ${start} never closes; add the closing quote ${JSON.stringify(quote)}.`);
  return [text, index + 1];
};

export const readArguments = (source: string, start: number) => {
  assert(source[start - 1] === "(", `arguments must start after "(", got ${JSON.stringify(source[start - 1])} before offset ${start}; pass the offset after the parenthesis.`);
  const found: Argument[] = [];
  let current: Argument = { pieces: [] };
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (QUOTES.has(character)) {
      const [text, end] = readLiteral(source, index);
      current.pieces.push(text);
      index = end;
      continue;
    }
    if (OPENERS.has(character)) depth += 1;
    if (CLOSERS.has(character) && depth === 0) break;
    if (CLOSERS.has(character)) depth -= 1;
    if (character === "," && depth === 0) {
      found.push(current);
      current = { pieces: [] };
    }
    index += 1;
  }
  assert(index < source.length, `the call opened at offset ${start} never closes; add the missing ")".`);
  found.push(current);
  return found;
};

export const extractMessages = (source: string): Message[] => {
  assert(typeof source === "string", `the source must be text, got ${typeof source}; pass the file content.`);
  assert(!source.includes(NUL), `the source must be text, got a NUL byte (${JSON.stringify(NUL)}) at offset ${source.indexOf(NUL)}; pass a source file.`);
  const lines = source.split("\n");
  const messages: Message[] = [];
  for (const call of source.matchAll(MESSAGE_CALL)) {
    const line = source.slice(0, call.index).split("\n").length;
    if (COMMENT_LINE.test(lines[line - 1])) continue;
    const found = readArguments(source, call.index + call[0].length);
    const isAssert = ASSERT_CALL.test(call[0]);
    if (isAssert && found.length < MIN_ASSERT_ARGUMENTS) continue;
    const pieces = (isAssert ? found[found.length - 1] : found[0]).pieces;
    const text = pieces.join(PIECE_SEPARATOR).replace(WHITESPACE, PIECE_SEPARATOR).trim();
    if (text.length >= MIN_MESSAGE_LENGTH) messages.push({ line, text });
  }
  return messages;
};
