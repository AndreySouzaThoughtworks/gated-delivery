export async function markStale(tenant: string, hash: string, pods: string[]) {
  await db.tenantConfigStatus.upsert({ tenant, hash, state: "stale", pods });
}
