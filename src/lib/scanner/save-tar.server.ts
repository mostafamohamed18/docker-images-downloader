// Parse a `docker save` output tar and extract installed packages,
// reusing the same OS/package-DB detection as the registry-based scanner.

import { readTar, gunzip } from "./tar-reader.server";
import { detectOs, parseApkInstalled, parseDpkgStatus } from "./parse-packages.server";
import type { DetectedPackage, PackageManager } from "./types";

const INTERESTING_FILES = new Set([
  "etc/os-release",
  "usr/lib/os-release",
  "var/lib/dpkg/status",
  "lib/apk/db/installed",
]);

export interface SaveExtractResult {
  repoTag: string | null;
  osFamily: string;
  osRelease: string;
  packageManager: PackageManager | "unknown";
  packages: DetectedPackage[];
  ecosystem: "Debian" | "Ubuntu" | "Alpine" | null;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function extractPackagesFromDockerSave(tarBytes: Uint8Array): Promise<SaveExtractResult> {
  // Pass 1: index all files in the outer tar (docker save is not gzipped).
  const outer = new Map<string, Uint8Array>();
  for (const entry of readTar(tarBytes)) {
    outer.set(entry.name.replace(/^\.\//, ""), entry.body);
  }

  const manifestBytes = outer.get("manifest.json");
  if (!manifestBytes) throw new Error("Not a docker save tar: missing manifest.json");
  let manifest: Array<{ RepoTags?: string[]; Layers?: string[] }>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("Invalid manifest.json in tar");
  }
  const entry = manifest[0];
  if (!entry?.Layers?.length) throw new Error("manifest.json has no layers");
  const repoTag = entry.RepoTags?.[0] || null;

  // Walk layers oldest→newest with overlay semantics
  const filesystem = new Map<string, Uint8Array>();
  for (const layerPath of entry.Layers) {
    const raw = outer.get(layerPath.replace(/^\.\//, ""));
    if (!raw) continue;
    let bytes = raw;
    if (isGzip(bytes)) {
      try { bytes = await gunzip(bytes); } catch { /* fall through */ }
    }
    for (const e of readTar(bytes)) {
      const clean = e.name.replace(/^\.\//, "").replace(/^\/+/, "");
      const base = clean.split("/").pop() || "";
      if (base.startsWith(".wh.")) {
        const target = clean.replace(/\.wh\./, "").replace(/^\.wh\./, "");
        filesystem.delete(target);
        continue;
      }
      if (INTERESTING_FILES.has(clean)) {
        filesystem.set(clean, e.body);
      }
    }
  }

  const osReleaseBytes = filesystem.get("etc/os-release") || filesystem.get("usr/lib/os-release");
  if (!osReleaseBytes) {
    return {
      repoTag,
      osFamily: "unknown",
      osRelease: "unknown (no /etc/os-release)",
      packageManager: "unknown",
      packages: [],
      ecosystem: null,
    };
  }
  const os = detectOs(new TextDecoder().decode(osReleaseBytes));
  let packages: DetectedPackage[] = [];
  if (os.packageManager === "apt" && (os.ecosystem === "Debian" || os.ecosystem === "Ubuntu")) {
    const dpkg = filesystem.get("var/lib/dpkg/status");
    if (dpkg) packages = parseDpkgStatus(new TextDecoder().decode(dpkg), os.ecosystem);
  } else if (os.packageManager === "apk") {
    const apk = filesystem.get("lib/apk/db/installed");
    if (apk) packages = parseApkInstalled(new TextDecoder().decode(apk));
  }

  return {
    repoTag,
    osFamily: os.osFamily,
    osRelease: os.osRelease,
    packageManager: os.packageManager,
    packages,
    ecosystem: os.ecosystem,
  };
}
