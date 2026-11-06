# Docker Images Downloader

Search, pull, and package container images and Helm charts from public OCI registries into **docker-loadable `.tar` archives** — entirely in your browser.

> Built for air-gapped and offline environments where you need to move images across a security boundary without a Docker daemon on the source machine.

**Live app:** _add your published URL here_
**Author:** [Mostafa Mohamed](https://www.linkedin.com/in/mostafa-mohamed-ali9/)
**Repo:** https://github.com/mostafamohamed18/docker-images-downloader

---

## Features

- 🔍 **Live search** across Docker Hub, Artifact Hub (Helm), and Chainguard's public catalog — typeahead, no submit button.
- 🏷️ **Full tag / version listing** for any repository, with automatic filtering of cosign `.sig` / `.att` / `.sbom` artifacts.
- 📦 **Client-side OCI packager** — streams blobs through an edge proxy and writes a `docker load`-compatible tar in the browser.
- ⛵ **Helm chart downloader** — resolves chart versions from Artifact Hub and downloads the `.tgz` bundle.
- 🧺 **Batch queue** — add multiple images and merge them into a single archive with layer deduplication.
- 🌐 **Supported registries:** Docker Hub, GHCR, GCR, Chainguard (`cgr.dev`), Quay, and any custom OCI v2 endpoint.
- 🔒 **Anonymous pulls only** — no credentials stored, no server-side buffering, nothing persisted beyond your browser.

## How it works

1. The UI calls a small set of edge API routes under `/api/public/registry/*` and `/api/public/helm/*`.
2. Those routes negotiate anonymous bearer tokens with the target registry and proxy manifest / blob requests.
3. Layer blobs stream straight to the browser, where a tar writer assembles a Docker-compatible archive (`manifest.json` + config + layers).
4. The finished `.tar` is offered as a direct download — ready for `docker load -i image.tar` on the air-gapped host.

## Tech stack

- **TanStack Start** (React 19 + Vite 7) with file-based routing and server functions
- **Tailwind CSS v4** + shadcn/ui components
- **TanStack Query** for data fetching
- **Zustand** for the local queue / history store
- Runs on Cloudflare-style edge workers (no Node runtime required in production)

## Local development

```bash
bun install
bun run dev
```

The app boots on `http://localhost:8080`.

### Useful scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the Vite dev server |
| `bun run build` | Production build |
| `bun run start` | Serve the production build |

## Project structure

```
src/
├── routes/                    # File-based routes (pages + API)
│   ├── index.tsx              # Dashboard
│   ├── images.tsx             # Docker Hub / Chainguard search + pull
│   ├── helm.tsx               # Artifact Hub search + chart download
│   ├── queue.tsx              # Batch queue
│   ├── downloads.tsx          # Built archives
│   └── api/public/
│       ├── registry/          # search, tags, manifest, blob proxy
│       └── helm/              # chart + versions proxy
├── lib/
│   ├── packager/              # OCI → docker-load tar writer
│   ├── registries.ts          # Registry catalog
│   └── store.ts               # Zustand store
└── components/
```

## Usage

1. Open **Images**, pick a source tab (Docker Hub / Chainguard), and start typing an image name.
2. Click **View tags** on a result, then choose the tag you want.
3. Click **Download** to stream the image and save a `docker load`-ready `.tar`.
4. Or add multiple images to the **Queue** and export them as one bundle.

For Helm, open **Helm**, search a chart, pick a version, and download the `.tgz`.

## Notes on Chainguard

Chainguard's public / free images only publish rolling tags (`latest`, `latest-dev`) plus cosign signature artifacts. Version-pinned tags (e.g. `tomcat-9.0.83`) require a paid Chainguard subscription — this app can't retrieve tags that the registry doesn't expose anonymously.

## License

MIT — do what you want, no warranty.

## Credits

Built by [Mostafa Mohamed](https://www.linkedin.com/in/mostafa-mohamed-ali9/).
