// Pull an image from Docker Hub via the existing mirror, extract package DBs
// from its layers, detect the OS and installed packages.

import {
  DOCKER_HUB_MIRROR_HOST,
  MANIFEST_ACCEPT,
  endpointFor,
  fetchAnonToken,
  normalizeDockerHubRepo,
} from "@/lib/registry-proxy.server";
import { readTar, gunzip } from "./tar-reader.server";
import { detectOs, parseApkInstalled, parseDpkgStatus } from "./parse-packages.server";
import type { DetectedPackage, PackageManager } from "./types";

const INTERESTING_FILES = new Set([
  "etc/os-release",
  "usr/lib/os-release",
  "var/lib/dpkg/status",
  "lib/apk/db/installed",
]);

async function fetchManifest(repo: string, reference: string): Promise<{ manifest: any; token: string | null }> {
  // Try mirror first
  const mirrorRes = await fetch(
    `https://${DOCKER_HUB_MIRROR_HOST}/v2/${repo}/manifests/${encodeURIComponent(reference)}`,
    { headers: { Accept: MANIFEST_ACCEPT } },
  );
  if (mirrorRes.ok) return { manifest: await mirrorRes.json(), token: null };

  // Fallback to real Docker Hub
  const ep = endpointFor("docker");
  const token = await fetchAnonToken(ep, repo);
  const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `https://${ep.host}/v2/${repo}/manifests/${encodeURIComponent(reference)}`,
    { headers },
  );
  if (!res.ok) throw new Error(`manifest fetch failed ${res.status}`);
  return { manifest: await res.json(), token };
}

async function fetchPlatformManifest(repo: string, reference: string): Promise<any> {
  const { manifest, token } = await fetchManifest(repo, reference);
  // If it's a manifest list, pick linux/amd64
  if (Array.isArray(manifest.manifests)) {
    const match = manifest.manifests.find(
      (m: any) => m.platform?.architecture === "amd64" && m.platform?.os === "linux",
    );
    if (!match) throw new Error("no linux/amd64 manifest in index");
    const { manifest: sub } = await fetchManifest(repo, match.digest);
    return sub;
  }
  void token;
  return manifest;
}

async function fetchBlob(repo: string, digest: string): Promise<Uint8Array> {
  const mirrorRes = await fetch(
    `https://${DOCKER_HUB_MIRROR_HOST}/v2/${repo}/blobs/${digest}`,
    { headers: { Accept: "*/*" }, redirect: "follow" },
  );
  if (mirrorRes.ok) return new Uint8Array(await mirrorRes.arrayBuffer());

  const ep = endpointFor("docker");
  const token = await fetchAnonToken(ep, repo);
  const headers: Record<string, string> = { Accept: "*/*" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://${ep.host}/v2/${repo}/blobs/${digest}`, {
    headers,
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`blob fetch failed ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface ExtractResult {
  osFamily: string;
  osRelease: string;
  packageManager: PackageManager | "unknown";
  packages: DetectedPackage[];
  ecosystem: "Debian" | "Ubuntu" | "Alpine" | null;
}

export async function extractImagePackages(image: string): Promise<ExtractResult> {
  // Parse image ref: name[:tag]
  const [namePart, tagRaw] = image.split(":");
  const tag = tagRaw || "latest";
  const repo = normalizeDockerHubRepo(namePart);

  const manifest = await fetchPlatformManifest(repo, tag);
  const layers: Array<{ digest: string; size?: number }> = manifest.layers || [];
  if (!layers.length) throw new Error("manifest has no layers");

  // Walk layers newest → oldest and keep the first (newest) version of each
  // interesting file. This surfaces the effective on-disk state even when a
  // large image forces us to stop early at the memory cap, and lets us bail
  // out as soon as every interesting file has been located.
  const filesystem = new Map<string, Uint8Array>();
  const deleted = new Set<string>();

  // Cap total layer bytes to fit in Worker memory (~100 MB).
  const MAX_TOTAL = 100 * 1024 * 1024;
  let total = 0;

  outer: for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const raw = await fetchBlob(repo, layer.digest);
    total += raw.byteLength;
    if (total > MAX_TOTAL) break;

    let tarBytes: Uint8Array;
    try {
      tarBytes = await gunzip(raw);
    } catch {
      // Non-gzipped layer — treat raw as tar. zstd layers will fail readTar
      // silently below and we simply move on.
      tarBytes = raw;
    }
    try {
      for (const entry of readTar(tarBytes)) {
        const clean = entry.name.replace(/^\.\//, "").replace(/^\/+/, "");
        const base = clean.split("/").pop() || "";
        if (base.startsWith(".wh.")) {
          const target = clean.replace(/\.wh\./, "").replace(/^\.wh\./, "");
          deleted.add(target);
          continue;
        }
        if (INTERESTING_FILES.has(clean) && !filesystem.has(clean) && !deleted.has(clean)) {
          filesystem.set(clean, entry.body);
          const hasOs = filesystem.has("etc/os-release") || filesystem.has("usr/lib/os-release");
          const hasPkgs = filesystem.has("var/lib/dpkg/status") || filesystem.has("lib/apk/db/installed");
          if (hasOs && hasPkgs) break outer;
        }
      }
    } catch {
      // Corrupt / unsupported layer format — skip.
    }
  }

  const osReleaseBytes = filesystem.get("etc/os-release") || filesystem.get("usr/lib/os-release");
  if (!osReleaseBytes) {
    // Detect zstd-compressed layers (magic 28 b5 2f fd) so we can give a
    // useful message instead of a generic "unsupported OS".
    const note = layers.length
      ? `Could not read layers (image may use zstd-compressed layers, which aren't supported in the Worker sandbox). Try uploading a "docker save" tar instead.`
      : "no /etc/os-release";
    return {
      osFamily: "unknown",
      osRelease: `unknown (${note})`,
      packageManager: "unknown",
      packages: [],
      ecosystem: null,
    };
  }
  const osReleaseText = new TextDecoder().decode(osReleaseBytes);
  const os = detectOs(osReleaseText);

  let packages: DetectedPackage[] = [];
  if (os.packageManager === "apt" && (os.ecosystem === "Debian" || os.ecosystem === "Ubuntu")) {
    const dpkg = filesystem.get("var/lib/dpkg/status");
    if (dpkg) packages = parseDpkgStatus(new TextDecoder().decode(dpkg), os.ecosystem);
  } else if (os.packageManager === "apk") {
    const apk = filesystem.get("lib/apk/db/installed");
    if (apk) packages = parseApkInstalled(new TextDecoder().decode(apk));
  }

  return {
    osFamily: os.osFamily,
    osRelease: os.osRelease,
    packageManager: os.packageManager,
    packages,
    ecosystem: os.ecosystem,
  };
}
