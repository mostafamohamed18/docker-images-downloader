import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Container, Star, Download, ExternalLink, Tag as TagIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { REGISTRIES, type RegistryId, parseImageRef } from "@/lib/registries";
import { useAppStore } from "@/lib/store";
import { RegistryBadge } from "@/components/registry-badge";
import { formatBytes } from "@/lib/format";

export const Route = createFileRoute("/images")({
  head: () => ({
    meta: [
      { title: "Images — Pull OCI images from any registry" },
      {
        name: "description",
        content:
          "Search Docker Hub and pull public container images from GHCR, GCR, Chainguard, Quay, or any custom OCI registry.",
      },
      { property: "og:title", content: "Images — Air-Gapped Packager" },
      {
        property: "og:description",
        content: "Pull public container images from any OCI registry as docker load tarballs.",
      },
    ],
  }),
  component: ImagesPage,
});

interface DockerResult {
  name: string;
  description: string;
  stars: number;
  pulls: number;
  official: boolean;
  registry: RegistryId;
}

interface TagInfo {
  name: string;
  size: number;
  updated: string | null;
  digest: string | null;
  architectures: string[];
}

function ImagesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Container Images</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add public images to your queue. Search Docker Hub or browse all available
          tags for any repository across supported registries.
        </p>
      </div>

      <Tabs defaultValue="search" className="space-y-6">
        <TabsList className="bg-surface">
          <TabsTrigger value="search">Docker Hub</TabsTrigger>
          <TabsTrigger value="chainguard">Chainguard</TabsTrigger>
          <TabsTrigger value="tags">Browse tags</TabsTrigger>
          <TabsTrigger value="direct">Direct entry</TabsTrigger>
        </TabsList>

        <TabsContent value="search"><DockerSearch /></TabsContent>
        <TabsContent value="chainguard"><ChainguardSearch /></TabsContent>
        <TabsContent value="tags"><TagBrowser /></TabsContent>
        <TabsContent value="direct"><DirectEntry /></TabsContent>
      </Tabs>
    </div>
  );
}

