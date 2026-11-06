// Registry metadata and image-reference parsing.

export type RegistryId =
  | "docker"
  | "ghcr"
  | "gcr"
  | "chainguard"
  | "quay"
  | "custom";

export interface RegistryInfo {
  id: RegistryId;
  label: string;
  host: string; // canonical host for OCI distribution API
  authHost: string; // token endpoint host
  authService: string; // ?service= for token
  defaultNamespace?: string; // e.g. "library" for docker hub
  examples: string[];
}

export const REGISTRIES: Record<RegistryId, RegistryInfo> = {
  docker: {
    id: "docker",
    label: "Docker Hub",
    host: "registry-1.docker.io",
    authHost: "auth.docker.io",
    authService: "registry.docker.io",
    defaultNamespace: "library",
    examples: ["nginx:latest", "alpine:3.19", "postgres:16"],
  },
  ghcr: {
    id: "ghcr",
    label: "GitHub Container Registry",
    host: "ghcr.io",
    authHost: "ghcr.io",
    authService: "ghcr.io",
    examples: ["ghcr.io/actions/runner:latest"],
  },
  gcr: {
    id: "gcr",
    label: "Google Container Registry",
    host: "gcr.io",
    authHost: "gcr.io",
    authService: "gcr.io",
    examples: ["gcr.io/distroless/static:latest"],
  },
  chainguard: {
    id: "chainguard",
    label: "Chainguard",
    host: "cgr.dev",
    authHost: "cgr.dev",
    authService: "cgr.dev",
    examples: ["cgr.dev/chainguard/nginx:latest"],
  },
  quay: {
    id: "quay",
    label: "Quay.io",
    host: "quay.io",
    authHost: "quay.io",
    authService: "quay.io",
    examples: ["quay.io/prometheus/prometheus:latest"],
  },
  custom: {
    id: "custom",
    label: "Custom OCI",
    host: "",
    authHost: "",
    authService: "",
    examples: ["my.registry.io/team/app:1.0"],
  },
};

export interface ParsedRef {
  registry: RegistryId;
  host: string; // resolved host
  repository: string; // e.g. "library/nginx"
  reference: string; // tag or digest
  isDigest: boolean;
  raw: string;
}

/**
 * Parse a container image reference like:
 *   nginx:latest
 *   library/nginx@sha256:...
 *   ghcr.io/owner/repo:tag
 *   gcr.io/project/img:tag
 *   cgr.dev/chainguard/nginx:latest
 */
export function parseImageRef(input: string, hint?: RegistryId): ParsedRef {
  const raw = input.trim();
  if (!raw) throw new Error("Empty image reference");

  // Split off tag / digest
  let rest = raw;
  let reference = "latest";
  let isDigest = false;
  const atIdx = rest.indexOf("@");
  if (atIdx >= 0) {
    reference = rest.slice(atIdx + 1);
    rest = rest.slice(0, atIdx);
    isDigest = true;
  } else {
    // last ':' after last '/'
    const slash = rest.lastIndexOf("/");
    const colon = rest.lastIndexOf(":");
    if (colon > slash) {
      reference = rest.slice(colon + 1);
      rest = rest.slice(0, colon);
    }
  }

  // Detect host
  const firstSlash = rest.indexOf("/");
  const head = firstSlash === -1 ? rest : rest.slice(0, firstSlash);
  const hasHost =
    head.includes(".") || head.includes(":") || head === "localhost";

  let registry: RegistryId = hint ?? "docker";
  let host = "";
  let repository = rest;

  if (hasHost) {
    host = head;
    repository = rest.slice(firstSlash + 1);
    if (host === "ghcr.io") registry = "ghcr";
    else if (host.endsWith("gcr.io")) registry = "gcr";
    else if (host === "cgr.dev") registry = "chainguard";
    else if (host === "quay.io") registry = "quay";
    else if (host === "docker.io" || host === "registry-1.docker.io") {
      registry = "docker";
      host = REGISTRIES.docker.host;
    } else registry = "custom";
  } else {
    registry = "docker";
    host = REGISTRIES.docker.host;
    if (!repository.includes("/")) {
      repository = `${REGISTRIES.docker.defaultNamespace}/${repository}`;
    }
  }

  return { registry, host, repository, reference, isDigest, raw };
}

export function shortDigest(digest: string, len = 12): string {
  const clean = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  return clean.slice(0, len);
}
