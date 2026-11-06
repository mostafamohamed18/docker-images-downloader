// Shared CORS + registry helpers for server routes.
// Do not import from client code.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

export const DOCKER_HUB_MIRROR_HOST = "mirror.gcr.io";

export const DOCKER_RATE_LIMIT_MESSAGE =
  "Docker Hub anonymous pull limit reached. This app now tries Google's public Docker Hub mirror first for Docker Hub pulls, but the requested image or layer was not available there. Try again later, use another registry, or use a less rate-limited network.";

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function corsError(message: string, status = 500): Response {
  return corsJson({ error: message }, status);
}

export async function safeErrorText(response: Response): Promise<string> {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}

export function isRateLimitResponse(status: number, body = ""): boolean {
  return (
    status === 429 ||
    /too\s*many\s*requests|toomanyrequests|rate\s*limit/i.test(body)
  );
}

export function registryFetchError(
  action: string,
  status: number,
  body = "",
): string {
  if (isRateLimitResponse(status, body)) return DOCKER_RATE_LIMIT_MESSAGE;
  const detail = body.trim();
  return detail ? `${action} failed ${status}: ${detail}` : `${action} failed ${status}`;
}

export function normalizeDockerHubRepo(repo: string): string {
  const clean = repo
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^registry-1\.docker\.io\//, "")
    .replace(/^docker\.io\//, "")
    .replace(/^_\//, "library/")
    .replace(/^\/+|\/+$/g, "");
  return clean.includes("/") ? clean : `library/${clean}`;
}

export function publicDockerHubName(repo: string): string {
  return repo.replace(/^library\//, "");
}

// Resolve host+auth endpoint from a registry id.
export interface RegistryEndpoint {
  host: string;
  authUrl: (repo: string) => string;
}

export function endpointFor(registry: string, customHost?: string): RegistryEndpoint {
  switch (registry) {
    case "docker":
      return {
        host: "registry-1.docker.io",
        authUrl: (repo) =>
          `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
      };
    case "ghcr":
      return {
        host: "ghcr.io",
        authUrl: (repo) => `https://ghcr.io/token?scope=repository:${repo}:pull`,
      };
    case "gcr":
      return {
        host: "gcr.io",
        authUrl: (repo) =>
          `https://gcr.io/v2/token?service=gcr.io&scope=repository:${repo}:pull`,
      };
    case "chainguard":
      return {
        host: "cgr.dev",
        authUrl: (repo) =>
          `https://cgr.dev/token?scope=repository:${repo}:pull`,
      };
    case "quay":
      return {
        host: "quay.io",
        authUrl: (repo) =>
          `https://quay.io/v2/auth?service=quay.io&scope=repository:${repo}:pull`,
      };
    case "custom": {
      if (!customHost) throw new Error("custom registry requires host param");
      return {
        host: customHost,
        authUrl: (repo) =>
          `https://${customHost}/v2/token?scope=repository:${repo}:pull`,
      };
    }
    default:
      throw new Error(`unknown registry: ${registry}`);
  }
}

// Fetch an anonymous bearer token. Returns null if the registry allows anon
// without a token (rare). Handles the WWW-Authenticate challenge for unknown
// custom registries by falling back to the requested URL.
export async function fetchAnonToken(
  ep: RegistryEndpoint,
  repo: string,
): Promise<string | null> {
  const url = ep.authUrl(repo);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    // Some public registries allow unauthenticated pulls
    if (res.status === 404 || res.status === 401) return null;
    throw new Error(`token fetch failed ${res.status}: ${await res.text()}`);
  }
  const data: { token?: string; access_token?: string } = await res.json();
  return data.token ?? data.access_token ?? null;
}

export const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.container.image.v1+json",
].join(", ");
