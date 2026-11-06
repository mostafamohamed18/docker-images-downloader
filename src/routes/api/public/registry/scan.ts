import { createFileRoute } from "@tanstack/react-router";
import { corsError, corsJson, corsPreflight } from "@/lib/registry-proxy.server";
import { extractImagePackages } from "@/lib/scanner/layer-extract.server";
import { queryVulnerabilities } from "@/lib/scanner/osv.server";
import type { ScanResult } from "@/lib/scanner/types";

export const Route = createFileRoute("/api/public/registry/scan")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { image?: string };
          const image = (body?.image || "").trim();
          if (!image) return corsError("missing image", 400);
          if (!/^[a-zA-Z0-9._\/-]+(:[a-zA-Z0-9._-]+)?$/.test(image)) {
            return corsError("invalid image reference", 400);
          }

          const extracted = await extractImagePackages(image);
          if (extracted.packages.length === 0) {
            const result: ScanResult = {
              image,
              osFamily: extracted.osFamily,
              osRelease: extracted.osRelease,
              packageManager: extracted.packageManager,
              packageCount: 0,
              vulnerabilities: [],
              totalCves: 0,
              note:
                extracted.packageManager === "unknown"
                  ? `Unsupported OS in v1 (${extracted.osFamily}). Scan supports Debian, Ubuntu, and Alpine base images.`
                  : "No installed packages detected. Image may be scratch/distroless.",
            };
            return corsJson(result);
          }

          const vulnerabilities = await queryVulnerabilities(extracted.packages);
          const totalCves = vulnerabilities.reduce((n, v) => n + v.vulns.length, 0);

          const result: ScanResult = {
            image,
            osFamily: extracted.osFamily,
            osRelease: extracted.osRelease,
            packageManager: extracted.packageManager,
            packageCount: extracted.packages.length,
            vulnerabilities,
            totalCves,
          };
          return corsJson(result);
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
