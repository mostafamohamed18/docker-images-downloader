import { createFileRoute } from "@tanstack/react-router";
import {
  corsError,
  corsJson,
  corsPreflight,
  normalizeDockerHubRepo,
  publicDockerHubName,
  safeErrorText,
} from "@/lib/registry-proxy.server";

// Proxies search across Docker Hub, Artifact Hub (Helm), and Chainguard.
// ?source=docker|artifacthub|chainguard&q=nginx

// Chainguard has no anonymous search API. We list image names from the public
// chainguard-images/images GitHub repo (the free/public catalog) and filter
// server-side. Cached in module scope for the life of the worker isolate.
let chainguardCache: { names: string[]; at: number } | undefined;
let officialDockerCache: { names: string[]; at: number } | undefined;
const CHAINGUARD_TTL = 60 * 60 * 1000; // 1h
const OFFICIAL_TTL = 6 * 60 * 60 * 1000; // 6h
const DOCKER_SEARCH_TTL = 30 * 60 * 1000;

const dockerSearchCache = new Map<string, { results: DockerSearchResult[]; at: number }>();

async function getOfficialDockerImages(): Promise<string[]> {
  const now = Date.now();
  if (officialDockerCache && now - officialDockerCache.at < OFFICIAL_TTL) {
    return officialDockerCache.names;
  }
  const res = await fetch(
    "https://api.github.com/repos/docker-library/official-images/contents/library",
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "airgapped-packager" } },
  );
  if (!res.ok) throw new Error(`official-images listing ${res.status}`);
  const entries = (await res.json()) as Array<{ name: string; type: string }>;
  const names = entries.filter((e) => e.type === "file").map((e) => e.name).sort();
  officialDockerCache = { names, at: now };
  return names;
}


type DockerSearchResult = {
  name: string;
  description: string;
  stars: number;
  pulls: number;
  official: boolean;
  registry: "docker";
};

const POPULAR_DOCKER_IMAGES: DockerSearchResult[] = [
  {
    name: "nginx",
    description: "Official build of Nginx.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "tomcat",
    description: "Apache Tomcat servlet container and web server.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "alpine",
    description: "A minimal Docker image based on Alpine Linux.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "ubuntu",
    description: "Ubuntu base image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "debian",
    description: "Debian base image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "node",
    description: "Node.js runtime image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "python",
    description: "Python runtime image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "postgres",
    description: "PostgreSQL database image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "mysql",
    description: "MySQL database image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "redis",
    description: "Redis data store image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "busybox",
    description: "BusyBox base image.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
  {
    name: "traefik",
    description: "Traefik cloud native reverse proxy.",
    stars: 0,
    pulls: 0,
    official: true,
    registry: "docker",
  },
];


function parsePullCount(raw: string): number {
  const m = raw.trim().match(/^([\d.]+)\s*([KMB]?)\+?$/i);
  if (!m) return Number(raw) || 0;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

async function getChainguardImages(): Promise<string[]> {
  const now = Date.now();
  if (chainguardCache && now - chainguardCache.at < CHAINGUARD_TTL) {
    return chainguardCache.names;
  }
  const res = await fetch(
    "https://api.github.com/repos/chainguard-images/images/contents/images",
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "airgapped-packager" } },
  );
  if (!res.ok) throw new Error(`chainguard listing ${res.status}`);
  const entries = (await res.json()) as Array<{ name: string; type: string }>;
  const names = entries.filter((e) => e.type === "dir").map((e) => e.name).sort();
  chainguardCache = { names, at: now };
  return names;
}

function getCachedDockerSearch(q: string): DockerSearchResult[] | null {
  const cached = dockerSearchCache.get(q.toLowerCase());
  if (!cached) return null;
  if (Date.now() - cached.at > DOCKER_SEARCH_TTL) {
    dockerSearchCache.delete(q.toLowerCase());
    return null;
  }
  return cached.results;
}

function setCachedDockerSearch(q: string, results: DockerSearchResult[]) {
  dockerSearchCache.set(q.toLowerCase(), { results, at: Date.now() });
}

function sortDockerResults(q: string, results: DockerSearchResult[]): DockerSearchResult[] {
  const needle = q.toLowerCase();
  return [...results].sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    const aExact = aName === needle ? 0 : 1;
    const bExact = bName === needle ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    if (a.official !== b.official) return a.official ? -1 : 1;

    const aStarts = aName.startsWith(needle) ? 0 : 1;
    const bStarts = bName.startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;

    if (a.pulls !== b.pulls) return b.pulls - a.pulls;
    if (a.stars !== b.stars) return b.stars - a.stars;
    return a.name.localeCompare(b.name);
  });
}