function DirectEntry() {
  const [registry, setRegistry] = useState<RegistryId>("docker");
  const [image, setImage] = useState("");
  const [reference, setReference] = useState("latest");
  const [arch, setArch] = useState("amd64");
  const [customHost, setCustomHost] = useState("");
  const addImage = useAppStore((s) => s.addImage);

  const onAdd = () => {
    try {
      const full =
        registry === "docker"
          ? `${image}:${reference}`
          : registry === "custom"
            ? `${customHost}/${image}:${reference}`
            : `${REGISTRIES[registry].host}/${image}:${reference}`;
      const parsed = parseImageRef(full, registry);
      addImage(parsed, arch);
      toast.success(`Added ${parsed.raw} to queue`);
      setImage("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const examples = REGISTRIES[registry].examples;

  return (
    <Card className="p-6">
      <div className="grid gap-5 md:grid-cols-[200px_1fr_180px_140px_auto]">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Registry</Label>
          <Select value={registry} onValueChange={(v) => setRegistry(v as RegistryId)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(REGISTRIES) as RegistryId[]).map((r) => (
                <SelectItem key={r} value={r}>{REGISTRIES[r].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Image {registry === "docker" && "(owner/name or just name)"}
          </Label>
          <Input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder={
              registry === "docker"
                ? "nginx or bitnami/postgresql"
                : registry === "ghcr"
                  ? "owner/repo"
                  : registry === "custom"
                    ? "team/app"
                    : "project/image"
            }
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tag or @digest</Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="latest"
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Arch</Label>
          <Select value={arch} onValueChange={setArch}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="amd64">amd64</SelectItem>
              <SelectItem value="arm64">arm64</SelectItem>
              <SelectItem value="arm">arm/v7</SelectItem>
              <SelectItem value="386">386</SelectItem>
              <SelectItem value="ppc64le">ppc64le</SelectItem>
              <SelectItem value="s390x">s390x</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Button onClick={onAdd} disabled={!image} className="gradient-primary text-primary-foreground border-0 glow-primary">
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      {registry === "custom" && (
        <div className="mt-4 space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Custom registry host</Label>
          <Input
            value={customHost}
            onChange={(e) => setCustomHost(e.target.value)}
            placeholder="my.registry.io"
            className="font-mono"
          />
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Examples</div>
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                const p = parseImageRef(ex);
                setImage(p.repository);
                setReference(p.reference);
              }}
              className="font-mono text-xs rounded-md border border-border/70 bg-surface px-2.5 py-1 hover:border-primary/50 hover:text-primary-glow"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between rounded-lg border border-border/60 bg-surface/50 p-4 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Container className="h-4 w-4" />
          Queue an image, then head to
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/queue">
            Queue <Download className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
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

function DockerSearch() {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const debounced = useDebounced(q.trim(), 300);

  const query = useQuery({
    queryKey: ["docker-search", debounced],
    enabled: debounced.length >= 2,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/registry/search?source=docker&q=${encodeURIComponent(debounced)}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `search failed (${res.status})`);
      }
      const data: { results: DockerResult[] } = await res.json();
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
          placeholder="Start typing an image name (e.g. nginx, postgres, redis)…"
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

      {query.data && (
        <div className="space-y-2">
          {query.data.length === 0 && (
            <div className="text-sm text-muted-foreground">No results.</div>
          )}
          {query.data.map((r) => {
            const isOpen = expanded === r.name;
            return (
              <Card key={r.name} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm font-semibold">{r.name}</div>
                      {r.official && <RegistryBadge id="docker" />}
                    </div>
                    <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {r.description || "No description."}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" /> {r.stars.toLocaleString()}
                      </span>
                      <span>{formatBytes(r.pulls)} pulls</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={`https://hub.docker.com/r/${r.name.includes("/") ? r.name : "_/" + r.name}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpanded(isOpen ? null : r.name)}
                    >
                      <TagIcon className="mr-1 h-3.5 w-3.5" />
                      {isOpen ? "Hide tags" : "View tags"}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-4 border-t border-border/60 pt-4">
                    <TagsList registry="docker" repo={r.name} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TagBrowser() {
  const [registry, setRegistry] = useState<RegistryId>("docker");
  const [repo, setRepo] = useState("");
  const [host, setHost] = useState("");
  const [submitted, setSubmitted] = useState<{ registry: RegistryId; repo: string; host?: string } | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="grid gap-5 md:grid-cols-[200px_1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Registry</Label>
            <Select value={registry} onValueChange={(v) => setRegistry(v as RegistryId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(REGISTRIES) as RegistryId[]).map((r) => (
                  <SelectItem key={r} value={r}>{REGISTRIES[r].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Repository
            </Label>
            <Input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder={
                registry === "docker"
                  ? "nginx or bitnami/postgresql"
                  : "owner/repo"
              }
              className="font-mono"
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={!repo || (registry === "custom" && !host)}
              onClick={() => setSubmitted({ registry, repo, host: host || undefined })}
              className="gradient-primary text-primary-foreground border-0"
            >
              <Search className="mr-1 h-4 w-4" /> List tags
            </Button>
          </div>
        </div>
        {registry === "custom" && (
          <div className="mt-4 space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Custom registry host</Label>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="my.registry.io"
              className="font-mono"
            />
          </div>
        )}
      </Card>

      {submitted && (
        <Card className="p-4">
          <TagsList
            registry={submitted.registry}
            repo={submitted.repo}
            host={submitted.host}
          />
        </Card>
      )}
    </div>
  );
}

function TagsList({
  registry,
  repo,
  host,
}: {
  registry: RegistryId;
  repo: string;
  host?: string;
}) {
  const [arch, setArch] = useState("amd64");
  const [filter, setFilter] = useState("");
  const [showArtifacts, setShowArtifacts] = useState(false);
  const addImage = useAppStore((s) => s.addImage);

  const query = useQuery({
    queryKey: ["tags", registry, repo, host],
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const params = new URLSearchParams({ registry, repo, limit: "500" });
      if (host) params.set("host", host);
      const res = await fetch(`/api/public/registry/tags?${params}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `tag lookup failed (${res.status})`);
      }
      const data: { tags: TagInfo[] } = await res.json();
      return data.tags;
    },
  });

  const queueTag = (tagName: string) => {
    try {
      const full =
        registry === "docker"
          ? `${repo}:${tagName}`
          : registry === "custom"
            ? `${host}/${repo}:${tagName}`
            : `${REGISTRIES[registry].host}/${repo}:${tagName}`;
      const parsed = parseImageRef(full, registry);
      addImage(parsed, arch);
      toast.success(`Added ${parsed.raw}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (query.isLoading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tags…
      </div>
    );
  if (query.error)
    return <div className="text-sm text-destructive">{(query.error as Error).message}</div>;

  const isArtifact = (name: string) =>
    /\.(sig|att|sbom)$/.test(name) || /^sha256[-:]/.test(name);

  const all = query.data ?? [];
  const withoutArtifacts = all.filter((t) => showArtifacts || !isArtifact(t.name));
  const tags = withoutArtifacts.filter((t) =>
    filter ? t.name.toLowerCase().includes(filter.toLowerCase()) : true,
  );
  const artifactCount = all.length - all.filter((t) => !isArtifact(t.name)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{repo}</span> —{" "}
          {withoutArtifacts.length} tags
          {artifactCount > 0 && !showArtifacts && (
            <>
              {" "}
              <button
                onClick={() => setShowArtifacts(true)}
                className="ml-1 text-primary-glow hover:underline"
              >
                (+{artifactCount} signature artifacts hidden)
              </button>
            </>
          )}
          {showArtifacts && (
            <button
              onClick={() => setShowArtifacts(false)}
              className="ml-1 text-primary-glow hover:underline"
            >
              (hide signature artifacts)
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags…"
            className="h-8 w-40 font-mono text-xs"
          />
          <Select value={arch} onValueChange={setArch}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="amd64">amd64</SelectItem>
              <SelectItem value="arm64">arm64</SelectItem>
              <SelectItem value="arm">arm/v7</SelectItem>
              <SelectItem value="386">386</SelectItem>
              <SelectItem value="ppc64le">ppc64le</SelectItem>
              <SelectItem value="s390x">s390x</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-md border border-border/60">
        {tags.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No tags match.</div>
        )}
        {tags.map((t) => (
          <div
            key={t.name}
            className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-b-0 hover:bg-surface/60"
          >
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm">{t.name}</div>
              <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                {t.size > 0 && <span>{formatBytes(t.size)}</span>}
                {t.updated && <span>{new Date(t.updated).toLocaleDateString()}</span>}
                {t.architectures.length > 0 && (
                  <span className="font-mono">{t.architectures.join(", ")}</span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              className="gradient-primary text-primary-foreground border-0"
              onClick={() => queueTag(t.name)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Queue
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ChainguardResult {
  name: string;
  slug: string;
  description: string;
  url: string;
}

function ChainguardSearch() {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const debounced = useDebounced(q.trim(), 300);

  const query = useQuery({
    queryKey: ["chainguard-search", debounced],
    enabled: debounced.length >= 1,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/registry/search?source=chainguard&q=${encodeURIComponent(debounced)}`,
      );
      if (!res.ok) throw new Error("search failed");
      const data: { results: ChainguardResult[] } = await res.json();
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
          placeholder="Start typing a Chainguard image name (e.g. tomcat, nginx, python)…"
          className="pl-9 font-mono"
          autoFocus
        />
        {query.isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="rounded-md border border-border/60 bg-surface/40 p-3 text-xs text-muted-foreground">
        Chainguard's public/free images only publish rolling tags such as{" "}
        <code className="font-mono text-primary-glow">latest</code> and{" "}
        <code className="font-mono text-primary-glow">latest-dev</code>. Version-pinned
        tags (e.g. <code className="font-mono">tomcat-9.0.83</code>) require a paid
        Chainguard subscription and are not exposed anonymously.
      </div>

      {query.error && (
        <div className="text-sm text-destructive">{(query.error as Error).message}</div>
      )}

      {query.data && (
        <div className="space-y-2">
          {query.data.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No Chainguard images match. Only images from the public
              chainguard-images/images catalog are listed.
            </div>
          )}
          {query.data.map((r) => {
            const isOpen = expanded === r.slug;
            return (
              <Card key={r.slug} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm font-semibold">{r.name}</div>
                      <RegistryBadge id="chainguard" />
                    </div>
                    <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {r.description}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={r.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpanded(isOpen ? null : r.slug)}
                    >
                      <TagIcon className="mr-1 h-3.5 w-3.5" />
                      {isOpen ? "Hide tags" : "View tags"}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-4 border-t border-border/60 pt-4">
                    <TagsList registry="chainguard" repo={`chainguard/${r.slug}`} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

