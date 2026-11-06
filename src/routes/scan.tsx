import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Search,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Download,
  ExternalLink,
  AlertTriangle,
  Upload,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { FixPlan, ScanResult } from "@/lib/scanner/types";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Scan & Fix — Vulnerability scanner for Docker images" },
      {
        name: "description",
        content:
          "Scan any Docker Hub image or local .tar for CVEs, rebuild a patched version, and verify the fix. Powered by OSV.dev.",
      },
      { property: "og:title", content: "Scan & Fix — Docker Images Downloader" },
      {
        property: "og:description",
        content: "Pull or upload a Docker image, scan, rebuild, and rescan to confirm the fix.",
      },
    ],
  }),
  component: ScanPage,
});

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

async function postBinary<T>(url: string, body: Blob | ArrayBuffer): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-tar" },
    body,
  });
  return handleResponse<T>(res);
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || text);
    } catch {
      throw new Error(text || `${res.status}`);
    }
  }
  return (await res.json()) as T;
}

function canRebuildResult(r: ScanResult | null | undefined): boolean {
  if (!r) return false;
  if (r.totalCves === 0) return false;
  if (!["apt", "apk", "dnf", "yum"].includes(r.packageManager)) return false;
  // Don't offer rebuild on an image we already rebuilt — the builder-agent's
  // local docker-fix/<ts> tag isn't pullable from any registry.
  if (r.image.startsWith("docker-fix/") || r.image.startsWith("docker-fix-")) return false;
  // Uploaded tar labels look like "repo:tag" from RepoTags; require a rebuildable ref.
  return /^[a-zA-Z0-9._/-]+(:[a-zA-Z0-9._-]+)?$/.test(r.image) && !r.image.includes(" ");
}

function ScanPage() {
  const [image, setImage] = useState("nginx:1.25");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [afterResult, setAfterResult] = useState<ScanResult | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setResult(null);
    setAfterResult(null);
    setRebuildStatus("");
  };

  const scan = useMutation({
    mutationFn: (img: string) =>
      postJSON<ScanResult>("/api/public/registry/scan", { image: img }),
    onSuccess: (data) => {
      setResult(data);
      setAfterResult(null);
      if (data.totalCves === 0) toast.success("No vulnerabilities found");
      else toast.warning(`Found ${data.totalCves} CVEs across ${data.vulnerabilities.length} packages`);
    },
    onError: (err: Error) => {
      reset();
      toast.error(err.message);
    },
  });

  const scanTar = useMutation({
    mutationFn: (file: File) => postBinary<ScanResult>("/api/public/registry/scan-tar", file),
    onSuccess: (data) => {
      setResult(data);
      setAfterResult(null);
      if (data.totalCves === 0) toast.success("No vulnerabilities found");
      else toast.warning(`Found ${data.totalCves} CVEs across ${data.vulnerabilities.length} packages`);
    },
    onError: (err: Error) => {
      reset();
      toast.error(err.message);
    },
  });

  const rebuild = useMutation({
    mutationFn: async (plan: FixPlan) => {
      setRebuildStatus("Building on your agent…");
      setAfterResult(null);
      const res = await fetch("/api/public/registry/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          throw new Error(JSON.parse(text).error || text);
        } catch {
          throw new Error(text || `${res.status}`);
        }
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") || "";
      const nameMatch = /filename="?([^"]+)"?/.exec(dispo);
      const filename = nameMatch?.[1] || `${plan.baseImage.replace(/[^A-Za-z0-9._-]/g, "_")}-fixed.tar`;

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      // Automatic rescan of the fixed image
      setRebuildStatus("Rescanning fixed image…");
      try {
        const rescan = await postBinary<ScanResult>("/api/public/registry/scan-tar", blob);
        setAfterResult(rescan);
        if (rescan.totalCves === 0) toast.success("Fix verified: no CVEs remaining");
        else toast.warning(`${rescan.totalCves} CVEs remain after fix`);
      } catch (e) {
        toast.error(`Rescan failed: ${(e as Error).message}`);
      } finally {
        setRebuildStatus("");
      }
      return filename;
    },
    onSuccess: (filename) => toast.success(`Downloaded ${filename}`),
    onError: (err: Error) => {
      setRebuildStatus("");
      toast.error(err.message);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scan &amp; Fix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan a Docker Hub image or a local <code>docker save</code> tar against OSV.dev, rebuild a patched
          copy through your build agent, and rescan to verify. Supports Debian, Ubuntu, and Alpine bases.
        </p>
      </div>

      <Card className="p-6">
        <Tabs defaultValue="registry" onValueChange={reset}>
          <TabsList className="grid w-full grid-cols-2 sm:w-auto">
            <TabsTrigger value="registry">
              <Search className="mr-2 h-4 w-4" /> Docker Hub image
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="mr-2 h-4 w-4" /> Upload .tar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="registry" className="mt-4 space-y-2">
            <Label htmlFor="image">Image reference</Label>
            <div className="flex gap-2">
              <Input
                id="image"
                placeholder="nginx:1.25 or library/php:8.2-fpm"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && image.trim()) scan.mutate(image.trim());
                }}
              />
              <Button
                onClick={() => scan.mutate(image.trim())}
                disabled={!image.trim() || scan.isPending}
              >
                {scan.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…</>
                ) : (
                  <><Search className="mr-2 h-4 w-4" /> Scan</>
                )}
              </Button>
            </div>
            {scan.isPending && (
              <p className="text-xs text-muted-foreground">
                Fetching manifest → downloading layers → extracting packages → checking OSV.dev…
                (large images can take 30-60s)
              </p>
            )}
          </TabsContent>

          <TabsContent value="upload" className="mt-4 space-y-3">
            <Label htmlFor="tar">Local image tar</Label>
            <p className="text-xs text-muted-foreground">
              Produce it locally with <code>docker save myimage:tag &gt; myimage.tar</code>. Max ~100 MB.
            </p>
            <div className="flex gap-2">
              <Input
                id="tar"
                ref={fileRef}
                type="file"
                accept=".tar,application/x-tar"
                disabled={scanTar.isPending}
              />
              <Button
                onClick={() => {
                  const f = fileRef.current?.files?.[0];
                  if (!f) return toast.error("Choose a .tar file first");
                  scanTar.mutate(f);
                }}
                disabled={scanTar.isPending}
              >
                {scanTar.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" /> Scan uploaded tar</>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      {result && (
        <ScanReport
          title="Scan result"
          result={result}
          onRebuild={
            canRebuildResult(result)
              ? (plan) => rebuild.mutate(plan)
              : undefined
          }
          rebuilding={rebuild.isPending}
          rebuildStatus={rebuildStatus}
        />
      )}

      {afterResult && (
        <>
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <RefreshCcw className="h-4 w-4" /> After fix
          </div>
          <ScanReport title="After fix" result={afterResult} rebuilding={false} rebuildStatus="" />
        </>
      )}
    </div>
  );
}