async function fetchDockerRepo(repo: string): Promise<DockerSearchResult | null> {
  const res = await fetch(
    `https://hub.docker.com/v2/repositories/${encodeURIComponent(repo).replace(/%2F/g, "/")}/`,
    { headers: { Accept: "application/json", "User-Agent": "Docker-Images-Downloader" } },
  );
  if (!res.ok) return null;
  const data: {
    namespace?: string;
    name?: string;
    description?: string;
    star_count?: number;
    pull_count?: number;
    is_official?: boolean;
  } = await res.json();
  const fullName = data.namespace && data.name ? `${data.namespace}/${data.name}` : repo;
  return {
    name: publicDockerHubName(fullName),
    description: data.description ?? "",
    stars: data.star_count ?? 0,
    pulls: data.pull_count ?? 0,
    official: data.is_official ?? fullName.startsWith("library/"),
    registry: "docker",
  };
}

async function fallbackDockerSearch(q: string): Promise<DockerSearchResult[]> {
  const needle = q.toLowerCase();
  const normalized = normalizeDockerHubRepo(q);
  const publicName = publicDockerHubName(normalized);

  // Always seed with a synthetic exact-match so the user can proceed to
  // browse tags via the mirror even when Docker Hub search/repo API is
  // rate-limited.
  const synthetic: DockerSearchResult = {
    name: publicName,
    description: normalized.startsWith("library/")
      ? `Official Docker Hub image: ${publicName}`
      : `Docker Hub repository: ${publicName}`,
    stars: 0,
    pulls: 0,
    official: normalized.startsWith("library/"),
    registry: "docker",
  };

  let exact: DockerSearchResult | null = null;
  try {
    exact = await fetchDockerRepo(normalized);
  } catch {
    exact = null;
  }

  const popular = POPULAR_DOCKER_IMAGES.filter(
    (image) =>
      image.name.toLowerCase().includes(needle) ||
      image.description.toLowerCase().includes(needle),
  );

  // Pull the full Docker Hub official-images catalog from GitHub (not rate-limited
  // the same way as Docker Hub search) so users see every matching official image.
  let officialMatches: DockerSearchResult[] = [];
  try {
    const names = await getOfficialDockerImages();
    officialMatches = names
      .filter((n) => n.toLowerCase().includes(needle))
      .slice(0, 40)
      .map((n) => ({
        name: n,
        description: `Official Docker Hub image: ${n}`,
        stars: 0,
        pulls: 0,
        official: true,
        registry: "docker" as const,
      }));
  } catch {
    officialMatches = [];
  }

  const byName = new Map<string, DockerSearchResult>();
  for (const result of [exact ?? synthetic, ...officialMatches, ...popular]) {
    if (result && !byName.has(result.name)) byName.set(result.name, result);
  }
  const all = sortDockerResults(q, [...byName.values()]);
  return all.slice(0, 40);
}



