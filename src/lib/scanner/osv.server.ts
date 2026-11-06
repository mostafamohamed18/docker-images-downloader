// Query OSV.dev for vulnerabilities affecting a list of packages.
// Docs: https://osv.dev/docs/#tag/api/operation/OSV_QueryAffectedBatch

import type { DetectedPackage, VulnerablePackage } from "./types";

interface OsvBatchResponse {
  results: Array<{
    vulns?: Array<{ id: string; modified?: string }>;
  }>;
}

const OSV_ENDPOINT = "https://api.osv.dev/v1/querybatch";

// Split into chunks so we don't exceed OSV's request size limit.
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function queryVulnerabilities(
  packages: DetectedPackage[],
): Promise<VulnerablePackage[]> {
  if (packages.length === 0) return [];

  const affected: VulnerablePackage[] = [];
  const CHUNK = 100;

  for (const group of chunk(packages, CHUNK)) {
    const body = {
      queries: group.map((p) => ({
        version: p.version,
        package: { name: p.name, ecosystem: p.ecosystem },
      })),
    };
    const res = await fetch(OSV_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OSV query failed ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as OsvBatchResponse;
    data.results.forEach((r, i) => {
      const vulns = r.vulns ?? [];
      if (vulns.length === 0) return;
      const pkg = group[i];
      affected.push({
        name: pkg.name,
        installedVersion: pkg.version,
        ecosystem: pkg.ecosystem,
        vulns: vulns.map((v) => ({
          id: v.id,
          url: `https://osv.dev/vulnerability/${v.id}`,
        })),
      });
    });
  }

  return affected;
}
