import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Container,
  Ship,
  ListChecks,
  Package,
  ArrowRight,
  Zap,
  Layers,
  ShieldCheck,
  HardDrive,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { formatBytes } from "@/lib/format";
import { RegistryBadge } from "@/components/registry-badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Docker Images Downloader" },
      {
        name: "description",
        content:
          "Track downloads and cache usage for your air-gapped image and Helm chart packaging workflow.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const history = useAppStore((s) => s.history);
  const queue = useAppStore((s) => s.queue);
  const totalBytes = history.reduce((s, h) => s + h.bytes, 0);
  const imageCount = history.filter((h) => h.kind !== "chart").length;
  const chartCount = history.filter((h) => h.kind === "chart").length;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="surface-panel relative overflow-hidden p-8">
        <div className="absolute inset-0 -z-10 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 20% 0%, color-mix(in oklab, var(--primary) 40%, transparent), transparent 55%)" }} />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary-glow">
              &gt; air-gap · registry · pipeline
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Package any registry into a{" "}
              <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                docker load
              </span>{" "}
              tarball.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Live-pull OCI images from Docker Hub, GHCR, GCR, Chainguard, Quay, or a
              custom registry. Blob streaming, layer dedup, and a browser-side tar
              writer produce clean archives ready for isolated environments.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="lg" className="gradient-primary glow-primary text-primary-foreground border-0">
              <Link to="/images">
                <Container className="mr-2 h-4 w-4" />
                Pull image
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/helm">
                <Ship className="mr-2 h-4 w-4" />
                Pull chart
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard icon={Package} label="Archives built" value={String(history.length)} accent />
        <StatCard icon={Layers} label="Total downloaded" value={formatBytes(totalBytes)} />
        <StatCard icon={ListChecks} label="In queue" value={String(queue.length)} />
        <StatCard icon={HardDrive} label="Cache estimate" value={formatBytes(totalBytes * 0.15)} sub="rolling window" />
      </section>

      {/* Feature grid */}
      <section className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          icon={Zap}
          title="Streaming layer proxy"
          body="Edge functions negotiate anonymous bearer tokens and pipe layer blobs straight to your browser — no server buffering."
        />
        <FeatureCard
          icon={Layers}
          title="Multi-image batching"
          body="Add several images to the queue and merge them into one docker-loadable archive with layer deduplication."
        />
        <FeatureCard
          icon={ShieldCheck}
          title="Public-only, no auth"
          body="Anonymous pulls only. Nothing stored server-side; your queue and history stay in this browser."
        />
      </section>

      {/* Recent activity */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Recent archives</h2>
          <Link to="/downloads" className="text-xs text-muted-foreground hover:text-foreground">
            View all →
          </Link>
        </div>
        {history.length === 0 ? (
          <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
            No archives built yet. Head to{" "}
            <Link to="/images" className="text-primary-glow hover:underline">
              Images
            </Link>{" "}
            to pull your first one.
          </Card>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 6).map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {h.kind === "chart" ? (
                    <Ship className="h-4 w-4 text-primary-glow" />
                  ) : (
                    <Container className="h-4 w-4 text-primary-glow" />
                  )}
                  <div>
                    <div className="font-mono text-sm">{h.label}</div>
                    <div className="text-xs text-muted-foreground">{h.filename}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="font-mono">{formatBytes(h.bytes)}</span>
                  <span>{new Date(h.at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Supported registries */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Supported registries</h2>
        <div className="flex flex-wrap gap-2">
          {(["docker", "ghcr", "gcr", "chainguard", "quay", "custom"] as const).map(
            (id) => (
              <RegistryBadge key={id} id={id} className="px-3 py-1 text-xs" />
            ),
          )}
        </div>
      </section>

      <div className="text-xs text-muted-foreground">
        Built {imageCount} image archive{imageCount === 1 ? "" : "s"} and {chartCount}{" "}
        Helm chart{chartCount === 1 ? "" : "s"} in this browser.
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card className={`p-5 ${accent ? "border-primary/30 bg-primary/5" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Icon className={`h-4 w-4 ${accent ? "text-primary-glow" : "text-muted-foreground"}`} />
      </div>
      <div className="mt-3 font-mono text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Package;
  title: string;
  body: string;
}) {
  return (
    <Card className="group p-5 transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-primary-glow">
        <Icon className="h-4 w-4" />
        <div className="text-sm font-semibold text-foreground">{title}</div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <ArrowRight className="mt-3 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Card>
  );
}
