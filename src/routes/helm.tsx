import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Ship, Star, Tag as TagIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/helm")({
  head: () => ({
    meta: [
      { title: "Helm Charts — Package .tgz bundles" },
      {
        name: "description",
        content:
          "Search Artifact Hub or paste a direct chart URL. Downloaded charts stream through the packager as .tgz files.",
      },
      { property: "og:title", content: "Helm Charts — Air-Gapped Packager" },
      { property: "og:description", content: "Pull Helm charts from Artifact Hub for air-gapped clusters." },
    ],
  }),
  component: HelmPage,
});

interface HubResult {
  id: string;
  name: string;
  version: string;
  description: string;
  repoName: string;
  repoUrl: string;
  stars: number;
}

function HelmPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Helm Charts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add Helm charts to your queue as <code className="font-mono text-primary-glow">.tgz</code> bundles.
        </p>
      </div>

      <Tabs defaultValue="search" className="space-y-6">
        <TabsList className="bg-surface">
          <TabsTrigger value="search">Artifact Hub</TabsTrigger>
          <TabsTrigger value="url">Direct URL</TabsTrigger>
        </TabsList>
        <TabsContent value="search"><HubSearch /></TabsContent>
        <TabsContent value="url"><DirectUrl /></TabsContent>
      </Tabs>
    </div>
  );
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function HubSearch() {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 300);

  const query = useQuery({
    queryKey: ["hub-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/registry/search?source=artifacthub&q=${encodeURIComponent(debounced)}`,
      );
      if (!res.ok) throw new Error("search failed");
      const data: { results: HubResult[] } = await res.json();
      return data.results;
    },
  });

  return (
    <div className="space-y-4">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Start typing a chart name (e.g. ingress-nginx, prometheus)…"
          className="pl-9 font-mono"
          autoFocus
        />
        {query.isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {debounced.length > 0 && debounced.length < 2 && (
        <div className="text-xs text-muted-foreground">Keep typing…</div>
      )}
      {query.error && <div className="text-sm text-destructive">{(query.error as Error).message}</div>}

      {query.data?.map((r) => (
        <ChartResultCard key={r.id} r={r} />
      ))}
    </div>
  );
}


function DirectUrl() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const addChart = useAppStore((s) => s.addChart);
  return (
    <Card className="p-6 space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Chart .tgz URL</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://charts.example.com/mychart-1.0.0.tgz"
          className="font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Display name
        </Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mychart"
          className="font-mono"
        />
      </div>
      <Button
        disabled={!url || !name}
        onClick={() => {
          addChart({ chartName: name, directUrl: url });
          toast.success(`Added ${name}`);
          setUrl(""); setName("");
        }}
        className="gradient-primary text-primary-foreground border-0"
      >
        <Plus className="mr-1 h-4 w-4" /> Add to queue
      </Button>
    </Card>
  );
}

interface ChartVersion {
  version: string;
  appVersion: string | null;
  ts: number | null;
}

function ChartResultCard({ r }: { r: HubResult }) {
  const [open, setOpen] = useState(false);
  const addChart = useAppStore((s) => s.addChart);

  const versions = useQuery({
    queryKey: ["hub-versions", r.repoName, r.name],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/helm/versions?repo=${encodeURIComponent(r.repoName)}&name=${encodeURIComponent(r.name)}`,
      );
      if (!res.ok) throw new Error(`versions ${res.status}`);
      const data: { versions: ChartVersion[] } = await res.json();
      return data.versions;
    },
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Ship className="h-4 w-4 text-primary-glow" />
            <div className="font-mono text-sm font-semibold">
              {r.repoName}/{r.name}
            </div>
            <span className="rounded border border-border/60 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              latest v{r.version}
            </span>
          </div>
          <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            {r.description || "No description."}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Star className="h-3 w-3" /> {r.stars}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
            <TagIcon className="mr-1 h-3.5 w-3.5" />
            {open ? "Hide versions" : "View versions"}
          </Button>
          <Button
            size="sm"
            className="gradient-primary text-primary-foreground border-0"
            onClick={() => {
              addChart({ repoName: r.repoName, chartName: r.name, version: r.version });
              toast.success(`Added ${r.repoName}/${r.name} v${r.version}`);
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Queue latest
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-border/60 pt-4">
          {versions.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading versions…
            </div>
          )}
          {versions.error && (
            <div className="text-sm text-destructive">
              {(versions.error as Error).message}
            </div>
          )}
          {versions.data && (
            <div className="max-h-80 overflow-y-auto rounded-md border border-border/60">
              {versions.data.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-b-0 hover:bg-surface/60"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm">v{v.version}</div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                      {v.appVersion && <span>app v{v.appVersion}</span>}
                      {v.ts && (
                        <span>{new Date(v.ts * 1000).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="gradient-primary text-primary-foreground border-0"
                    onClick={() => {
                      addChart({
                        repoName: r.repoName,
                        chartName: r.name,
                        version: v.version,
                      });
                      toast.success(`Added ${r.repoName}/${r.name} v${v.version}`);
                    }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Queue
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
