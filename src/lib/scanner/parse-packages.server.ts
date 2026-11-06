// Parse dpkg status DBs (Debian/Ubuntu) and apk installed DBs (Alpine).

import type { DetectedPackage } from "./types";

// dpkg /var/lib/dpkg/status format: paragraph-per-package, "Key: value" lines.
export function parseDpkgStatus(text: string, ecosystem: "Debian" | "Ubuntu"): DetectedPackage[] {
  const packages: DetectedPackage[] = [];
  const paragraphs = text.split(/\n\n+/);
  for (const p of paragraphs) {
    let name = "", version = "", status = "";
    for (const line of p.split("\n")) {
      if (line.startsWith("Package: ")) name = line.slice(9).trim();
      else if (line.startsWith("Version: ")) version = line.slice(9).trim();
      else if (line.startsWith("Status: ")) status = line.slice(8).trim();
    }
    // Only include actually-installed packages
    if (name && version && status.includes("installed") && !status.includes("not-installed")) {
      packages.push({ name, version, ecosystem });
    }
  }
  return packages;
}

// apk /lib/apk/db/installed format: paragraph-per-package, "K:value" lines.
export function parseApkInstalled(text: string): DetectedPackage[] {
  const packages: DetectedPackage[] = [];
  const paragraphs = text.split(/\n\n+/);
  for (const p of paragraphs) {
    let name = "", version = "";
    for (const line of p.split("\n")) {
      if (line.startsWith("P:")) name = line.slice(2).trim();
      else if (line.startsWith("V:")) version = line.slice(2).trim();
    }
    if (name && version) packages.push({ name, version, ecosystem: "Alpine" });
  }
  return packages;
}

// Detect OS family from /etc/os-release content.
export function detectOs(osReleaseText: string): {
  osFamily: string;
  osRelease: string;
  packageManager: "apt" | "apk" | "dnf" | "yum" | "unknown";
  ecosystem: "Debian" | "Ubuntu" | "Alpine" | null;
} {
  const kv: Record<string, string> = {};
  for (const line of osReleaseText.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) kv[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  const id = (kv.ID || "").toLowerCase();
  const idLike = (kv.ID_LIKE || "").toLowerCase();
  const version = kv.VERSION_ID || kv.VERSION || "";
  const pretty = kv.PRETTY_NAME || `${id} ${version}`;

  if (id === "ubuntu" || idLike.includes("ubuntu")) {
    return { osFamily: "ubuntu", osRelease: pretty, packageManager: "apt", ecosystem: "Ubuntu" };
  }
  if (id === "debian" || idLike.includes("debian")) {
    return { osFamily: "debian", osRelease: pretty, packageManager: "apt", ecosystem: "Debian" };
  }
  if (id === "alpine") {
    return { osFamily: "alpine", osRelease: pretty, packageManager: "apk", ecosystem: "Alpine" };
  }
  if (id === "rhel" || id === "centos" || id === "rocky" || id === "almalinux" || id === "fedora" || idLike.includes("rhel")) {
    return { osFamily: id || "rhel", osRelease: pretty, packageManager: "dnf", ecosystem: null };
  }
  return { osFamily: id || "unknown", osRelease: pretty, packageManager: "unknown", ecosystem: null };
}
