export function validate(sources: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!("routing" in sources)) errors.push("routing.yaml is required");
  if (!("prompts" in sources)) errors.push("prompts.yaml is required");
  return errors;
}
