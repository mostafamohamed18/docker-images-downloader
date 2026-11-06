import { createFileRoute } from "@tanstack/react-router";
import { corsError, corsJson, corsPreflight } from "@/lib/registry-proxy.server";

// List all available versions for a Helm chart from Artifact Hub.
// ?repo=<repoName>&name=<chartName>
export const Route = createFileRoute("/api/public/helm/versions")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const repo = url.searchParams.get("repo") ?? "";
          const name = url.searchParams.get("name") ?? "";
          if (!repo || !name) return corsError("repo and name required", 400);
          const res = await fetch(
            `https://artifacthub.io/api/v1/packages/helm/${encodeURIComponent(
              repo,
            )}/${encodeURIComponent(name)}`,
          );
          if (!res.ok)
            return corsError(`artifacthub ${res.status}`, res.status);
          const data: {
            available_versions?: Array<{
              version: string;
              app_version?: string;
              ts?: number;
            }>;
          } = await res.json();
          return corsJson({
            versions: (data.available_versions ?? []).map((v) => ({
              version: v.version,
              appVersion: v.app_version ?? null,
              ts: v.ts ?? null,
            })),
          });
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
