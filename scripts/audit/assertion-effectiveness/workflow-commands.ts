import assert from "node:assert";

const RUN_LINE = /^(\s*)(?:- )?run:\s*(.*)$/;
const BLOCK_SCALAR = "|";
const NOT_FOUND = -1;

export const normalizeCommand = (command: string) => {
  assert(typeof command === "string", `a command is text, got ${typeof command}`);
  const normalized = command.replace(/\s+/g, " ").trim();
  assert(normalized !== "", `a command must hold more than whitespace, got ${JSON.stringify(command)}`);
  return normalized;
};

export const workflowRunCommands = (workflowText: string) => {
  assert(workflowText.trim() !== "", `the workflow text is empty, got ${JSON.stringify(workflowText)}`);
  const lines = workflowText.split("\n");
  const commands: string[] = [];
  lines.forEach((line, index) => {
    const match = RUN_LINE.exec(line);
    if (!match) return;
    const [, indent, inline] = match;
    if (inline !== BLOCK_SCALAR) {
      commands.push(inline);
      return;
    }
    const following = lines.slice(index + 1);
    const bodyLength = following.findIndex((next) => next.trim() !== "" && next.length - next.trimStart().length <= indent.length);
    commands.push((bodyLength === NOT_FOUND ? following : following.slice(0, bodyLength)).join("\n"));
  });
  assert(commands.every((command) => command.trim() !== ""), `a run step in the workflow has no command among ${commands.length}`);
  return commands.map(normalizeCommand);
};

export const commandDrift = (workflowText: string, declared: string[], notTests: string[]) => {
  const inWorkflow = workflowRunCommands(workflowText);
  assert(inWorkflow.length > 0, `the workflow text holds no run step; got ${workflowText.length} characters`);
  const known = [...declared, ...notTests].map(normalizeCommand);
  assert(new Set(known).size === known.length, `a command is declared twice among the ${known.length} declared and excluded commands`);
  return {
    undeclared: [...new Set(inWorkflow.filter((command) => !known.includes(command)))],
    absent: declared.map(normalizeCommand).filter((command) => !inWorkflow.includes(command)),
  };
};
