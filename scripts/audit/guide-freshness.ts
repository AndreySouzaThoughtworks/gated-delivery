import assert from "node:assert";

export const GUIDE_FILE = "docs/guide.html";
const README_FILE = "README.md";
const README_LINK = `](${GUIDE_FILE})`;

type Inventory = { skills: string[]; agents: string[]; commands: string[]; hooks: number };
type GuideInput = { guide: string | null; readme: string; inventory: Inventory };

const QUOTED_OUTPUT = /<pre\b[\s\S]*?<\/pre>/gi;

export const guideProblems = ({ guide, readme, inventory }: GuideInput) => {
  assert(typeof readme === "string", `the README must be text, got ${typeof readme}; pass its body.`);
  assert(Array.isArray(inventory.skills), `the inventory must list skills, got ${typeof inventory.skills}; pass the skill names.`);
  const problems: string[] = [];
  if (!readme.includes(README_LINK)) {
    problems.push(`${README_FILE} does not link ${GUIDE_FILE}. Hint: add a link to the guide in the README.`);
  }
  if (guide === null) {
    problems.push(`${GUIDE_FILE} is missing. Hint: restore the guide, since the README links it.`);
    return problems;
  }
  const named: [string, string[]][] = [["skill", inventory.skills], ["agent", inventory.agents], ["command", inventory.commands]];
  for (const [kind, names] of named) {
    for (const name of names) {
      if (!guide.includes(name)) problems.push(`${GUIDE_FILE} does not name the ${kind} "${name}". Hint: add it to the guide.`);
    }
  }
  const prose = guide.replace(QUOTED_OUTPUT, "");
  const counted: [string, number][] = [["skills", inventory.skills.length], ["agents", inventory.agents.length], ["commands", inventory.commands.length], ["hooks", inventory.hooks]];
  for (const [label, actual] of counted) {
    for (const [, stated] of prose.matchAll(new RegExp(`(\\d+)\\s+${label}\\b`, "g"))) {
      if (Number(stated) !== actual) problems.push(`${GUIDE_FILE} says "${stated} ${label}", which is not the real count of ${actual}. Hint: change it to "${actual} ${label}".`);
    }
  }
  return problems;
};
