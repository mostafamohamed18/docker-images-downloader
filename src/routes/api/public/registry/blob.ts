import { createFileRoute } from "@tanstack/react-router";
import {
  CORS_HEADERS,
  DOCKER_HUB_MIRROR_HOST,
  corsError,
  corsPreflight,
  endpointFor,
  fetchAnonToken,
  isRateLimitResponse,
  registryFetchError,
  safeErrorText,
} from "@/lib/registry-proxy.server";

async function fetchDockerMirrorBlob(
  repo: string,
  digest: string,
): Promise<Response | null> {
  const mirrorUrl = `https://${DOCKER_HUB_MIRROR_HOST}/v2/${repo}/blobs/${digest}`;
  const res = await fetch(mirrorUrl, {
    headers: { Accept: "*/*" },
    redirect: "follow",
  });
  return res.ok && res.body ? res : null;
}

// Streams a blob (image config JSON or layer bytes) back to the client
// without buffering. Client passes ?registry=&repo=&digest=&host=.
export const Route = createFileRoute("/api/public/registry/blob")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const registry = url.searchParams.get("registry") ?? "docker";
          const repo = url.searchParams.get("repo");
          const digest = url.searchParams.get("digest");
          const host = url.searchParams.get("host") ?? undefined;
          if (!repo || !digest) return corsError("missing repo/digest", 400);

          const ep = endpointFor(registry, host ?? undefined);
          let upstream: Response | null =
            registry === "docker" ? await fetchDockerMirrorBlob(repo, digest) : null;

          if (!upstream) {
            let token: string | null = null;
            try {
              token = await fetchAnonToken(ep, repo);
            } catch (err) {
              const message = (err as Error).message;
              if (registry === "docker" && isRateLimitResponse(429, message)) {
                return corsError(registryFetchError("token fetch", 429, message), 429);
              }
              throw err;
            }
            const blobUrl = `https://${ep.host}/v2/${repo}/blobs/${digest}`;
            const headers: Record<string, string> = { Accept: "*/*" };
            if (token) headers.Authorization = `Bearer ${token}`;
            upstream = await fetch(blobUrl, { headers, redirect: "follow" });
          }

          if (!upstream.ok || !upstream.body) {
            const body = await safeErrorText(upstream);
            return corsError(
              registryFetchError("blob fetch", upstream.status, body),
              upstream.status,
            );
          }
          const outHeaders: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type":
              upstream.headers.get("content-type") ?? "application/octet-stream",
          };
          const len = upstream.headers.get("content-length");
          if (len) outHeaders["Content-Length"] = len;
          // Expose so client can read it
          outHeaders["Access-Control-Expose-Headers"] = "Content-Length, Content-Type";

          return new Response(upstream.body, {
            status: 200,
            headers: outHeaders,
          });
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