export const Route = createFileRoute("/api/public/registry/search")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const source = url.searchParams.get("source") ?? "docker";
          const q = url.searchParams.get("q") ?? "";
          const debug = url.searchParams.get("debug") === "1";
          const dbg: Record<string, unknown> = {};
          if (!q) return corsJson({ results: [] });

          if (source === "docker") {
            const cached = getCachedDockerSearch(q);
            if (cached && !debug) return corsJson({ results: cached });

            // Try Docker Hub search v3 first (returns many more results,
            // including community repos), then fall back to legacy v2, then
            // to synthetic + popular list.
            try {
              const res = await fetch(
                `https://hub.docker.com/api/search/v3/catalog/search?query=${encodeURIComponent(q)}&type=image&size=25`,
                {
                  headers: {
                    Accept: "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; Docker-Images-Downloader/1.0)",
                  },
                },
              );
              dbg.v3_status = res.status;
              if (res.ok) {
                const data: {
                  results?: Array<{
                    name?: string;
                    slug?: string;
                    short_description?: string;
                    star_count?: number;
                    rate_plans?: Array<{
                      repositories?: Array<{
                        name?: string;
                        namespace?: string;
                        description?: string;
                        pull_count?: string | number;
                        is_official?: boolean;
                      }>;
                    }>;
                  }>;
                } = await res.json();
                dbg.v3_count = data.results?.length ?? 0;
                if (data.results?.length) {
                  const results: DockerSearchResult[] = [];
                  const seen = new Set<string>();
                  for (const r of data.results) {
                    const repo = r.rate_plans?.[0]?.repositories?.[0];
                    const ns = repo?.namespace;
                    const nm = repo?.name ?? r.slug ?? r.name;
                    if (!nm) continue;
                    const fullName = ns && ns !== "library" ? `${ns}/${nm}` : nm;
                    if (seen.has(fullName)) continue;
                    seen.add(fullName);
                    const pullsRaw = repo?.pull_count;
                    const pullsNum =
                      typeof pullsRaw === "number"
                        ? pullsRaw
                        : typeof pullsRaw === "string"
                          ? parsePullCount(pullsRaw)
                          : 0;
                    results.push({
                      name: fullName,
                      description: repo?.description ?? r.short_description ?? "",
                      stars: r.star_count ?? 0,
                      pulls: pullsNum,
                      official: !!repo?.is_official || ns === "library",
                      registry: "docker",
                    });
                  }
                  if (results.length) {
                    const sorted = sortDockerResults(q, results);
                    setCachedDockerSearch(q, sorted);
                    if (debug) return corsJson({ results: sorted, debug: dbg });
                    return corsJson({ results: sorted });
                  }
                }
              } else {
                dbg.v3_body = (await safeErrorText(res)).slice(0, 300);
              }
            } catch (e) {
              dbg.v3_err = (e as Error).message;
            }

            // Legacy v2 as secondary
            try {
              const res = await fetch(
                `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=25`,
                {
                  headers: {
                    Accept: "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; Docker-Images-Downloader/1.0)",
                  },
                },
              );
              dbg.v2_status = res.status;
              if (res.ok) {
                const data: {
                  results: Array<{
                    repo_name: string;
                    short_description?: string;
                    star_count?: number;
                    pull_count?: number;
                    is_official?: boolean;
                  }>;
                } = await res.json();
                dbg.v2_count = data.results?.length ?? 0;
                if (data.results?.length) {
                  const results = data.results.map((r): DockerSearchResult => ({
                    name: r.repo_name,
                    description: r.short_description ?? "",
                    stars: r.star_count ?? 0,
                    pulls: r.pull_count ?? 0,
                    official: !!r.is_official,
                    registry: "docker" as const,
                  }));
                  const sorted = sortDockerResults(q, results);
                  setCachedDockerSearch(q, sorted);
                  if (debug) return corsJson({ results: sorted, debug: dbg });
                  return corsJson({ results: sorted });
                }
              } else {
                dbg.v2_body = (await safeErrorText(res)).slice(0, 300);
              }
            } catch (e) {
              dbg.v2_err = (e as Error).message;
            }

            // Last Docker Hub API fallback before the offline catalog. This
            // legacy endpoint often remains available when the newer search
            // APIs rate-limit shared server IPs.
            try {
              const res = await fetch(
                `https://index.docker.io/v1/search?q=${encodeURIComponent(q)}&n=25`,
                {
                  headers: {
                    Accept: "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; Docker-Images-Downloader/1.0)",
                  },
                },
              );
              dbg.v1_status = res.status;
              if (res.ok) {
                const data: {
                  results?: Array<{
                    name: string;
                    description?: string;
                    star_count?: number;
                    pull_count?: number;
                    is_official?: boolean;
                  }>;
                } = await res.json();
                dbg.v1_count = data.results?.length ?? 0;
                if (data.results?.length) {
                  const results = sortDockerResults(
                    q,
                    data.results.map((r): DockerSearchResult => ({
                      name: r.name,
                      description: r.description ?? "",
                      stars: r.star_count ?? 0,
                      pulls: r.pull_count ?? 0,
                      official: !!r.is_official,
                      registry: "docker" as const,
                    })),
                  );
                  setCachedDockerSearch(q, results);
                  if (debug) return corsJson({ results, debug: dbg });
                  return corsJson({ results });
                }
              } else {
                dbg.v1_body = (await safeErrorText(res)).slice(0, 300);
              }
            } catch (e) {
              dbg.v1_err = (e as Error).message;
            }

            const fallback = await fallbackDockerSearch(q);
            setCachedDockerSearch(q, fallback);
            if (debug) return corsJson({ results: fallback, debug: dbg });
            return corsJson({ results: fallback });
          }




          if (source === "artifacthub") {
            const res = await fetch(
              `https://artifacthub.io/api/v1/packages/search?kind=0&limit=20&ts_query_web=${encodeURIComponent(q)}`,
            );
            if (!res.ok) return corsError(`artifacthub ${res.status}`, res.status);
            const data: {
              packages: Array<{
                package_id: string;
                name: string;
                version: string;
                description?: string;
                repository: { name: string; url: string };
                stars?: number;
              }>;
            } = await res.json();
            return corsJson({
              results: data.packages.map((p) => ({
                id: p.package_id,
                name: p.name,
                version: p.version,
                description: p.description ?? "",
                repoName: p.repository.name,
                repoUrl: p.repository.url,
                stars: p.stars ?? 0,
              })),
            });
          }

          if (source === "chainguard") {
            const names = await getChainguardImages();
            const needle = q.toLowerCase();
            const matches = names
              .filter((n) => n.toLowerCase().includes(needle))
              .slice(0, 40);
            return corsJson({
              results: matches.map((name) => ({
                name: `chainguard/${name}`,
                slug: name,
                description: `Chainguard hardened image: ${name}`,
                registry: "chainguard" as const,
                url: `https://images.chainguard.dev/directory/image/${name}`,
              })),
            });
          }

          return corsError("unknown source", 400);
        } catch (err) {
          return corsError((err as Error).message, 500);
        }
      },
    },
  },
});
