// Client-side Docker image packaging pipeline.
// Fetches manifest + config + layers via the /api/public/registry/* proxy,
// gunzips layers, hashes them, and emits a Docker-loadable tar via TarWriter.

import { inflate } from "pako";
import type { ParsedRef } from "@/lib/registries";
import { TarWriter, createArraySink, createStreamSink } from "./tar-writer";

export interface LayerProgress {
  index: number;
  digest: string;
  downloaded: number;
  total: number;
  speedBps: number;
}

export interface ImageProgress {
  imageIndex: number;
  totalImages: number;
  ref: string;
  phase: "manifest" | "config" | "layers" | "packaging" | "done" | "error";
  layer?: LayerProgress;
  overallBytes: number;
  overallTotal: number;
  message?: string;
}

export type ProgressCallback = (p: ImageProgress) => void;

interface DockerManifest {
  schemaVersion?: number;
  mediaType?: string;
  config: { mediaType: string; digest: string; size: number };
  layers: Array<{ mediaType: string; digest: string; size: number }>;
}

interface ResolvedImage {
  ref: ParsedRef;
  manifest: DockerManifest;
  configBytes: Uint8Array;
  configDigest: string; // sha256:xxxx
  configId: string; // hex without prefix, used for filenames
}

async function fetchManifest(ref: ParsedRef, arch: string): Promise<{
  manifest: DockerManifest;
  digest: string;
}> {
  const url = new URL("/api/public/registry/manifest", window.location.origin);
  url.searchParams.set("registry", ref.registry);
  url.searchParams.set("repo", ref.repository);
  url.searchParams.set("reference", ref.reference);
  url.searchParams.set("arch", arch);
  url.searchParams.set("os", "linux");
  if (ref.registry === "custom") url.searchParams.set("host", ref.host);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest: ${res.status} ${await res.text()}`);
  const data: {
    kind: string;
    manifest?: DockerManifest;
    index?: unknown;
    digest: string;
  } = await res.json();
  if (data.kind !== "manifest" || !data.manifest) {
    throw new Error(
      `manifest is a multi-arch index but no ${arch} match was found`,
    );
  }
  return { manifest: data.manifest, digest: data.digest };
}

async function fetchBlob(
  ref: ParsedRef,
  digest: string,
  totalHint: number,
  onProgress?: (downloaded: number, total: number, speedBps: number) => void,
): Promise<Uint8Array> {
  const url = new URL("/api/public/registry/blob", window.location.origin);
  url.searchParams.set("registry", ref.registry);
  url.searchParams.set("repo", ref.repository);
  url.searchParams.set("digest", digest);
  if (ref.registry === "custom") url.searchParams.set("host", ref.host);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`blob ${digest}: ${res.status}`);
  const contentLen = Number(res.headers.get("content-length")) || totalHint;

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let downloaded = 0;
  const start = performance.now();
  let lastReport = start;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    downloaded += value.byteLength;
    const now = performance.now();
    if (onProgress && now - lastReport > 120) {
      const elapsed = (now - start) / 1000;
      const speed = elapsed > 0 ? downloaded / elapsed : 0;
      onProgress(downloaded, contentLen, speed);
      lastReport = now;
    }
  }
  if (onProgress) {
    const elapsed = (performance.now() - start) / 1000;
    onProgress(downloaded, contentLen, elapsed > 0 ? downloaded / elapsed : 0);
  }
  const out = new Uint8Array(downloaded);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++)
    s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return bytesToHex(new Uint8Array(buf));
}

// Resolve manifest + config for one image and download all layers.
// Returns raw (already-gunzipped) layer tarballs keyed by their diff_id.
async function resolveImage(
  ref: ParsedRef,
  arch: string,
  imageIndex: number,
  totalImages: number,
  onProgress: ProgressCallback,
): Promise<{
  resolved: ResolvedImage;
  layerTars: Uint8Array[]; // uncompressed layer tars, in order
  layerDigests: string[]; // original compressed digests (sha256:xxx)
}> {
  onProgress({
    imageIndex,
    totalImages,
    ref: ref.raw,
    phase: "manifest",
    overallBytes: 0,
    overallTotal: 0,
  });
  const { manifest, digest: manifestDigest } = await fetchManifest(ref, arch);

  onProgress({
    imageIndex,
    totalImages,
    ref: ref.raw,
    phase: "config",
    overallBytes: 0,
    overallTotal: manifest.layers.reduce((s, l) => s + l.size, 0),
  });
  const configBytes = await fetchBlob(ref, manifest.config.digest, manifest.config.size);
  const configId = manifest.config.digest.replace(/^sha256:/, "");

  const resolved: ResolvedImage = {
    ref,
    manifest,
    configBytes,
    configDigest: manifest.config.digest,
    configId,
  };
  void manifestDigest;

  const layerTars: Uint8Array[] = [];
  const layerDigests: string[] = [];
  const overallTotal = manifest.layers.reduce((s, l) => s + l.size, 0);
  let cumulative = 0;

  for (let i = 0; i < manifest.layers.length; i++) {
    const layer = manifest.layers[i];
    const bytes = await fetchBlob(ref, layer.digest, layer.size, (d, t, s) => {
      onProgress({
        imageIndex,
        totalImages,
        ref: ref.raw,
        phase: "layers",
        layer: { index: i, digest: layer.digest, downloaded: d, total: t, speedBps: s },
        overallBytes: cumulative + d,
        overallTotal,
      });
    });
    cumulative += bytes.byteLength;
    // gunzip if compressed
    const isGzip =
      layer.mediaType.includes("gzip") ||
      (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b);
    const rawTar = isGzip ? inflate(bytes) : bytes;
    layerTars.push(rawTar);
    layerDigests.push(layer.digest);
  }
  return { resolved, layerTars, layerDigests };
}

// Build a Docker image tarball ready for `docker load`.
// If multiple images share layers by digest, they are deduplicated.
export async function packageImages(
  refs: ParsedRef[],
  arch: string,
  onProgress: ProgressCallback,
): Promise<{ blob: Blob; filename: string; usedStream: false } | { usedStream: true; filename: string }> {
  const resolved: Array<Awaited<ReturnType<typeof resolveImage>>> = [];
  for (let i = 0; i < refs.length; i++) {
    resolved.push(await resolveImage(refs[i], arch, i, refs.length, onProgress));
  }

  onProgress({
    imageIndex: refs.length,
    totalImages: refs.length,
    ref: refs.map((r) => r.raw).join(", "),
    phase: "packaging",
    overallBytes: 0,
    overallTotal: 0,
  });

  // Compute diff_ids (sha256 of uncompressed layer tars) per image.
  // These are directory names in the tar.
  interface LayerFileEntry {
    dirName: string; // diff_id hex
    tar: Uint8Array;
  }
  const layerFiles = new Map<string, LayerFileEntry>();
  const perImageLayerDirs: string[][] = [];

  for (const r of resolved) {
    const dirs: string[] = [];
    for (const raw of r.layerTars) {
      const diffId = await sha256Hex(raw);
      if (!layerFiles.has(diffId)) {
        layerFiles.set(diffId, { dirName: diffId, tar: raw });
      }
      dirs.push(diffId);
    }
    perImageLayerDirs.push(dirs);
  }

  // Build manifest.json
  const manifestJson = resolved.map((r, i) => {
    const repoTag = r.resolved.ref.isDigest
      ? `${r.resolved.ref.repository}@${r.resolved.ref.reference}`
      : `${r.resolved.ref.repository}:${r.resolved.ref.reference}`;
    // Include registry host prefix for non-docker registries
    const withHost =
      r.resolved.ref.registry === "docker" &&
      r.resolved.ref.repository.startsWith("library/")
        ? `${r.resolved.ref.repository.replace(/^library\//, "")}:${r.resolved.ref.reference}`
        : r.resolved.ref.registry === "docker"
          ? repoTag
          : `${r.resolved.ref.host}/${repoTag}`;
    return {
      Config: `${r.resolved.configId}.json`,
      RepoTags: [withHost],
      Layers: perImageLayerDirs[i].map((d) => `${d}/layer.tar`),
    };
  });

  // repositories legacy file
  const repositories: Record<string, Record<string, string>> = {};
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    const dirs = perImageLayerDirs[i];
    const topLayer = dirs[dirs.length - 1];
    const repoKey =
      r.resolved.ref.registry === "docker"
        ? r.resolved.ref.repository.replace(/^library\//, "")
        : `${r.resolved.ref.host}/${r.resolved.ref.repository}`;
    if (!repositories[repoKey]) repositories[repoKey] = {};
    if (!r.resolved.ref.isDigest) {
      repositories[repoKey][r.resolved.ref.reference] = topLayer;
    }
  }

  // Write everything into a tar.
  const filename =
    refs.length === 1
      ? `${sanitize(refs[0].raw)}.tar`
      : `images-${new Date().toISOString().replace(/[:.]/g, "-")}.tar`;

  // Try File System Access API for true streaming.
  const canStream =
    typeof (window as unknown as { showSaveFilePicker?: unknown })
      .showSaveFilePicker === "function";

  const encoder = new TextEncoder();

  async function writeAllTo(writer: TarWriter) {
    for (const r of resolved) {
      await writer.addFileBytes(`${r.resolved.configId}.json`, r.resolved.configBytes);
    }
    for (const [, entry] of layerFiles) {
      await writer.addFileBytes(`${entry.dirName}/layer.tar`, entry.tar);
    }
    await writer.addFileBytes(
      "manifest.json",
      encoder.encode(JSON.stringify(manifestJson)),
    );
    await writer.addFileBytes(
      "repositories",
      encoder.encode(JSON.stringify(repositories)),
    );
    await writer.finalize();
  }

  if (canStream) {
    try {
      const handle = await (
        window as unknown as {
          showSaveFilePicker: (opts: unknown) => Promise<{
            createWritable: () => Promise<WritableStream<Uint8Array>>;
          }>;
        }
      ).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Docker image tar", accept: { "application/x-tar": [".tar"] } }],
      });
      const stream = await handle.createWritable();
      const writer = new TarWriter(createStreamSink(stream.getWriter()));
      await writeAllTo(writer);
      await stream.close();
      onProgress({
        imageIndex: refs.length,
        totalImages: refs.length,
        ref: refs.map((r) => r.raw).join(", "),
        phase: "done",
        overallBytes: 0,
        overallTotal: 0,
      });
      return { usedStream: true, filename };
    } catch (err) {
      // User cancelled or unsupported — fall through to Blob path
      if ((err as Error).name === "AbortError") {
        throw err;
      }
    }
  }

  const { sink, chunks } = createArraySink();
  const writer = new TarWriter(sink);
  await writeAllTo(writer);
  const blob = new Blob(chunks as BlobPart[], { type: "application/x-tar" });
  onProgress({
    imageIndex: refs.length,
    totalImages: refs.length,
    ref: refs.map((r) => r.raw).join(", "),
    phase: "done",
    overallBytes: blob.size,
    overallTotal: blob.size,
  });
  return { blob, filename, usedStream: false };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}
