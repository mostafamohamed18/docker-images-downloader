import { createFileRoute } from "@tanstack/react-router";
import {
  CORS_HEADERS,
  DOCKER_HUB_MIRROR_HOST,
  corsError,
  corsJson,
  corsPreflight,
  endpointFor,
  fetchAnonToken,
  isRateLimitResponse,
  registryFetchError,
  safeErrorText,
  MANIFEST_ACCEPT,
} from "@/lib/registry-proxy.server";

async function fetchDockerMirrorManifest(
  repo: string,
  reference: string,
): Promise<Response | null> {
  const mirrorUrl = `https://${DOCKER_HUB_MIRROR_HOST}/v2/${repo}/manifests/${encodeURIComponent(reference)}`;
  const res = await fetch(mirrorUrl, { headers: { Accept: MANIFEST_ACCEPT } });
  return res.ok ? res : null;
}

export const Route = createFileRoute("/api/public/registry/manifest")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const registry = url.searchParams.get("registry") ?? "docker";
          const repo = url.searchParams.get("repo");
          const reference = url.searchParams.get("reference") ?? "latest";
          const host = url.searchParams.get("host") ?? undefined;
          const arch = url.searchParams.get("arch") ?? "amd64";
          const os = url.searchParams.get("os") ?? "linux";
          const raw = url.searchParams.get("raw") === "1";
          if (!repo) return corsError("missing repo", 400);

          const ep = endpointFor(registry, host ?? undefined);
          let token: string | null = null;
          let headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
          let res: Response | null =
            registry === "docker"
              ? await fetchDockerMirrorManifest(repo, reference)
              : null;

          if (!res) {
            try {
              token = await fetchAnonToken(ep, repo);
            } catch (err) {
              const message = (err as Error).message;
              if (registry === "docker" && isRateLimitResponse(429, message)) {
                return corsError(registryFetchError("token fetch", 429, message), 429);
              }
              throw err;
            }
            headers = { Accept: MANIFEST_ACCEPT };
            if (token) headers.Authorization = `Bearer ${token}`;
            const manifestUrl = `https://${ep.host}/v2/${repo}/manifests/${encodeURIComponent(reference)}`;
            res = await fetch(manifestUrl, { headers });
          }

          if (!res.ok) {
            const body = await safeErrorText(res);
            return corsError(
              registryFetchError("manifest fetch", res.status, body),
              res.status,
            );
          }
          const contentType = res.headers.get("content-type") ?? "";
          const digest = res.headers.get("docker-content-digest") ?? "";
          const body = await res.json();

          // If manifest list / OCI index, pick platform match unless raw.
          const isIndex =
            contentType.includes("manifest.list") ||
            contentType.includes("image.index") ||
            Array.isArray(body?.manifests);

          if (isIndex && !raw) {
            const match = (body.manifests as Array<{
              digest: string;
              platform?: { architecture?: string; os?: string; variant?: string };
              mediaType?: string;
            }>).find(
              (m) =>
                m.platform?.architecture === arch && m.platform?.os === os,
            );
            if (!match) {
              return corsJson({
                kind: "index",
                index: body,
                digest,
                contentType,
              });
            }
            // Recurse: fetch selected platform manifest
            let subRes: Response | null =
              registry === "docker"
                ? await fetchDockerMirrorManifest(repo, match.digest)
                : null;
            if (!subRes) {
              if (!token && registry === "docker") {
                try {
                  token = await fetchAnonToken(ep, repo);
                } catch (err) {
                  const message = (err as Error).message;
                  if (registry === "docker" && isRateLimitResponse(429, message)) {
                    return corsError(registryFetchError("token fetch", 429, message), 429);
                  }
                  throw err;
                }
                headers = { Accept: MANIFEST_ACCEPT };
                if (token) headers.Authorization = `Bearer ${token}`;
              }
              const subUrl = `https://${ep.host}/v2/${repo}/manifests/${encodeURIComponent(match.digest)}`;
              subRes = await fetch(subUrl, { headers });
            }
            if (!subRes.ok) {
              const body = await safeErrorText(subRes);
              return corsError(
                registryFetchError("platform manifest fetch", subRes.status, body),
                subRes.status,
              );
            }
            const subBody = await subRes.json();
            return corsJson({
              kind: "manifest",
              manifest: subBody,
              digest: subRes.headers.get("docker-content-digest") ?? match.digest,
              contentType: subRes.headers.get("content-type") ?? "",
              platform: match.platform,
            });
          }

          return corsJson({
            kind: isIndex ? "index" : "manifest",
            manifest: body,
            digest,
            contentType,
          });
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});

export const _cors = CORS_HEADERS;
