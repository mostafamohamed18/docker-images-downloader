// Shared, client-safe types for the scanner feature.

export type PackageManager = "apt" | "apk" | "dnf" | "yum";

export interface DetectedPackage {
  name: string;
  version: string;
  ecosystem: "Debian" | "Ubuntu" | "Alpine";
}

export interface VulnRef {
  id: string;
  url: string;
}

export interface VulnerablePackage {
  name: string;
  installedVersion: string;
  ecosystem: string;
  vulns: VulnRef[];
}

export interface ScanResult {
  image: string;
  osFamily: string;
  osRelease: string;
  packageManager: PackageManager | "unknown";
  packageCount: number;
  vulnerabilities: VulnerablePackage[];
  totalCves: number;
  note?: string;
}

export interface FixPlan {
  baseImage: string;
  packageManager: PackageManager;
  upgrades: string[];
}
