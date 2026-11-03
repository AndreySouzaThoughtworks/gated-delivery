import assert from "node:assert";

export const JUDGE_MODEL_ENV = "GATED_DELIVERY_JUDGE_MODEL";
export const DEFAULT_JUDGE_MODEL = "haiku";

export const judgeModel = (env: NodeJS.ProcessEnv = process.env) => {
  assert(typeof env === "object" && env !== null, `judgeModel reads an environment object, got ${typeof env}`);
  const model = env[JUDGE_MODEL_ENV] || DEFAULT_JUDGE_MODEL;
  assert(model.trim() !== "", `${JUDGE_MODEL_ENV} must name a model or be unset, got ${JSON.stringify(model)}`);
  return model;
};
