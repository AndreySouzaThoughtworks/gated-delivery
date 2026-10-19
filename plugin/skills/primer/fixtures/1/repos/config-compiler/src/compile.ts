import { createHash } from "node:crypto";
import { readTenantYaml } from "./read";
import { validate } from "./schema";
import { putObject } from "./store";
import { publish } from "./bus";

export async function compileTenant(tenant: string) {
  const sources = await readTenantYaml(`configs/${tenant}`);
  const errors = validate(sources);
  if (errors.length) throw new CompileError(tenant, errors);
  const bundle = JSON.stringify({ tenant, compiledAt: new Date().toISOString(), config: sources });
  const hash = createHash("sha256").update(bundle).digest("hex");
  await putObject(`bundles/${tenant}/${hash}.json`, bundle);
  await publish("config.compiled", { tenant, hash });
  return hash;
}

export class CompileError extends Error {
  constructor(readonly tenant: string, readonly errors: string[]) {
    super(`${tenant}: ${errors.length} validation error(s)`);
  }
}
