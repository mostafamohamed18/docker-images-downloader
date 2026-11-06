import { createFileRoute } from "@tanstack/react-router";
import {
  CORS_HEADERS,
  corsError,
  corsJson,
  corsPreflight,
} from "@/lib/registry-proxy.server";

// Resolves a Helm chart .tgz from Artifact Hub (by repoName + chart + version)
// or from a direct URL, and streams it back.
//   ?url=https://...            -> stream directly
//   ?repo=bitnami&name=nginx&version=15.4.4 -> resolve via Artifact Hub
export const Route = createFileRoute("/api/public/helm/chart")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const direct = url.searchParams.get("url");
          const repo = url.searchParams.get("repo");
          const name = url.searchParams.get("name");
          const version = url.searchParams.get("version") ?? "";

          let tgzUrl: string | null = null;

          if (direct) {
            tgzUrl = direct;
          } else if (repo && name) {
            const meta = await fetch(
              `https://artifacthub.io/api/v1/packages/helm/${encodeURIComponent(repo)}/${encodeURIComponent(name)}${version ? "/" + encodeURIComponent(version) : ""}`,
            );
            if (!meta.ok) return corsError(`artifacthub ${meta.status}`, meta.status);
            const data: {
              content_url?: string;
              version?: string;
              name?: string;
            } = await meta.json();
            if (!data.content_url) return corsError("chart has no content_url", 404);
            tgzUrl = data.content_url;
            if (url.searchParams.get("meta") === "1") {
              return corsJson({ url: data.content_url, version: data.version, name: data.name });
            }
          } else {
            return corsError("missing url or repo/name", 400);
          }

          const upstream = await fetch(tgzUrl, { redirect: "follow" });
          if (!upstream.ok || !upstream.body) {
            return corsError(`chart fetch ${upstream.status}`, upstream.status);
          }
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type": "application/gzip",
            "Access-Control-Expose-Headers": "Content-Length, Content-Type",
          };
          const len = upstream.headers.get("content-length");
          if (len) headers["Content-Length"] = len;
          return new Response(upstream.body, { status: 200, headers });
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
