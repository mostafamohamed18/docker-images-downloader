import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Trash2, Download, Package, Container, Ship, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { RegistryBadge } from "@/components/registry-badge";
import { shortDigest } from "@/lib/registries";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "Queue — Batch package images and charts" },
      {
        name: "description",
        content:
          "Review and package your queued container images and Helm charts. Merge multiple images into one docker-loadable tarball.",
      },
    ],
  }),
  component: QueuePage,
});

function QueuePage() {
  const queue = useAppStore((s) => s.queue);
  const remove = useAppStore((s) => s.remove);
  const clearQueue = useAppStore((s) => s.clearQueue);
  const navigate = useNavigate();

  const images = queue.filter((q) => q.type === "image");
  const charts = queue.filter((q) => q.type === "chart");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {queue.length} item{queue.length === 1 ? "" : "s"} · {images.length} image
            {images.length === 1 ? "" : "s"} · {charts.length} chart
            {charts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={queue.length === 0}
            onClick={() => clearQueue()}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Clear
          </Button>
          <Button
            disabled={images.length === 0}
            className="gradient-primary text-primary-foreground border-0 glow-primary"
            onClick={() =>
              navigate({ to: "/downloads", search: { batch: "1" } as never })
            }
          >
            <Package className="mr-1 h-4 w-4" />
            Package all as single archive
          </Button>
        </div>
      </div>

      {queue.length === 0 && (
        <Card className="border-dashed p-12 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-4 text-sm text-muted-foreground">
            Your queue is empty.{" "}
            <Link to="/images" className="text-primary-glow hover:underline">
              Add an image
            </Link>{" "}
            or{" "}
            <Link to="/helm" className="text-primary-glow hover:underline">
              a Helm chart
            </Link>
            .
          </div>
        </Card>
      )}

      {images.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Container images
          </h2>
          <div className="space-y-2">
            {images.map((q) => q.type === "image" && (
              <Card key={q.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Container className="h-4 w-4 text-primary-glow shrink-0" />
                  <RegistryBadge id={q.ref.registry} />
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">
                      {q.ref.registry === "docker"
                        ? q.ref.repository.replace(/^library\//, "")
                        : `${q.ref.host}/${q.ref.repository}`}
                      <span className="text-muted-foreground">
                        {q.ref.isDigest ? "@" : ":"}
                      </span>
                      <span className="text-primary-glow">
                        {q.ref.isDigest ? shortDigest(q.ref.reference) : q.ref.reference}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      arch · {q.arch}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({
                        to: "/downloads",
                        search: { id: q.id } as never,
                      })
                    }
                  >
                    <Download className="mr-1 h-3.5 w-3.5" /> Pull
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(q.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {charts.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Helm charts
          </h2>
          <div className="space-y-2">
            {charts.map((q) => q.type === "chart" && (
              <Card key={q.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Ship className="h-4 w-4 text-primary-glow shrink-0" />
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">
                      {q.repoName ? `${q.repoName}/${q.chartName}` : q.chartName}
                      {q.version && (
                        <span className="ml-2 text-muted-foreground">v{q.version}</span>
                      )}
                    </div>
                    {q.directUrl && (
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">
                        {q.directUrl}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({
                        to: "/downloads",
                        search: { id: q.id } as never,
                      })
                    }
                  >
                    <Download className="mr-1 h-3.5 w-3.5" /> Pull
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(q.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