function ScanReport({
  result,
  onRebuild,
  rebuilding,
  rebuildStatus,
}: {
  title: string;
  result: ScanResult;
  onRebuild?: (plan: FixPlan) => void;
  rebuilding: boolean;
  rebuildStatus: string;
}) {
  const clean = result.totalCves === 0;
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${clean ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
            {clean ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold">{result.image}</div>
            <div className="text-xs text-muted-foreground">
              {result.osRelease} · {result.packageCount} packages · {result.packageManager}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${clean ? "text-success" : "text-destructive"}`}>
              {result.totalCves}
            </div>
            <div className="text-xs text-muted-foreground">CVEs</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{result.vulnerabilities.length}</div>
            <div className="text-xs text-muted-foreground">Affected packages</div>
          </div>
        </div>

        {result.note && (
          <div className="mt-4 flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span>{result.note}</span>
          </div>
        )}

        {!clean && onRebuild && (
          <div className="mt-4">
            <Button
              onClick={() =>
                onRebuild({
                  baseImage: result.image,
                  packageManager: result.packageManager as FixPlan["packageManager"],
                  upgrades: result.vulnerabilities.map((v) => v.name),
                })
              }
              disabled={rebuilding}
              className="w-full sm:w-auto"
            >
              {rebuilding ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {rebuildStatus || "Building…"}</>
              ) : (
                <><Download className="mr-2 h-4 w-4" /> Rebuild, download &amp; rescan</>
              )}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Builds <code>FROM {result.image}</code> with <code>{result.packageManager} upgrade</code> for {result.vulnerabilities.length} package(s),
              streams the fixed <code>.tar</code> back, then rescans it to verify the fix.
            </p>
          </div>
        )}
      </Card>

      {result.vulnerabilities.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="border-b border-border bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vulnerabilities
          </div>
          <div className="divide-y divide-border">
            {result.vulnerabilities.map((v) => (
              <div key={v.name} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-sm font-semibold">{v.name}</div>
                    <div className="text-xs text-muted-foreground">
                      installed <code>{v.installedVersion}</code> · {v.ecosystem}
                    </div>
                  </div>
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                    {v.vulns.length} CVE{v.vulns.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {v.vulns.slice(0, 20).map((c) => (
                    <a
                      key={c.id}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 font-mono text-[11px] hover:bg-muted"
                    >
                      {c.id}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                  {v.vulns.length > 20 && (
                    <span className="px-2 py-0.5 text-[11px] text-muted-foreground">
                      +{v.vulns.length - 20} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
