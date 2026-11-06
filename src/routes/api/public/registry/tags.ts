import { createFileRoute } from "@tanstack/react-router";
import {
  DOCKER_HUB_MIRROR_HOST,
  corsError,
  corsJson,
  corsPreflight,
  endpointFor,
  fetchAnonToken,
  isRateLimitResponse,
  normalizeDockerHubRepo,
  registryFetchError,
  safeErrorText,
} from "@/lib/registry-proxy.server";

interface TagInfo {
  name: string;
  size: number;
  updated: string | null;
  digest: string | null;
  architectures: string[];
}

type TagCacheEntry = { tags: TagInfo[]; at: number };

const TAG_CACHE_TTL = 30 * 60 * 1000;
const tagCache = new Map<string, TagCacheEntry>();

function getCachedTags(key: string): TagInfo[] | null {
  const cached = tagCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.at > TAG_CACHE_TTL) {
    tagCache.delete(key);
    return null;
  }
  return cached.tags;
}

function setCachedTags(key: string, tags: TagInfo[]) {
  tagCache.set(key, { tags, at: Date.now() });
}

async function fetchMirrorDockerTags(repo: string, limit: number): Promise<TagInfo[] | null> {
  const candidates = [repo];
  if (repo.startsWith("library/")) candidates.push(repo.replace(/^library\//, ""));

  for (const candidate of candidates) {
    const res = await fetch(
      `https://${DOCKER_HUB_MIRROR_HOST}/v2/${candidate}/tags/list?n=${limit}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) continue;
    const data: {
      tags?: string[] | null;
      manifest?: Record<
        string,
        { tag?: string[]; timeUploadedMs?: string; mediaType?: string }
      >;
    } = await res.json();

    const byName = new Map<string, TagInfo>();
    for (const [digestHex, manifest] of Object.entries(data.manifest ?? {})) {
      for (const name of manifest.tag ?? []) {
        if (!name || byName.has(name)) continue;
        const ms = Number(manifest.timeUploadedMs);
        byName.set(name, {
          name,
          size: 0,
          updated: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
          digest: `sha256:${digestHex.replace(/^sha256:/, "")}`,
          architectures: [],
        });
      }
    }
    for (const name of data.tags ?? []) {
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        size: 0,
        updated: null,
        digest: null,
        architectures: [],
      });
    }
    const tags = [...byName.values()]
      .sort((a, b) => {
        if (a.name === "latest") return -1;
        if (b.name === "latest") return 1;
        return (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name);
      })
      .slice(0, limit);
    if (tags.length > 0) return tags;
  }
  return null;
}

async function fetchDockerHubTags(repo: string, limit: number): Promise<TagInfo[] | Response> {
  const res = await fetch(
    `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=${limit}&ordering=last_updated`,
    { headers: { Accept: "application/json", "User-Agent": "Docker-Images-Downloader" } },
  );
  if (!res.ok) return res;
  const data: {
    results: Array<{
      name: string;
      full_size?: number;
      last_updated?: string;
      digest?: string;
      images?: Array<{ architecture: string; os: string }>;
    }>;
  } = await res.json();
  return data.results.map((t) => ({
    name: t.name,
    size: t.full_size ?? 0,
    updated: t.last_updated ?? null,
    digest: t.digest ?? null,
    architectures: (t.images ?? [])
      .filter((i) => i.os === "linux" && i.architecture)
      .map((i) => i.architecture),
  }));
}

// List tags for a repository.
//   Docker Hub: uses the hub.docker.com REST API (richer metadata, public).
//   Other OCI registries: /v2/<repo>/tags/list with an anonymous bearer token.
//
// Query params:
//   registry  = docker | ghcr | gcr | chainguard | quay | custom
//   repo      = repository path (e.g. library/nginx, owner/name)
//   host      = required when registry=custom
//   limit     = max tags to return (default 100)
export const Route = createFileRoute("/api/public/registry/tags")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const registry = url.searchParams.get("registry") ?? "docker";
          const repo = url.searchParams.get("repo") ?? "";
          const host = url.searchParams.get("host") ?? undefined;
          const limit = Math.min(
            500,
            Math.max(1, Number(url.searchParams.get("limit") ?? "100")),
          );
          if (!repo) return corsError("repo is required", 400);

          if (registry === "docker") {
            const fullRepo = normalizeDockerHubRepo(repo);
            const cacheKey = `docker:${fullRepo}:${limit}`;
            const cached = getCachedTags(cacheKey);
            if (cached) return corsJson({ tags: cached });

            const mirrorTags = await fetchMirrorDockerTags(fullRepo, limit);
            if (mirrorTags?.length) {
              setCachedTags(cacheKey, mirrorTags);
              return corsJson({ tags: mirrorTags });
            }

            const hubTags = await fetchDockerHubTags(fullRepo, limit);
            if (hubTags instanceof Response) {
              const body = await safeErrorText(hubTags);
              if (isRateLimitResponse(hubTags.status, body)) {
                return corsJson({ tags: [] });
              }
              return corsError(
                registryFetchError("docker tags", hubTags.status, body),
                hubTags.status,
              );
            }
            setCachedTags(cacheKey, hubTags);
            return corsJson({ tags: hubTags });
          }

          const ep = endpointFor(registry, host);
          let token: string | null = null;
          try {
            token = await fetchAnonToken(ep, repo);
          } catch (err) {
            const msg = (err as Error).message;
            // Registry rejected the repo name (e.g. Chainguard requires a
            // namespace like chainguard/tomcat). Surface as 404, not 500.
            if (/400|invalid repository|not found|404/i.test(msg)) {
              return corsError(
                `Repository "${repo}" not found on ${ep.host}. Try a fully qualified path like "chainguard/${repo}".`,
                404,
              );
            }
            throw err;
          }
          const headers: Record<string, string> = { Accept: "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;

          // OCI /tags/list paginates via a `Link: <url>; rel="next"` header.
          // Follow it until we hit the limit or run out of pages.
          const collected: string[] = [];
          let next: string | null =
            `https://${ep.host}/v2/${repo}/tags/list?n=1000`;
          let pages = 0;
          while (next && collected.length < limit && pages < 10) {
            const res: Response = await fetch(next, { headers });
            if (!res.ok) {
              const body = await res.text();
              const status = res.status === 400 ? 404 : res.status;
              return corsError(
                status === 404
                  ? `Repository "${repo}" not found on ${ep.host}.`
                  : `tags ${res.status}: ${body}`,
                status,
              );
            }
            const data: { name: string; tags: string[] | null } = await res.json();
            for (const t of data.tags ?? []) collected.push(t);
            const link = res.headers.get("link");
            const m = link?.match(/<([^>]+)>\s*;\s*rel="next"/);
            next = m ? new URL(m[1], `https://${ep.host}`).toString() : null;
            pages++;
          }
          const tags = collected.slice(0, limit).map((name: string) => ({
              name,
              size: 0,
              updated: null,
              digest: null,
              architectures: [],
            }));
          return corsJson({ tags });
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
