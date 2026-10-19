import { subscribe } from "./bus";
import { getObject } from "./store";
import { runtimePods } from "./pods";
import { markStale } from "./status";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 2000, 8000];

subscribe("config.compiled", async ({ tenant, hash }) => {
  const bundle = await getObject(`bundles/${tenant}/${hash}.json`);
  const pods = await runtimePods(tenant);
  const failed: string[] = [];
  for (const pod of pods) {
    if (!(await pushWithRetry(pod, bundle))) failed.push(pod);
  }
  if (failed.length) await markStale(tenant, hash, failed);
});

async function pushWithRetry(pod: string, bundle: string) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`http://${pod}/config`, { method: "PUT", body: bundle });
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
  }
  return false;
}
