import { createFileRoute } from "@tanstack/react-router";
import { corsError, corsJson, corsPreflight } from "@/lib/registry-proxy.server";
import { extractPackagesFromDockerSave } from "@/lib/scanner/save-tar.server";
import { queryVulnerabilities } from "@/lib/scanner/osv.server";
import type { ScanResult } from "@/lib/scanner/types";

// ~100 MB cap (Cloudflare Workers request body limit).
const MAX_BYTES = 100 * 1024 * 1024;

export const Route = createFileRoute("/api/public/registry/scan-tar")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        try {
          const contentLength = Number(request.headers.get("content-length") || 0);
          if (contentLength && contentLength > MAX_BYTES) {
            return corsError(`Tar too large (>${MAX_BYTES} bytes)`, 413);
          }
          const buf = new Uint8Array(await request.arrayBuffer());
          if (buf.byteLength === 0) return corsError("empty body", 400);
          if (buf.byteLength > MAX_BYTES) {
            return corsError(`Tar too large (>${MAX_BYTES} bytes)`, 413);
          }

          const extracted = await extractPackagesFromDockerSave(buf);
          const label = extracted.repoTag || "uploaded.tar";

          if (extracted.packages.length === 0) {
            const result: ScanResult = {
              image: label,
              osFamily: extracted.osFamily,
              osRelease: extracted.osRelease,
              packageManager: extracted.packageManager,
              packageCount: 0,
              vulnerabilities: [],
              totalCves: 0,
              note:
                extracted.packageManager === "unknown"
                  ? `Unsupported OS (${extracted.osFamily}). Scan supports Debian, Ubuntu, and Alpine base images.`
                  : "No installed packages detected. Image may be scratch/distroless.",
            };
            return corsJson(result);
          }

          const vulnerabilities = await queryVulnerabilities(extracted.packages);
          const totalCves = vulnerabilities.reduce((n, v) => n + v.vulns.length, 0);

          const result: ScanResult = {
            image: label,
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
