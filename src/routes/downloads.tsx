import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  Play,
  Package,
  Check,
  X,
  Download,
  Layers,
  Ship,
  Container,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAppStore, type QueueItem } from "@/lib/store";
import { formatBytes, formatSpeed } from "@/lib/format";
import { packageImages, type ImageProgress } from "@/lib/packager";
import { RegistryBadge } from "@/components/registry-badge";
import { shortDigest } from "@/lib/registries";

const search = z
  .object({
    id: z.string().optional(),
    batch: z.string().optional(),
  })
  .partial();

export const Route = createFileRoute("/downloads")({
  head: () => ({
    meta: [
      { title: "Downloads — Live layer streaming" },
      {
        name: "description",
        content:
          "Watch layers stream from any OCI registry through the packager pipeline into a docker-loadable tarball.",
      },
    ],
  }),
  validateSearch: (raw) => search.parse(raw),
  component: DownloadsPage,
});

interface ChartProgress {
  kind: "chart";
  label: string;
  bytes: number;
  total: number;
  phase: "downloading" | "done" | "error";
  message?: string;
}

type LiveProgress = ImageProgress | ChartProgress;

function DownloadsPage() {
  const { id, batch } = Route.useSearch();
  const queue = useAppStore((s) => s.queue);
  const pushHistory = useAppStore((s) => s.pushHistory);
  const remove = useAppStore((s) => s.remove);

  const [progress, setProgress] = useState<LiveProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<
    Array<{ label: string; bytes: number; filename: string; at: number }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);

  // Auto-trigger from search params
  useEffect(() => {
    const key = `${id ?? ""}|${batch ?? ""}`;
    if (!id && !batch) return;
    if (startedRef.current === key) return;
    startedRef.current = key;
    if (batch) {
      const images = queue.filter((q): q is Extract<QueueItem, { type: "image" }> => q.type === "image");
      if (images.length > 0) void runBatch(images);
    } else if (id) {
      const item = queue.find((q) => q.id === id);
      if (item) void runSingle(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, batch]);

  async function runSingle(item: QueueItem) {
    setError(null);
    setRunning(true);
    setProgress(null);
    try {
      if (item.type === "image") {
        const result = await packageImages([item.ref], item.arch, setProgress);
        await deliver(result);
        const bytes = "blob" in result ? result.blob.size : 0;
        pushHistory({
          label: item.ref.raw,
          kind: "image",
          bytes,
          filename: result.filename,
        });
        setDone((d) => [...d, { label: item.ref.raw, bytes, filename: result.filename, at: Date.now() }]);
        remove(item.id);
        toast.success(`Packaged ${item.ref.raw}`);
      } else {
        await runChart(item);
        remove(item.id);
      }
    } catch (err) {
      const msg = (err as Error).message || "failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  async function runBatch(items: Array<Extract<QueueItem, { type: "image" }>>) {
    setError(null);
    setRunning(true);
    setProgress(null);
    try {
      const arch = items[0].arch;
      const result = await packageImages(items.map((i) => i.ref), arch, setProgress);
      await deliver(result);
      const bytes = "blob" in result ? result.blob.size : 0;
      const label = `${items.length} images bundle`;
      pushHistory({ label, kind: "batch", bytes, filename: result.filename });
      setDone((d) => [...d, { label, bytes, filename: result.filename, at: Date.now() }]);
      for (const i of items) remove(i.id);
      toast.success(`Packaged ${items.length} images`);
    } catch (err) {
      const msg = (err as Error).message || "failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  async function runChart(item: Extract<QueueItem, { type: "chart" }>) {
    const label = item.repoName ? `${item.repoName}/${item.chartName}` : item.chartName;
    setProgress({ kind: "chart", label, bytes: 0, total: 0, phase: "downloading" });
    const url = new URL("/api/public/helm/chart", window.location.origin);
    if (item.directUrl) url.searchParams.set("url", item.directUrl);
    else {
      url.searchParams.set("repo", item.repoName ?? "");
      url.searchParams.set("name", item.chartName);
      if (item.version) url.searchParams.set("version", item.version);
    }
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`chart fetch ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done: d, value } = await reader.read();
      if (d) break;
      parts.push(value);
      bytes += value.byteLength;
      setProgress({ kind: "chart", label, bytes, total, phase: "downloading" });
    }
    const blob = new Blob(parts as BlobPart[], { type: "application/gzip" });
    const filename = `${item.chartName}${item.version ? "-" + item.version : ""}.tgz`;
    triggerDownload(blob, filename);
    pushHistory({ label, kind: "chart", bytes: blob.size, filename });
    setDone((dn) => [...dn, { label, bytes: blob.size, filename, at: Date.now() }]);
    setProgress({ kind: "chart", label, bytes, total: bytes, phase: "done" });
    toast.success(`Downloaded ${filename}`);
  }

  async function deliver(result: Awaited<ReturnType<typeof packageImages>>) {
    if (result.usedStream) return;
    triggerDownload(result.blob, result.filename);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Downloads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live layer-by-layer progress. The packager streams blobs through the edge
          proxy, gunzips them client-side, and writes a valid Docker image tar.
        </p>
      </div>

      {!progress && !running && (
        <Card className="border-dashed p-12 text-center">
          <Download className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-4 text-sm text-muted-foreground">
            Trigger a pull from the <a href="/queue" className="text-primary-glow hover:underline">Queue</a> page.
          </div>
        </Card>
      )}

      {progress && "kind" in progress && progress.kind === "chart" ? (
        <ChartProgressCard p={progress} />
      ) : progress ? (
        <ImageProgressCard p={progress as ImageProgress} />
      ) : null}

      {error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <X className="h-4 w-4" /> {error}
          </div>
        </Card>
      )}

      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Completed this session
          </h2>
          <div className="space-y-2">
            {done.map((d, i) => (
              <Card key={i} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Check className="h-4 w-4 text-success" />
                  <div>
                    <div className="font-mono text-sm">{d.label}</div>
                    <div className="text-xs text-muted-foreground">{d.filename}</div>
                  </div>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {formatBytes(d.bytes)}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <ManualTriggers running={running} onStart={(q) => runSingle(q)} onBatch={runBatch} />
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImageProgressCard({ p }: { p: ImageProgress }) {
  const overallPct =
    p.overallTotal > 0 ? Math.min(100, (p.overallBytes / p.overallTotal) * 100) : 0;
  const layerPct = p.layer && p.layer.total > 0 ? (p.layer.downloaded / p.layer.total) * 100 : 0;

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Container className="h-5 w-5 text-primary-glow" />
          <div>
            <div className="font-mono text-sm">{p.ref}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className={p.phase === "done" ? "text-success" : "text-primary-glow"}>
                {p.phase}
              </span>
              {p.totalImages > 1 && (
                <span>
                  image {p.imageIndex + 1} / {p.totalImages}
                </span>
              )}
            </div>
          </div>
        </div>
        {p.phase === "done" ? (
          <Check className="h-5 w-5 text-success" />
        ) : (
          <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Overall</span>
          <span className="font-mono">
            {formatBytes(p.overallBytes)} / {formatBytes(p.overallTotal)}
          </span>
        </div>
        <Progress value={overallPct} className="h-2" />
      </div>

      {p.layer && (
        <div className="rounded-lg border border-border/60 bg-surface/50 p-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-primary-glow" />
              <span className="font-mono">
                layer #{p.layer.index + 1}
              </span>
              <span className="font-mono text-muted-foreground">
                {shortDigest(p.layer.digest, 16)}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-muted-foreground">
              <span>{formatSpeed(p.layer.speedBps)}</span>
              <span>
                {formatBytes(p.layer.downloaded)} / {formatBytes(p.layer.total)}
              </span>
            </div>
          </div>
          <Progress value={layerPct} className="mt-2 h-1.5" />
        </div>
      )}

      {p.phase === "packaging" && (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs">
          <Package className="mr-1 inline h-3.5 w-3.5" />
          Assembling tarball · writing manifest.json and layer directories…
        </div>
      )}
    </Card>
  );
}

function ChartProgressCard({ p }: { p: ChartProgress }) {
  const pct = p.total > 0 ? (p.bytes / p.total) * 100 : p.phase === "done" ? 100 : 0;
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Ship className="h-5 w-5 text-primary-glow" />
          <div>
            <div className="font-mono text-sm">{p.label}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-widest text-primary-glow">
              {p.phase}
            </div>
          </div>
        </div>
        {p.phase === "done" && <Check className="h-5 w-5 text-success" />}
      </div>
      <Progress value={pct} className="h-2" />
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>{formatBytes(p.bytes)}</span>
        <span>{p.total > 0 ? formatBytes(p.total) : "streaming…"}</span>
      </div>
    </Card>
  );
}

function ManualTriggers({
  running,
  onStart,
  onBatch,
}: {
  running: boolean;
  onStart: (q: QueueItem) => void;
  onBatch: (items: Array<Extract<QueueItem, { type: "image" }>>) => void;
}) {
  const queue = useAppStore((s) => s.queue);
  const images = queue.filter((q): q is Extract<QueueItem, { type: "image" }> => q.type === "image");
  if (queue.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Pending in queue
      </h2>
      {images.length > 1 && (
        <Button
          disabled={running}
          className="gradient-primary text-primary-foreground border-0"
          onClick={() => onBatch(images)}
        >
          <Package className="mr-1 h-4 w-4" />
          Package {images.length} images as single archive
        </Button>
      )}
      <div className="space-y-2">
        {queue.map((q) => (
          <Card key={q.id} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              {q.type === "image" ? (
                <>
                  <Container className="h-4 w-4 text-primary-glow" />
                  <RegistryBadge id={q.ref.registry} />
                  <span className="font-mono text-sm">{q.ref.raw}</span>
                </>
              ) : (
                <>
                  <Ship className="h-4 w-4 text-primary-glow" />
                  <span className="font-mono text-sm">
                    {q.repoName ? `${q.repoName}/${q.chartName}` : q.chartName}
                  </span>
                </>
              )}
            </div>
            <Button
              size="sm"
              disabled={running}
              variant="outline"
              onClick={() => onStart(q)}
            >
              <Play className="mr-1 h-3.5 w-3.5" /> Start
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
